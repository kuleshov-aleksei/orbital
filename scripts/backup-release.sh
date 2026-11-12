#!/usr/bin/env bash
# Back up production data to the Garage (S3) backups bucket before a deploy
# replaces any container. Run from the deploy workflow on the orbital host.
#
#   db/<version>/<ts>/orbital.db.gz   SQLite online backup (versioned, pruned by
#                                     scripts/prune-s3-backups.sh)
#   meili/meili.snapshot|meili.dump   Meilisearch snapshot + dump (single copy,
#                                     overwritten on every deploy)
#   media/<dir>/                      incremental mirror of user uploads
#                                     (aws s3 sync --delete)
#
# Each part is skipped (with a warning) when its data or service is not
# deployed yet, e.g. the first deploy or the release that introduces
# Meilisearch. Any other failure exits non-zero and aborts the deploy.
#
# Files under the data dirs are root-owned (written by containers), so they are
# only ever read through read-only mounts into containers, never on the host.
#
# Requires: Docker, AWS_* credentials + endpoint, AWS_CLI_VERSION,
# BACKUP_S3_BUCKET. Restore runbook: docs/notes/BACKUP_RESTORE.md.
# Optional: DEPLOY_DIR (default /opt/orbital), AWS_DOCKER_NETWORK (network for
# the aws-cli container, e.g. the dev Garage's `orbital_default`).
#
# Usage: backup-release.sh <version>

set -euo pipefail

VERSION="${1:?usage: backup-release.sh <version>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/orbital}"
BACKEND_DATA="${DEPLOY_DIR}/data/backend"
MEILI_DATA="${DEPLOY_DIR}/data/meilisearch"
COMPOSE_FILE="${DEPLOY_DIR}/docker-compose.yml"
MEDIA_DIRS=(audio soundboard emojis avatars)
MEILI_TASK_TIMEOUT="${MEILI_TASK_TIMEOUT:-600}"
# Helper image for sqlite3 / stat / sha256sum. The only place it is pinned.
TOOLS_IMAGE="${TOOLS_IMAGE:-alpine:3.24}"

for var in AWS_ENDPOINT_URL AWS_CLI_VERSION BACKUP_S3_BUCKET; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: ${var} is not set" >&2
    exit 1
  fi
done

AWS_IMAGE="${AWS_IMAGE:-amazon/aws-cli:${AWS_CLI_VERSION}}"
REMOTE="s3://${BACKUP_S3_BUCKET}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
GIT_SHA="$(git -C "${SCRIPT_DIR}/.." rev-parse HEAD 2>/dev/null || echo unknown)"

# aws [docker-run-args...] -- <aws args...>
aws() {
  local mounts=()
  while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
    mounts+=("$1")
    shift
  done
  [ "${1:-}" = "--" ] && shift
  docker run --rm \
    -v "${SCRIPT_DIR}/aws-cli-config:/aws/config:ro" -e AWS_CONFIG_FILE=/aws/config \
    --network "${AWS_DOCKER_NETWORK:-bridge}" \
    -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION -e AWS_ENDPOINT_URL \
    "${mounts[@]}" "${AWS_IMAGE}" "$@"
}

# tools <host-dir> <command...>: run a command in the tools image with
# <host-dir> mounted read-only at /src.
tools() {
  local dir="$1"
  shift
  docker run --rm -v "${dir}:/src:ro" "${TOOLS_IMAGE}" "$@"
}

compose() {
  docker compose --project-directory "${DEPLOY_DIR}" -f "${COMPOSE_FILE}" "$@"
}

service_running() {
  [ -f "${COMPOSE_FILE}" ] || return 1
  # Capture first: `grep -q` in a pipeline can SIGPIPE compose under pipefail.
  local running
  running="$(compose ps --status running --services 2>/dev/null || true)"
  printf '%s\n' "${running}" | grep -qx "$1"
}

# verify_upload <key> <expected-size>
verify_upload() {
  local remote_size
  remote_size="$(aws -- s3api head-object --bucket "${BACKUP_S3_BUCKET}" --key "$1" \
    --query ContentLength --output text)"
  if [ "${remote_size}" != "$2" ]; then
    echo "ERROR: ${1}: remote size ${remote_size} != local size ${2}" >&2
    exit 1
  fi
  echo "  verified ${1} (${2} bytes)"
}

# Dedicated staging folder, emptied with a quoted find (never rm $VAR/*).
STAGING="${DEPLOY_DIR}/backup-staging"
mkdir -p "${STAGING}"
cleanup() { find "${STAGING}" -mindepth 1 -delete 2>/dev/null || true; }
trap cleanup EXIT
cleanup

echo "Backing up release ${VERSION} (${TS}) to ${REMOTE}"

# --- SQLite -----------------------------------------------------------------
backup_db() {
  echo "== Database"
  if [ ! -f "${BACKEND_DATA}/orbital.db" ]; then
    echo "WARNING: ${BACKEND_DATA}/orbital.db not found, skipping database backup"
    return
  fi

  # .backup uses SQLite's online backup API: consistent even while the backend
  # is writing. The copy is integrity-checked before it is uploaded.
  docker run --rm \
    -v "${BACKEND_DATA}:/data" -v "${STAGING}:/out" \
    -e OWNER="$(id -u):$(id -g)" \
    "${TOOLS_IMAGE}" sh -euc '
      # Hand the staging files back to the runner even on failure, so the
      # host-side cleanup can delete them.
      trap "chown -R \"\$OWNER\" /out" EXIT
      rm -f /out/orbital.db /out/orbital.db.gz
      apk add --no-cache -q sqlite >/dev/null
      sqlite3 /data/orbital.db ".backup /out/orbital.db"
      result="$(sqlite3 /out/orbital.db "PRAGMA integrity_check;")"
      if [ "$result" != "ok" ]; then
        echo "ERROR: integrity_check on the backup copy: $result" >&2
        exit 1
      fi
      gzip -9 /out/orbital.db
    '

  local size sha key="db/${VERSION}/${TS}"
  size="$(stat -c %s "${STAGING}/orbital.db.gz")"
  sha="$(sha256sum "${STAGING}/orbital.db.gz" | awk '{print $1}')"
  printf 'version=%s\ntimestamp=%s\ngit_sha=%s\norbital.db.gz size=%s sha256=%s\n' \
    "${VERSION}" "${TS}" "${GIT_SHA}" "${size}" "${sha}" > "${STAGING}/manifest.txt"

  aws -v "${STAGING}:/backup:ro" -- s3 cp --no-progress /backup/orbital.db.gz "${REMOTE}/${key}/orbital.db.gz"
  verify_upload "${key}/orbital.db.gz" "${size}"
  aws -v "${STAGING}:/backup:ro" -- s3 cp --no-progress /backup/manifest.txt "${REMOTE}/${key}/manifest.txt"
}

# --- Meilisearch --------------------------------------------------------------
# meili_api <method> <path>: call the Meilisearch API from inside its own
# container (no published port), with the master key from its environment.
meili_api() {
  # shellcheck disable=SC2016 # expanded inside the container, not here
  compose exec -T -e METHOD="$1" -e API_PATH="$2" meilisearch sh -c \
    'curl -fsS -X "$METHOD" -H "Authorization: Bearer $MEILI_MASTER_KEY" "http://localhost:7700$API_PATH"'
}

# meili_wait <taskUid>: wait for a task; failures only show up in the task
# status, never as HTTP errors. Prints the final task JSON.
meili_wait() {
  local uid="$1" deadline=$((SECONDS + MEILI_TASK_TIMEOUT)) task status
  while :; do
    task="$(meili_api GET "/tasks/${uid}")"
    status="$(printf '%s' "${task}" | grep -o '"status":"[a-z]*"' | head -1 | cut -d'"' -f4)"
    case "${status}" in
      succeeded)
        printf '%s' "${task}"
        return 0
        ;;
      failed | canceled)
        echo "ERROR: Meilisearch task ${uid} ${status}: ${task}" >&2
        exit 1
        ;;
    esac
    if [ "${SECONDS}" -ge "${deadline}" ]; then
      echo "ERROR: Meilisearch task ${uid} still '${status}' after ${MEILI_TASK_TIMEOUT}s" >&2
      exit 1
    fi
    sleep 2
  done
}

task_uid() {
  grep -o '"taskUid":[0-9]*' | cut -d: -f2
}

backup_meili() {
  echo "== Meilisearch"
  if ! service_running meilisearch; then
    echo "WARNING: meilisearch is not deployed/running, skipping Meilisearch backup"
    return
  fi

  local meili_version snap_uid dump_uid dump_task dump_name
  meili_version="$(meili_api GET /version | grep -o '"pkgVersion":"[^"]*"' | cut -d'"' -f4)"
  echo "  Meilisearch ${meili_version}"

  snap_uid="$(meili_api POST /snapshots | task_uid)"
  [ -n "${snap_uid}" ] || { echo "ERROR: POST /snapshots returned no taskUid" >&2; exit 1; }
  echo "  snapshot task ${snap_uid}"
  meili_wait "${snap_uid}" >/dev/null

  dump_uid="$(meili_api POST /dumps | task_uid)"
  [ -n "${dump_uid}" ] || { echo "ERROR: POST /dumps returned no taskUid" >&2; exit 1; }
  echo "  dump task ${dump_uid}"
  dump_task="$(meili_wait "${dump_uid}")"
  dump_name="$(printf '%s' "${dump_task}" | grep -o '"dumpUid":"[^"]*"' | cut -d'"' -f4)"
  [ -n "${dump_name}" ] || { echo "ERROR: dump task has no dumpUid: ${dump_task}" >&2; exit 1; }

  # Both tasks succeeded: only now overwrite the remote copy.
  local snap_file="snapshots/data.ms.snapshot" dump_file="dumps/${dump_name}.dump"
  local snap_size dump_size snap_sha dump_sha
  snap_size="$(tools "${MEILI_DATA}" stat -c %s "/src/${snap_file}")"
  dump_size="$(tools "${MEILI_DATA}" stat -c %s "/src/${dump_file}")"
  snap_sha="$(tools "${MEILI_DATA}" sha256sum "/src/${snap_file}" | awk '{print $1}')"
  dump_sha="$(tools "${MEILI_DATA}" sha256sum "/src/${dump_file}" | awk '{print $1}')"

  aws -v "${MEILI_DATA}:/meili:ro" -- s3 cp --no-progress "/meili/${snap_file}" "${REMOTE}/meili/meili.snapshot"
  verify_upload meili/meili.snapshot "${snap_size}"
  aws -v "${MEILI_DATA}:/meili:ro" -- s3 cp --no-progress "/meili/${dump_file}" "${REMOTE}/meili/meili.dump"
  verify_upload meili/meili.dump "${dump_size}"

  # Manifest last: a run that died mid-upload leaves a stale manifest behind.
  printf 'release=%s\ntimestamp=%s\ngit_sha=%s\nmeilisearch=%s\nmeili.snapshot size=%s sha256=%s\nmeili.dump size=%s sha256=%s dump_uid=%s\n' \
    "${VERSION}" "${TS}" "${GIT_SHA}" "${meili_version}" \
    "${snap_size}" "${snap_sha}" "${dump_size}" "${dump_sha}" "${dump_name}" > "${STAGING}/meili-manifest.txt"
  aws -v "${STAGING}:/backup:ro" -- s3 cp --no-progress /backup/meili-manifest.txt "${REMOTE}/meili/manifest.txt"

  # The dump is uploaded: drop the local copy (dumps accumulate otherwise). The
  # snapshot stays; the daily MEILI_SCHEDULE_SNAPSHOT overwrites the same file.
  compose exec -T meilisearch rm -f "/meili_data/${dump_file}"
}

# --- Media --------------------------------------------------------------------
backup_media() {
  echo "== Media"
  local dir count changes
  for dir in "${MEDIA_DIRS[@]}"; do
    if [ ! -d "${BACKEND_DATA}/${dir}" ]; then
      echo "WARNING: ${dir}: not found, skipping (remote mirror left untouched)"
      continue
    fi
    # An empty dir most likely means a wrong mount or path; syncing it with
    # --delete would wipe the whole remote mirror.
    count="$(tools "${BACKEND_DATA}/${dir}" find /src -type f | wc -l)"
    if [ "${count}" -eq 0 ]; then
      echo "WARNING: ${dir}: empty, skipping (remote mirror left untouched)"
      continue
    fi
    changes="$(aws -v "${BACKEND_DATA}/${dir}:/src/${dir}:ro" -- \
      s3 sync --delete --no-progress "/src/${dir}" "${REMOTE}/media/${dir}/")"
    if [ -n "${changes}" ]; then
      printf '%s\n' "${changes}"
    fi
    echo "  ${dir}: ${count} local files, $(printf '%s' "${changes}" | grep -c '^upload:' || true) uploaded, $(printf '%s' "${changes}" | grep -c '^delete:' || true) deleted"
  done
}

backup_db
backup_meili
backup_media

echo "Backup of ${VERSION} complete."

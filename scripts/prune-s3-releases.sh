#!/usr/bin/env bash
# Prune old Electron release artifacts from the Garage (S3) update bucket.
#
# Keeps the newest N versions plus the version currently referenced by the live
# `latest.yml`, deleting the installer/blockmap/AppImage files of everything
# older. Manifests, staging manifests and any non-versioned objects are left
# untouched.
#
# Requires `MC_HOST_garage` to be set (credentials + endpoint) and Docker, since
# mc runs via the minio/mc image.
#
# Usage: prune-s3-releases.sh <bucket> [keep=3]

set -euo pipefail

BUCKET="${1:?usage: prune-s3-releases.sh <bucket> [keep]}"
KEEP="${2:-3}"
MC_IMAGE="${MC_IMAGE:-minio/mc}"
MC_ALIAS="${MC_ALIAS:-garage}"

if [ -z "${MC_HOST_garage:-}" ]; then
  echo "ERROR: MC_HOST_garage is not set" >&2
  exit 1
fi

mc() {
  docker run --rm -e MC_HOST_garage "${MC_IMAGE}" "$@"
}

REMOTE="${MC_ALIAS}/${BUCKET}"

# Version currently served to clients (never prune it).
LIVE_VERSION="$(mc cat "${REMOTE}/latest.yml" 2>/dev/null \
  | awk '/^version:/{print $2; exit}' \
  | tr -d "'\"" || true)"
echo "Live version: ${LIVE_VERSION:-<none>}"

# Every version that has at least one artifact in the bucket root.
mapfile -t VERSIONS < <(
  mc ls "${REMOTE}/" 2>/dev/null \
    | awk '{print $NF}' \
    | grep -oE 'Orbital(-Setup)?-[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?' \
    | sed -E 's/^Orbital(-Setup)?-//' \
    | sort -uV
)

if [ "${#VERSIONS[@]}" -eq 0 ]; then
  echo "No versioned artifacts found; nothing to prune."
  exit 0
fi

echo "Found versions: ${VERSIONS[*]}"

declare -A KEEP_SET=()
kept=0
for ((i=${#VERSIONS[@]}-1; i>=0; i--)); do
  v="${VERSIONS[$i]}"
  if [ "$kept" -lt "$KEEP" ] || [ "$v" = "$LIVE_VERSION" ]; then
    KEEP_SET["$v"]=1
    kept=$((kept + 1))
  fi
done

for v in "${VERSIONS[@]}"; do
  if [ -n "${KEEP_SET[$v]:-}" ]; then
    echo "Keeping ${v}"
    continue
  fi
  echo "Pruning ${v}"
  for name in \
    "Orbital-Setup-${v}.exe" \
    "Orbital-Setup-${v}.exe.blockmap" \
    "Orbital-${v}.AppImage"; do
    mc rm --force "${REMOTE}/${name}" >/dev/null 2>&1 || true
  done
done

echo "Retention complete."

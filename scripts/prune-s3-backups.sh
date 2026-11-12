#!/usr/bin/env bash
# Prune old database backups from the Garage (S3) backups bucket.
#
# Layout written by scripts/backup-release.sh:
#   db/<version>/<yyyymmddTHHMMSSZ>/orbital.db.gz
#
# Keeps the newest N versions (ranked by their newest backup timestamp, since
# versions like 3.0.0-<hash> don't sort chronologically), and within each kept
# version only its newest timestamp folder. Only touches db/: meili/ and media/
# always hold a single, current copy.
#
# Requires the AWS_* env vars (credentials + endpoint), AWS_CLI_VERSION and
# Docker, since the AWS CLI runs via the amazon/aws-cli image.
#
# Usage: prune-s3-backups.sh <bucket> [keep=3]

set -euo pipefail

BUCKET="${1:?usage: prune-s3-backups.sh <bucket> [keep]}"
KEEP="${2:-3}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for var in AWS_ENDPOINT_URL AWS_CLI_VERSION; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: ${var} is not set" >&2
    exit 1
  fi
done

AWS_IMAGE="${AWS_IMAGE:-amazon/aws-cli:${AWS_CLI_VERSION}}"

aws() {
  docker run --rm \
    -v "${SCRIPT_DIR}/aws-cli-config:/aws/config:ro" -e AWS_CONFIG_FILE=/aws/config \
    --network "${AWS_DOCKER_NETWORK:-bridge}" \
    -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION -e AWS_ENDPOINT_URL \
    "${AWS_IMAGE}" "$@"
}

REMOTE="s3://${BUCKET}/db"

# `aws s3 ls` prints sub-prefixes as "PRE <name>/".
list_prefixes() {
  aws s3 ls "$1/" 2>/dev/null | awk '$1 == "PRE" {sub(/\/$/, "", $2); print $2}' || true
}

mapfile -t VERSIONS < <(list_prefixes "${REMOTE}")
if [ "${#VERSIONS[@]}" -eq 0 ]; then
  echo "No database backups found; nothing to prune."
  exit 0
fi

# "<newest ts> <version>" per version; drop older timestamps of each version.
ranked=()
for v in "${VERSIONS[@]}"; do
  mapfile -t stamps < <(list_prefixes "${REMOTE}/${v}" | sort)
  if [ "${#stamps[@]}" -eq 0 ]; then
    continue
  fi
  newest="${stamps[${#stamps[@]}-1]}"
  ranked+=("${newest} ${v}")
  for ((i = 0; i < ${#stamps[@]} - 1; i++)); do
    echo "Pruning ${v}/${stamps[$i]} (older backup of the same version)"
    aws s3 rm --recursive --only-show-errors "${REMOTE}/${v}/${stamps[$i]}/"
  done
done

kept=0
while read -r ts v; do
  # Never build an `rm --recursive` on an empty version name.
  if [ -z "${ts}" ] || [ -z "${v}" ]; then
    continue
  fi
  if [ "${kept}" -lt "${KEEP}" ]; then
    echo "Keeping ${v} (${ts})"
    kept=$((kept + 1))
  else
    echo "Pruning ${v} (${ts})"
    aws s3 rm --recursive --only-show-errors "${REMOTE}/${v}/"
  fi
done < <(printf '%s\n' "${ranked[@]}" | sort -r)

echo "Retention complete."

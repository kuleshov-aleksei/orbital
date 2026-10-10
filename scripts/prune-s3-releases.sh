#!/usr/bin/env bash
# Prune old Electron release artifacts from the Garage (S3) update bucket.
#
# Keeps the newest N versions plus the version currently referenced by the live
# `latest.yml`, deleting the installer/blockmap/AppImage files of everything
# older. Manifests, staging manifests and any non-versioned objects are left
# untouched.
#
# Requires the AWS_* env vars (credentials + endpoint) to be set and Docker,
# since the AWS CLI runs via the amazon/aws-cli image. Parsing stays on the host
# so the container only needs the `aws` binary.
#
# Usage: prune-s3-releases.sh <bucket> [keep=3]

set -euo pipefail

BUCKET="${1:?usage: prune-s3-releases.sh <bucket> [keep]}"
KEEP="${2:-3}"
AWS_IMAGE="${AWS_IMAGE:-amazon/aws-cli}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -z "${AWS_ENDPOINT_URL:-}" ]; then
  echo "ERROR: AWS_ENDPOINT_URL is not set" >&2
  exit 1
fi

aws() {
  docker run --rm \
    -v "${SCRIPT_DIR}/aws-cli-config:/aws/config:ro" -e AWS_CONFIG_FILE=/aws/config \
    -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION -e AWS_ENDPOINT_URL \
    "${AWS_IMAGE}" "$@"
}

REMOTE="s3://${BUCKET}"

# Version currently served to clients (never prune it).
LIVE_VERSION="$(aws s3 cp "${REMOTE}/latest.yml" - 2>/dev/null \
  | awk '/^version:/{print $2; exit}' \
  | tr -d "'\"" || true)"
echo "Live version: ${LIVE_VERSION:-<none>}"

# Every version that has at least one artifact in the bucket root.
mapfile -t VERSIONS < <(
  aws s3 ls "${REMOTE}/" 2>/dev/null \
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
    aws s3 rm "${REMOTE}/${name}" >/dev/null 2>&1 || true
  done
done

echo "Retention complete."

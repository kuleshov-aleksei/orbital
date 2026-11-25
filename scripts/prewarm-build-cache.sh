#!/usr/bin/env bash
# Prewarm the Docker build cache used by .github/workflows/build-electron.yml.
# See docs/notes/build-cache-prewarm.md.
#
# Builds only the source-independent part of the release image (`--target deps`
# and the `audiocap` stage), so the cache stays valid across commits and a
# release build reuses it instead of downloading toolchains on release night.
#
# Usage: scripts/prewarm-build-cache.sh [ref]        (default: origin/main)
#        PREWARM_MODE=full scripts/prewarm-build-cache.sh [ref]
#        PREWARM_REPO=/path/to/clone scripts/prewarm-build-cache.sh
set -euo pipefail

REPO=${PREWARM_REPO:-/opt/orbital-prewarm}
REF=${1:-origin/main}
MODE=${PREWARM_MODE:-deps}

if [ ! -d "$REPO/.git" ]; then
  echo "error: $REPO is not a git clone (set PREWARM_REPO)" >&2
  exit 1
fi

git -C "$REPO" fetch --prune --tags origin
git -C "$REPO" checkout --detach --quiet "$REF"
git -C "$REPO" clean -ffdxq
cd "$REPO"

echo "== audiocap: rust image + windows-gnu target + mingw toolchain + cargo"
docker build --target audiocap -f docker/Dockerfile.electron .

if [ "$MODE" = "full" ]; then
  # Also warms this commit's source layers and the packaging tail. Best parity
  # when the release tag is cut from this ref; costs ~1-2 GB of cache per new
  # commit, which is why it is not the default.
  echo "== full build at $REF (source layers included)"
  docker build --build-arg VERSION=0.0.0-prewarm \
    -t orbital-prewarm-check -f docker/Dockerfile.electron .
  docker image rm orbital-prewarm-check
else
  echo "== deps: OS packages, pnpm installs, license list"
  docker build --target deps -f docker/Dockerfile.electron .
fi

echo "== build cache now"
docker system df

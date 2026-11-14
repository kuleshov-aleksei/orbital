#!/usr/bin/env bash
# Point .env at one of the environment profiles in the repo root.
#
# Usage: scripts/activate.sh <local|mobile>
#   local  -> .env-local
#   mobile -> .env-mobile-tunnel
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
    echo "Usage: $0 <local|mobile>" >&2
    exit 1
}

[[ $# -eq 1 ]] || usage

case "$1" in
    local)  target=".env-local" ;;
    mobile) target=".env-mobile-tunnel" ;;
    *)      usage ;;
esac

cd "$ROOT_DIR"

if [[ ! -f "$target" ]]; then
    echo "Error: $target not found in $ROOT_DIR" >&2
    exit 1
fi

# Never clobber a real .env file; only replace an existing symlink.
if [[ -e .env && ! -L .env ]]; then
    echo "Error: .env is a regular file, not a symlink. Move it away first." >&2
    exit 1
fi

# Relative link so it survives moving the repo.
ln -sfn "$target" .env
echo ".env -> $target"

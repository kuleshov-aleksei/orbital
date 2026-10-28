#!/bin/bash
# Repair the Node CLI symlinks that the GitHub Actions runner self-update
# flattens into regular files (actions/runner#2094).
#
# When this happens, the runner's bundled npm is a copy of npm-cli.js, so it
# fails with "Cannot find module '../lib/cli.js'". Restoring the symlinks is
# enough to fix it and is safe to run before every job.

set -euo pipefail

candidates=()
if [ -n "${RUNNER_WORKSPACE:-}" ]; then
  candidates+=("$RUNNER_WORKSPACE/../..")
fi
candidates+=("/opt/actions-runner")

runner_root=""
for candidate in "${candidates[@]}"; do
  if [ -d "$candidate" ] && compgen -G "$candidate/externals*" >/dev/null; then
    runner_root="$(cd "$candidate" && pwd)"
    break
  fi
done

if [ -z "$runner_root" ]; then
  echo "ERROR: runner externals not found (tried: ${candidates[*]})" >&2
  exit 1
fi

link() {
  local dir="$1" name="$2" target="$3"

  [ -e "$dir/$target" ] || return 0
  if [ -L "$dir/$name" ]; then
    return 0
  fi

  ln -sfn "$target" "$dir/$name"
  echo "relinked $dir/$name -> $target"
}

found=0

for externals in "$runner_root"/externals "$runner_root"/externals.*; do
  [ -d "$externals" ] || continue

  for node_bin in "$externals"/node*/bin; do
    [ -d "$node_bin" ] || continue
    found=1

    link "$node_bin" npm ../lib/node_modules/npm/bin/npm-cli.js
    link "$node_bin" npx ../lib/node_modules/npm/bin/npx-cli.js
    link "$node_bin" corepack ../lib/node_modules/corepack/dist/corepack.js
  done
done

if [ "$found" -eq 0 ]; then
  echo "ERROR: no runner externals found under $runner_root" >&2
  exit 1
fi

echo "Runner Node symlinks OK ($runner_root)"

#!/usr/bin/env bash
# Fails when shell code changed without a shell-api.json bump (AGENTS.md
# "Shell changes require a shell-api.json bump"). The frontend ships over the
# air; the shell only through a reinstall, so a bundle must know which shell it
# needs. Compares the working tree (incl. untracked files) against BASE (HEAD),
# or with --staged only what is staged for commit (the pre-commit hook).
#
# Usage: scripts/check-shell-api.sh [--staged | base]   SKIP_SHELL_API_CHECK=1 to bypass.
set -euo pipefail

if [ "${SKIP_SHELL_API_CHECK:-}" = "1" ]; then
  echo "shell-api check skipped (SKIP_SHELL_API_CHECK=1)"
  exit 0
fi

cd "$(git rev-parse --show-toplevel)"

if [ "${1:-}" = "--staged" ]; then
  BASE=HEAD
  changed="$(git diff --cached --name-only | sort -u)"
  diff_args=(--cached)
  current_shell_api() { git show :shell-api.json 2>/dev/null || true; }
else
  BASE="${1:-HEAD}"
  changed="$( (git diff --name-only "$BASE"; git ls-files --others --exclude-standard) | sort -u)"
  diff_args=("$BASE")
  current_shell_api() { cat shell-api.json 2>/dev/null || true; }
fi

# Did the number for <platform> change? (New file counts as changed.)
bumped() {
  if ! git cat-file -e "$BASE:shell-api.json" 2>/dev/null; then return 0; fi
  [ "$(git show "$BASE:shell-api.json" | grep "\"$1\"")" != "$(current_shell_api | grep "\"$1\"")" ]
}

fail=0
check() {
  local platform="$1" pattern="$2"
  local hits
  hits="$(printf '%s\n' "$changed" | grep -E "$pattern" | grep -vE '\.test\.ts$|\.md$' || true)"
  if [ -n "$hits" ] && ! bumped "$platform"; then
    echo "ERROR: $platform shell files changed without bumping \"$platform\" in shell-api.json:" >&2
    printf '  %s\n' $hits >&2
    fail=1
  fi
}

check electron '^electron/(main|preload)/|^electron/electron-builder\.json$|^electron/package\.json$'
check android '^mobile/android/|^frontend/capacitor\.config\.ts$'

if printf '%s\n' "$changed" | grep -qx 'frontend/package.json' \
  && git diff "${diff_args[@]}" -- frontend/package.json | grep -qE '^[-+].*"@capacitor/' && ! bumped android; then
  echo "ERROR: @capacitor/* dependencies changed without bumping \"android\" in shell-api.json" >&2
  fail=1
fi

if [ "$fail" = 1 ]; then
  echo "Bump it, or set SKIP_SHELL_API_CHECK=1 if the change really doesn't affect the shell API." >&2
  exit 1
fi
echo "shell-api check passed"

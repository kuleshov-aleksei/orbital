#!/usr/bin/env bash
# Strip digits from file names, e.g. emoji packs downloaded with numeric
# prefixes, so the name works as a custom emoji shortcode:
#
#   1499-vibecat.gif -> vibecat.gif
#   5498_catJAM.gif  -> catJAM.gif
#   72953-cat-1.png  -> cat.png
#
#   scripts/strip-filename-numbers.sh [-n] [dir]...   (default: current directory)
#
# Directories are searched recursively; only files are renamed (directory
# names and extensions are left alone). After the digits are removed, runs of
# "-", "_", "." and spaces collapse to the first one, and separators at the
# start or end of the name are trimmed. A file is skipped when its new name
# would be empty or already exists.
#
#   -n  dry run: print the renames without doing them
set -euo pipefail

usage() {
  echo "Usage: $0 [-n] [dir]..." >&2
  exit 2
}

dry_run=0
while getopts "nh" opt; do
  case "$opt" in
    n) dry_run=1 ;;
    *) usage ;;
  esac
done
shift $((OPTIND - 1))
[ $# -eq 0 ] && set -- .

renamed=0
skipped=0

for dir in "$@"; do
  if [ ! -d "$dir" ]; then
    echo "Not a directory: $dir" >&2
    exit 1
  fi

  while IFS= read -r -d '' path; do
    parent=$(dirname -- "$path")
    name=$(basename -- "$path")

    # Split off the extension (only when the name has a non-leading dot).
    stem=$name
    ext=
    if [[ "$name" == ?*.* ]]; then
      stem=${name%.*}
      ext=.${name##*.}
    fi

    new_stem=$(printf '%s' "$stem" | sed -E 's/[0-9]+//g; s/([-_. ])[-_. ]+/\1/g; s/^[-_. ]+//; s/[-_. ]+$//')
    [ "$new_stem" = "$stem" ] && continue

    if [ -z "$new_stem" ]; then
      echo "skip (name would be empty): $path" >&2
      skipped=$((skipped + 1))
      continue
    fi

    target="$parent/$new_stem$ext"
    if [ -e "$target" ]; then
      echo "skip (exists): $path -> $target" >&2
      skipped=$((skipped + 1))
      continue
    fi

    echo "$path -> $target"
    if [ "$dry_run" -eq 0 ]; then
      mv -n -- "$path" "$target"
    fi
    renamed=$((renamed + 1))
  done < <(find "$dir" -type f -print0)
done

if [ "$dry_run" -eq 1 ]; then
  echo "Dry run: $renamed to rename, $skipped skipped." >&2
else
  echo "Renamed $renamed, skipped $skipped." >&2
fi

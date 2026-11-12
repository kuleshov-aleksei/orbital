#!/usr/bin/env bash
# Re-encode .webm stickers (e.g. Telegram video stickers) into animated .webp
# files that the custom emoji upload accepts. The app itself does not take
# WebM: the backend encoder (libvips) cannot decode video.
#
#   scripts/webm-to-webp.sh [-f] [dir|file]...   (default: current directory)
#
# Directories are searched recursively; each foo.webm becomes foo.webp next to
# it. Existing .webp files are skipped unless -f is given. Transparency is kept
# (VP8/VP9 alpha needs the libvpx decoders, so they are forced).
#
# Output is limited to what the backend accepts (backend/internal/service/
# emojiservice.go): fits 128x128, at most 30 fps, upload limit 256 KB, at
# most 300 frames.
#
# Needs: ffmpeg and ffprobe built with libvpx and libwebp.
set -euo pipefail

MAX_BYTES=$((256 * 1024))
MAX_FRAMES=300
FPS=30

usage() {
  echo "Usage: $0 [-f] [dir|file]..." >&2
  exit 2
}

force=0
while getopts "fh" opt; do
  case "$opt" in
    f) force=1 ;;
    *) usage ;;
  esac
done
shift $((OPTIND - 1))
[ $# -eq 0 ] && set -- .

for bin in ffmpeg ffprobe; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "error: $bin not found in PATH" >&2
    exit 1
  fi
done

converted=0
skipped=0
failed=0

convert() {
  local in="$1"
  local out="${in%.*}.webp"

  if [ -e "$out" ] && [ "$force" -eq 0 ]; then
    echo "skip   $in (exists: $out, use -f to overwrite)"
    skipped=$((skipped + 1))
    return
  fi

  # The native vp8/vp9 decoders drop the alpha channel; libvpx keeps it.
  local codec decoder=()
  codec="$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name \
    -of default=nokey=1:noprint_wrappers=1 "$in" 2>/dev/null || true)"
  case "$codec" in
    vp9) decoder=(-c:v libvpx-vp9) ;;
    vp8) decoder=(-c:v libvpx) ;;
    "")
      echo "FAIL   $in (no video stream)" >&2
      failed=$((failed + 1))
      return
      ;;
  esac

  if ! ffmpeg -nostdin -hide_banner -loglevel error -y "${decoder[@]}" -i "$in" \
    -vf "fps=${FPS},scale=128:128:force_original_aspect_ratio=decrease:flags=lanczos" \
    -c:v libwebp_anim -lossless 0 -quality 85 -loop 0 -an "$out"; then
    echo "FAIL   $in (ffmpeg error)" >&2
    rm -f -- "$out"
    failed=$((failed + 1))
    return
  fi

  local size duration warn=""
  size="$(wc -c <"$out" | tr -d ' ')"
  duration="$(ffprobe -v error -show_entries format=duration \
    -of default=nokey=1:noprint_wrappers=1 "$in" 2>/dev/null || true)"
  if [ "$size" -gt "$MAX_BYTES" ]; then
    warn+=" WARNING: larger than 256 KB, upload will be rejected"
  fi
  if [ -n "$duration" ] && [ "$duration" != "N/A" ] &&
    awk -v d="$duration" -v f="$FPS" -v m="$MAX_FRAMES" 'BEGIN { exit !(d * f > m) }'; then
    warn+=" WARNING: more than ${MAX_FRAMES} frames, upload will be rejected"
  fi
  echo "ok     $out ($((size / 1024)) KB)${warn}"
  converted=$((converted + 1))
}

for target in "$@"; do
  if [ -d "$target" ]; then
    while IFS= read -r -d '' file; do
      convert "$file"
    done < <(find "$target" -type f -iname '*.webm' -print0 | sort -z)
  elif [ -f "$target" ]; then
    convert "$target"
  else
    echo "FAIL   $target (not found)" >&2
    failed=$((failed + 1))
  fi
done

echo "converted: $converted, skipped: $skipped, failed: $failed"
[ "$failed" -eq 0 ]

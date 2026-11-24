#!/usr/bin/env bash
# Demo server for screenshots: starts a throwaway backend (own SQLite
# database, uploads folder and Meilisearch index), seeds it with
# frontend/tests/e2e/setup-screenshots.spec.ts, then serves the frontend
# against it until Ctrl+C. Everything it created is removed on exit; the dev
# database, uploads and index are never touched.
#
# Needs: Meilisearch up (make meili-up), node >= 22, go, pnpm, curl.
# Voice calls also need LiveKit running (LIVEKIT_* from .env).
# Env: SEED_PORT (backend, default 8090), SEED_FRONTEND_PORT (default 3090),
#      MEILI_URL, MEILI_KEY, SEED_KEEP=1 (keep the work folder for a later look).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# LiveKit, JWT secret, GIF provider etc. come from .env like `make dev`.
# Sourced first, so it can't override the variables below.
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi
# The seeded users have fake addresses: never send them mail or pushes.
# Search by image contents is not needed for a demo.
unset SMTP_HOST FCM_CREDENTIALS_FILE CHAT_ML_URL

SEED_BACKEND_PORT="${SEED_PORT:-8090}"
SEED_FRONT_PORT="${SEED_FRONTEND_PORT:-3090}"
MEILI_URL="${MEILI_URL:-http://127.0.0.1:7700}"
MEILI_KEY="${MEILI_KEY:-orbital-dev-meili-key}"
INDEX="text_messages_screenshots_$$"
BACKEND_URL="http://127.0.0.1:$SEED_BACKEND_PORT"
FRONTEND_URL="http://localhost:$SEED_FRONT_PORT"

for bin in node go pnpm curl; do
  command -v "$bin" >/dev/null || { echo "screenshots-seed: '$bin' is required" >&2; exit 2; }
done
for port in "$SEED_BACKEND_PORT" "$SEED_FRONT_PORT"; do
  if curl -sS -o /dev/null "http://127.0.0.1:$port" 2>/dev/null; then
    echo "screenshots-seed: port $port is already in use (set SEED_PORT / SEED_FRONTEND_PORT)" >&2
    exit 2
  fi
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/orbital-screenshots.XXXXXX")"
SERVER_PID=""
FRONTEND_PID=""

cleanup() {
  trap - EXIT INT TERM
  echo ""
  echo "Stopping the demo server..."
  for pid in "$FRONTEND_PID" "$SERVER_PID"; do
    # Both run in their own session: stop the whole process group.
    if [ -n "$pid" ]; then
      kill -- "-$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  curl -fsS -X DELETE -H "Authorization: Bearer $MEILI_KEY" \
    "$MEILI_URL/indexes/$INDEX" >/dev/null 2>&1 || true
  if [ "${SEED_KEEP:-}" = "1" ]; then
    echo "Kept $WORK"
  else
    case "$WORK" in
      */orbital-screenshots.*) rm -rf -- "$WORK" ;;
    esac
  fi
}
trap cleanup EXIT
# Ctrl+C is how the demo server is meant to stop: not an error.
trap 'cleanup; exit 0' INT TERM

# The backend keeps uploads (avatars, emojis, badges) in ./data, relative to
# its working directory, so it runs from the work folder.
echo "Compiling the backend..."
(cd "$ROOT/backend" && go build -o "$WORK/orbital" ./cmd/server)

echo "Starting the demo backend on :$SEED_BACKEND_PORT (index $INDEX)..."
(
  cd "$WORK"
  exec setsid env SERVER_PORT="$SEED_BACKEND_PORT" PORT="$SEED_BACKEND_PORT" DATABASE_PATH="$WORK/orbital.db" \
    MEILI_URL="$MEILI_URL" MEILI_API_KEY="$MEILI_KEY" MEILI_INDEX="$INDEX" \
    SERVER_CORS_ORIGINS="$FRONTEND_URL,http://127.0.0.1:$SEED_FRONT_PORT" \
    RATE_LIMIT_AUTH_PER_MINUTE=1000 RATE_LIMIT_USER_UPLOAD_PER_HOUR=1000 \
    ./orbital >"$WORK/server.log" 2>&1
) &
SERVER_PID=$!

ready=""
for _ in $(seq 1 120); do
  if curl -fsS "$BACKEND_URL/api/health" 2>/dev/null | grep -q '"text_channels":"ok"'; then
    ready=1
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    break
  fi
  sleep 0.5
done
if [ -z "$ready" ]; then
  echo "screenshots-seed: backend did not become ready (is Meilisearch up?):" >&2
  tail -20 "$WORK/server.log" >&2
  exit 1
fi

echo "Seeding..."
if ! (cd "$ROOT/frontend" && SEED_BACKEND_URL="$BACKEND_URL" \
  pnpm exec playwright test -c playwright.config.screenshots.ts setup-screenshots); then
  echo "--- backend log (last 30 lines) ---" >&2
  tail -30 "$WORK/server.log" >&2
  exit 1
fi

echo "Starting the frontend on :$SEED_FRONT_PORT..."
(
  cd "$ROOT/frontend"
  exec setsid env VITE_BACKEND_URL="$BACKEND_URL" \
    pnpm exec vite --host 127.0.0.1 --port "$SEED_FRONT_PORT" --strictPort \
    >"$WORK/frontend.log" 2>&1
) &
FRONTEND_PID=$!

for _ in $(seq 1 60); do
  curl -fsS -o /dev/null "http://127.0.0.1:$SEED_FRONT_PORT" 2>/dev/null && break
  sleep 0.5
done

cat <<EOF

Demo server is up: $FRONTEND_URL
  Sign in as AdminUser (owner) or user1..7@test.com, password P@ssword123.
  Voice screenshots (needs LiveKit):
    cd frontend && SEED_BACKEND_URL=$BACKEND_URL SEED_FRONTEND_URL=$FRONTEND_URL \\
      pnpm exec playwright test -c playwright.config.screenshots.ts join-rooms-screenshots
Press Ctrl+C to stop and delete everything.
EOF

wait "$SERVER_PID" "$FRONTEND_PID"

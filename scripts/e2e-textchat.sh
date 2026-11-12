#!/usr/bin/env bash
# Live text channel check (docs/specs/CHAT_SYSTEM.md): starts a throwaway
# backend with its own SQLite database and Meilisearch index, runs
# scripts/e2e-textchat.mjs against it, then removes everything it created.
# The dev database and the dev index are never touched.
#
# Needs: Meilisearch up (make meili-up), Garage for attachments (make garage-up), node >= 22 (global WebSocket), sqlite3.
# Env: E2E_PORT (default 8091), MEILI_URL, MEILI_KEY.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${E2E_PORT:-8091}"
MEILI_URL="${MEILI_URL:-http://127.0.0.1:7700}"
MEILI_KEY="${MEILI_KEY:-orbital-dev-meili-key}"
INDEX="text_messages_e2e_$$"

for bin in node sqlite3 curl go; do
  command -v "$bin" >/dev/null || { echo "e2e-textchat: '$bin' is required" >&2; exit 2; }
done
if curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
  echo "e2e-textchat: port $PORT is already in use (set E2E_PORT)" >&2
  exit 2
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/orbital-e2e-textchat.XXXXXX")"
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    # The server runs in its own session: stop `go run` and its child.
    kill -- "-$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  curl -fsS -X DELETE -H "Authorization: Bearer $MEILI_KEY" \
    "$MEILI_URL/indexes/$INDEX" >/dev/null 2>&1 || true
  case "$WORK" in
    */orbital-e2e-textchat.*) rm -rf -- "$WORK" ;;
  esac
}
trap cleanup EXIT INT TERM

# Attachments: pass the dev Garage key (make garage-up) from .env through.
# Without it the backend runs with attachments off and those checks skip.
if [ -f "$ROOT/.env" ]; then
  while IFS='=' read -r key value; do
    case "$key" in
      GARAGE_DEFAULT_ACCESS_KEY | GARAGE_DEFAULT_SECRET_KEY | GARAGE_DEFAULT_BUCKET)
        value="${value%\"}"
        export "$key=${value#\"}"
        ;;
    esac
  done <"$ROOT/.env"
fi

echo "Starting throwaway backend on :$PORT (index $INDEX)..."
(
  cd "$ROOT/backend"
  # CHAT_ML_URL (e.g. http://127.0.0.1:3003 after `make ml-up`) enables the
  # search-by-image-contents checks; unset, they skip.
  exec setsid env SERVER_PORT="$PORT" DATABASE_PATH="$WORK/e2e.db" \
    MEILI_URL="$MEILI_URL" MEILI_API_KEY="$MEILI_KEY" MEILI_INDEX="$INDEX" \
    CHAT_ML_URL="${CHAT_ML_URL:-}" \
    go run ./cmd/server >"$WORK/server.log" 2>&1
) &
SERVER_PID=$!

for _ in $(seq 1 120); do
  if curl -fsS "http://localhost:$PORT/api/health" 2>/dev/null | grep -q '"text_channels":"ok"'; then
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "e2e-textchat: backend exited early:" >&2
    tail -20 "$WORK/server.log" >&2
    exit 1
  fi
  sleep 0.5
done
if ! curl -fsS "http://localhost:$PORT/api/health" 2>/dev/null | grep -q '"text_channels":"ok"'; then
  echo "e2e-textchat: backend did not become ready:" >&2
  tail -20 "$WORK/server.log" >&2
  exit 1
fi

status=0
E2E_ML="${CHAT_ML_URL:+1}" node "$ROOT/scripts/e2e-textchat.mjs" "http://localhost:$PORT" "$WORK/e2e.db" || status=$?
if [ "$status" -ne 0 ]; then
  echo "--- backend log (last 30 lines) ---" >&2
  tail -30 "$WORK/server.log" >&2
fi
exit "$status"

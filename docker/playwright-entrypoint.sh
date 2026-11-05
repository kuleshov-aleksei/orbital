#!/bin/sh
set -eu

# Docker daemon/CLI proxy settings are injected into the container even for
# loopback traffic. Playwright's webServer readiness probe then goes through
# the egress proxy and gets a 503 instead of reaching the local backend.
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy

LIVEKIT_PID=""

cleanup() {
    if [ -n "$LIVEKIT_PID" ]; then
        kill "$LIVEKIT_PID" 2>/dev/null || true
        wait "$LIVEKIT_PID" 2>/dev/null || true
    fi
}

trap cleanup EXIT INT TERM

livekit-server --config /app/livekit/livekit-dev.yaml >/dev/null 2>&1 &
LIVEKIT_PID=$!

# LiveKit answers unknown paths with a 4xx, so any HTTP response proves it is up.
attempt=0
while ! curl -s -o /dev/null http://127.0.0.1:7880/; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 60 ]; then
        echo "LiveKit did not become ready in time" >&2
        exit 1
    fi
    sleep 0.5
done

cd /app/frontend
pnpm exec playwright test --grep-invert @screenshot "$@"

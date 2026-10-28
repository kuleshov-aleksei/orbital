#!/usr/bin/env bash
set -uo pipefail

MODE="${1:-all}"
IMAGE="${PLAYWRIGHT_TEST_IMAGE:-orbital-playwright-tests}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

frontend_status=0
backend_status=0

run_frontend() {
    echo "=== Frontend tests ==="
    mkdir -p frontend/playwright-report frontend/test-results

    docker run --rm \
        --shm-size=1g \
        --ipc=host \
        -e PLAYWRIGHT_SUMMARY_ONLY=1 \
        -v "$ROOT_DIR/frontend/playwright-report:/app/frontend/playwright-report" \
        -v "$ROOT_DIR/frontend/test-results:/app/frontend/test-results" \
        "$IMAGE" ${PLAYWRIGHT_TEST_ARGS:-} || frontend_status=$?
}

run_backend() {
    echo "=== Backend tests ==="
    (cd backend && go test -v ./...) 2>&1 | awk '
        /^--- PASS:/ { passed++ }
        /^--- FAIL:/ {
            failed++
            name = $0
            sub(/^--- FAIL: /, "", name)
            sub(/ \([0-9.]+s\)$/, "", name)
            if ((getline detail) > 0) {
                sub(/^[[:space:]]+/, "", detail)
                failures = failures sprintf("  - %s — %s\n", name, detail)
            } else {
                failures = failures sprintf("  - %s\n", name)
            }
        }
        /^FAIL[[:space:]].*\[build failed\]/ {
            failed++
            failures = failures sprintf("  - %s\n", $0)
        }
        END {
            printf "%d passed\n", passed
            if (failed == 0) {
                print "0 failed"
            } else {
                printf "%d failed:\n", failed
                printf "%s", failures
            }
        }
    '
    backend_status=${PIPESTATUS[0]}
}

case "$MODE" in
    frontend)
        run_frontend
        ;;
    all)
        run_frontend
        echo
        run_backend
        ;;
    *)
        echo "Usage: $0 [all|frontend]" >&2
        exit 2
        ;;
esac

if ((frontend_status != 0 || backend_status != 0)); then
    exit 1
fi

#!/bin/bash
# Simulate a client-side network blackout without stopping backend/LiveKit.
# Drops traffic to Orbital ports for N seconds, then restores automatically.
#
# What it blocks (host OUTPUT + INPUT):
#   7880/tcp - LiveKit signaling (WS)
#   7881/tcp,udp - LiveKit media (UDP + TCP fallback)
#   8080/tcp - Backend REST + WS (frontend proxies /api and /ws here)
#
# Servers keep running; only packets are dropped, so LiveKit SDK should hit
# RoomEvent.Reconnecting -> RoomEvent.Reconnected, and backend WS should retry.
# Keep duration < WS_PING_TIMEOUT (default 30s) so presence is not wiped.
#
# Usage:
#   sudo ./scripts/simulate-blackout.sh [seconds] [--dry-run]
#   sudo ./scripts/simulate-blackout.sh 15
#   sudo ./scripts/simulate-blackout.sh 15 --dry-run
#
# Safety:
#   - Must run as root (iptables requires it).
#   - Rules are removed via trap EXIT, even on Ctrl+C / failure.
#   - Checks with -C before -A/-D so re-runs don't duplicate or error.
#   - Does NOT touch docker containers, images, or networks.

set -u

SECONDS_TO_BLOCK="${1:-15}"
DRY_RUN=false
for arg in "$@"; do
  if [ "$arg" = "--dry-run" ] || [ "$arg" = "-n" ]; then
    DRY_RUN=true
  fi
done

# Validate seconds (positive integer)
if ! [[ "$SECONDS_TO_BLOCK" =~ ^[0-9]+$ ]] || [ "$SECONDS_TO_BLOCK" -le 0 ]; then
  echo "Usage: sudo $0 [seconds] [--dry-run]" >&2
  echo "  seconds must be a positive integer (default: 15)" >&2
  exit 1
fi

# Use TCP_PORTS="7880 8080" for backend blackout
TCP_PORTS="7880"
TCP_UDP_PORTS="7881"
IPTABLES="iptables"
IP6TABLES="ip6tables"

have_ip6tables=false
if command -v ip6tables >/dev/null 2>&1; then
  have_ip6tables=true
fi

if [ "$DRY_RUN" = false ]; then
  if [ "$(id -u)" -ne 0 ]; then
    echo "Error: must run as root (try: sudo $0 $SECONDS_TO_BLOCK)" >&2
    exit 1
  fi
  if ! command -v "$IPTABLES" >/dev/null 2>&1; then
    echo "Error: iptables not found" >&2
    exit 1
  fi
fi

run() {
  if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] $*"
  else
    "$@"
  fi
}

# add_or_del <add|del> <table-cmd> <chain> <rule...>
# Uses -C to check existence so adds are idempotent and dels never fail.
add_or_del() {
  local mode="$1"; shift
  local cmd="$1"; shift
  local chain="$1"; shift
  if [ "$mode" = "add" ]; then
    if [ "$DRY_RUN" = true ]; then
      run "$cmd" -A "$chain" "$@"
    elif ! "$cmd" -C "$chain" "$@" 2>/dev/null; then
      "$cmd" -A "$chain" "$@"
    fi
  else
    if [ "$DRY_RUN" = true ]; then
      run "$cmd" -D "$chain" "$@"
    else
      # shellcheck disable=SC2086
      while "$cmd" -C "$chain" "$@" 2>/dev/null; do
        "$cmd" -D "$chain" "$@"
      done
    fi
  fi
}

apply_rules() {
  local mode="$1"
  local cmd
  for cmd in "$IPTABLES" $($have_ip6tables && echo "$IP6TABLES"); do
    local port
    for port in $TCP_PORTS; do
      add_or_del "$mode" "$cmd" OUTPUT -p tcp --dport "$port" -j DROP
      add_or_del "$mode" "$cmd" INPUT -p tcp --sport "$port" -j DROP
    done
    for port in $TCP_UDP_PORTS; do
      add_or_del "$mode" "$cmd" OUTPUT -p tcp --dport "$port" -j DROP
      add_or_del "$mode" "$cmd" INPUT -p tcp --sport "$port" -j DROP
      # ip6tables/iptables both support udp; keep symmetric
      add_or_del "$mode" "$cmd" OUTPUT -p udp --dport "$port" -j DROP
      add_or_del "$mode" "$cmd" INPUT -p udp --sport "$port" -j DROP
    done
  done
}

cleanup() {
  echo ""
  echo "Restoring network (removing blackout rules)..."
  apply_rules del
  echo "Network restored."
}

if [ "$DRY_RUN" = true ]; then
  echo "Dry run: would block for ${SECONDS_TO_BLOCK}s (TCP dports: ${TCP_PORTS}, TCP+UDP dports: ${TCP_UDP_PORTS})"
  apply_rules add
  echo "Dry run: would sleep ${SECONDS_TO_BLOCK}s, then remove the rules above."
  exit 0
fi

trap cleanup EXIT INT TERM

echo "Simulating network blackout for ${SECONDS_TO_BLOCK}s..."
echo "Blocked: TCP dports ${TCP_PORTS}, TCP+UDP dports ${TCP_UDP_PORTS} (LiveKit 7880/7881, backend 8080)."
echo "Containers are untouched. Press Ctrl+C to restore early."
apply_rules add

echo "Blackout active... (0/${SECONDS_TO_BLOCK}s)"
i=1
while [ "$i" -le "$SECONDS_TO_BLOCK" ]; do
  sleep 1
  echo "Blackout active... (${i}/${SECONDS_TO_BLOCK}s)"
  i=$((i + 1))
done

# Normal exit triggers trap -> cleanup
trap - EXIT INT TERM
cleanup

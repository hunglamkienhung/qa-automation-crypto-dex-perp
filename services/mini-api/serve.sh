#!/usr/bin/env bash
# Run mini-api against the local PerpDEX, or stop it.
#
#   ./serve.sh up       start in the background (fresh store if the chain was redeployed)
#   ./serve.sh down     stop
#   ./serve.sh status   /health
#
# The admin token is fixed for local runs so the test tiers can mint scoped
# tokens; it is a local-chain convenience, not a secret, and the service will
# happily generate a random one when the variable is unset.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${MINI_API_PORT:-8787}"
export MINI_API_PORT="${PORT}"
export MINI_API_ADMIN_TOKEN="${MINI_API_ADMIN_TOKEN:-local-admin-token}"
LOG="${MINI_API_LOG:-/tmp/mini-api-${PORT}.log}"
PIDFILE="/tmp/mini-api-${PORT}.pid"

free_port() {
  # Kill whatever still holds the port, however it was launched. A stale server
  # left on this port from an earlier run keeps answering /health, so a fresh
  # bind that silently fails looks "up" while serving an empty store -- which
  # turns every downstream case into a spurious Blocked. Freeing the port is the
  # only reliable guard: pkill-by-name misses a server launched as bare
  # `node server.js`, and a leftover pidfile may not name a live process.
  if command -v fuser >/dev/null 2>&1; then fuser -k "${PORT}/tcp" 2>/dev/null || true
  elif command -v lsof >/dev/null 2>&1; then lsof -ti tcp:"${PORT}" 2>/dev/null | xargs -r kill 2>/dev/null || true; fi
}
stop() {
  if [ -f "${PIDFILE}" ]; then kill "$(cat "${PIDFILE}")" 2>/dev/null || true; rm -f "${PIDFILE}"; fi
  pkill -f "mini-api/server.js" 2>/dev/null || true
  free_port
  sleep 0.3
}

case "${1:-up}" in
  up)
    stop
    nohup node "$(pwd)/server.js" > "${LOG}" 2>&1 < /dev/null &
    echo $! > "${PIDFILE}"
    for i in $(seq 1 50); do
      if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then break; fi
      sleep 0.2
    done
    curl -s "http://127.0.0.1:${PORT}/health" || { echo "mini-api did not come up; log:"; cat "${LOG}"; exit 1; }
    echo
    ;;
  down)
    stop
    echo "mini-api stopped"
    ;;
  status)
    curl -s "http://127.0.0.1:${PORT}/health"; echo
    ;;
  *)
    echo "usage: $0 up|down|status" >&2
    exit 2
    ;;
esac

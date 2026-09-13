#!/usr/bin/env bash
# Load-test mini-api with Locust, headless, with a pass/fail gate.
#
#   bash perf/run.sh [users] [spawn-rate] [duration]
#
# Seeds a fresh mini-api, then drives the read-heavy indexer endpoints under
# concurrency. The service rate-limits per client address; since a load test
# runs from one host, this raises MINI_API_RATE_LIMIT so we measure the store's
# read latency rather than the limiter (the functional suite covers the limiter).
# The locustfile's `quitting` hook exits non-zero if the error ratio or p95
# latency crosses PERF_MAX_FAIL_RATIO / PERF_MAX_P95_MS.
set -euo pipefail
USERS="${1:-40}"
RATE="${2:-10}"
DUR="${3:-30s}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export MINI_API_DB="${MINI_API_DB:-/tmp/mini-api-perf/mini-api.db}"
export MINI_API_PORT="${MINI_API_PORT:-8787}"
export MINI_API_RATE_LIMIT="${MINI_API_RATE_LIMIT:-100000000}"   # lift the per-host cap for throughput measurement
HOST="http://127.0.0.1:${MINI_API_PORT}"

# mini-api is an indexer over a local chain: bring the chain up and deploy (this
# writes contracts/deployments/31337.json that the service reads at startup),
# exactly as scripts/run-be.sh does, then start the service.
bash contracts/chain.sh up
( cd services/mini-api && bash serve.sh up )

python -m pip install -q -r perf/requirements.txt
locust -f perf/locustfile.py --headless -u "$USERS" -r "$RATE" -t "$DUR" --host "$HOST" --only-summary

#!/usr/bin/env bash
# Run the whole suite -- every tier, one stack -- then gate on the shape of the
# complete run against fixtures/expected-results.json. The per-tier scripts run
# and report a subset; only here is the FULL queue present, so only here does
# qa-verify make sense (a partial run would "diverge" on the tiers it never
# ran). CI runs this as its gate; it is the one command that says the whole
# suite landed where it should.
#
#   bash scripts/gate.sh [node|python]
set -euo pipefail
STACK="${1:-node}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

bash "$ROOT/scripts/run-be.sh" "$STACK"
bash "$ROOT/scripts/run-fe.sh" "$STACK"

cd "$ROOT"
if [ "$STACK" = node ]; then
  ( cd node && QA_DOMAIN_ROOT=.. npx qa-report && QA_DOMAIN_ROOT=.. npx qa-verify )
else
  . .venv-ci/bin/activate
  ( cd python && QA_DOMAIN_ROOT=.. qa-report && QA_DOMAIN_ROOT=.. qa-verify )
fi

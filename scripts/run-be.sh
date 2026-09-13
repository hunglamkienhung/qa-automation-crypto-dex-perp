#!/usr/bin/env bash
# Bring up a fresh anvil + PerpDEX + mini-api, then run the crypto BE tiers for
# one stack and gate on the shape of the run. No browser. Used by CI and
# reproducible by hand.
set -euo pipefail
STACK="${1:-node}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="$HOME/.foundry/bin:$PATH"
export MINI_API_DB="${MINI_API_DB:-/tmp/mini-api/mini-api.db}"
export MINI_API_ADMIN_TOKEN="${MINI_API_ADMIN_TOKEN:-local-admin-token}"

bash contracts/chain.sh up
( cd services/mini-api && bash serve.sh up )

if [ "$STACK" = node ]; then
  ( cd node && npm install --no-audit --no-fund )
  ( cd node && QA_DOMAIN_ROOT=.. npx cucumber-js --tags "@be" )
  ( cd node && QA_DOMAIN_ROOT=.. npx qa-report )
else
  python -m venv .venv-ci && . .venv-ci/bin/activate
  ( cd python && pip install -q -r requirements.txt )
  ( cd python && QA_DOMAIN_ROOT=.. python -m pytest -m "be" -q ) || true
  ( cd python && QA_DOMAIN_ROOT=.. qa-report )
fi

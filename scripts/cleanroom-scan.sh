#!/usr/bin/env bash
# Fail if anything identifying the prior employer leaks into the repo. The
# knowledge Ken carries is fair game; the names, IDs and addresses are not.
# Scans tracked files only, so build output and dependencies are out of scope.
set -uo pipefail
cd "$(dirname "$0")/.."

# Proper nouns and product/organisation names, case-insensitive, whole word.
NAMES='Thomas|Lucky|Harry|Kellan|Herry|Liver|Henry|Autex|Leverx'
# Secret-shaped variables that must never appear.
SECRETS='PG_URL|REDIS_URL|CLICKHOUSE_|Wallet_PRIVATE_KEY|App[_ ]?Secret'

fail=0
scan() {
  local label="$1" pattern="$2"
  # -w whole word for names; tracked files only; skip this scanner itself.
  local hits
  hits=$(git ls-files | grep -vE '^scripts/cleanroom-scan\.sh$' \
    | xargs grep -InwE "$pattern" 2>/dev/null || true)
  if [ -n "$hits" ]; then echo "== $label =="; echo "$hits"; fail=1; fi
}
scan "company/person names" "$NAMES"

# Secrets: substring match (not whole word) since these are prefixes.
sec=$(git ls-files | grep -vE '^scripts/cleanroom-scan\.sh$' | xargs grep -InE "$SECRETS" 2>/dev/null || true)
if [ -n "$sec" ]; then echo "== secret-shaped names =="; echo "$sec"; fail=1; fi

if [ "$fail" -ne 0 ]; then echo "clean-room scan FAILED"; exit 1; fi
echo "clean-room scan clean"

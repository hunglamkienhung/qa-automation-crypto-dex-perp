# Demo script (about 5 minutes)

Ordered so the earliest step needs the least to be working. Each step stands on
its own; stop wherever your time runs out.

## 1. The grading core, offline (30 seconds)

Needs nothing external. Proves the rule that everything else rests on.

```bash
cd core/node && node --test "selftest/*.test.js"
cd ../python && pip install -e . && python -m pytest selftest -q
```

Point to make: `Failed > Blocked > Passed` is asserted in both proposition
orders, and the measurement controls (a clean sample must read clean, a known-
dirty sample must be flagged) run here — the tooling is tested before it is
trusted.

## 2. The contract build (30 seconds, needs Foundry)

```bash
cd contracts && forge test
```

Point to make: the PerpDEX exchange is real Solidity with its own test suite;
the QA tiers exercise it over raw JSON-RPC, not against a mock.

## 3. One spec, two stacks, one verdict (2 minutes)

Bring the backend up and run it in each stack:

```bash
bash scripts/run-be.sh node
bash scripts/run-be.sh python
```

Point to make: both read the same `features/*.feature` and land on the same
verdict for every case. Open `*/queue/results.jsonl` in each and diff the
statuses — they match, case for case.

## 4. A real write path with a real database (1 minute)

The backend run above places and matches orders on the local PerpDEX; the
indexer turns those events into SQLite, and the DB tier reads the rows directly.

Point to make: the indexer is idempotent by `(tx_hash, log_index)` and rebuilds
from block 0 on a reorg — a scenario triggers an EVM revert and then asserts the
store matches the chain again. These are checked from the SQLite rows, not from
the API's own word.

## 5. The gate that fails both ways (30 seconds)

```bash
cd node && QA_DOMAIN_ROOT=.. npx qa-verify
```

Point to make: the gate checks the *shape* of the run against
`fixtures/expected-results.json`. It catches a Passed→Failed regression **and** a
Failed→Passed check that stopped checking; no declared status is ever `Failed`
for a live-source case, so an outage cannot turn the build red.

## 6. The screen (if a browser is handy)

```bash
bash scripts/run-fe.sh node       # the GMX trading screen
```

Point to make: the FE tier checks each figure on screen against the same public
API the BE tier reads — the frontend is held to the backend's numbers. When the
live screen is slow or down, those cases grade Blocked, never Failed.

## If nothing external is available

Steps 1 and the contract build stand alone:

```bash
cd contracts && forge test
```

Everything live-dependent (GMX) grades Blocked with a reason, and the gate stays
green because Blocked is a declared, acceptable status.

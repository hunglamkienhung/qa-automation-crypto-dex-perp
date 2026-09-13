# qa-automation-crypto-dex-perp

![Pytest-BDD](https://img.shields.io/badge/Pytest--BDD-tests-0A9EDC?logo=pytest&logoColor=white)
![Cucumber](https://img.shields.io/badge/Cucumber-BDD-23D96C?logo=cucumber&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-E2E-2EAD33?logo=playwright&logoColor=white)
![Solidity](https://img.shields.io/badge/Solidity-Foundry-363636?logo=solidity&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-store-003B57?logo=sqlite&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![Node](https://img.shields.io/badge/Node-24-5FA04E?logo=nodedotjs&logoColor=white)
[![CI](https://github.com/hunglamkienhung/qa-automation-crypto-dex-perp/actions/workflows/ci.yml/badge.svg)](https://github.com/hunglamkienhung/qa-automation-crypto-dex-perp/actions/workflows/ci.yml)

QA automation for a crypto-perpetuals domain, built as a working system rather
than a slideshow. One derivatives-exchange domain tested at **every layer it
has** — Solidity contract, indexer database, REST API, a risk bot, and the
trading screen — by **two independent stacks** (Node with Cucumber, Python with
pytest-bdd) that read **one** shared set of Gherkin features and must return the
**same verdict for every case**.

Nothing here needs an account, a key, or a paid service. Clone it and it runs.

[Tiếng Việt](README.vi.md) · [Architecture](docs/ARCHITECTURE.md) ·
[Grading](docs/GRADING.md) · [Gherkin](docs/GHERKIN.md) · [Demo script](docs/DEMO.md)

## The two systems under test

**GMX (read-only)** — a real perpetuals protocol on Arbitrum. Read three ways
and cross-checked against itself: the v1 Vault and v2 markets over public RPC
(`be/contract`), the public price and market API (`be/api`), and the trading
screen (`fe/ui`). Every read is an invariant — reserved never exceeds the pool,
the oracle spread is ordered, open interest agrees in tokens and USD — so a
disagreement between the three views is a finding, not a difference of opinion.

**PerpDEX (read + write)** — a self-written perpetuals exchange in Solidity
(`contracts/`), deployed to a local anvil, and **mini-api** (`services/mini-api`),
a self-written indexer that turns its events into SQLite and serves a REST layer
over the store. This is where the write paths live: placing and matching orders,
funding, liquidation, ADL, admin — and where the DB and API tiers, the bot, and
the harder invariants are exercised deterministically.

## Layers and case counts

**301 cases**, each with an immutable ID, run in **both** stacks and reconciled
case-by-case.

| Layer | Target | Cases | Where |
|---|---|---|---|
| Contract | PerpDEX on anvil (JSON-RPC, both stacks) | 121 | `be/contract`, `contracts/` |
| Contract | GMX v1 Vault + v2 markets on Arbitrum | 25 | `be/contract` |
| DB | mini-api's SQLite, opened directly | 26 | `be/db` |
| API | mini-api REST over that SQLite | 40 | `be/api` |
| API | GMX public price/market API | 43 | `be/api` |
| Bot | risk gate (pure) + operations on PerpDEX | 35 | `be/bot` |
| FE | the GMX trading screen (Playwright) | 11 | `fe/ui` |
| | **Total** | **301** | |

## The two ideas worth a minute

**One Gherkin set, two stacks, one verdict.** `features/*.feature` are shared.
`node/` runs them with Cucumber; `python/` runs the same files with pytest-bdd.
A per-case disagreement is itself a finding — the grading logic is being read
differently in two places — and the build fails on it.

**Failed > Blocked > Passed, and an outage is never a failure.** A case is
Failed only when an observed proposition is wrong. When a live source (GMX, a
down service) cannot be reached, the case is **Blocked**, never Failed — so a
flaky network can never masquerade as a broken protocol. The CI gate checks the
*shape* of a run against `fixtures/expected-results.json`: it fails both when a
Passed turns Failed (a regression) and when a Failed turns Passed (a check that
stopped checking). See [docs/GRADING.md](docs/GRADING.md).

## Run in 30 seconds

The fastest thing that proves the machinery, needing nothing external:

```bash
# the shared grading core, both stacks
cd core/node && node --test "selftest/*.test.js"
cd ../python && pip install -e . && python -m pytest selftest -q
```

## Run the whole suite

Each step below is exactly what CI runs (`scripts/*.sh`), so it works by hand too.

```bash
# backend, one stack, no browser (fresh anvil + PerpDEX + mini-api and the tiers)
bash scripts/run-be.sh node      # or: python

# the screen (installs a chromium browser)
bash scripts/run-fe.sh node      # or: python

# the whole suite, then verify the run's shape against the baseline
bash scripts/gate.sh node

# just the contract, with Foundry
cd contracts && forge test
```

By hand, the pieces the scripts wire together:

```bash
bash contracts/chain.sh up                 # fresh anvil, deploy PerpDEX, write deployments/31337.json
( cd services/mini-api && bash serve.sh up )
cd node && QA_DOMAIN_ROOT=.. npx cucumber-js --tags "@be and @contract and @perpdex"
```

Prerequisites: Node ≥ 22.13 (for `node:sqlite`), Python ≥ 3.11, and — for the
contract tier — [Foundry](https://book.getfoundry.sh/) (`anvil`, `forge`,
`cast`). The FE script installs its own browser. A devcontainer with all of it
is in [.devcontainer/](.devcontainer/devcontainer.json).

## Layout

```
core/            one grading/queue/report/bugflow core, vendored into this repo
contracts/       PerpDEX (Solidity, Foundry) — an object of test
services/
  mini-api/      indexer + REST over SQLite — an object of test
features/        one Gherkin set, shared by both stacks
fixtures/        testcases.json (IDs) · expected-results.json (shape)
node/  python/   the two stacks: be/{contract,db,api,bot} fe/ui
testcases/       catalogue rendered from data modules
scripts/         the exact commands CI runs; reproducible by hand
docs/            architecture, grading rules, Gherkin conventions, demo script
.github/workflows/ci.yml
```

## Notes that cost something to learn

- The contract tier talks to both chains over **raw JSON-RPC** with a
  hand-written ABI coder (verified against `cast` vectors) — no web3 library.
  The signer refuses any chain but anvil's 31337.
- mini-api follows **one** exchange address, is idempotent by `(tx_hash,
  log_index)`, and rebuilds from block 0 when it sees a reorg — which a scenario
  triggers with an EVM revert and then asserts the store matches the chain again.
- The catalogue (`testcases/`) is data: `perpdex.cases.js`, `miniapi.cases.js`
  and `bot.cases.js` render to `fixtures/testcases.json` and the `.md`/`.xlsx`
  tables via `testcases/generate.js`.

## Honest scope

The FE tier and the live-source BE tiers (GMX) depend on a third party that can
be slow or change; those cases are written to grade **Blocked**, not Failed,
when that happens. The self-written PerpDEX and mini-api are fully deterministic
and are where the write paths, the database, and the harder invariants are
exercised.

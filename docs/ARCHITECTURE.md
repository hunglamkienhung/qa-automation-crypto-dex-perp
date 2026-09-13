# Architecture

## Shape

```
core/                         one grading/queue/report/bugflow core
  node/  python/              same architecture, one per stack
contracts/                    PerpDEX (Solidity) — an object of test
services/
  mini-api/                   indexer + REST over SQLite — an object of test
features/*.feature            one Gherkin set, shared by both stacks
fixtures/                     testcases.json (IDs) · expected-results.json (shape)
node/   python/               the two stacks: be/{contract,db,api,bot} fe/ui
testcases/                    catalogue rendered from data modules
scripts/                      the exact commands CI runs
```

Dependency direction is one way: `the domain → core`. The core knows nothing
about the domain. The domain links the core without publishing it — Node via
`"@portfolio/core": "file:../core/node"`, Python via `pip install -e ../core/python`.

## Why a real system next to a real third party

Reading a live protocol proves you can measure the real world; it cannot prove
you can test a **write** path, because you cannot safely place orders or mutate
someone else's chain. So the domain pairs a live read-only system with a
self-written one you fully control:

```
GMX (read)  +  PerpDEX + mini-api (read/write, own DB)
```

The self-written systems are where orders are placed and matched, where funding
accrues, where a liquidation fires, where an indexer rebuilds after a reorg, and
where a bot's risk gate refuses an order before it is sent. GMX is where
invariants are checked against something nobody here can tune to pass.

## Data flows the tests follow

```
anvil (PerpDEX) --events--> mini-api indexer --> SQLite --REST--> mini-api
    the DB tier reads the SQLite directly and checks it against the chain;
    the API tier checks each REST response against that same SQLite.

GMX on Arbitrum: RPC, public API, and screen — three independent reads of one
    protocol, each checked against the others.
```

Each cross-check compares exactly one pair, so a divergence names one layer:
chain ↔ DB is the indexer; DB ↔ API is the REST layer; the three GMX views name
whichever of RPC / API / screen disagrees.

## One feature set, two stacks

A feature file is authored once. Cucumber (Node) and pytest-bdd (Python) each
bind their own step definitions to it and file results to their own queue under
the same immutable case IDs. The gate then requires the two queues to agree.
This is the project's central claim made mechanical: the same specification,
executed two independent ways, lands on the same verdict — or the build stops.

See [GRADING.md](GRADING.md) for how a verdict is decided and
[GHERKIN.md](GHERKIN.md) for the feature conventions.

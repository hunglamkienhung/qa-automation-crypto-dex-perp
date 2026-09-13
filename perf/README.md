# Performance tests (Locust)

Load tests for the **mini-api** service (the indexer's REST layer) — the
performance counterpart to the functional BDD suite. They drive the same
read-heavy endpoints a perp-DEX front end would poll (markets, order book,
trades, liquidations) under concurrency, validating every response so a wrong
status is a failure, not just a slow success.

## Run

```bash
pip install -r perf/requirements.txt
bash perf/run.sh                 # 40 users, spawn 10/s, 30s, against a fresh mini-api
bash perf/run.sh 100 20 60s      # heavier
```

An interactive web UI (charts, live control):

```bash
( cd services/mini-api && MINI_API_DB=/tmp/mini-api-perf/mini-api.db MINI_API_RATE_LIMIT=100000000 bash serve.sh up )
locust -f perf/locustfile.py --host http://127.0.0.1:8787      # then open http://localhost:8089
```

## The traffic model

One `Reader` class polls the public indexer endpoints, weighted toward the book
and the market list:

| Endpoint | Weight |
|---|---|
| `GET /markets` | 4 |
| `GET /orderbook/[id]` | 4 |
| `GET /markets/[id]` | 3 |
| `GET /trades` | 3 |
| `GET /liquidations` | 2 |
| `GET /health` | 1 |

## Rate limiting

The service rate-limits per client address (60 / 10 s by default) — a real
protection the functional suite tests directly. A throughput test from one host
would hit that cap immediately, so `run.sh` raises `MINI_API_RATE_LIMIT` for the
run; the goal here is the store's read latency, not the limiter.

## The pass/fail gate

The locustfile's `quitting` hook exits **non-zero** when a run breaches either
threshold, so `run.sh` doubles as a CI performance gate:

- error ratio > `PERF_MAX_FAIL_RATIO` (default `0.01` — 1%)
- p95 latency > `PERF_MAX_P95_MS` (default `750` ms)

Override per environment, e.g. `PERF_MAX_P95_MS=400 bash perf/run.sh`.

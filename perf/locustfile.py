"""Locust load test for the mini-api service (the indexer's REST layer).

The performance counterpart to the functional BDD suite: the same read-heavy
REST API a perp-DEX front end would poll -- markets, the order book, recent
trades and liquidations -- driven under concurrency. Every request validates its
response so a wrong status counts as a failure, not just a slow success.

The service rate-limits per client address (60 / 10 s by default). A throughput
test from one host would otherwise hit 429s immediately, so perf/run.sh raises
MINI_API_RATE_LIMIT for the run -- we are measuring the store's read latency,
not the limiter (which the functional suite already covers).

Run it headless with a pass/fail gate (see perf/run.sh):

    locust -f perf/locustfile.py --headless -u 40 -r 10 -t 30s \
        --host http://127.0.0.1:8787
"""

from __future__ import annotations

import os
import random

from locust import HttpUser, between, events, task

MAX_FAIL_RATIO = float(os.environ.get("PERF_MAX_FAIL_RATIO", "0.01"))
MAX_P95_MS = float(os.environ.get("PERF_MAX_P95_MS", "750"))


def _get(client, path, name, expect=(200,)):
    with client.get(path, name=name, catch_response=True) as r:
        r.success() if r.status_code in expect else r.failure(f"{r.status_code} {r.text[:80]}")
        return r


class Reader(HttpUser):
    """A front end polling the public indexer endpoints."""

    wait_time = between(0.1, 0.5)

    def on_start(self):
        self.markets = [1]
        r = self.client.get("/markets", name="GET /markets")
        try:
            ids = [m["market_id"] for m in r.json().get("markets", [])]
            if ids:
                self.markets = ids
        except Exception:  # noqa: BLE001
            pass

    @task(4)
    def markets(self):
        _get(self.client, "/markets", "GET /markets")

    @task(3)
    def market_detail(self):
        _get(self.client, f"/markets/{random.choice(self.markets)}", "GET /markets/[id]")

    @task(4)
    def orderbook(self):
        _get(self.client, f"/orderbook/{random.choice(self.markets)}", "GET /orderbook/[id]")

    @task(3)
    def trades(self):
        _get(self.client, "/trades?limit=50", "GET /trades")

    @task(2)
    def liquidations(self):
        _get(self.client, "/liquidations?limit=50", "GET /liquidations")

    @task(1)
    def health(self):
        _get(self.client, "/health", "GET /health")


@events.quitting.add_listener
def _gate(environment, **_kw):
    stats = environment.stats.total
    p95 = stats.get_response_time_percentile(0.95)
    print(f"\nperf gate: requests={stats.num_requests} fails={stats.num_failures} "
          f"fail_ratio={stats.fail_ratio:.4f} p95={p95}ms rps={stats.total_rps:.1f}")
    reasons = []
    if stats.num_requests == 0:
        reasons.append("no requests were made")
    if stats.fail_ratio > MAX_FAIL_RATIO:
        reasons.append(f"fail ratio {stats.fail_ratio:.4f} > {MAX_FAIL_RATIO}")
    if p95 and p95 > MAX_P95_MS:
        reasons.append(f"p95 {p95}ms > {MAX_P95_MS}ms")
    if reasons:
        print("perf gate FAILED: " + "; ".join(reasons))
        environment.process_exit_code = 1
    else:
        print("perf gate PASSED")
        environment.process_exit_code = 0

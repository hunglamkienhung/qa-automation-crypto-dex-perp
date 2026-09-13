"""Steps for be-api-mini.feature: the REST layer compared with the rows it
serves. Mirror of node/be/api/steps/mini.steps.js -- a plugin module. The
store-side steps (opening, catching up, the admin levers, noted counts) live
in be/db/steps/store_steps.py and are shared.

``qa.api`` is always the LAST response: status, headers, parsed body. The
request steps never assert; the "the response ..." steps do, so a 4xx that a
scenario expects is graded like any other answer.
"""

from __future__ import annotations

import json
import os
import re
import time

import pytest
from pytest_bdd import given, parsers, then, when

from be.api.venues.mini import ADMIN_TOKEN, WINDOW_MS, ApiUnreachable
from be.contract.chain.perpdex import ChainUnreachable
from be.contract.steps.perpdex_steps import P, market_id
from be.db.steps.store_steps import check as _check, eq, j, who
from be.db.store import DbUnreachable

UNREACHABLE = (ApiUnreachable, DbUnreachable, ChainUnreachable)
RATE_LIMIT = int(os.environ.get("MINI_API_RATE_LIMIT", "60"))
POSITION_FIELDS = ["market_id", "size", "entry_price", "realized_pnl", "funding_paid"]
ACTORS = "alice|bob|carol|dave|victim|keeper|erin|frank|grace|admin"


@pytest.fixture(autouse=True)
def mini_scenario(request, qa, store_scenario):
    if request.node.get_closest_marker("mini") is None:
        yield
        return
    qa.api = None
    qa.tokens = {}
    qa.requests = 0
    yield


check = _check


def resolve_path(qa, path: str) -> str:
    return re.sub(rf"([/=])({ACTORS})(?=[/?&]|$)", lambda m: m.group(1) + who(qa, m.group(2)), path)


def send(qa, method: str, path: str, **opts) -> None:
    if qa.source_error:
        return
    path = resolve_path(qa, path)
    try:
        qa.api = qa.mini.request(method, path, **opts)
        qa.requests += 1
        qa.evidence(f"http.{qa.requests}", {"method": method, "path": path, "status": qa.api["status"], "origin": opts.get("origin"), "token": "(set)" if opts.get("token") else None})
    except ApiUnreachable as err:
        qa.source_error = str(err)


def body(qa) -> dict:
    return (qa.api or {}).get("body") or {}


def field(qa, name: str):
    return body(qa).get(name)


def token_of(qa, alias: str) -> str:
    return qa.tokens.get(alias, alias)  # an unknown alias is sent literally ("nope")


def same_rows(got, want: list[dict], keys: list[str]):
    if not isinstance(got, list):
        return False, "response is not a list"
    if len(got) != len(want):
        return False, f"response has {len(got)} rows, store has {len(want)}"
    for i, (g, w) in enumerate(zip(got, want)):
        bad = [k for k in keys if not eq(g.get(k), w.get(k))]
        if bad:
            return False, f"row {i}: " + ", ".join(f"{k} api={g.get(k)} store={w.get(k)}" for k in bad)
    return True, f"{len(got)} rows equal on {len(keys)} fields"


def mint(qa, alias: str, scope: str, subject: str | None = None, ttl: int | None = None) -> None:
    if qa.source_error:
        return
    try:
        qa.tokens[alias] = qa.mini.mint_token(scope, subject, ttl)
    except ApiUnreachable as err:
        qa.source_error = str(err)


# ---------------------------------------------------------------- Background


@given("the API is reachable")
def api_reachable(qa):
    send(qa, "GET", "/health")
    if qa.source_error:
        return
    if qa.api["status"] != 200 or not body(qa).get("ok"):
        qa.source_error = f"GET /health answered {qa.api['status']} {qa.api['text'][:200]}"
    else:
        qa.evidence("health", {"last_block": field(qa, "last_block"), "rebuilds": field(qa, "rebuilds")})


# ---------------------------------------------------------------- requests


@when(parsers.re(r"^GET (?P<path>/\S*)$"))
def get_plain(qa, path):
    send(qa, "GET", path)


@when(parsers.re(r'^GET (?P<path>/\S*) with origin "(?P<origin>[^"]*)"$'))
def get_origin(qa, path, origin):
    send(qa, "GET", path, origin=origin)


@when(parsers.re(r'^GET (?P<path>/\S*) with token "(?P<alias>[^"]*)"$'))
def get_token(qa, path, alias):
    send(qa, "GET", path, token=token_of(qa, alias))


@when(parsers.re(r'^OPTIONS (?P<path>/\S*) with origin "(?P<origin>[^"]*)" and request method (?P<method>\w+)$'))
def options_preflight(qa, path, origin, method):
    send(qa, "OPTIONS", path, origin=origin, headers={"Access-Control-Request-Method": method, "Access-Control-Request-Headers": "authorization"})


@when(parsers.re(r'^POST (?P<path>/\S*) with token "(?P<alias>[^"]*)" and body (?P<payload>\{.*\})$'))
def post_token(qa, path, alias, payload):
    send(qa, "POST", path, token=token_of(qa, alias), body=json.loads(payload))


@when(parsers.re(r"^POST (?P<path>/\S*) with no token and body (?P<payload>\{.*\})$"))
def post_no_token(qa, path, payload):
    send(qa, "POST", path, body=json.loads(payload))


@when(parsers.re(r"^POST (?P<path>/\S*) with the admin token and body (?P<payload>\{.*\})$"))
def post_admin(qa, path, payload):
    send(qa, "POST", path, token=ADMIN_TOKEN, body=json.loads(payload))


@when(P("the trades are paged {n:d} at a time until the cursor is exhausted"))
def page_trades(qa, n):
    qa.noted["paged"] = []
    cursor = None
    for _ in range(200):
        send(qa, "GET", f"/trades?limit={n}" + (f"&cursor={cursor}" if cursor else ""))
        if qa.source_error or qa.api["status"] != 200:
            break
        qa.noted["paged"].extend(body(qa)["trades"])
        cursor = body(qa).get("next_cursor")
        if not cursor:
            break
    qa.evidence("pages", -(-len(qa.noted["paged"]) // n))


@when(parsers.re(r"^GET (?P<path>/\S*) is sent (?P<extra>\d+) times more than the rate limit within the window$"))
def burst(qa, path, extra):
    if qa.source_error:
        return
    time.sleep(WINDOW_MS / 1000 + 0.3)  # start on a fresh window so the count is this burst alone
    total = RATE_LIMIT + int(extra)
    b = {"statuses": [], "remaining": [], "first429At": None, "zeroBefore429": False}
    started = time.monotonic()
    for i in range(total):
        try:
            r = qa.mini.request("GET", path, throttle=False)
        except ApiUnreachable as err:
            qa.source_error = str(err)
            return
        b["statuses"].append(r["status"])
        rem = r["headers"].get("x-ratelimit-remaining")
        b["remaining"].append(None if rem is None else int(rem))
        if r["status"] == 429 and b["first429At"] is None:
            b["first429At"] = i
            b["zeroBefore429"] = 0 in b["remaining"][:i]
        qa.api = r
    b["elapsedMs"] = int((time.monotonic() - started) * 1000)
    qa.noted["burst"] = b
    qa.evidence("burst", {"sent": total, "elapsedMs": b["elapsedMs"], "first429At": b["first429At"], "count429": b["statuses"].count(429)})


# ---------------------------------------------------------------- tokens


@given(P('a token with scope {scope:w} as "{alias}"'))
def token_scope(qa, scope, alias):
    mint(qa, alias, scope)


@given(P('a token with scope {scope:w} for {name:w} as "{alias}"'))
def token_scope_for(qa, scope, name, alias):
    mint(qa, alias, scope, who(qa, name))


@given(parsers.re(r'^a token with scope (?P<scope>\w+) for (?P<name>\w+) expiring in (?P<ttl>\d+) seconds? as "(?P<alias>[^"]*)"$'))
def token_scope_for_ttl(qa, scope, name, ttl, alias):
    mint(qa, alias, scope, who(qa, name), int(ttl))


# ---------------------------------------------------------------- response: status, shape, fields


@then(parsers.re(r"^the (?:last )?response status is (?P<status>\d+)$"))
def response_status(qa, status):
    check(qa, f"status {status}", lambda: (qa.api["status"] == int(status), f"status {qa.api['status']} {qa.api['text'][:160]}"))


@then(parsers.re(r'^the (?:last )?response is an error with code "(?P<code>[^"]*)"$'))
def response_error(qa, code):
    def ev():
        b = body(qa)
        return b.get("code") == code and isinstance(b.get("error"), str) and len(b["error"]) > 0, qa.api["text"][:160]
    check(qa, f"error code {code}", ev)


@then(parsers.re(r'^the response field "(?P<name>[^"]+)" is (?P<lit>true|false|-?\d+)$'))
def response_field_literal(qa, name, lit):
    want = True if lit == "true" else False if lit == "false" else int(lit)
    check(qa, f"field {name} is {lit}", lambda: (field(qa, name) == want and type(field(qa, name)) is type(want), f"{name} = {j(field(qa, name))}"))


@then(parsers.re(r'^the response field "(?P<name>[^"]+)" is "(?P<want>[^"]*)"$'))
def response_field_string(qa, name, want):
    check(qa, f"field {name} is {want}", lambda: (field(qa, name) == want, f"{name} = {j(field(qa, name))}"))


@then(parsers.re(r'^the response field "(?P<name>[^"]+)" is the list (?P<lst>.+)$'))
def response_field_list(qa, name, lst):
    want = [x.strip() for x in lst.split(",")]
    check(qa, f"field {name} is {lst}", lambda: (field(qa, name) == want, f"{name} = {j(field(qa, name))}"))


@then(P('the response list "{name}" has {n:d} entries'))
def response_list_len(qa, name, n):
    def ev():
        lst = field(qa, name)
        return isinstance(lst, list) and len(lst) == n, f"{len(lst)} entries" if isinstance(lst, list) else "not a list"
    check(qa, f"{name} has {n} entries", ev)


@then(parsers.re(r"^the response keys are exactly (?P<lst>.+)$"))
def response_keys(qa, lst):
    want = sorted(x.strip() for x in lst.split(","))
    check(qa, "response keys", lambda: (sorted(body(qa).keys()) == want, "keys " + ", ".join(sorted(body(qa).keys()))))


@then(parsers.re(r'^the response field "(?P<name>[^"]+)" equals indexer_state\.(?P<col>\w+)$'))
def response_field_state(qa, name, col):
    def ev():
        a, b = field(qa, name), qa.store.state()[col]
        same = a.lower() == b.lower() if isinstance(a, str) and isinstance(b, str) else eq(a, b)
        return same, f"api {j(a)}, store {j(b)}"
    check(qa, f"{name} == indexer_state.{col}", ev)


# ---------------------------------------------------------------- response: headers


@then(parsers.re(r'^the response header (?P<h>[\w-]+) is "(?P<want>[^"]*)"$'))
def header_is(qa, h, want):
    check(qa, f"header {h}", lambda: (qa.api["headers"].get(h.lower()) == want, f"{h}: {j(qa.api['headers'].get(h.lower()))}"))


@then(parsers.re(r'^the response header (?P<h>[\w-]+) contains "(?P<want>[^"]*)"$'))
def header_contains(qa, h, want):
    def ev():
        v = qa.api["headers"].get(h.lower(), "")
        return want in [x.strip() for x in v.split(",")] or want in v, f"{h}: {j(v)}"
    check(qa, f"header {h} contains {want}", ev)


@then(parsers.re(r"^the response has no (?P<h>[\w-]+) header$"))
def header_absent(qa, h):
    def ev():
        v = qa.api["headers"].get(h.lower())
        return v is None, f"absent (status {qa.api['status']})" if v is None else f"{h}: {v}"
    check(qa, f"no {h} header", ev)


@then(parsers.re(r"^the (?:last )?response header (?P<h>[\w-]+) is a positive integer$"))
def header_positive_int(qa, h):
    def ev():
        v = qa.api["headers"].get(h.lower())
        return bool(v) and v.isdigit() and int(v) > 0, f"{h}: {j(v)}"
    check(qa, f"{h} positive integer", ev)


@then("the response header X-Indexed-Block is below the chain head")
def indexed_block_below_head(qa):
    def ev():
        v = qa.api["headers"].get("x-indexed-block")
        head = qa.dex.block_number()
        return v is not None and v.lstrip("-").isdigit() and int(v) < head, f"X-Indexed-Block {v}, head {head}"
    check(qa, "X-Indexed-Block < head", ev)


@then("X-RateLimit-Remaining reached 0 before the first 429")
def remaining_zero_before_429(qa):
    def ev():
        b = qa.noted.get("burst")
        if not b:
            return False, "no burst"
        at = b["first429At"] or 0
        return b["first429At"] is not None and b["zeroBefore429"], f"first 429 at request {b['first429At']}, remaining before it: {j(b['remaining'][max(0, at - 3):at])}"
    check(qa, "remaining hit 0 before 429", ev)


# ---------------------------------------------------------------- markets (190-196)

MARKET_COLS = ["market_id", "symbol", "status", "tick_size", "step_size", "min_notional", "max_leverage", "maker_fee_bps", "taker_fee_bps", "max_basis_bps"]


def market_rows(qa) -> list[dict]:
    return qa.store.all("SELECT m.*, i.price AS index_price FROM markets m LEFT JOIN index_prices i ON i.market_id = m.market_id ORDER BY m.market_id")


@then("the markets in the response equal the markets rows")
def markets_equal(qa):
    check(qa, "/markets == markets rows", lambda: same_rows(field(qa, "markets"), market_rows(qa), MARKET_COLS + ["index_price"]))


@then(P("the market in the response equals the markets row {mid:d}"))
def market_equal(qa, mid):
    check(qa, f"/markets/{mid} == row", lambda: same_rows([body(qa)], [r for r in market_rows(qa) if r["market_id"] == mid], MARKET_COLS + ["index_price"]))


@then(P('the response field "{name}" equals the mark derived from the store for {sym:w}'))
def field_equals_derived_mark(qa, name, sym):
    def ev():
        d = qa.store.mark_of(market_id(sym))
        return d is not None and eq(field(qa, name), d), f"api {field(qa, name)}, derived {d}"
    check(qa, f"{name} == derived mark", ev)


@then(P("the response open interest equals the positions sums for {sym:w}"))
def oi_equals_positions(qa, sym):
    def ev():
        long = short = 0
        for r in qa.store.all("SELECT size FROM positions WHERE market_id = ?", market_id(sym)):
            s = int(r["size"])
            if s > 0:
                long += s
            else:
                short -= s
        b = body(qa)
        return eq(b.get("open_interest_long"), long) and eq(b.get("open_interest_short"), short) and long > 0, f"api {b.get('open_interest_long')}/{b.get('open_interest_short')}, store {long}/{short}"
    check(qa, "open interest == positions sums", ev)


@then(P('the response field "{name}" equals the markets row {mid:d} status'))
def field_equals_market_status(qa, name, mid):
    def ev():
        row = qa.store.get("SELECT status FROM markets WHERE market_id = ?", mid)
        return bool(row) and field(qa, name) == row["status"], f"api {field(qa, name)}, store {row and row['status']}"
    check(qa, f"{name} == markets row status", ev)


# ---------------------------------------------------------------- book, orders, positions (197-202)


@then(P("the bids in the response equal the store's open bids aggregated per price for {sym:w}"))
def bids_equal(qa, sym):
    def ev():
        rows = qa.store.all("SELECT price, SUM(CAST(size AS INTEGER) - CAST(filled AS INTEGER)) AS size, COUNT(*) AS orders FROM orders WHERE market_id = ? AND status = 'Open' AND side = 'Buy' GROUP BY price", market_id(sym))
        rows.sort(key=lambda r: int(r["price"]), reverse=True)
        want = [{"price": r["price"], "size": str(r["size"]), "orders": r["orders"]} for r in rows[:5]]
        ok, detail = same_rows(field(qa, "bids"), want, ["price", "size", "orders"])
        return ok and len(want) > 0, detail + "; store levels " + j(want)
    check(qa, "/orderbook bids == aggregated open bids", ev)


@then(P("the orders in the response equal the store's orders for {name:w} with status {status:w}"))
def orders_equal(qa, name, status):
    def ev():
        if status == "all":
            rows = qa.store.all("SELECT * FROM orders WHERE owner = ? ORDER BY order_id", who(qa, name))
        else:
            rows = qa.store.all("SELECT * FROM orders WHERE owner = ? AND status = ? ORDER BY order_id", who(qa, name), status)
        ok, detail = same_rows(field(qa, "orders"), rows, list(rows[0].keys()) if rows else ["order_id"])
        return ok and len(rows) > 0, detail
    check(qa, f"/orders == orders rows ({status})", ev)


@then(P("the positions in the response equal the store's positions for {name:w}"))
def positions_equal(qa, name):
    def ev():
        rows = qa.store.all("SELECT * FROM positions WHERE account = ? ORDER BY market_id", who(qa, name))
        got = field(qa, "positions")
        keys = list(rows[0].keys()) if (isinstance(got, list) and got and "account" in got[0] and rows) else POSITION_FIELDS
        ok, detail = same_rows(got, rows, keys)
        return ok and len(rows) > 0, detail
    check(qa, "/positions == positions rows", ev)


# ---------------------------------------------------------------- trades (203-208)


@then(P('the response field "{name}" equals the count of {table:w} rows'))
def field_equals_count(qa, name, table):
    def ev():
        n = qa.store.count(table)
        return field(qa, name) == n and n > 0, f"api {field(qa, name)}, store {n}"
    check(qa, f"{name} == COUNT({table})", ev)


@then(P('the response field "{name}" equals the count of trades rows for market {m:d}'))
def field_equals_count_market(qa, name, m):
    def ev():
        n = qa.store.count("trades", "WHERE market_id = ?", m)
        return field(qa, name) == n and n > 0, f"api {field(qa, name)}, store {n}"
    check(qa, f"{name} == COUNT(trades) for market {m}", ev)


@then(P('the response field "{name}" equals the noted trades count'))
def field_equals_noted(qa, name):
    check(qa, f"{name} == noted trades count", lambda: (field(qa, name) == qa.noted["trades"], f"api {field(qa, name)}, noted {qa.noted['trades']}"))


@then(P('the response field "{name}" equals the noted trades count plus {d:d}'))
def field_equals_noted_plus(qa, name, d):
    check(qa, f"{name} == noted trades count + {d}", lambda: (field(qa, name) == qa.noted["trades"] + d, f"api {field(qa, name)}, noted {qa.noted['trades']}"))


@then("the trades in the response are ordered newest first by block and log index")
def trades_newest_first(qa):
    def ev():
        t = field(qa, "trades") or []
        for i in range(1, len(t)):
            a, b = t[i - 1], t[i]
            if a["block_number"] < b["block_number"] or (a["block_number"] == b["block_number"] and a["log_index"] <= b["log_index"]):
                return False, f"row {i - 1} ({a['block_number']}#{a['log_index']}) before row {i} ({b['block_number']}#{b['log_index']})"
        return len(t) >= 2, f"{len(t)} rows, keys " + " ".join(f"{x['block_number']}#{x['log_index']}" for x in t)
    check(qa, "trades newest first", ev)


@then("the paged trades are exactly the trades rows, each once")
def paged_trades_exact(qa):
    def ev():
        key = lambda r: f"{r['tx_hash']}#{r['log_index']}"  # noqa: E731
        got = sorted(key(r) for r in qa.noted.get("paged", []))
        want = sorted(key(r) for r in qa.store.all("SELECT tx_hash, log_index FROM trades"))
        dup = [k for i, k in enumerate(got) if i > 0 and got[i - 1] == k]
        return got == want and not dup and len(want) > 0, f"paged {len(got)}, store {len(want)}, duplicates {len(dup)}"
    check(qa, "paged trades == trades rows", ev)


@then(P("every trade in the response has market_id {m:d}"))
def trades_market_filter(qa, m):
    def ev():
        t = field(qa, "trades") or []
        bad = [x for x in t if x["market_id"] != m]
        return not bad and len(t) > 0, f"{len(t)} rows, {len(bad)} off-market"
    check(qa, f"trades filtered by market {m}", ev)


# ---------------------------------------------------------------- funding, liquidations (209-212)


@then(P("the funding in the response equals the funding rows for {sym:w}"))
def funding_equal(qa, sym):
    def ev():
        since = int(time.time()) - 86_400
        rows = qa.store.all("SELECT * FROM funding WHERE market_id = ? AND funding_time >= ? ORDER BY funding_time DESC, log_index DESC LIMIT 50", market_id(sym), since)
        ok, detail = same_rows(field(qa, "funding"), rows, ["tx_hash", "log_index", "rate_bps", "cumulative_index", "funding_time", "samples"])
        return ok and len(rows) > 0, detail
    check(qa, "/funding/history == funding rows", ev)


@then("the newest liquidation in the response equals the newest liquidations row")
def newest_liquidation(qa):
    def ev():
        row = qa.store.get("SELECT * FROM liquidations ORDER BY block_number DESC, log_index DESC LIMIT 1")
        lst = field(qa, "liquidations") or []
        if not row or not lst:
            return False, "response has no liquidation" if row else "store has no liquidation"
        return same_rows([lst[0]], [row], list(row.keys()))
    check(qa, "/liquidations[0] == newest row", ev)


# ---------------------------------------------------------------- portfolio, tokens (217, 219)


@then(P('the response field "{name}" equals the accounts row for {actor:w} deposits'))
def field_equals_deposits(qa, name, actor):
    def ev():
        row = qa.store.get("SELECT deposits FROM accounts WHERE account = ?", who(qa, actor))
        return bool(row) and eq(field(qa, name), row["deposits"]) and row["deposits"] != "0", f"api {field(qa, name)}, store {row and row['deposits']}"
    check(qa, f"{name} == accounts.deposits", ev)


@then(P('the response field "{name}" equals the count of {actor:w}\'s open and pending orders'))
def field_equals_open_orders(qa, name, actor):
    def ev():
        n = qa.store.count("orders", "WHERE owner = ? AND status IN ('Open','Pending')", who(qa, actor))
        return field(qa, name) == n and n > 0, f"api {field(qa, name)}, store {n}"
    check(qa, f"{name} == open+pending orders", ev)


@then(P("the minted token exists in api_keys with scope {scope:w}"))
def minted_token_exists(qa, scope):
    def ev():
        t = field(qa, "token")
        row = qa.store.get("SELECT scope FROM api_keys WHERE token = ?", t) if t else None
        return bool(row) and row["scope"] == scope, f"scope {row['scope']}" if row else "no row for the returned token"
    check(qa, "minted token in api_keys", ev)

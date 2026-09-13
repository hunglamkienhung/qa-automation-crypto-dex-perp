"""Steps for be-db.feature, plus the store-side steps be-api-mini.feature shares.
Mirror of node/be/db/steps/store.steps.js -- a plugin module.

Every scenario here is also @perpdex, so perpdex_steps' fixture gives it a
chain snapshot before and a revert after. The indexer sees the revert as a
reorg and rebuilds; "the store has caught up" waits for that, so a scenario
always reads a store that matches the chain it is looking at.

The store is opened read-only. The two admin levers (pause, rewind) go through
the API because only the service may touch its own file.
"""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

import pytest
from pytest_bdd import given, parsers, then, when

from be.api.venues.mini import ApiUnreachable, MiniApi
from be.contract.chain import units as U
from be.contract.chain.perpdex import ChainUnreachable, Reverted
from be.contract.steps.perpdex_steps import P, market_id
from be.db.store import DbUnreachable, Store, throwaway, wait_caught_up

ZERO = "0x0000000000000000000000000000000000000000"
UNREACHABLE = (DbUnreachable, ChainUnreachable, ApiUnreachable)
ARTIFACT = Path(__file__).resolve().parents[4] / "contracts" / "out" / "PerpExchange.sol" / "PerpExchange.json"

# One client for the whole run: it carries the rate-limit budget across scenarios.
mini = MiniApi()


@pytest.fixture(autouse=True)
def store_scenario(request, qa, perpdex_scenario):
    """Per-scenario slots for @db / @mini scenarios; unpause and close afterwards.
    Depends on perpdex_scenario so the chain slots (dex, who, noted) exist first."""
    if request.node.get_closest_marker("db") is None and request.node.get_closest_marker("mini") is None:
        yield
        return
    qa.store = None
    qa.mini = mini
    qa.paused_indexer = False
    qa.tmp = None
    yield
    if qa.paused_indexer:
        try:
            mini.set_indexer_paused(False)
        except Exception:  # noqa: BLE001 - best effort
            pass
    if qa.tmp is not None:
        qa.tmp.close()
    if qa.store is not None:
        qa.store.close()


# ---------------------------------------------------------------- helpers


def who(qa, name: str) -> str:
    key = name.removesuffix("'s")
    if key not in qa.who:
        raise KeyError(f'unknown actor "{name}"')
    return qa.who[key].lower()


def check(qa, description: str, fn) -> None:
    if qa.source_error:
        qa.unobservable(description, "the source could not be reached -- " + qa.source_error)
        return
    try:
        passed, detail = fn()
    except UNREACHABLE as err:
        qa.unobservable(description, str(err))
        return
    qa.check(description, passed, detail)


def act(qa, fn) -> None:
    if qa.source_error:
        return
    try:
        fn()
    except UNREACHABLE as err:
        qa.source_error = str(err)
    except Reverted as err:
        qa.last = {"ok": False, "revert": err}
        qa.unchecked = err


def catch_up(qa, description: str = "the store caught up with the chain head") -> dict | None:
    if qa.source_error or qa.store is None:
        return None
    r = wait_caught_up(qa.store, qa.dex, timeout_s=40.0)
    # A store that has not caught up is UNOBSERVABLE, not wrong: under a full run
    # the chain grows large and the indexer's rebuild-from-0 can lag. Grade
    # Blocked and set source_error so every later assertion Blocks too, rather
    # than letting a stale read grade Failed.
    if not r["caughtUp"]:
        why = f"the store did not catch up within the timeout -- last_block {r['last_block']}, head {r['head']}, paused {r['paused']}, after {r['waitedMs']} ms"
        qa.unobservable(description, why)
        qa.source_error = why
    return r


def events(qa) -> list[dict]:
    return (qa.last or {}).get("events", []) or []


def last_tx(qa):
    return ((qa.last or {}).get("receipt") or {}).get("transactionHash")


def eq(a, b) -> bool:
    return str(a) == str(b)


def j(v) -> str:
    return json.dumps(v, default=str)


def diff_fields(pairs, row: dict, src: dict) -> list[str]:
    bad = []
    for spec in pairs:
        col, key = spec[0], spec[1]
        want = spec[2](src[key]) if len(spec) > 2 else src[key]
        if not eq(row[col], want):
            bad.append(f"{col}={row[col]} (chain {want})")
    return bad


SIDE_NAME = ["Buy", "Sell"]
ORDER_TYPE_NAME = ["Market", "Limit", "StopMarket", "StopLimit", "TakeProfit"]
TIF_NAME = ["GTC", "IOC", "FOK", "PostOnly"]
lower = str.lower


# ---------------------------------------------------------------- Background


@given("the store is open and the indexer has caught up")
def store_open(qa):
    if qa.source_error:
        return
    try:
        qa.store = Store()
    except DbUnreachable as err:
        qa.source_error = str(err)
        return
    qa.evidence("storeFile", str(qa.store.file))
    st = qa.store.state()
    if st and st["paused"]:
        qa.evidence("indexerWasPausedAtStart", True)
        act(qa, lambda: mini.set_indexer_paused(False))
    r = catch_up(qa, "the store caught up with the chain head before the scenario")
    if r:
        qa.evidence("storeAtStart", {"last_block": r["last_block"], "head": r["head"], "waitedMs": r["waitedMs"]})


@given("the store has caught up")
@when("the store has caught up")
@then("the store has caught up")
def store_caught_up(qa):
    catch_up(qa)


# ---------------------------------------------------------------- chain and time levers


@given("a block is mined")
@when("a block is mined")
def block_mined(qa):
    act(qa, lambda: qa.dex.mine())


@given(P("{s:d} seconds pass"))
@when(P("{s:d} seconds pass"))
def seconds_pass(qa, s):
    time.sleep(s)


@given("a chain snapshot is taken")
def chain_snapshot(qa):
    def go():
        qa.noted["snap"] = qa.dex.snapshot()
    act(qa, go)


@when("the chain is reverted to the snapshot")
def chain_revert(qa):
    def go():
        if not qa.dex.revert(qa.noted["snap"]):
            raise RuntimeError("evm_revert returned false")
    act(qa, go)


# ---------------------------------------------------------------- indexer levers (through the API)


@given("the indexer is paused")
def indexer_paused(qa):
    def go():
        mini.set_indexer_paused(True)
        qa.paused_indexer = True
    act(qa, go)


@when("the indexer is unpaused")
def indexer_unpaused(qa):
    def go():
        mini.set_indexer_paused(False)
        qa.paused_indexer = False
    act(qa, go)


@when(P("the indexer is rewound by {n:d} blocks"))
def indexer_rewound(qa, n):
    def go():
        st = qa.store.state()
        target = max(-1, st["last_block"] - n)
        mini.rewind_indexer(target)
        qa.evidence("rewind", {"from": st["last_block"], "to": target})
    act(qa, go)


# ---------------------------------------------------------------- noting


@given("the store row counts are noted")
def note_counts(qa):
    if qa.store is not None:
        qa.noted["counts"] = qa.store.counts()


@given("the trades count is noted")
def note_trades(qa):
    if qa.store is not None:
        qa.noted["trades"] = qa.store.count("trades")


@given("the rebuild count is noted")
def note_rebuilds(qa):
    if qa.store is not None:
        qa.noted["rebuilds"] = qa.store.state()["rebuilds"]


# ---------------------------------------------------------------- schema (164, 165)


@then(parsers.re(r"the store has tables (?P<lst>.+)"))
def has_tables(qa, lst):
    want = [t.strip() for t in lst.split(",")]

    def ev():
        have = qa.store.tables()
        missing = [t for t in want if t not in have]
        return not missing, ("missing " + ", ".join(missing)) if missing else f"{len(have)} tables"
    check(qa, "store has the documented tables", ev)


@then(parsers.re(r"the tables (?P<lst>.+) are uniquely keyed by \(tx_hash, log_index\)"))
def keyed_by_tx_log(qa, lst):
    tables = [t.strip() for t in lst.split(",")]

    def ev():
        bad = [t for t in tables if qa.store.primary_key(t) != ["tx_hash", "log_index"]]
        return not bad, "; ".join(f"{t}: {','.join(qa.store.primary_key(t))}" for t in bad) if bad else f"{len(tables)} tables"
    check(qa, "event tables keyed by (tx_hash, log_index)", ev)


@given("a throwaway database with the schema applied")
def throwaway_db(qa):
    qa.tmp = throwaway()
    qa.tmp.execute("INSERT INTO markets VALUES (1, 'ETH-PERP', 'Active', '100000000', '10000000', '10000000', 50, -2, 5, 100, 1)")
    qa.tmp.execute("INSERT INTO orders (order_id, owner, market_id, side, order_type, tif, size, price, trigger_price, reduce_only, user_order_id, max_ts, status, placed_block, placed_tx, placed_log, updated_block) VALUES (1, '0xaa', 1, 'Buy', 'Market', 'IOC', '100000000', '0', '0', 0, 0, '0', 'Open', 1, '0xt1', 0, 1)")


def insert_fails(db, sql: str, params: tuple, needle: str):
    try:
        db.execute(sql, params)
        return False, "insert succeeded"
    except sqlite3.Error as err:
        return needle in str(err), str(err)


TRADE_SQL = "INSERT INTO trades (tx_hash, log_index, block_number, market_id, taker, maker, taker_order_id, maker_order_id, taker_side, size, price, taker_fee, maker_fee) VALUES (?, ?, 1, 1, '0xaa', '0xbb', 1, 0, 'Buy', ?, '250000000000', '0', '0')"


@then(P('inserting a trade of size "{size}" fails a CHECK'))
def trade_size_check(qa, size):
    qa.observe("trade size CHECK", lambda: insert_fails(qa.tmp, TRADE_SQL, ("0xt2", 0, size), "CHECK constraint failed"))


@then(P("inserting an order on market {m:d} fails a FOREIGN KEY"))
def order_market_fk(qa, m):
    qa.observe("orders.market_id FOREIGN KEY", lambda: insert_fails(qa.tmp, "INSERT INTO orders (order_id, owner, market_id, side, order_type, tif, size, price, trigger_price, reduce_only, user_order_id, max_ts, status, placed_block, placed_tx, placed_log, updated_block) VALUES (2, '0xaa', ?, 'Buy', 'Limit', 'GTC', '100000000', '1', '0', 0, 0, '0', 'Open', 1, '0xt3', 0, 1)", (m,), "FOREIGN KEY constraint failed"))


@then(P('inserting a market with status "{status}" fails a CHECK'))
def market_status_check(qa, status):
    qa.observe("markets.status CHECK", lambda: insert_fails(qa.tmp, "INSERT INTO markets VALUES (9, 'X-PERP', ?, '1', '1', '1', 1, 0, 0, 0, 1)", (status,), "CHECK constraint failed"))


@then("inserting the same trade key twice fails on the second insert")
def trade_key_unique(qa):
    def ev():
        first = insert_fails(qa.tmp, TRADE_SQL, ("0xt9", 3, "100000000"), "\0never")
        if first[1] != "insert succeeded":
            return False, "first insert: " + first[1]
        return insert_fails(qa.tmp, TRADE_SQL, ("0xt9", 3, "100000000"), "UNIQUE constraint failed: trades.tx_hash, trades.log_index")
    qa.observe("trades key unique", ev)


# ---------------------------------------------------------------- indexer_state (166, 167, 184, 185)


@then("indexer_state.exchange equals the deployed exchange address")
def state_exchange(qa):
    def ev():
        st = qa.store.state()
        return st["exchange"].lower() == qa.dex.ex.lower(), f"store {st['exchange']}, deployment {qa.dex.ex}"
    check(qa, "indexer_state.exchange", ev)


@then(P("indexer_state.chain_id is {cid:d}"))
def state_chain_id(qa, cid):
    check(qa, "indexer_state.chain_id", lambda: (qa.store.state()["chain_id"] == cid, f"chain_id {qa.store.state()['chain_id']}"))


@then("indexer_state.genesis_hash equals the chain's block 0 hash")
def state_genesis(qa):
    def ev():
        st = qa.store.state()
        b0 = qa.dex.block(0)
        return st["genesis_hash"] == b0["hash"], f"store {st['genesis_hash']}, chain {b0['hash']}"
    check(qa, "indexer_state.genesis_hash", ev)


@then("indexer_state.last_block equals the chain head")
def state_last_block_head(qa):
    def ev():
        st = qa.store.state()
        head = qa.dex.block_number()
        return st["last_block"] == head, f"last_block {st['last_block']}, head {head}"
    check(qa, "last_block == head", ev)


@then("indexer_state.last_block_hash equals the hash of that block")
def state_last_block_hash(qa):
    def ev():
        st = qa.store.state()
        b = qa.dex.block(st["last_block"])
        return bool(b) and st["last_block_hash"] == b["hash"], f"store {st['last_block_hash']}, chain {b and b['hash']}"
    check(qa, "last_block_hash == hash(last_block)", ev)


@then("indexer_state.last_block is below the chain head")
def state_last_block_below(qa):
    def ev():
        st = qa.store.state()
        head = qa.dex.block_number()
        return st["last_block"] < head, f"last_block {st['last_block']}, head {head}"
    check(qa, "last_block < head", ev)


@then("the trades count is unchanged")
def trades_unchanged(qa):
    check(qa, "trades count unchanged", lambda: (qa.store.count("trades") == qa.noted["trades"], f"before {qa.noted['trades']}, now {qa.store.count('trades')}"))


@then(P("the trades count grew by {d:d}"))
def trades_grew(qa, d):
    check(qa, f"trades count grew by {d}", lambda: (qa.store.count("trades") == qa.noted["trades"] + d, f"before {qa.noted['trades']}, now {qa.store.count('trades')}"))


@then(P("the rebuild count grew by {d:d}"))
def rebuilds_grew(qa, d):
    check(qa, f"rebuilds grew by {d}", lambda: (qa.store.state()["rebuilds"] == qa.noted["rebuilds"] + d, f"before {qa.noted['rebuilds']}, now {qa.store.state()['rebuilds']}"))


@then("the store row counts are unchanged")
def counts_unchanged(qa):
    def ev():
        now = qa.store.counts()
        bad = [t for t in now if now[t] != qa.noted["counts"][t]]
        return not bad, "; ".join(f"{t}: {qa.noted['counts'][t]} -> {now[t]}" for t in bad) if bad else j(now)
    check(qa, "row counts unchanged after replay", ev)


# ---------------------------------------------------------------- markets and index (168, 169)

MARKET_PAIRS = [("symbol", "symbol"), ("status", "statusName"), ("tick_size", "tickSize"), ("step_size", "stepSize"), ("min_notional", "minNotional"), ("max_leverage", "maxLeverage"), ("maker_fee_bps", "makerFeeBps"), ("taker_fee_bps", "takerFeeBps"), ("max_basis_bps", "maxBasisBps")]


@then("the markets table has as many rows as marketCount")
def markets_count(qa):
    check(qa, "markets rows == marketCount", lambda: (qa.store.count("markets") == qa.dex.market_count(), f"rows {qa.store.count('markets')}, marketCount {qa.dex.market_count()}"))


@then("every markets row equals getMarket and getMarketParams")
def markets_rows(qa):
    def ev():
        bad = []
        for row in qa.store.all("SELECT * FROM markets ORDER BY market_id"):
            mk = qa.dex.get_market(row["market_id"])
            src = {**mk["params"], "symbol": mk["symbol"], "statusName": mk["statusName"]}
            d = diff_fields(MARKET_PAIRS, row, src)
            if d:
                bad.append(f"market {row['market_id']}: " + ", ".join(d))
        return not bad, "; ".join(bad) if bad else f"{len(MARKET_PAIRS)} fields equal on every row"
    check(qa, "markets rows == getters", ev)


@then(P("index_prices for {sym:w} equals getIndexPrice"))
def index_prices_row(qa, sym):
    def ev():
        row = qa.store.get("SELECT * FROM index_prices WHERE market_id = ?", market_id(sym))
        ip = qa.dex.get_index_price(market_id(sym))
        ok = bool(row) and eq(row["price"], ip["price"]) and eq(row["publish_time"], ip["publishTime"])
        return ok, f"store {row['price']}@{row['publish_time']}, chain {ip['price']}@{ip['publishTime']}" if row else "no row"
    check(qa, f"{sym} index_prices == getIndexPrice", ev)


# ---------------------------------------------------------------- trades (170-172)

TRADE_PAIRS = [("market_id", "marketId"), ("taker", "taker", lower), ("maker", "maker", lower), ("taker_order_id", "takerOrderId"), ("maker_order_id", "makerOrderId"), ("taker_side", "takerSide", lambda s: SIDE_NAME[int(s)]), ("size", "size"), ("price", "price"), ("taker_fee", "takerFee"), ("maker_fee", "makerFee")]


def filled_event(qa):
    return next((e for e in events(qa) if e["name"] == "OrderFilled"), None)


@then("the OrderFilled event of the last call has exactly one trades row")
def one_trade_row(qa):
    def ev():
        e = filled_event(qa)
        if not e:
            return False, "the last call emitted no OrderFilled"
        rows = qa.store.all("SELECT * FROM trades WHERE tx_hash = ? AND log_index = ?", e["txHash"], e["logIndex"])
        qa.noted["tradeRow"] = rows[0] if rows else None
        return len(rows) == 1, f"{len(rows)} rows for {e['txHash']}#{e['logIndex']}"
    check(qa, "one trades row per OrderFilled", ev)


@then("that trades row equals the event")
def trade_row_equals_event(qa):
    def ev():
        e = filled_event(qa)
        row = qa.noted.get("tradeRow")
        if not e or not row:
            return False, "no event or no row"
        bad = diff_fields(TRADE_PAIRS, row, e)
        return not bad and row["block_number"] == e["blockNumber"], ", ".join(bad) if bad else f"{len(TRADE_PAIRS)} fields equal"
    check(qa, "trades row == OrderFilled", ev)


@then(P("the trades row of the last call has maker the zero address and maker_order_id {mid:d}"))
def backstop_trade_row(qa, mid):
    def ev():
        rows = qa.store.all("SELECT * FROM trades WHERE tx_hash = ?", last_tx(qa))
        if len(rows) != 1:
            return False, f"{len(rows)} rows for {last_tx(qa)}"
        r = rows[0]
        return r["maker"] == ZERO and r["maker_order_id"] == mid, f"maker {r['maker']}, maker_order_id {r['maker_order_id']}"
    check(qa, "backstop trade row", ev)


@then("no trades row references a taker order missing from orders")
def no_orphan_taker(qa):
    def ev():
        n = qa.store.count("trades t", "WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_id = t.taker_order_id)")
        total = qa.store.count("trades")
        return n == 0 and total > 0, f"{n} orphans over {total} trades"
    check(qa, "no orphan taker_order_id", ev)


@then("no trades row references a maker order missing from orders")
def no_orphan_maker(qa):
    def ev():
        n = qa.store.count("trades t", "WHERE t.maker_order_id <> 0 AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_id = t.maker_order_id)")
        with_maker = qa.store.count("trades", "WHERE maker_order_id <> 0")
        return n == 0 and with_maker > 0, f"{n} orphans over {with_maker} book trades"
    check(qa, "no orphan maker_order_id", ev)


# ---------------------------------------------------------------- orders (173-175)

ORDER_PAIRS = [("owner", "owner", lower), ("market_id", "marketId"), ("side", "side", lambda s: SIDE_NAME[int(s)]), ("order_type", "orderType", lambda t: ORDER_TYPE_NAME[int(t)]), ("tif", "tif", lambda t: TIF_NAME[int(t)]), ("size", "size"), ("filled", "filled"), ("price", "price"), ("trigger_price", "triggerPrice"), ("reduce_only", "reduceOnly", lambda b: 1 if b else 0), ("user_order_id", "userOrderId"), ("max_ts", "maxTs"), ("status", "statusName")]


def order_row(qa, alias: str):
    return qa.store.get("SELECT * FROM orders WHERE order_id = ?", int(qa.orders[alias]))


@then(P('the orders row for "{alias}" equals getOrder'))
def order_row_equals(qa, alias):
    def ev():
        row = order_row(qa, alias)
        if not row:
            return False, f"no row for order {qa.orders[alias]}"
        o = qa.dex.get_order(qa.orders[alias])
        bad = diff_fields(ORDER_PAIRS, row, o)
        return not bad, ", ".join(bad) if bad else f"{len(ORDER_PAIRS)} fields equal"
    check(qa, f"orders row {alias} == getOrder", ev)


@then(P('the orders row for "{alias}" has filled equal to size and status {status:w}'))
def order_row_filled(qa, alias, status):
    def ev():
        row = order_row(qa, alias)
        return bool(row) and row["filled"] == row["size"] and row["status"] == status, f"filled {row['filled']}, size {row['size']}, status {row['status']}" if row else "no row"
    check(qa, f"orders row {alias} filled == size, {status}", ev)


@then(P('the orders row for "{alias}" has status {status:w}'))
def order_row_status(qa, alias, status):
    def ev():
        row = order_row(qa, alias)
        return bool(row) and row["status"] == status, f"status {row['status']}" if row else "no row"
    check(qa, f"orders row {alias} status {status}", ev)


# ---------------------------------------------------------------- positions (176-179)


@then(P("the positions row for {name:w} on {sym:w} equals getPosition"))
def position_row_equals(qa, name, sym):
    def ev():
        row = qa.store.get("SELECT * FROM positions WHERE account = ? AND market_id = ?", who(qa, name), market_id(sym))
        p = qa.dex.get_position(qa.who[name], market_id(sym))
        if not row:
            return p["size"] == 0, f"no row; chain size {p['size']}"
        return eq(row["size"], p["size"]) and eq(row["entry_price"], p["entryPrice"]), f"store size {row['size']} entry {row['entry_price']}; chain size {p['size']} entry {p['entryPrice']}"
    check(qa, f"{name} {sym} positions row == getPosition", ev)


@then(P("the positions row for {name:w} on {sym:w} has realized_pnl equal to getPosition"))
def position_row_pnl(qa, name, sym):
    def ev():
        row = qa.store.get("SELECT * FROM positions WHERE account = ? AND market_id = ?", who(qa, name), market_id(sym))
        p = qa.dex.get_position(qa.who[name], market_id(sym))
        return bool(row) and eq(row["realized_pnl"], p["realizedPnl"]), (f"store {row['realized_pnl']}" if row else "no row") + f", chain {p['realizedPnl']}"
    check(qa, f"{name} {sym} realized_pnl", ev)


@then("for every market the positions table is balanced and equals getMarket open interest")
def positions_balanced(qa):
    def ev():
        bad, seen = [], []
        for m in range(qa.dex.market_count()):
            long = short = 0
            for r in qa.store.all("SELECT size FROM positions WHERE market_id = ?", m):
                s = int(r["size"])
                if s > 0:
                    long += s
                else:
                    short -= s
            mk = qa.dex.get_market(m)
            seen.append(f"{m}: long {long} short {short} oi {mk['openInterestLong']}/{mk['openInterestShort']}")
            if not (long == short == mk["openInterestLong"] and short == mk["openInterestShort"]):
                bad.append(seen[-1])
        return not bad, ("unbalanced " + "; ".join(bad)) if bad else "; ".join(seen)
    check(qa, "positions balance == open interest, every market", ev)


@then(P("the position_events rows of the last call are two, for {name:w} and the backstop, with opposite signs"))
def two_position_events(qa, name):
    def ev():
        rows = qa.store.all("SELECT * FROM position_events WHERE tx_hash = ? ORDER BY log_index", last_tx(qa))
        accts = sorted(r["account"] for r in rows)
        want = sorted([who(qa, name), qa.who["backstop"].lower()])
        deltas = [int(r["size_after"]) - int(r["size_before"]) for r in rows]
        opposite = len(deltas) == 2 and deltas[0] == -deltas[1] and deltas[0] != 0
        return len(rows) == 2 and accts == want and opposite, f"{len(rows)} rows: " + ", ".join(f"{r['account']} {r['size_before']}->{r['size_after']}" for r in rows)
    check(qa, "two position_events per fill", ev)


# ---------------------------------------------------------------- funding, liquidation, accounts (180-182)


@then(P("the newest funding row for {sym:w} equals getFundingRate"))
def funding_row(qa, sym):
    def ev():
        row = qa.store.get("SELECT * FROM funding WHERE market_id = ? ORDER BY block_number DESC, log_index DESC LIMIT 1", market_id(sym))
        f = qa.dex.get_funding_rate(market_id(sym))
        if not row:
            return False, "no funding row"
        bad = diff_fields([("rate_bps", "lastRateBps"), ("cumulative_index", "cumulativeIndex"), ("funding_time", "lastFundingTime")], row, f)
        return not bad, ", ".join(bad) if bad else f"rate {row['rate_bps']} bps, index {row['cumulative_index']}, time {row['funding_time']}"
    check(qa, f"{sym} newest funding row == getFundingRate", ev)


LIQ_PAIRS = [("account", "account", lower), ("market_id", "marketId"), ("liquidator", "liquidator", lower), ("size_closed", "sizeClosed"), ("price", "price"), ("liquidator_fee", "liquidatorFee"), ("bad_debt", "badDebt"), ("insurance_used", "insuranceUsed")]


@then("the liquidations row of the last call equals the Liquidated event")
def liquidation_row(qa):
    def ev():
        e = next((x for x in events(qa) if x["name"] == "Liquidated"), None)
        if not e:
            return False, "the last call emitted no Liquidated"
        row = qa.store.get("SELECT * FROM liquidations WHERE tx_hash = ? AND log_index = ?", e["txHash"], e["logIndex"])
        if not row:
            return False, f"no row for {e['txHash']}#{e['logIndex']}"
        bad = diff_fields(LIQ_PAIRS, row, e)
        return not bad, ", ".join(bad) if bad else f"{len(LIQ_PAIRS)} fields equal"
    check(qa, "liquidations row == Liquidated", ev)


@then(P("the accounts row for {name:w} has deposits ${dep:dec} and withdrawals ${wd:dec}"))
def accounts_row_flows(qa, name, dep, wd):
    def ev():
        row = qa.store.get("SELECT * FROM accounts WHERE account = ?", who(qa, name))
        return bool(row) and eq(row["deposits"], U.usd(dep)) and eq(row["withdrawals"], U.usd(wd)), f"deposits {row['deposits']}, withdrawals {row['withdrawals']}" if row else "no row"
    check(qa, f"{name} accounts row flows", ev)


@then(P("the accounts table has no row for {name:w}"))
def no_accounts_row(qa, name):
    def ev():
        row = qa.store.get("SELECT * FROM accounts WHERE account = ?", who(qa, name))
        return not row, f"row exists, created_block {row['created_block']}" if row else "no row"
    check(qa, f"no accounts row for {name}", ev)


# ---------------------------------------------------------------- a second deployment (186)


@given("a second PerpDEX is deployed from the build artifact")
def second_perpdex(qa):
    if qa.source_error:
        return
    if not ARTIFACT.exists():
        qa.unobservable("a second PerpDEX can be deployed", f"no build artifact at {ARTIFACT} -- run forge build")
        qa.source_error = "no build artifact"
        return

    def go():
        art = json.loads(ARTIFACT.read_text(encoding="utf-8"))
        d = qa.dex.d
        qa.noted["second"] = qa.dex.deploy_contract(qa.who["admin"], art["bytecode"]["object"], "(address,address,address,address)", [d["vault"], d["oracle"], d["admin"], d["treasury"]])
        qa.evidence("secondExchange", qa.noted["second"])
    act(qa, go)


@when(P("{name:w} initialises an account on the second PerpDEX"))
def init_on_second(qa, name):
    def go():
        receipt = qa.dex.sender.send(qa.who[name], qa.noted["second"], "initializeAccount()", [])
        qa.last = {"ok": True, "receipt": receipt, "events": qa.dex.decode_logs(receipt)}
        qa.unchecked = None
    act(qa, go)


# ---------------------------------------------------------------- mark derivation (187-189)


@then(P("the mark derived from the store for {sym:w} equals getMarkPrice"))
def derived_mark(qa, sym):
    def ev():
        derived = qa.store.mark_of(market_id(sym))
        mark = qa.dex.get_mark_price(market_id(sym))
        return derived is not None and derived == mark, f"derived {derived}, chain {mark}"
    check(qa, f"{sym} derived mark == getMarkPrice", ev)

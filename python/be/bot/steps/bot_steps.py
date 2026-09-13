"""Steps for be-bot.feature -- a plugin module. Mirror of node/be/bot/steps/bot.steps.js.

Risk-gate scenarios build a RiskEngine directly with the deployed market specs
and never touch the chain (no @perpdex tag, so the contract tier's hooks skip
them). Chain scenarios are @perpdex; the bot drives account `alice` and reuses
the contract tier's Givens for counterparties.
"""

from __future__ import annotations

import json

import pytest
from pytest_bdd import given, then, when

from be.bot.client.bot import Bot
from be.bot.risk.engine import RiskEngine
from be.contract.chain import units as U
from be.contract.chain.ethcall import ChainUnreachable, rpc
from be.contract.chain.perpdex import Reverted
from be.contract.steps.perpdex_steps import P, market_id

# The three markets' parameters as the deploy script sets them -- fed to the pure
# risk engine so a unit scenario needs no chain yet stays true to the venue.
SPECS = {
    "BTC": {"tick": U.price("0.01"), "step": U.size("0.0001"), "minNotional": U.usd("10"), "maxLeverage": 50},
    "ETH": {"tick": U.price("0.01"), "step": U.size("0.001"), "minNotional": U.usd("10"), "maxLeverage": 50},
    "SOL": {"tick": U.price("0.001"), "step": U.size("0.01"), "minNotional": U.usd("10"), "maxLeverage": 20},
}
SIDE = {"buy": "Buy", "sell": "Sell"}
MID = {"BTC": 0, "ETH": 1, "SOL": 2}
CAPS = {"max_order_size": U.size("1000"), "max_position_size": U.size("1000")}


def j(v) -> str:
    return json.dumps(v, default=str)


@pytest.fixture(autouse=True)
def bot_scenario(request, qa, perpdex_scenario):
    """Per-scenario bot slots. Depends on perpdex_scenario so the chain slots exist first."""
    if request.node.get_closest_marker("bot") is None:
        yield
        return
    qa.risk = None
    qa.plan = None
    qa.bot = None
    qa.bot_last = None
    yield


# ---------------------------------------------------------------- risk-only bot (pure)


@given(P("a risk-only bot with max order size {max_order:dec} and max position {max_pos:dec}"))
def risk_only_bot(qa, max_order, max_pos):
    qa.risk = RiskEngine(specs=SPECS, max_order_size=U.size(max_order), max_position_size=U.size(max_pos))


@given("the kill switch is engaged")
def kill_switch(qa):
    qa.risk.set_kill_switch(True)


@given("dry run is engaged")
def dry_run(qa):
    qa.risk.dry_run = True


def _plan(qa, over, ctx=None):
    o = {"market": "ETH", "side": "Buy", "size": U.size("1"), "price": U.price("2500"), "orderType": "Limit"}
    o.update(over)
    qa.plan = qa.risk.plan(o, ctx or {})


@when(P("it plans a buy of {size:dec} {sym:w} at {price:dec}"))
def plan_buy(qa, size, sym, price):
    _plan(qa, {"market": sym, "size": U.size(size), "price": U.price(price)})


@when(P("it plans a buy of {size:dec} {sym:w} at {price:dec} with user order id {uid:d}"))
def plan_buy_uid(qa, size, sym, price, uid):
    _plan(qa, {"market": sym, "size": U.size(size), "price": U.price(price), "userOrderId": uid})


@when(P("it plans a buy of {size:dec} {sym:w} at {price:dec} against an existing position of {pos:dec} {u:w}"))
def plan_buy_pos(qa, size, sym, price, pos, u):
    _plan(qa, {"market": sym, "size": U.size(size), "price": U.price(price)}, {"positionSize": U.size(pos)})


@when(P("it plans a reduce-only sell of {size:dec} {sym:w} at {price:dec} against an existing position of {pos:dec} {u:w}"))
def plan_reduce(qa, size, sym, price, pos, u):
    _plan(qa, {"market": sym, "side": "Sell", "size": U.size(size), "price": U.price(price), "reduceOnly": True, "userOrderId": 999}, {"positionSize": U.size(pos)})


def _decision(qa):
    return qa.plan or (qa.bot_last or {}).get("decision")


@then("the order is cleared to send")
def cleared_send(qa):
    d = _decision(qa)
    qa.observe("order cleared to send", lambda: (bool(d) and d["ok"] and d["action"] == "send", j(d)))


@then("the order is cleared as a dry run")
def cleared_dry_run(qa):
    d = _decision(qa)
    qa.observe("order cleared as dry run", lambda: (bool(d) and d["ok"] and d["action"] == "dry-run", j(d)))


@then("the order is a duplicate")
def is_duplicate(qa):
    d = _decision(qa)
    qa.observe("order is a duplicate", lambda: (bool(d) and d["ok"] and d["action"] == "duplicate", j(d)))


@then(P('the order is refused with reason "{reason}"'))
def refused(qa, reason):
    d = _decision(qa)
    qa.observe("order refused: " + reason, lambda: (bool(d) and d["ok"] is False and d["reason"] == reason, j(d)))


@then(P("the planned size is {size:dec} {u:w}"))
def planned_size(qa, size, u):
    qa.observe("planned size", lambda: (bool(qa.plan.get("rounded")) and qa.plan["rounded"]["size"] == U.size(size), U.show_size(qa.plan["rounded"]["size"]) if qa.plan.get("rounded") else "no rounded"))


@then(P("the planned price is {price:dec}"))
def planned_price(qa, price):
    qa.observe("planned price", lambda: (bool(qa.plan.get("rounded")) and qa.plan["rounded"]["price"] == U.price(price), U.show_price(qa.plan["rounded"]["price"]) if qa.plan.get("rounded") else "no rounded"))


@then("a transient failure is retried up to the limit")
def transient_retried(qa):
    bot = Bot(dex=type("D", (), {"url": ""})(), account="0x0", risk=qa.risk)
    calls = {"n": 0}

    def boom():
        calls["n"] += 1
        raise ChainUnreachable("down")
    try:
        bot.with_retry("t", boom, max_tries=3)
    except ChainUnreachable:
        pass
    qa.check("a transient is retried up to the limit", calls["n"] == 3, f"called {calls['n']} times, expected 3")


@then("a revert is surfaced on the first attempt")
def revert_not_retried(qa):
    bot = Bot(dex=type("D", (), {"url": ""})(), account="0x0", risk=qa.risk)
    calls = {"n": 0}
    threw = False

    def boom():
        calls["n"] += 1
        raise Reverted({"name": "PostOnlyWouldCross", "args": []}, "x")
    try:
        bot.with_retry("t", boom, max_tries=3)
    except Reverted:
        threw = True
    qa.check("a revert is surfaced on the first attempt", threw and calls["n"] == 1, f"threw={threw}, called {calls['n']} times, expected 1")


@then("the bot's record contains no secret")
def no_secret(qa):
    bot = Bot(dex=type("D", (), {"url": ""})(), account="0x0", risk=qa.risk, log=["funded account with $100000", "plan Buy 1 ETH -> send", "placed order 3"])
    qa.observe("no secret in the bot record", lambda: (bot.leaked_secret() is None, bot.leaked_secret() or "clean"))


# ---------------------------------------------------------------- bot over the chain


def make_bot(qa, usd, **opts):
    if qa.source_error:
        return
    try:
        qa.bot = Bot.from_chain(qa.dex, qa.who["alice"], CAPS["max_order_size"], CAPS["max_position_size"], **opts)
        qa.bot.fund(usd)
    except ChainUnreachable as err:
        qa.source_error = str(err)


@given(P("a bot funded with ${usd:dec}"))
def bot_funded(qa, usd):
    make_bot(qa, usd)


@given(P("a dry-run bot funded with ${usd:dec}"))
def dry_run_bot_funded(qa, usd):
    make_bot(qa, usd, dry_run=True)


@given("the bot's kill switch is engaged")
def bot_kill_switch(qa):
    if qa.bot:
        qa.bot.risk.set_kill_switch(True)


def bot_place(qa, **spec):
    if qa.source_error or not qa.bot:
        qa.bot_last = {"skipped": True}
        return
    try:
        qa.bot_last = qa.bot.place(**spec)
        if qa.bot_last.get("sent") and qa.bot_last.get("orderId") is not None:
            qa.orders["bot"] = qa.bot_last["orderId"]
    except Reverted as err:
        qa.bot_last = {"sent": False, "revert": err}
    except ChainUnreachable as err:
        qa.source_error = str(err)
        qa.bot_last = {"skipped": True}


@given(P("the bot places a limit {side:w} of {size:dec} {sym:w} at {price:dec}"))
@when(P("the bot places a limit {side:w} of {size:dec} {sym:w} at {price:dec}"))
def bot_places_limit(qa, side, size, sym, price):
    bot_place(qa, sym=sym, side=SIDE[side], size=size, price=price, order_type="Limit", tif="GTC")


@when(P("the bot places a post-only {side:w} of {size:dec} {sym:w} at {price:dec}"))
def bot_places_postonly(qa, side, size, sym, price):
    bot_place(qa, sym=sym, side=SIDE[side], size=size, price=price, order_type="Limit", tif="PostOnly")


@when(P("the bot places an IOC {side:w} of {size:dec} {sym:w} at {price:dec}"))
def bot_places_ioc(qa, side, size, sym, price):
    bot_place(qa, sym=sym, side=SIDE[side], size=size, price=price, order_type="Limit", tif="IOC")


@when(P("the bot places a {side:w} of {size:dec} {sym:w} at {price:dec}"))
def bot_places_plain(qa, side, size, sym, price):
    bot_place(qa, sym=sym, side=SIDE[side], size=size, price=price, order_type="Limit", tif="GTC")


@when(P("the bot places a reduce-only {side:w} of {size:dec} {sym:w} at {price:dec}"))
def bot_places_reduce(qa, side, size, sym, price):
    bot_place(qa, sym=sym, side=SIDE[side], size=size, price=price, order_type="Limit", tif="GTC", reduce_only=True)


@given(P("the bot buys {size:dec} {sym:w} at market"))
@when(P("the bot buys {size:dec} {sym:w} at market"))
def bot_buys_market(qa, size, sym):
    bot_place(qa, sym=sym, side="Buy", size=size, order_type="Market", tif="IOC")


def _guard(qa, fn):
    if qa.source_error or not qa.bot:
        return
    try:
        return fn()
    except ChainUnreachable as err:
        qa.source_error = str(err)


@when("the bot cancels its order")
def bot_cancels(qa):
    _guard(qa, lambda: qa.bot.cancel(qa.orders["bot"]))


@when("the bot cancels all its orders")
def bot_cancels_all(qa):
    _guard(qa, lambda: qa.bot.cancel_all())


@when(P("the bot flattens {sym:w}"))
def bot_flattens(qa, sym):
    qa.noted["flat"] = _guard(qa, lambda: qa.bot.flatten(sym))


# ---------------------------------------------------------------- bot Thens (chain)


def chk(qa, description, fn):
    if qa.source_error:
        qa.unobservable(description, "the source could not be reached -- " + qa.source_error)
        return
    try:
        passed, detail = fn()
    except ChainUnreachable as err:
        qa.unobservable(description, str(err))
        return
    qa.check(description, passed, detail)


@then(P("the bot's order reverts with {name:w}"))
def bot_reverts(qa, name):
    def ev():
        bl = qa.bot_last
        if not bl or not bl.get("revert"):
            return False, ("the order was sent, no revert" if bl and bl.get("sent") else "no revert recorded (" + j(bl) + ")")
        return bl["revert"].error == name, str(bl["revert"])
    qa.observe("bot order reverts with " + name, ev)


@then("the bot tried the place once")
def tried_once(qa):
    a = [x for x in (qa.bot.attempts or []) if x["op"] == "place"]
    qa.observe("place attempted once", lambda: (len(a) == 1 and a[0]["tries"] == 1, j(a)))


@then("the bot's account exists")
def bot_account_exists(qa):
    chk(qa, "bot account exists", lambda: (qa.dex.account_exists(qa.who["alice"]), "accountExists false"))


@then(P("the bot's vault balance is ${usd:dec}"))
def bot_vault_balance(qa, usd):
    chk(qa, "bot vault balance", lambda: ((lambda b: (b == U.usd(usd), "$" + U.show_usd(b)))(qa.dex.vault_balance(qa.who["alice"]))))


@then("the bot's order is Open")
def bot_order_open(qa):
    o = (qa.bot_last or {}).get("order")
    qa.observe("bot order Open", lambda: (bool(o) and o["statusName"] == "Open", o["statusName"] if o else j(qa.bot_last)))


@then("the bot's order is Cancelled")
def bot_order_cancelled(qa):
    chk(qa, "bot order Cancelled", lambda: ((lambda o: (o["statusName"] == "Cancelled", o["statusName"]))(qa.dex.get_order(qa.orders["bot"]))))


@then(P("the bot's order size is {size:dec} {u:w}"))
def bot_order_size(qa, size, u):
    o = (qa.bot_last or {}).get("order")
    qa.observe("bot order size", lambda: (bool(o) and o["size"] == U.size(size), U.show_size(o["size"]) if o else "no order"))


@then(P("the bot's order price is {price:dec}"))
def bot_order_price(qa, price):
    o = (qa.bot_last or {}).get("order")
    qa.observe("bot order price", lambda: (bool(o) and o["price"] == U.price(price), U.show_price(o["price"]) if o else "no order"))


@then(P("the bot has {n:d} open orders"))
def bot_open_orders(qa, n):
    chk(qa, f"bot open orders {n}", lambda: ((lambda a: (int(a["openOrders"]) == n, "openOrders " + str(a["openOrders"])))(qa.dex.get_account(qa.who["alice"]))))


@then(P("the bot is flat on {sym:w}"))
def bot_flat(qa, sym):
    chk(qa, "bot flat on " + sym, lambda: (bool(qa.noted.get("flat") and qa.noted["flat"]["flat"]), j(qa.noted.get("flat"))))


@then(P("the bot's {sym:w} position size is {size:dec} {u:w}"))
def bot_position_size(qa, sym, size, u):
    chk(qa, f"bot {sym} size", lambda: ((lambda p: (p["size"] == U.size(size), U.show_size(p["size"])))(qa.dex.get_position(qa.who["alice"], MID[sym]))))


@then(P("the bot's {sym:w} entry price is above 0"))
def bot_entry_above_zero(qa, sym):
    chk(qa, f"bot {sym} entry > 0", lambda: ((lambda p: (p["entryPrice"] > 0, U.show_price(p["entryPrice"])))(qa.dex.get_position(qa.who["alice"], MID[sym]))))


@then("the bot's free collateral fell")
def bot_free_fell(qa):
    def ev():
        f = qa.dex.free_collateral(qa.who["alice"])
        bal = qa.dex.vault_balance(qa.who["alice"])
        return f < bal, f"free ${U.show_usd(f)} < balance ${U.show_usd(bal)}"
    chk(qa, "bot free collateral fell", ev)


@then("the treasury's vault balance increased")
def treasury_increased(qa):
    chk(qa, "treasury balance increased", lambda: ((lambda b: (b > qa.noted["bal.treasury"], f"before {qa.noted['bal.treasury']}, after {b}"))(qa.dex.vault_balance(qa.who["treasury"]))))


@then("the bot's fill was mined")
def fill_mined(qa):
    def ev():
        result = (qa.bot_last or {}).get("receipt") or {}
        r = result.get("receipt") or {}
        return bool(r) and r.get("status") == "0x1" and bool(r.get("blockNumber")), ("status " + str(r.get("status")) + " block " + str(int(r["blockNumber"], 16)) if r else "no receipt")
    qa.observe("fill mined", ev)


@then(P("the account nonce advanced by {n:d}"))
def nonce_advanced(qa, n):
    def ev():
        now = int(rpc("eth_getTransactionCount", [qa.who["alice"], "latest"], qa.dex.url), 16)
        first = qa.bot.nonces[0]
        consecutive = all(v == qa.bot.nonces[i - 1] + 1 for i, v in enumerate(qa.bot.nonces) if i > 0)
        return consecutive and now - first == n, f"nonces {qa.bot.nonces}, now {now}"
    chk(qa, f"nonce advanced by {n}", ev)


@then(P("the bot's {sym:w} order clears the minimum notional"))
def clears_min_notional(qa, sym):
    def ev():
        o = qa.bot_last["order"]
        p = qa.dex.get_market_params(MID[sym])
        notional = U.notional(o["size"], o["price"])
        return notional >= p["minNotional"], f"notional ${U.show_usd(notional)} >= min ${U.show_usd(p['minNotional'])}"
    chk(qa, sym + " order clears min notional", ev)

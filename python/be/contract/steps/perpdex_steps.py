"""PerpDEX steps over JSON-RPC, in pytest-bdd -- a plugin module.

Mirror of node/be/contract/steps/perpdex.steps.js. Loaded by the domain
conftest as a plugin so the DB and API features can use the same Givens
(pytest-bdd binds a step to the module that defines it). test_perpdex.py
binds the contract feature; the DB and API modules bind theirs.

Every @perpdex scenario snapshots the chain first and reverts after; every
write is recorded on the recorder as success or decoded revert and read back
by "the call ..." steps. A transport failure grades Blocked.

Parse types: ``{x:dec}`` is a decimal literal ("2502.5", "-0.1"); ``{x:w}``
is a single word. Both keep patterns from swallowing neighbouring words.
"""

from __future__ import annotations

import pytest
from pytest_bdd import given, parsers, then, when

from be.contract.chain import units as U
from be.contract.chain.perpdex import MARKET_STATUS, ChainUnreachable, PerpDex, Reverted

MARKET = {"BTC": 0, "ETH": 1, "SOL": 2}
NAMES = ["admin", "alice", "bob", "carol", "dave", "victim", "keeper", "erin", "frank", "grace"]

# ---------------------------------------------------------------- parse types


def _dec(text: str) -> str:
    return text


_dec.pattern = r"-?\d+(?:\.\d+)?"
TYPES = {"dec": _dec}


def P(pattern: str):
    return parsers.parse(pattern, extra_types=TYPES)


# ---------------------------------------------------------------- chain fixture (module-wide)

_state = {"dex": None, "accounts": None, "pristine": None, "error": None, "tried": False}


def _connect():
    if _state["tried"]:
        return
    _state["tried"] = True
    try:
        dex = PerpDex()
        _state["accounts"] = dex.accounts()
        _state["pristine"] = dex.next_order_id() == 1
        _state["dex"] = dex
    except ChainUnreachable as err:
        _state["error"] = str(err)
    except Exception as err:  # noqa: BLE001 - a connection failure of any shape is "not reachable"
        _state["error"] = f"{type(err).__name__}: {err}"


@pytest.fixture(autouse=True)
def perpdex_scenario(request, qa):
    """Snapshot before, revert after, and the per-scenario slots -- for @perpdex scenarios only."""
    if request.node.get_closest_marker("perpdex") is None:
        yield
        return
    _connect()
    qa.dex = _state["dex"]
    qa.who = {}
    qa.orders = {}
    qa.noted = {}
    qa.last = None
    qa.unchecked = None
    qa.walk = None
    snap = None
    if qa.dex is None:
        qa.source_error = "PerpDEX is not reachable -- " + str(_state["error"])
    else:
        for i, n in enumerate(NAMES):
            qa.who[n] = _state["accounts"][i]
        qa.who["deployer"] = _state["accounts"][0]
        qa.who["treasury"] = qa.dex.d["treasury"]
        qa.who["backstop"] = qa.dex.d["backstop"]
        qa.who["insurance"] = qa.dex.d["insuranceFund"]
        qa.evidence("chainPristineAtStart", _state["pristine"])
        if _state["pristine"] is False:
            qa.unobservable("scenario starts from a freshly deployed venue", "the chain already had orders before the run began; redeploy anvil for a clean baseline")
        try:
            snap = qa.dex.snapshot()
        except ChainUnreachable as err:
            qa.source_error = "could not snapshot the chain -- " + str(err)
    yield
    # a revert no "Then the call ..." step looked at is a precondition that silently failed
    if qa.unchecked is not None:
        qa.check("no unchecked revert during setup", False, "a call reverted and no step asserted it: " + str(qa.unchecked))
    if qa.dex is not None and snap is not None:
        try:
            qa.dex.revert(snap)
        except Exception:  # noqa: BLE001
            pass


# ---------------------------------------------------------------- helpers


def addr(qa, name: str) -> str:
    key = name.removesuffix("'s").removesuffix("'").removeprefix("the ").removesuffix(" fund")
    if key not in qa.who:
        raise KeyError(f'unknown actor "{name}"')
    return qa.who[key]


def actor(qa, name: str) -> str:
    return qa.who["admin"] if name in ("the admin", "admin") else addr(qa, name)


def market_id(sym: str) -> int:
    if sym not in MARKET:
        raise KeyError("unknown market " + sym)
    return MARKET[sym]


def attempt(qa, fn):
    if qa.source_error:
        qa.last = {"skipped": True}
        return
    try:
        r = fn()
        receipt = r["receipt"] if isinstance(r, dict) and "receipt" in r else r
        events = r["events"] if isinstance(r, dict) and "events" in r else (qa.dex.decode_logs(receipt) if isinstance(receipt, dict) and "logs" in receipt else [])
        qa.last = {"ok": True, "receipt": receipt, "events": events, "result": r}
        qa.unchecked = None
    except Reverted as err:
        qa.last = {"ok": False, "revert": err}
        qa.unchecked = err
    except ChainUnreachable as err:
        qa.source_error = str(err)
        qa.last = {"skipped": True}


def read(qa, fn):
    if qa.source_error:
        return None
    try:
        return fn()
    except ChainUnreachable as err:
        qa.source_error = str(err)
        return None


def check(qa, description: str, fn):
    if qa.source_error:
        qa.unobservable(description, "the source could not be reached -- " + qa.source_error)
        return
    try:
        passed, detail = fn()
    except ChainUnreachable as err:
        qa.unobservable(description, str(err))
        return
    qa.check(description, passed, detail)


def place_as(qa, name: str, params: dict, alias: str | None):
    attempt(qa, lambda: qa.dex.place_order(addr(qa, name), params))
    if alias and qa.last and qa.last.get("ok"):
        qa.orders[alias] = qa.last["result"]["orderId"]
        qa.evidence("order." + alias, str(qa.orders[alias]))


def fund(qa, name: str, usd_units: int):
    read(qa, lambda: qa.dex.fund_trader(addr(qa, name), usd_units))


SIDE_OF = {"buy": "Buy", "sell": "Sell", "buys": "Buy", "sells": "Sell"}
PARAMS_T = "(uint64,uint64,uint64,uint16,uint16,uint16,int16,uint16,uint16,uint16,uint16,uint16,uint16,uint64,uint16,uint64)"
PARAMS_FIELDS = ["tickSize", "stepSize", "minNotional", "maxLeverage", "initialMarginBps", "maintenanceMarginBps", "makerFeeBps", "takerFeeBps", "priceBandBps", "maxBasisBps", "liquidationFeeBps", "partialLiquidationBps", "fundingRateCapBps", "fundingIntervalSec", "backstopSpreadBps", "backstopMaxSize"]


def params_except(qa, sym: str, field: str | None, value):
    p = dict(qa.dex.get_market_params(market_id(sym)))
    if field:
        p[field] = int(value)
    return [p[f] for f in PARAMS_FIELDS]


def events(qa) -> list[dict]:
    return (qa.last or {}).get("events", []) or []


def reason_text(e: dict) -> str:
    return bytes.fromhex(e["reason"][2:]).decode("utf-8").rstrip("\x00")


def clip_for(p: dict, price: int) -> int:
    clip = p["stepSize"] * 10
    while U.notional(clip, price) < p["minNotional"] * 12 // 10:
        clip += p["stepSize"] * 10
    return clip


# ================================================================ Given: actors and funding


@given(P("a funded trader {name:w} with ${amount:dec}"))
def funded_trader(qa, name, amount):
    fund(qa, name, U.usd(amount))


@given(P("a funded trader {name:w} with one unit less than the initial margin for {size:dec} {sym:w}"))
def funded_just_under_im(qa, name, size, sym):
    m = market_id(sym)
    price = qa.dex.get_index_price(m)["price"]
    p = qa.dex.get_market_params(m)
    required = U.notional(U.size(size), price) * p["initialMarginBps"] // 10_000
    qa.noted["required"] = required
    fund(qa, name, required - 1)


@given(P("a funded trader {name:w} with {pct:d} percent of the notional of {size:dec} {sym:w}"))
def funded_pct_of_notional(qa, name, pct, size, sym):
    m = market_id(sym)
    price = qa.dex.get_index_price(m)["price"]
    n = U.notional(U.size(size), price) * pct // 100
    qa.noted["collateral"] = n
    fund(qa, name, n)


@given(P("an unfunded address {name:w}"))
def unfunded(qa, name):
    addr(qa, name)


@given(P("an unfunded address {name:w} holding ${amount:dec} of USDC"))
def unfunded_holding(qa, name, amount):
    a = addr(qa, name)

    def go():
        qa.dex.mint(a, a, U.usd(amount))
        qa.dex.approve_vault(a, U.usd(amount))
    read(qa, go)


@given(P("{name:w} has initialised an account"))
def has_initialised(qa, name):
    read(qa, lambda: qa.dex.initialize_account(addr(qa, name)))


def _drain(qa, which: str):
    def go():
        bal = qa.dex.vault_balance(qa.dex.d[which])
        if bal > 0:
            qa.dex.sender.send(qa.who["admin"], qa.dex.d[which], "drain(address,uint256)", [qa.who["admin"], bal])
    read(qa, go)


@given("the insurance fund is drained")
def drain_insurance(qa):
    _drain(qa, "insuranceFund")


@given("the backstop is drained")
def drain_backstop(qa):
    _drain(qa, "backstop")


@given(P("the clock advances {s:d} seconds"))
def clock_advances(qa, s):
    def go():
        qa.dex.warp(s)
        for m in (0, 1, 2):
            qa.dex.set_mock_price(qa.who["admin"], m, qa.dex.oracle_peek(m)["price"])
    read(qa, go)


@given(P("{name:w}'s equity is noted"))
def note_equity(qa, name):
    qa.noted["equity." + name] = read(qa, lambda: qa.dex.equity(addr(qa, name)))


@given(P("{name:w}'s vault balance is noted"))
def note_balance(qa, name):
    qa.noted["bal." + name] = read(qa, lambda: qa.dex.vault_balance(addr(qa, name)))


@given(P("{a:w}'s and {b:w}'s vault balances are noted"))
def note_two_balances(qa, a, b):
    qa.noted["bal." + a] = read(qa, lambda: qa.dex.vault_balance(addr(qa, a)))
    qa.noted["bal." + b] = read(qa, lambda: qa.dex.vault_balance(addr(qa, b)))


@given("the treasury's and insurance fund's vault balances are noted")
def note_treasury_insurance(qa):
    qa.noted["bal.treasury"] = read(qa, lambda: qa.dex.vault_balance(qa.who["treasury"]))
    qa.noted["bal.insurance"] = read(qa, lambda: qa.dex.vault_balance(qa.who["insurance"]))


@given("the insurance fund's vault balance is noted")
def note_insurance(qa):
    qa.noted["bal.insurance"] = read(qa, lambda: qa.dex.vault_balance(qa.who["insurance"]))


# ================================================================ trading (Given == When here)


def market_order(qa, name, verb, size, sym, alias=None):
    place_as(qa, name, {"marketId": market_id(sym), "side": SIDE_OF[verb], "orderType": "Market", "tif": "IOC", "size": U.size(size)}, alias)


def limit_order(qa, name, side, size, sym, price, alias, **extra):
    place_as(qa, name, {"marketId": market_id(sym), "side": SIDE_OF[side], "orderType": "Limit", "tif": "GTC", "size": U.size(size), "price": U.price(price), **extra}, alias)


@given(P("{name:w} buys {size:dec} {sym:w} at market"))
@when(P("{name:w} buys {size:dec} {sym:w} at market"))
def buys_market(qa, name, size, sym):
    market_order(qa, name, "buy", size, sym)


@given(P("{name:w} sells {size:dec} {sym:w} at market"))
@when(P("{name:w} sells {size:dec} {sym:w} at market"))
def sells_market(qa, name, size, sym):
    market_order(qa, name, "sell", size, sym)


@given(P('{name:w} places a market {side:w} of {size:dec} {sym:w} as "{alias}"'))
@when(P('{name:w} places a market {side:w} of {size:dec} {sym:w} as "{alias}"'))
def places_market(qa, name, side, size, sym, alias):
    market_order(qa, name, side, size, sym, alias)


@given(P('{name:w} places a limit {side:w} of {size:dec} {sym:w} at {price:dec} as "{alias}"'))
@when(P('{name:w} places a limit {side:w} of {size:dec} {sym:w} at {price:dec} as "{alias}"'))
def places_limit(qa, name, side, size, sym, price, alias):
    limit_order(qa, name, side, size, sym, price, alias)


@when(P('{name:w} places a limit {side:w} of {size:dec} {sym:w} at {price:dec} with user order id {uid:d} as "{alias}"'))
def places_limit_uid(qa, name, side, size, sym, price, uid, alias):
    limit_order(qa, name, side, size, sym, price, alias, userOrderId=uid)


@when(P('{name:w} places an IOC limit {side:w} of {size:dec} {sym:w} at {price:dec} as "{alias}"'))
def places_ioc(qa, name, side, size, sym, price, alias):
    limit_order(qa, name, side, size, sym, price, alias, tif="IOC")


@when(P('{name:w} places a FOK limit {side:w} of {size:dec} {sym:w} at {price:dec} as "{alias}"'))
def places_fok(qa, name, side, size, sym, price, alias):
    limit_order(qa, name, side, size, sym, price, alias, tif="FOK")


@when(P('{name:w} places a post-only limit {side:w} of {size:dec} {sym:w} at {price:dec} as "{alias}"'))
def places_post_only(qa, name, side, size, sym, price, alias):
    limit_order(qa, name, side, size, sym, price, alias, tif="PostOnly")


@when(P('{name:w} places a limit {side:w} of {size:dec} {sym:w} at {price:dec} expiring {us:d} microsecond before the chain clock as "{alias}"'))
def places_expiring_before(qa, name, side, size, sym, price, us, alias):
    clock = qa.dex.clock_micros()
    limit_order(qa, name, side, size, sym, price, alias, maxTs=clock - us)


@when(P('{name:w} places a limit {side:w} of {size:dec} {sym:w} at {price:dec} expiring {secs:d} seconds after the chain clock as "{alias}"'))
def places_expiring_after(qa, name, side, size, sym, price, secs, alias):
    clock = qa.dex.clock_micros()
    limit_order(qa, name, side, size, sym, price, alias, maxTs=clock + secs * 1_000_000)


@when(P('{name:w} places a limit {side:w} of one unit more than {step:dec} {sym:w} at {price:dec} as "{alias}"'))
def places_off_step(qa, name, side, step, sym, price, alias):
    place_as(qa, name, {"marketId": market_id(sym), "side": SIDE_OF[side], "orderType": "Limit", "size": U.size(step) + 1, "price": U.price(price)}, alias)


@when(P('{name:w} places a limit {side:w} of {size:dec} {sym:w} at one unit more than {price:dec} as "{alias}"'))
def places_off_tick(qa, name, side, size, sym, price, alias):
    place_as(qa, name, {"marketId": market_id(sym), "side": SIDE_OF[side], "orderType": "Limit", "size": U.size(size), "price": U.price(price) + 1}, alias)


def _lower_band(qa, sym):
    m = market_id(sym)
    price = qa.dex.get_index_price(m)["price"]
    p = qa.dex.get_market_params(m)
    lower = price * (10_000 - p["priceBandBps"]) // 10_000
    return m, p, lower


@when(P('{name:w} places a limit {side:w} of {size:dec} {sym:w} at one tick below the lower band as "{alias}"'))
def places_below_band(qa, name, side, size, sym, alias):
    m, p, lower = _lower_band(qa, sym)
    on_tick = lower - (lower % p["tickSize"]) - p["tickSize"]
    place_as(qa, name, {"marketId": m, "side": SIDE_OF[side], "orderType": "Limit", "size": U.size(size), "price": on_tick}, alias)


@when(P('{name:w} places a limit {side:w} of {size:dec} {sym:w} at exactly the lower band as "{alias}"'))
def places_at_band(qa, name, side, size, sym, alias):
    m, p, lower = _lower_band(qa, sym)
    on_tick = lower if lower % p["tickSize"] == 0 else lower + (p["tickSize"] - lower % p["tickSize"])
    place_as(qa, name, {"marketId": m, "side": SIDE_OF[side], "orderType": "Limit", "size": U.size(size), "price": on_tick}, alias)


def trigger_order(qa, name, side, otype, size, sym, trigger, limit_price, source, alias, reduce_only):
    place_as(qa, name, {
        "marketId": market_id(sym), "side": SIDE_OF[side], "orderType": otype, "tif": "GTC" if otype == "StopLimit" else "IOC",
        "size": U.size(size), "price": U.price(limit_price) if limit_price else 0,
        "triggerPrice": U.price(trigger), "triggerSource": "Mark" if source == "mark" else "Index", "reduceOnly": reduce_only,
    }, alias)


@given(P('{name:w} places a stop-market {side:w} of {size:dec} {sym:w} triggered at {trigger:dec} on the {source:w} as "{alias}"'))
@when(P('{name:w} places a stop-market {side:w} of {size:dec} {sym:w} triggered at {trigger:dec} on the {source:w} as "{alias}"'))
def places_stop_market(qa, name, side, size, sym, trigger, source, alias):
    trigger_order(qa, name, side, "StopMarket", size, sym, trigger, None, source, alias, False)


@given(P('{name:w} places a stop-limit {side:w} of {size:dec} {sym:w} triggered at {trigger:dec} with limit {lp:dec} on the {source:w} as "{alias}"'))
def places_stop_limit(qa, name, side, size, sym, trigger, lp, source, alias):
    trigger_order(qa, name, side, "StopLimit", size, sym, trigger, lp, source, alias, False)


@given(P('{name:w} places a reduce-only take-profit {side:w} of {size:dec} {sym:w} triggered at {trigger:dec} on the {source:w} as "{alias}"'))
def places_take_profit(qa, name, side, size, sym, trigger, source, alias):
    trigger_order(qa, name, side, "TakeProfit", size, sym, trigger, None, source, alias, True)


@when(P('a keeper triggers order "{alias}"'))
def keeper_triggers(qa, alias):
    attempt(qa, lambda: qa.dex.trigger_order(qa.who["keeper"], qa.orders[alias]))


@given(P('{name:w} cancels order "{alias}"'))
@when(P('{name:w} cancels order "{alias}"'))
def cancels(qa, name, alias):
    attempt(qa, lambda: qa.dex.cancel_order(addr(qa, name), qa.orders[alias]))


@when(P("{name:w} cancels all orders on {sym:w}"))
def cancels_all_market(qa, name, sym):
    attempt(qa, lambda: qa.dex.cancel_all(addr(qa, name), market_id(sym)))


@when(P("{name:w} cancels all orders on every market"))
def cancels_all(qa, name):
    attempt(qa, lambda: qa.dex.cancel_all(addr(qa, name), 0xFFFF))


@when(P("{name:w} initialises an account"))
def initialises(qa, name):
    attempt(qa, lambda: qa.dex.initialize_account(addr(qa, name)))


@when(P("{name:w} deposits ${amount:dec}"))
def deposits(qa, name, amount):
    attempt(qa, lambda: qa.dex.deposit(addr(qa, name), U.usd(amount)))


@when(P("{name:w} withdraws ${amount:dec}"))
def withdraws(qa, name, amount):
    attempt(qa, lambda: qa.dex.withdraw(addr(qa, name), U.usd(amount)))


@when(P("{name:w} withdraws one unit more than her free collateral"))
def withdraws_over(qa, name):
    free = qa.dex.free_collateral(addr(qa, name))
    attempt(qa, lambda: qa.dex.withdraw(addr(qa, name), free + 1))


@when(P("{name:w} withdraws exactly her free collateral"))
def withdraws_exact(qa, name):
    free = qa.dex.free_collateral(addr(qa, name))
    attempt(qa, lambda: qa.dex.withdraw(addr(qa, name), free))


@when(P("{name:w} calls the vault's transferBetween directly"))
def vault_transfer_direct(qa, name):
    attempt(qa, lambda: qa.dex.sender.send(addr(qa, name), qa.dex.d["vault"], "transferBetween(address,address,int128,bytes32)", [qa.who["alice"], qa.who["bob"], 1, "0x" + "00" * 32]))


@when(P("{name:w} calls the vault's withdrawFor directly"))
def vault_withdraw_direct(qa, name):
    attempt(qa, lambda: qa.dex.sender.send(addr(qa, name), qa.dex.d["vault"], "withdrawFor(address,address,uint256)", [qa.who["alice"], qa.who["alice"], 1]))


@given(P("a keeper updates funding for {sym:w}"))
@when(P("a keeper updates funding for {sym:w}"))
def keeper_updates_funding(qa, sym):
    qa.noted["funding.before"] = read(qa, lambda: qa.dex.get_funding_rate(market_id(sym)))
    attempt(qa, lambda: qa.dex.update_funding(qa.who["keeper"], market_id(sym)))


@given(P("a keeper liquidates {victim:w} on {sym:w}"))
@when(P("a keeper liquidates {victim:w} on {sym:w}"))
def keeper_liquidates(qa, victim, sym):
    attempt(qa, lambda: qa.dex.liquidate(qa.who["keeper"], addr(qa, victim), market_id(sym)))


@when(P("a keeper settles {who}'s {sym:w} position"))
def keeper_settles(qa, who, sym):
    attempt(qa, lambda: qa.dex.settle_position(qa.who["keeper"], addr(qa, who), market_id(sym)))


# admin & oracle


@when(P("{name:w} pauses the exchange"))
def actor_pauses(qa, name):
    attempt(qa, lambda: qa.dex.set_paused(actor(qa, name), True))


@given("the admin pauses the exchange")
@when("the admin pauses the exchange")
def admin_pauses(qa):
    attempt(qa, lambda: qa.dex.set_paused(qa.who["admin"], True))


@when("the admin unpauses the exchange")
def admin_unpauses(qa):
    attempt(qa, lambda: qa.dex.set_paused(qa.who["admin"], False))


@when("the deployer pauses the exchange")
def deployer_pauses(qa):
    attempt(qa, lambda: qa.dex.set_paused(qa.who["deployer"], True))


@given(P("the admin sets market {sym:w} to {status:w}"))
@when(P("the admin sets market {sym:w} to {status:w}"))
def admin_sets_status(qa, sym, status):
    attempt(qa, lambda: qa.dex.set_market_status(qa.who["admin"], market_id(sym), status, 0))


@given(P("the admin sets market {sym:w} to Settling at {price:dec}"))
@when(P("the admin sets market {sym:w} to Settling at {price:dec}"))
def admin_sets_settling(qa, sym, price):
    attempt(qa, lambda: qa.dex.set_market_status(qa.who["admin"], market_id(sym), "Settling", U.price(price)))


@when(P("{name:w} sets market {sym:w} to {status:w}"))
def actor_sets_status(qa, name, sym, status):
    attempt(qa, lambda: qa.dex.set_market_status(addr(qa, name), market_id(sym), status, 0))


@given(P("the admin sets {sym:w} fees to maker {maker:d} and taker {taker:d} bps"))
@when(P("the admin sets {sym:w} fees to maker {maker:d} and taker {taker:d} bps"))
def admin_sets_fees(qa, sym, maker, taker):
    attempt(qa, lambda: qa.dex.set_fees(qa.who["admin"], market_id(sym), maker, taker))


@when(P("{name:w} sets {sym:w} fees to maker {maker:d} and taker {taker:d} bps"))
def actor_sets_fees(qa, name, sym, maker, taker):
    attempt(qa, lambda: qa.dex.set_fees(addr(qa, name), market_id(sym), maker, taker))


@when(P("the admin transfers admin to {to:w}"))
def admin_transfers(qa, to):
    attempt(qa, lambda: qa.dex.transfer_admin(qa.who["admin"], addr(qa, to)))


@when(P("{name:w} transfers admin to {to:w}"))
def actor_transfers(qa, name, to):
    attempt(qa, lambda: qa.dex.transfer_admin(addr(qa, name), addr(qa, to)))


@when(P("{name:w} accepts admin"))
def accepts_admin(qa, name):
    attempt(qa, lambda: qa.dex.accept_admin(addr(qa, name)))


def _add_market(qa, who, symbol, sym, field, value):
    p = params_except(qa, sym, field, value)
    attempt(qa, lambda: qa.dex.sender.send(who, qa.dex.ex, f"addMarket(string,{PARAMS_T})", [symbol, p], "addMarket"))
    if qa.last and qa.last.get("ok"):
        qa.noted["newMarketId"] = qa.dex.market_count() - 1


@when(P('the admin adds market "{symbol}" with the {sym:w} parameters'))
def admin_adds_market(qa, symbol, sym):
    _add_market(qa, qa.who["admin"], symbol, sym, None, None)


@when(P('{name:w} adds market "{symbol}" with the {sym:w} parameters'))
def actor_adds_market(qa, name, symbol, sym):
    _add_market(qa, addr(qa, name), symbol, sym, None, None)


@when(P('the admin adds market "{symbol}" with the {sym:w} parameters except {field:w} = {value:d}'))
def admin_adds_market_except(qa, symbol, sym, field, value):
    _add_market(qa, qa.who["admin"], symbol, sym, field, value)


@when(P("the admin adds markets until the count reaches {n:d}"))
def admin_adds_until(qa, n):
    def go():
        p = params_except(qa, "ETH", None, None)
        while qa.dex.market_count() < n:
            qa.dex.sender.send(qa.who["admin"], qa.dex.ex, f"addMarket(string,{PARAMS_T})", ["M", p], "addMarket")
    read(qa, go)


@when(P("the admin sets the {sym:w} parameters to the {src:w} parameters except {field:w} = {value:d}"))
def admin_sets_params(qa, sym, src, field, value):
    p = params_except(qa, src, field, value)
    attempt(qa, lambda: qa.dex.sender.send(qa.who["admin"], qa.dex.ex, f"setMarketParams(uint16,{PARAMS_T})", [market_id(sym), p], "setMarketParams"))


@given(P("the {sym:w} index is set to {price:dec}"))
@when(P("the {sym:w} index is set to {price:dec}"))
def index_set(qa, sym, price):
    attempt(qa, lambda: qa.dex.set_mock_price(qa.who["admin"], market_id(sym), U.price(price)))


@when(P("{name:w} sets the {sym:w} mock index to {price:dec}"))
def actor_sets_index(qa, name, sym, price):
    attempt(qa, lambda: qa.dex.set_mock_price(addr(qa, name), market_id(sym), U.price(price)))


@when(P("{name:w} locks the {sym:w} mock"))
def actor_locks(qa, name, sym):
    attempt(qa, lambda: qa.dex.lock_mock(actor(qa, name), market_id(sym)))


@when(P("the admin locks the {sym:w} mock"))
def admin_locks(qa, sym):
    attempt(qa, lambda: qa.dex.lock_mock(qa.who["admin"], market_id(sym)))


@when(P("the admin sets the {sym:w} index through the admin feed to {price:dec}"))
def admin_feed(qa, sym, price):
    attempt(qa, lambda: qa.dex.sender.send(qa.who["admin"], qa.dex.d["oracle"], "setPrice(uint16,uint64)", [market_id(sym), U.price(price)]))


@when(P("{name:w} publishes an {sym:w} reading of {price:dec} stamped {ago:d} seconds ago"))
def publishes_reading(qa, name, sym, price, ago):
    now = qa.dex.clock_micros() // 1_000_000
    attempt(qa, lambda: qa.dex.set_mock_reading(addr(qa, name), market_id(sym), U.price(price), now - ago))


@given(P("a fill on {sym:w} lands the mark {direction:w} the index by {pct:dec} percent"))
def fill_lands_mark(qa, sym, direction, pct):
    m = market_id(sym)
    index = qa.dex.get_index_price(m)["price"]
    p = qa.dex.get_market_params(m)
    bps = int(round(float(pct) * 100))
    target = index * (10_000 + bps) // 10_000 if direction == "above" else index * (10_000 - bps) // 10_000
    target -= target % p["tickSize"]
    clip = clip_for(p, target)
    qty = p["backstopMaxSize"] + clip

    def go():
        if direction == "above":
            qa.dex.place_order(qa.who["bob"], {"marketId": m, "side": "Sell", "orderType": "Limit", "size": clip, "price": target})
            qa.dex.place_order(qa.who["alice"], {"marketId": m, "side": "Buy", "orderType": "Limit", "size": qty, "price": target})
            qa.noted["longSide"], qa.noted["shortSide"] = "alice", "bob"
        else:
            qa.dex.place_order(qa.who["bob"], {"marketId": m, "side": "Buy", "orderType": "Limit", "size": clip, "price": target})
            qa.dex.place_order(qa.who["alice"], {"marketId": m, "side": "Sell", "orderType": "Limit", "size": qty, "price": target})
            qa.noted["longSide"], qa.noted["shortSide"] = "bob", "alice"
    read(qa, go)
    qa.evidence("markAfterFill", U.show_price(qa.dex.get_mark_price(m)))


@when(P("the {sym:w} index walks down in {pct:dec} percent steps until {name:w} is liquidatable, checking liquidate agrees at every tick"))
def index_walk(qa, sym, pct, name):
    m = market_id(sym)
    who = addr(qa, name)
    p = qa.dex.get_market_params(m)
    pos = qa.dex.get_position(who, m)
    balance = qa.dex.vault_balance(who)
    index = qa.dex.get_index_price(m)["price"]
    step_bps = int(round(float(pct) * 100))

    size = abs(pos["size"])
    entry_notional = U.notional(size, pos["entryPrice"]) / 1e6
    size_f = size / 1e8
    mm = p["maintenanceMarginBps"] / 10_000
    mark_t = (entry_notional - balance / 1e6) / (size_f * (1 - mm))
    index_t = mark_t / (1 + p["maxBasisBps"] / 10_000)
    qa.noted["expectedIndex"] = index_t

    result = {"flipped": False, "checks": 0, "index": None, "disagree": None}

    def go():
        nonlocal index
        for _ in range(2000):
            index = index - index * step_bps // 10_000
            qa.dex.set_mock_price(qa.who["admin"], m, index)
            liq = qa.dex.is_liquidatable(who)
            result["checks"] += 1
            if not liq:
                try:
                    qa.dex.liquidate(qa.who["keeper"], who, m)
                    result["disagree"] = "liquidate succeeded while isLiquidatable was false at index " + U.show_price(index)
                    return
                except Reverted as err:
                    if err.error != "NotLiquidatable":
                        raise
            else:
                qa.dex.liquidate(qa.who["keeper"], who, m)
                result["flipped"] = True
                result["index"] = index
                return
    read(qa, go)
    qa.walk = result
    qa.evidence("walk", {"checks": result["checks"], "liquidatedAtIndex": U.show_price(result["index"]) if result["index"] else None, "expectedIndex": f"{index_t:.4f}", "stepPct": pct})


# ================================================================ Then: call outcome


@then("the call succeeds")
def call_succeeds(qa):
    qa.unchecked = None
    last = qa.last
    qa.observe("the call succeeded", lambda: (bool(last and last.get("ok")), str(last["revert"]) if last and last.get("revert") else "no call recorded"))


@then(P("the call reverts with {name:w}"))
def call_reverts(qa, name):
    qa.unchecked = None
    last = qa.last

    def ev():
        if not last:
            return False, "no call recorded"
        if last.get("ok"):
            return False, "the call succeeded"
        return last["revert"].error == name, str(last["revert"])
    qa.observe("the call reverts with " + name, ev)


@then(P('the call reverts with BadParams "{what}"'))
def call_reverts_badparams(qa, what):
    qa.unchecked = None
    last = qa.last

    def ev():
        if not last or last.get("ok"):
            return False, "the call succeeded" if last and last.get("ok") else "no call"
        r = last["revert"]
        return r.error == "BadParams" and r.args[0] == what, str(r)
    qa.observe(f"the call reverts with BadParams({what})", ev)


@then(P("the revert arguments are {a:dec} and {b:dec}"))
def revert_args_two(qa, a, b):
    args = (qa.last or {}).get("revert").args if qa.last and qa.last.get("revert") else []
    want = [U.price(a), U.price(b)]
    qa.observe("revert arguments", lambda: (len(args) >= 2 and args[0] == want[0] and args[1] == want[1], f"got {args}, want {want}"))


@then(P("the revert arguments are {a:dec}, {b:dec} and {c:dec}"))
def revert_args_three(qa, a, b, c):
    args = qa.last["revert"].args if qa.last and qa.last.get("revert") else []
    want = [U.price(a), U.price(b), U.price(c)]
    qa.observe("revert arguments", lambda: (len(args) >= 3 and all(args[i] == w for i, w in enumerate(want)), f"got {args}"))


@then(P('the revert names order "{alias}"'))
def revert_names_order(qa, alias):
    args = qa.last["revert"].args if qa.last and qa.last.get("revert") else []
    qa.observe("revert names order " + alias, lambda: (bool(args) and args[0] == qa.orders[alias], f"got {args[0] if args else None}, want {qa.orders.get(alias)}"))


@then(P("the required collateral in the revert equals the initial margin for {size:dec} {sym:w}"))
def revert_required(qa, size, sym):
    args = qa.last["revert"].args if qa.last and qa.last.get("revert") else []
    qa.observe("InsufficientCollateral.required == initial margin", lambda: (len(args) >= 2 and args[1] == qa.noted.get("required"), f"required {args[1] if len(args) > 1 else None}, computed {qa.noted.get('required')}"))


# ================================================================ Then: state


@then(P("{name:w}'s account exists"))
def account_exists(qa, name):
    check(qa, name + " account exists", lambda: (qa.dex.account_exists(addr(qa, name)), "accountExists() false"))


@then(P("{name:w} has {n:d} open orders"))
def has_open_orders(qa, name, n):
    def ev():
        a = qa.dex.get_account(addr(qa, name))
        return a["openOrders"] == n, f"openOrders = {a['openOrders']}"
    check(qa, f"{name} has {n} open orders", ev)


@then(P("{name:w}'s account was created in the current block or earlier"))
def account_created(qa, name):
    def ev():
        a = qa.dex.get_account(addr(qa, name))
        now = qa.dex.clock_micros() // 1_000_000
        return a["createdAt"] > 0 and a["createdAt"] <= now, f"createdAt {a['createdAt']}, now {now}"
    check(qa, "createdAt <= now", ev)


@then(P("{name:w}'s vault balance is ${amount:dec}"))
def vault_balance_is(qa, name, amount):
    check(qa, name + " vault balance", lambda: ((b := qa.dex.vault_balance(addr(qa, name))) == U.usd(amount), "balance $" + U.show_usd(b)))


@then(P("{name:w}'s vault balance is below ${amount:dec}"))
def vault_balance_below(qa, name, amount):
    check(qa, name + " vault balance below", lambda: ((b := qa.dex.vault_balance(addr(qa, name))) < U.usd(amount), "balance $" + U.show_usd(b)))


@then(P("{name:w}'s vault balance is at least ${amount:dec}"))
def vault_balance_at_least(qa, name, amount):
    check(qa, name + " vault balance at least", lambda: ((b := qa.dex.vault_balance(addr(qa, name))) >= U.usd(amount), "balance $" + U.show_usd(b)))


@then(P("{name:w}'s vault balance changed by ${delta:dec}"))
def vault_balance_changed(qa, name, delta):
    def ev():
        b = qa.dex.vault_balance(addr(qa, name))
        d = b - qa.noted["bal." + name]
        return d == U.usd(delta), f"delta ${U.show_usd(d)}, want ${delta}"
    check(qa, name + " balance delta", ev)


@then(P("{name:w}'s vault balance decreased"))
def vault_balance_decreased(qa, name):
    check(qa, name + " balance decreased", lambda: ((b := qa.dex.vault_balance(addr(qa, name))) < qa.noted["bal." + name], f"before {qa.noted['bal.' + name]}, after {b}"))


@then(P("{name:w}'s vault balance increased"))
def vault_balance_increased(qa, name):
    check(qa, name + " balance increased", lambda: ((b := qa.dex.vault_balance(addr(qa, name))) > qa.noted["bal." + name], f"before {qa.noted['bal.' + name]}, after {b}"))


@then(P("the treasury's vault balance changed by ${delta:dec}"))
def treasury_changed(qa, delta):
    check(qa, "treasury balance delta", lambda: ((d := qa.dex.vault_balance(qa.who["treasury"]) - qa.noted["bal.treasury"]) == U.usd(delta), "delta $" + U.show_usd(d)))


@then(P("the insurance fund's vault balance changed by ${delta:dec}"))
def insurance_changed(qa, delta):
    check(qa, "insurance balance delta", lambda: ((d := qa.dex.vault_balance(qa.who["insurance"]) - qa.noted["bal.insurance"]) == U.usd(delta), "delta $" + U.show_usd(d)))


@then("the insurance fund's vault balance decreased")
def insurance_decreased(qa):
    check(qa, "insurance balance decreased", lambda: ((b := qa.dex.vault_balance(qa.who["insurance"])) < qa.noted["bal.insurance"], f"before {qa.noted['bal.insurance']}, after {b}"))


@then(P("{name:w}'s free collateral is at most ${amount:dec}"))
def free_at_most(qa, name, amount):
    check(qa, name + " free collateral", lambda: ((f := qa.dex.free_collateral(addr(qa, name))) <= U.usd(amount), "free $" + U.show_usd(f)))


@then("the vault holds exactly its ledger")
def vault_holds_ledger(qa):
    check(qa, "vault tokens == ledger", lambda: ((r := qa.dex.vault_reserves())["held"] == r["ledger"], f"held {r['held']}, ledger {r['ledger']}"))


@then(P("{name:w}'s {sym:w} position size is {size:dec} {unit:w}"))
def position_size(qa, name, sym, size, unit):
    check(qa, f"{name} {sym} size", lambda: ((p := qa.dex.get_position(addr(qa, name), market_id(sym)))["size"] == U.size(size), "size " + U.show_size(p["size"])))


@then(P("the backstop's {sym:w} position size is {size:dec} {unit:w}"))
def backstop_position_size(qa, sym, size, unit):
    check(qa, f"backstop {sym} size", lambda: ((p := qa.dex.get_position(qa.who["backstop"], market_id(sym)))["size"] == U.size(size), "size " + U.show_size(p["size"])))


@then(P("{name:w}'s {sym:w} entry price is {price:dec}"))
def entry_price(qa, name, sym, price):
    check(qa, f"{name} {sym} entry", lambda: ((p := qa.dex.get_position(addr(qa, name), market_id(sym)))["entryPrice"] == U.price(price), "entry " + U.show_price(p["entryPrice"])))


@then(P("{name:w}'s {sym:w} realised pnl is ${pnl:dec}"))
def realised_pnl(qa, name, sym, pnl):
    check(qa, f"{name} {sym} realised pnl", lambda: ((p := qa.dex.get_position(addr(qa, name), market_id(sym)))["realizedPnl"] == U.usd(pnl), "realised $" + U.show_usd(p["realizedPnl"])))


@then(P("{sym:w} has {n:d} position holders"))
def holders(qa, sym, n):
    check(qa, sym + " holders", lambda: (len(h := qa.dex.holders_of(market_id(sym))) == n, f"holders {len(h)}"))


@then(P("{sym:w} open interest is {l:dec} {u1:w} long and {s:dec} {u2:w} short"))
def open_interest(qa, sym, l, u1, s, u2):
    def ev():
        m = qa.dex.get_market(market_id(sym))
        return m["openInterestLong"] == U.size(l) and m["openInterestShort"] == U.size(s), f"long {U.show_size(m['openInterestLong'])}, short {U.show_size(m['openInterestShort'])}"
    check(qa, sym + " open interest", ev)


@then(P("{name:w}'s equity changed by ${delta:dec}"))
def equity_changed(qa, name, delta):
    check(qa, name + " equity delta", lambda: ((d := qa.dex.equity(addr(qa, name)) - qa.noted["equity." + name]) == U.usd(delta), "delta $" + U.show_usd(d)))


@then(P("{name:w}'s equity decreased"))
def equity_decreased(qa, name):
    check(qa, name + " equity decreased", lambda: ((e := qa.dex.equity(addr(qa, name))) < qa.noted["equity." + name], f"before {qa.noted['equity.' + name]}, after {e}"))


@then(P("{name:w}'s equity is above ${amount:dec}"))
def equity_above(qa, name, amount):
    check(qa, name + " equity above", lambda: ((e := qa.dex.equity(addr(qa, name))) > U.usd(amount), "equity $" + U.show_usd(e)))


@then(P("{name:w}'s estimated {sym:w} liquidation price is below her entry and above 0"))
def est_liq_below(qa, name, sym):
    def ev():
        a = addr(qa, name)
        liq = qa.dex.estimated_liquidation_price(a, market_id(sym))
        p = qa.dex.get_position(a, market_id(sym))
        return 0 < liq < p["entryPrice"], f"liq {U.show_price(liq)}, entry {U.show_price(p['entryPrice'])}"
    check(qa, name + " est. liq below entry", ev)


@then(P("{name:w}'s estimated {sym:w} liquidation price is above his entry"))
def est_liq_above(qa, name, sym):
    def ev():
        a = addr(qa, name)
        liq = qa.dex.estimated_liquidation_price(a, market_id(sym))
        p = qa.dex.get_position(a, market_id(sym))
        return liq > p["entryPrice"], f"liq {U.show_price(liq)}, entry {U.show_price(p['entryPrice'])}"
    check(qa, name + " est. liq above entry", ev)


@then(P("{name:w} is liquidatable"))
def is_liquidatable(qa, name):
    check(qa, name + " is liquidatable", lambda: (qa.dex.is_liquidatable(addr(qa, name)), "isLiquidatable false"))


@then(P("{name:w} is not liquidatable"))
def is_not_liquidatable(qa, name):
    check(qa, name + " is not liquidatable", lambda: (not qa.dex.is_liquidatable(addr(qa, name)), "isLiquidatable true"))


@then(P("{name:w}'s liquidation count is {n:d}"))
def liquidation_count(qa, name, n):
    check(qa, name + " liquidationCount", lambda: ((a := qa.dex.get_account(addr(qa, name)))["liquidationCount"] == n, f"count {a['liquidationCount']}"))


@then(P("{name:w}'s last liquidation was in the current block"))
def last_liquidation_now(qa, name):
    def ev():
        a = qa.dex.get_account(addr(qa, name))
        now = qa.dex.clock_micros() // 1_000_000
        return a["lastLiquidatedAt"] == now, f"lastLiquidatedAt {a['lastLiquidatedAt']}, now {now}"
    check(qa, name + " lastLiquidatedAt == now", ev)


@then(P('order "{alias}" status is {status:w}'))
def order_status(qa, alias, status):
    check(qa, f"order {alias} status", lambda: ((o := qa.dex.get_order(qa.orders[alias]))["statusName"] == status, "status " + o["statusName"]))


@then(P('order "{alias}" filled is {size:dec} {unit:w}'))
def order_filled(qa, alias, size, unit):
    check(qa, f"order {alias} filled", lambda: ((o := qa.dex.get_order(qa.orders[alias]))["filled"] == U.size(size), "filled " + U.show_size(o["filled"])))


@then(P("market {sym:w} has {n:d} pending triggers"))
def pending_triggers(qa, sym, n):
    check(qa, sym + " pending triggers", lambda: (len(ids := qa.dex.pending_trigger_ids(market_id(sym))) == n, f"pending {len(ids)}"))


def _book_level(qa, sym, side, price, size, source):
    def ev():
        b = qa.dex.get_order_book(market_id(sym), 10)
        src = 1 if source == "backstop" else 0
        levels = b[side]
        hit = next((lv for lv in levels if lv["price"] == U.price(price) and lv["source"] == src), None)
        return hit is not None and hit["size"] == U.size(size), side + " " + " ".join(f"{U.show_price(lv['price'])}@{U.show_size(lv['size'])}/{lv['source']}" for lv in levels)
    return ev


@then(P("the {sym:w} order book has a bid at {price:dec} of {size:dec} {unit:w} from the {source:w}"))
def book_bid(qa, sym, price, size, unit, source):
    check(qa, sym + " bid level", _book_level(qa, sym, "bids", price, size, source))


@then(P("the {sym:w} order book has an ask at {price:dec} of {size:dec} {unit:w} from the {source:w}"))
def book_ask(qa, sym, price, size, unit, source):
    check(qa, sym + " ask level", _book_level(qa, sym, "asks", price, size, source))


@then(P("the {sym:w} order book has no bid at {price:dec}"))
def book_no_bid(qa, sym, price):
    def ev():
        b = qa.dex.get_order_book(market_id(sym), 10)
        return not any(lv["price"] == U.price(price) for lv in b["bids"]), "bids " + " ".join(U.show_price(lv["price"]) for lv in b["bids"])
    check(qa, sym + " no bid", ev)


@then(P("the {sym:w} order book has no backstop levels"))
def book_no_backstop(qa, sym):
    def ev():
        b = qa.dex.get_order_book(market_id(sym), 10)
        return not any(lv["source"] == 1 for lv in b["bids"] + b["asks"]), f"levels {len(b['bids']) + len(b['asks'])}"
    check(qa, sym + " no backstop", ev)


@then(P("the mark price of {sym:w} is {price:dec}"))
def mark_is(qa, sym, price):
    check(qa, sym + " mark", lambda: ((m := qa.dex.get_mark_price(market_id(sym))) == U.price(price), "mark " + U.show_price(m)))


@then(P("the mark price of {sym:w} equals its index price"))
def mark_equals_index(qa, sym):
    def ev():
        m = qa.dex.get_mark_price(market_id(sym))
        i = qa.dex.get_index_price(market_id(sym))["price"]
        return m == i, f"mark {U.show_price(m)}, index {U.show_price(i)}"
    check(qa, sym + " mark == index", ev)


@then(P("the index price of {sym:w} is {price:dec}"))
def index_is(qa, sym, price):
    check(qa, sym + " index", lambda: ((p := qa.dex.get_index_price(market_id(sym))["price"]) == U.price(price), "index " + U.show_price(p)))


@then(P("reading the {sym:w} index reverts with {name:w}"))
def index_reverts(qa, sym, name):
    def ev():
        try:
            qa.dex.get_index_price(market_id(sym))
            return False, "did not revert"
        except Reverted as err:
            return err.error == name, str(err)
    check(qa, f"{sym} index reverts {name}", ev)


@then(P("the {sym:w} oracle peek reports stale"))
def peek_stale(qa, sym):
    check(qa, sym + " peek stale", lambda: ((r := qa.dex.oracle_peek(market_id(sym)))["isStale"] is True, f"isStale {r['isStale']}"))


@then(P("{sym:w} funding did not advance"))
def funding_not_advanced(qa, sym):
    def ev():
        f = qa.dex.get_funding_rate(market_id(sym))
        b = qa.noted["funding.before"]
        return f["cumulativeIndex"] == b["cumulativeIndex"] and f["lastFundingTime"] == b["lastFundingTime"], f"index {f['cumulativeIndex']}, time {f['lastFundingTime']}"
    check(qa, sym + " funding unchanged", ev)


@then(P("{sym:w} funding advanced"))
def funding_advanced(qa, sym):
    def ev():
        f = qa.dex.get_funding_rate(market_id(sym))
        b = qa.noted["funding.before"]
        return f["lastFundingTime"] > b["lastFundingTime"], f"time before {b['lastFundingTime']}, after {f['lastFundingTime']}"
    check(qa, sym + " funding advanced", ev)


@then(P("the {sym:w} funding rate is {bps:d} bps"))
def rate_is(qa, sym, bps):
    check(qa, sym + " rate", lambda: ((f := qa.dex.get_funding_rate(market_id(sym)))["lastRateBps"] == bps, f"rate {f['lastRateBps']} bps"))


@then(P("the {sym:w} funding rate is positive"))
def rate_positive(qa, sym):
    check(qa, sym + " rate > 0", lambda: ((f := qa.dex.get_funding_rate(market_id(sym)))["lastRateBps"] > 0, f"rate {f['lastRateBps']}"))


@then(P("the {sym:w} funding rate is negative"))
def rate_negative(qa, sym):
    check(qa, sym + " rate < 0", lambda: ((f := qa.dex.get_funding_rate(market_id(sym)))["lastRateBps"] < 0, f"rate {f['lastRateBps']}"))


@then(P("the {sym:w} funding rate is at most {bps:d} bps"))
def rate_at_most(qa, sym, bps):
    check(qa, sym + " rate <= cap", lambda: ((f := qa.dex.get_funding_rate(market_id(sym)))["lastRateBps"] <= bps, f"rate {f['lastRateBps']}"))


@then(P("the {sym:w} funding rate is between {lo:d} and {hi:d} bps"))
def rate_between(qa, sym, lo, hi):
    check(qa, sym + " rate in range", lambda: (lo <= (f := qa.dex.get_funding_rate(market_id(sym)))["lastRateBps"] <= hi, f"rate {f['lastRateBps']}"))


@then(P("market {sym:w}'s last funding time is on an interval boundary"))
def funding_boundary(qa, sym):
    mid = int(sym) if sym.isdigit() else market_id(sym)

    def ev():
        f = qa.dex.get_funding_rate(mid)
        p = qa.dex.get_market_params(mid)
        return f["lastFundingTime"] % p["fundingIntervalSec"] == 0, f"lastFundingTime {f['lastFundingTime']} mod {p['fundingIntervalSec']} = {f['lastFundingTime'] % p['fundingIntervalSec']}"
    check(qa, sym + " funding boundary", ev)


@then(P("market {sym:w}'s last funding time is the most recent boundary"))
def funding_most_recent(qa, sym):
    def ev():
        f = qa.dex.get_funding_rate(market_id(sym))
        p = qa.dex.get_market_params(market_id(sym))
        now = qa.dex.clock_micros() // 1_000_000
        want = now - now % p["fundingIntervalSec"]
        return f["lastFundingTime"] == want, f"lastFundingTime {f['lastFundingTime']}, want {want}"
    check(qa, sym + " most recent boundary", ev)


@then(P("on the next touch the {payer:w} on {sym:w} pay funding"))
def next_touch_pays(qa, payer, sym):
    m = market_id(sym)
    name = qa.noted["longSide"] if payer == "longs" else qa.noted["shortSide"]
    who = addr(qa, name)

    def ev():
        p = qa.dex.get_market_params(m)
        pos = qa.dex.get_position(who, m)
        idx = qa.dex.get_index_price(m)["price"]
        clip = clip_for(p, idx)
        side = "Sell" if pos["size"] > 0 else "Buy"
        r = qa.dex.place_order(who, {"marketId": m, "side": side, "orderType": "Market", "tif": "IOC", "size": clip})
        pc = next((e for e in r["events"] if e["name"] == "PositionChanged" and e["account"].lower() == who.lower()), None)
        return pc is not None and pc["fundingPaid"] > 0, f"fundingPaid {pc['fundingPaid']}" if pc else "no PositionChanged for " + name
    check(qa, payer + " pay funding on touch", ev)


@then(P("the new market id is {n:d}"))
def new_market_id(qa, n):
    qa.observe("new market id", lambda: (qa.noted.get("newMarketId") == n, f"id {qa.noted.get('newMarketId')}"))


@then(P("market {m:d} is Active"))
def market_active(qa, m):
    check(qa, f"market {m} Active", lambda: ((mk := qa.dex.get_market(m))["statusName"] == "Active", mk["statusName"]))


@then(P("the market count is {n:d}"))
def market_count_is(qa, n):
    check(qa, "market count", lambda: ((c := qa.dex.market_count()) == n, f"count {c}"))


@then(P("the {sym:w} market parameters are:"))
def market_params_are(qa, sym, datatable):
    def ev():
        p = qa.dex.get_market_params(market_id(sym))
        bad = [f"{field}={p[field]} (want {value})" for field, value in datatable if str(p[field]) != value]
        return not bad, "; ".join(bad) if bad else f"{len(datatable)} fields equal"
    check(qa, sym + " params", ev)


@then(P("the {sym:w} market parameter {field:w} is {value:d}"))
def market_param_is(qa, sym, field, value):
    check(qa, f"{sym} {field}", lambda: ((p := qa.dex.get_market_params(market_id(sym)))[field] == value, f"{field} = {p[field]}"))


@then(P("the pending admin is {name:w}"))
def pending_admin_is(qa, name):
    check(qa, "pendingAdmin", lambda: ((a := qa.dex.pending_admin()).lower() == addr(qa, name).lower(), a))


@then("the admin is still the deployer")
def admin_still_deployer(qa):
    check(qa, "admin unchanged", lambda: ((a := qa.dex.admin()).lower() == qa.who["deployer"].lower(), a))


@then(P("the admin is {name:w}"))
def admin_is(qa, name):
    check(qa, "admin", lambda: ((a := qa.dex.admin()).lower() == addr(qa, name).lower(), a))


@then("the walk ended with a successful liquidation")
def walk_succeeded(qa):
    w = qa.walk
    qa.observe("walk flipped and liquidated", lambda: (bool(w and w["flipped"] and not w["disagree"]), (w["disagree"] or f"liquidated at index {U.show_price(w['index'])} after {w['checks']} ticks") if w else "no walk"))


@then("the liquidation index matched the equity-equals-maintenance arithmetic within one step")
def walk_matches_arithmetic(qa):
    def ev():
        if not qa.walk or not qa.walk["index"]:
            return False, "no liquidation index"
        got = qa.walk["index"] / 1e8
        want = qa.noted["expectedIndex"]
        ok = got <= want and got > want * (1 - 0.001) * (1 - 0.001)
        return ok, f"first liquidatable index {got:.4f}, computed threshold {want:.4f}"
    qa.observe("threshold matches arithmetic", ev)


# events


def _find(qa, name, pred=lambda e: True):
    return next((e for e in events(qa) if e["name"] == name and pred(e)), None)


@then(P("an AccountInitialized event names {name:w}"))
def ev_account_initialized(qa, name):
    e = _find(qa, "AccountInitialized")
    qa.observe("AccountInitialized", lambda: (e is not None and e["account"].lower() == addr(qa, name).lower(), e["account"] if e else "no event"))


@then(P("a Deposited event names {name:w} with amount ${amount:dec}"))
def ev_deposited(qa, name, amount):
    e = _find(qa, "Deposited")
    qa.observe("Deposited", lambda: (e is not None and e["account"].lower() == addr(qa, name).lower() and e["amount"] == U.usd(amount), f"amount {e['amount']}" if e else "no event"))


@then(P("a MarketStatusChanged event reports {sym:w} {status:w} at {price:dec}"))
def ev_market_status(qa, sym, status, price):
    e = _find(qa, "MarketStatusChanged")
    qa.observe("MarketStatusChanged", lambda: (e is not None and e["marketId"] == market_id(sym) and e["status"] == MARKET_STATUS[status] and e["settlementPrice"] == U.price(price), str(e) if e else "no event"))


@then(P('an OrderCancelled event has reason "{reason}"'))
def ev_cancelled_reason(qa, reason):
    e = _find(qa, "OrderCancelled")
    got = reason_text(e) if e else None
    qa.observe("OrderCancelled reason " + reason, lambda: (got == reason, f"reason {got}"))


@then(P('an OrderCancelled event has reason "{reason}" and unfilled {size:dec} {unit:w}'))
def ev_cancelled_unfilled(qa, reason, size, unit):
    e = _find(qa, "OrderCancelled")
    got = reason_text(e) if e else None
    qa.observe("OrderCancelled", lambda: (got == reason and e["unfilled"] == U.size(size), f"reason {got}, unfilled {U.show_size(e['unfilled']) if e else '-'}"))


@then(P('an OrderTriggered event names order "{alias}"'))
def ev_triggered(qa, alias):
    e = _find(qa, "OrderTriggered")
    qa.observe("OrderTriggered", lambda: (e is not None and e["orderId"] == qa.orders[alias], f"orderId {e['orderId']}" if e else "no event"))


@then("an OrderPlaced event matches the placed order exactly")
def ev_placed_matches(qa):
    def ev():
        e = _find(qa, "OrderPlaced")
        if not e:
            return False, "no event"
        o = qa.dex.get_order(e["orderId"])
        differ = [f for f in ["marketId", "side", "orderType", "tif", "size", "price", "triggerPrice", "reduceOnly", "userOrderId", "maxTs"] if str(e[f]) != str(o[f])]
        return not differ and e["owner"].lower() == o["owner"].lower(), ("differ: " + ",".join(differ)) if differ else "all fields equal"
    check(qa, "OrderPlaced == order", ev)


@then(P("the OrderFilled events in order name makers {first:w} then the zero address"))
def ev_filled_makers(qa, first):
    f = [e for e in events(qa) if e["name"] == "OrderFilled"]
    qa.observe("OrderFilled makers", lambda: (len(f) == 2 and f[0]["maker"].lower() == addr(qa, first).lower() and f[1]["maker"] == "0x" + "0" * 40, ", ".join(x["maker"] for x in f)))


@then(P("the second OrderFilled event has makerOrderId {n:d}"))
def ev_second_filled_maker_id(qa, n):
    f = [e for e in events(qa) if e["name"] == "OrderFilled"]
    qa.observe("second OrderFilled makerOrderId", lambda: (len(f) >= 2 and f[1]["makerOrderId"] == n, str(f[1]["makerOrderId"]) if len(f) >= 2 else "fewer than 2 fills"))


@then(P("there are {n:d} PositionChanged events"))
def ev_position_changed_count(qa, n):
    c = len([e for e in events(qa) if e["name"] == "PositionChanged"])
    qa.observe("PositionChanged count", lambda: (c == n, f"count {c}"))


@then(P("the PositionChanged event for {name:w} reports sizeBefore {b:dec} {u1:w} and sizeAfter {a:dec} {u2:w}"))
def ev_position_changed_for(qa, name, b, u1, a, u2):
    e = _find(qa, "PositionChanged", lambda x: x["account"].lower() == addr(qa, name).lower())
    qa.observe("PositionChanged " + name, lambda: (e is not None and e["sizeBefore"] == U.size(b) and e["sizeAfter"] == U.size(a), f"before {U.show_size(e['sizeBefore'])}, after {U.show_size(e['sizeAfter'])}" if e else "no event"))


@then(P("a FundingUpdated event reports {sym:w} with samples at least {n:d} and a boundary-aligned time"))
def ev_funding_updated(qa, sym, n):
    def ev():
        e = _find(qa, "FundingUpdated")
        if not e:
            return False, "no event"
        p = qa.dex.get_market_params(market_id(sym))
        return e["marketId"] == market_id(sym) and e["samples"] >= n and e["fundingTime"] % p["fundingIntervalSec"] == 0, f"samples {e['samples']}, time {e['fundingTime']}"
    check(qa, "FundingUpdated", ev)


@then(P("a Liquidated event reports badDebt above {zero:d} and insuranceUsed equal to badDebt"))
def ev_liquidated_covered(qa, zero):
    e = _find(qa, "Liquidated")
    qa.observe("Liquidated bad debt covered", lambda: (e is not None and e["badDebt"] > 0 and e["insuranceUsed"] == e["badDebt"], f"badDebt {e['badDebt']}, insuranceUsed {e['insuranceUsed']}" if e else "no event"))


@then(P("a Liquidated event reports sizeClosed {size:dec} {unit:w}, a fee above {zero:d}, and insuranceUsed at most badDebt"))
def ev_liquidated_fields(qa, size, unit, zero):
    e = _find(qa, "Liquidated")
    qa.observe("Liquidated fields", lambda: (e is not None and e["sizeClosed"] == U.size(size) and e["liquidatorFee"] > 0 and e["insuranceUsed"] <= e["badDebt"], f"sizeClosed {U.show_size(e['sizeClosed'])}, fee {e['liquidatorFee']}, badDebt {e['badDebt']}, insuranceUsed {e['insuranceUsed']}" if e else "no event"))


@then(P("an AutoDeleveraged event names {name:w}"))
def ev_adl_names(qa, name):
    e = _find(qa, "AutoDeleveraged", lambda x: x["account"].lower() == addr(qa, name).lower())
    qa.observe("AutoDeleveraged " + name, lambda: (e is not None, f"sizeClosed {U.show_size(e['sizeClosed'])}, socialised {e['socialised']}" if e else "no event for " + name))


@then(P("no AutoDeleveraged event names {name:w}"))
def ev_no_adl_for(qa, name):
    e = _find(qa, "AutoDeleveraged", lambda x: x["account"].lower() == addr(qa, name).lower())
    qa.observe("no AutoDeleveraged for " + name, lambda: (e is None, "found one" if e else "none"))


@then("no AutoDeleveraged event was emitted")
def ev_no_adl(qa):
    c = len([e for e in events(qa) if e["name"] == "AutoDeleveraged"])
    qa.observe("no AutoDeleveraged", lambda: (c == 0, f"count {c}"))


@then(P("an AdminTransferred event names {name:w}"))
def ev_admin_transferred(qa, name):
    e = _find(qa, "AdminTransferred")
    qa.observe("AdminTransferred", lambda: (e is not None and e["current"].lower() == addr(qa, name).lower(), e["current"] if e else "no event"))

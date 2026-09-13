"""Pure unit tests for the risk engine -- no chain, no case binding.
Mirror of node/be/bot/risk/engine.test.js."""

from __future__ import annotations

from be.bot.risk.engine import REASONS, RiskEngine
from be.contract.chain import units as U

SPECS = {"ETH": {"tick": U.price("1"), "step": U.size("0.001"), "minNotional": U.usd("10"), "maxLeverage": 50}}


def base(**over):
    kw = {"specs": SPECS, "max_order_size": U.size("5"), "max_position_size": U.size("10")}
    kw.update(over)
    return RiskEngine(**kw)


def order(**over):
    o = {"market": "ETH", "side": "Buy", "size": U.size("1"), "price": U.price("2500"), "orderType": "Limit"}
    o.update(over)
    return o


def test_clean_order_cleared_and_rounded():
    d = base().plan(order(size=U.size("1.2345"), price=U.price("2500.7")))
    assert d["ok"] and d["action"] == "send"
    assert d["rounded"]["size"] == U.size("1.234")
    assert d["rounded"]["price"] == U.price("2500")


def test_kill_switch_refuses_everything():
    assert base(kill_switch=True).plan(order())["reason"] == REASONS.KILL_SWITCH


def test_above_max_order_size():
    assert base().plan(order(size=U.size("6")))["reason"] == REASONS.MAX_ORDER_SIZE


def test_max_position_unless_reduce_only():
    r = base()
    assert r.plan(order(size=U.size("4")), {"positionSize": U.size("7")})["reason"] == REASONS.MAX_POSITION
    assert r.plan(order(size=U.size("4"), reduceOnly=True, userOrderId=9), {"positionSize": U.size("7")})["ok"]


def test_size_rounds_to_zero():
    assert base().plan(order(size=U.size("0.0005")))["reason"] == REASONS.ZERO_SIZE


def test_below_min_notional():
    assert base().plan(order(size=U.size("0.001"), price=U.price("2500")))["reason"] == REASONS.BELOW_MIN_NOTIONAL


def test_market_needs_reference_price():
    assert base().plan(order(orderType="Market", price=0))["reason"] == REASONS.NO_PRICE
    assert base().plan(order(orderType="Market", price=0), {"refPrice": U.price("2500")})["ok"]


def test_duplicate_user_order_id():
    r = base()
    assert r.plan(order(userOrderId=1))["action"] == "send"
    assert r.plan(order(userOrderId=1))["action"] == "duplicate"


def test_dry_run_clears_but_does_not_send():
    d = base(dry_run=True).plan(order())
    assert d["ok"] and d["action"] == "dry-run"


def test_unknown_market():
    assert base().plan(order(market="DOGE"))["reason"] == REASONS.UNKNOWN_MARKET

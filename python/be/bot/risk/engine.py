"""The bot's risk gate: a PURE function from an order plus the account's current
position to a decision. Mirror of node/be/bot/risk/engine.js.

No network, no chain -- fully unit-testable, and the bot can reject an order it
should never send before spending a transaction to have the contract reject it.
It rounds first, then checks, then decides.

The decision is one of:
    {"ok": True,  "action": "send"|"dry-run"|"duplicate", "rounded": {...}}
    {"ok": False, "reason": <machine-readable>, "detail": <text>}
"""

from __future__ import annotations

from be.contract.chain import units as U


class REASONS:
    KILL_SWITCH = "kill-switch"
    ZERO_SIZE = "zero-size"
    MAX_ORDER_SIZE = "max-order-size"
    MAX_POSITION = "max-position"
    BELOW_MIN_NOTIONAL = "below-min-notional"
    UNKNOWN_MARKET = "unknown-market"
    NO_PRICE = "no-reference-price"


def _floor_to(value: int, unit: int) -> int:
    return value - (value % unit) if unit > 0 else value


class RiskEngine:
    def __init__(self, specs: dict, max_order_size: int, max_position_size: int, kill_switch: bool = False, dry_run: bool = False) -> None:
        self.specs = specs
        self.max_order_size = int(max_order_size)
        self.max_position_size = int(max_position_size)
        self.kill_switch = kill_switch
        self.dry_run = dry_run
        self.seen: set = set()  # userOrderIds already acted on -- idempotence

    def set_kill_switch(self, on: bool) -> None:
        self.kill_switch = bool(on)

    def plan(self, order: dict, ctx: dict | None = None) -> dict:
        ctx = ctx or {}
        spec = self.specs.get(order["market"])
        if not spec:
            return {"ok": False, "reason": REASONS.UNKNOWN_MARKET, "detail": "no spec for market " + str(order["market"])}

        if self.kill_switch:
            return {"ok": False, "reason": REASONS.KILL_SWITCH, "detail": "the kill switch is engaged"}

        uid = order.get("userOrderId")
        if uid is not None and uid in self.seen:
            return {"ok": True, "action": "duplicate", "detail": f"userOrderId {uid} already acted on", "rounded": None}

        size = _floor_to(int(order["size"]), int(spec["step"]))
        if size <= 0:
            return {"ok": False, "reason": REASONS.ZERO_SIZE, "detail": "size rounds to zero at step " + str(spec["step"])}

        is_limit = order.get("orderType") in ("Limit", "StopLimit", "PostOnly")
        price = _floor_to(int(order.get("price", 0)), int(spec["tick"])) if is_limit else 0

        if size > self.max_order_size:
            return {"ok": False, "reason": REASONS.MAX_ORDER_SIZE, "detail": f"size {U.show_size(size)} over max {U.show_size(self.max_order_size)}"}

        if not order.get("reduceOnly"):
            pos = int(ctx.get("positionSize") or 0)
            have = -pos if pos < 0 else pos
            if have + size > self.max_position_size:
                return {"ok": False, "reason": REASONS.MAX_POSITION, "detail": f"position {U.show_size(have)} + {U.show_size(size)} over max {U.show_size(self.max_position_size)}"}

        ref_price = price if is_limit else int(ctx.get("refPrice") or 0)
        if ref_price <= 0:
            return {"ok": False, "reason": REASONS.NO_PRICE, "detail": "a market order needs a reference price to size notional"}
        notional = U.notional(size, ref_price)
        if notional < int(spec["minNotional"]):
            return {"ok": False, "reason": REASONS.BELOW_MIN_NOTIONAL, "detail": f"notional ${U.show_usd(notional)} below min ${U.show_usd(int(spec['minNotional']))}"}

        if uid is not None:
            self.seen.add(uid)
        rounded = {"size": size, "price": price}
        if self.dry_run:
            return {"ok": True, "action": "dry-run", "detail": "dry run: not sent", "rounded": rounded}
        return {"ok": True, "action": "send", "detail": "cleared", "rounded": rounded}

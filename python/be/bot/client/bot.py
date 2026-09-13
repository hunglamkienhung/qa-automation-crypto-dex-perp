"""A trading bot over PerpDEX. Mirror of node/be/bot/client/bot.js.

Both a tool -- it drives the scenarios the read-only tiers cannot -- and an
object of test: its risk gate and its operational discipline (retry
classification, sequential nonces, cleanup) are asserted directly.

It never holds a key. On anvil the accounts are unlocked and the node signs;
the client refuses any chain but 31337 through the same Sender the contract
tier uses, and carries nothing secret to leak.
"""

from __future__ import annotations

import re

from be.bot.risk.engine import RiskEngine
from be.contract.chain import units as U
from be.contract.chain.ethcall import ChainUnreachable, rpc
from be.contract.chain.perpdex import Reverted

MARKET = {"BTC": 0, "ETH": 1, "SOL": 2}


class Bot:
    def __init__(self, dex, account, risk, log=None) -> None:
        self.dex = dex
        self.account = account
        self.risk = risk
        self.log = log if log is not None else []
        self.nonces = []    # nonce of each write, in order
        self.attempts = []  # {op, tries, outcome} -- retry classification evidence

    @classmethod
    def from_chain(cls, dex, account, max_order_size, max_position_size, symbols=("BTC", "ETH", "SOL"), kill_switch=False, dry_run=False) -> "Bot":
        specs = {}
        for sym in symbols:
            p = dex.get_market_params(MARKET[sym])
            specs[sym] = {"tick": p["tickSize"], "step": p["stepSize"], "minNotional": p["minNotional"], "maxLeverage": p["maxLeverage"]}
        risk = RiskEngine(specs=specs, max_order_size=max_order_size, max_position_size=max_position_size, kill_switch=kill_switch, dry_run=dry_run)
        return cls(dex, account, risk)

    def say(self, line: str) -> None:
        self.log.append(line)

    def mid(self, sym: str) -> int:
        return MARKET[sym]

    def nonce(self) -> int:
        return int(rpc("eth_getTransactionCount", [self.account, "latest"], self.dex.url), 16)

    def with_retry(self, op: str, fn, max_tries: int = 3):
        """Retry a transient failure, never a deterministic one. A Reverted is the
        contract's considered answer -- re-raised on the first try. Only a
        ChainUnreachable is retried."""
        tries = 0
        while True:
            tries += 1
            try:
                r = fn()
                self.attempts.append({"op": op, "tries": tries, "outcome": "ok"})
                return r
            except Reverted as err:
                self.attempts.append({"op": op, "tries": tries, "outcome": "reverted:" + err.error})
                raise
            except ChainUnreachable:
                if tries < max_tries:
                    continue
                self.attempts.append({"op": op, "tries": tries, "outcome": "unreachable"})
                raise

    def fund(self, amount_usd) -> None:
        self.with_retry("fund", lambda: self.dex.fund_trader(self.account, U.usd(str(amount_usd))))
        self.say("funded account with $" + str(amount_usd))

    def place(self, sym, side, size, price=0, order_type="Limit", tif="GTC", reduce_only=False, user_order_id=None) -> dict:
        mid = self.mid(sym)
        try:
            position_size = self.dex.get_position(self.account, mid)["size"]
            ref_price = self.dex.get_index_price(mid)["price"] if order_type == "Market" else 0
        except ChainUnreachable as err:
            return {"sent": False, "decision": {"ok": False, "reason": "chain-unreachable", "detail": str(err)}}
        order = {"market": sym, "side": side, "size": U.size(str(size)), "price": U.price(str(price)), "orderType": order_type, "reduceOnly": reduce_only}
        if user_order_id is not None:
            order["userOrderId"] = user_order_id
        decision = self.risk.plan(order, {"positionSize": position_size, "refPrice": ref_price})
        self.say(f"plan {side} {size} {sym} -> " + (decision["action"] if decision["ok"] else "refused:" + decision["reason"]))
        if not decision["ok"] or decision["action"] != "send":
            return {"sent": False, "decision": decision}

        nonce_before = self.nonce()
        params = {"marketId": mid, "side": side, "orderType": order_type, "tif": tif, "reduceOnly": reduce_only,
                  "size": decision["rounded"]["size"], "price": decision["rounded"]["price"]}
        if user_order_id is not None:
            params["userOrderId"] = user_order_id
        result = self.with_retry("place", lambda: self.dex.place_order(self.account, params))
        self.nonces.append(nonce_before)
        order_id = result.get("orderId")
        row = self.dex.get_order(order_id) if order_id is not None else None
        self.say("placed order " + str(order_id))
        return {"sent": True, "decision": decision, "orderId": order_id, "order": row, "receipt": result}

    def cancel(self, order_id):
        r = self.with_retry("cancel", lambda: self.dex.cancel_order(self.account, order_id))
        self.say("cancelled order " + str(order_id))
        return r

    def cancel_all(self, sym=None):
        r = self.with_retry("cancelAll", lambda: self.dex.cancel_all(self.account, 0xFFFF if sym is None else self.mid(sym)))
        self.say("cancelled all orders" + (" on " + sym if sym else ""))
        return r

    def flatten(self, sym) -> dict:
        mid = self.mid(sym)
        self.cancel_all(sym)
        pos = self.dex.get_position(self.account, mid)
        if pos["size"] != 0:
            side = "Sell" if pos["size"] > 0 else "Buy"
            size = pos["size"] if pos["size"] > 0 else -pos["size"]
            self.with_retry("close", lambda: self.dex.place_order(self.account, {"marketId": mid, "side": side, "orderType": "Market", "tif": "IOC", "reduceOnly": True, "size": size}))
            self.say(f"closed {U.show_size(size)} {sym}")
        after = self.dex.get_position(self.account, mid)
        acct = self.dex.get_account(self.account)
        return {"flat": after["size"] == 0 and int(acct["openOrders"]) == 0, "positionSize": after["size"], "openOrders": int(acct["openOrders"])}

    def leaked_secret(self):
        """Does any recorded line look like it carries a 32-byte secret (64 hex chars)?"""
        rx = re.compile(r"(^|[^0-9a-fx])[0-9a-fA-F]{64}([^0-9a-fA-F]|$)")
        for line in self.log:
            if rx.search(line):
                return line
        if getattr(self, "private_key", None) is not None:
            return "(holds a private_key field)"
        return None

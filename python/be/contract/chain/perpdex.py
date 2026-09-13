"""Client for the exchange in ../../../../contracts, over raw JSON-RPC.
Mirror of node/be/contract/chain/perpdex.js -- same ABI tables, same names."""

from __future__ import annotations

import json
import os
from pathlib import Path

from be.contract.chain import abi
from be.contract.chain.ethcall import ChainUnreachable, RevertError, call, rpc
from be.contract.chain.sender import Reverted, Sender, WrongChain

RPC = os.environ.get("PERPDEX_RPC", "http://127.0.0.1:8545")
DEPLOYMENTS = Path(os.environ.get("PERPDEX_DEPLOYMENTS") or Path(__file__).resolve().parents[4] / "contracts" / "deployments" / "31337.json")

ERRORS = [
    "NotAdmin()", "PendingAdminMismatch()", "ExchangePaused()", "AccountNotFound()", "AccountExists()",
    "UnknownMarket(uint16)", "MarketPaused(uint16)", "MarketSettling(uint16)", "MarketNotSettling(uint16)",
    "ReduceOnlyViolation()", "PriceOutOfBand(uint64,uint64,uint64)", "InvalidTick(uint64,uint64)", "InvalidStep(uint64,uint64)",
    "BelowMinNotional(uint256,uint64)", "OrderExpired(uint64,uint64)", "DuplicateUserOrderId(uint32)", "OrderSlotsFull()",
    "PostOnlyWouldCross(uint64,uint64)", "InsufficientCollateral(int256,uint256)", "SelfTradePrevented(uint64)",
    "FillOrKillUnfillable(uint64,uint64)", "NotOrderOwner()", "OrderNotOpen(uint64)", "TriggerNotMet(uint64,uint64)",
    "NotLiquidatable(address)", "NoPosition()", "TooManyMarkets()", "BadParams(string)", "ZeroAmount()", "WiringAlreadySet()",
    "InvalidLeverage()",
    "NotExchange()", "InsufficientBalance(int128,uint256)", "TransferFailed()", "MockIsLocked(uint16)", "OracleStale(uint16,uint64,uint64)",
    "ZeroPrice()", "InsufficientBalance(uint256,uint256)", "InsufficientAllowance(uint256,uint256)",
]

SIDE = {"Buy": 0, "Sell": 1}
ORDER_TYPE = {"Market": 0, "Limit": 1, "StopMarket": 2, "StopLimit": 3, "TakeProfit": 4}
TIF = {"GTC": 0, "IOC": 1, "FOK": 2, "PostOnly": 3}
TRIGGER = {"Mark": 0, "Index": 1}
ORDER_STATUS = ["Pending", "Open", "Filled", "Cancelled"]
MARKET_STATUS = {"Active": 0, "Paused": 1, "ReduceOnly": 2, "Settling": 3}
MARKET_STATUS_NAMES = ["Active", "Paused", "ReduceOnly", "Settling"]

ORDER_PARAMS_T = "(uint16,uint8,uint8,uint8,uint64,uint64,uint64,uint8,bool,uint32,uint64)"
ORDER_T = "(uint64,address,uint16,uint8,uint8,uint8,uint64,uint64,uint64,uint64,uint8,bool,uint32,uint64,uint64,uint64,uint8)"
ORDER_FIELDS = ["id", "owner", "marketId", "side", "orderType", "tif", "size", "filled", "price", "triggerPrice", "triggerSource", "reduceOnly", "userOrderId", "maxTs", "placedAt", "seq", "status"]
POSITION_T = "(int64,uint64,int128,int128,uint64)"
POSITION_FIELDS = ["size", "entryPrice", "realizedPnl", "fundingIndexSnapshot", "lastUpdated"]
ACCOUNT_T = "(bool,uint8,uint32,uint64,uint64)"
ACCOUNT_FIELDS = ["exists", "openOrders", "liquidationCount", "lastLiquidatedAt", "createdAt"]
PARAMS_T = "(uint64,uint64,uint64,uint16,uint16,uint16,int16,uint16,uint16,uint16,uint16,uint16,uint16,uint64,uint16,uint64)"
PARAMS_FIELDS = ["tickSize", "stepSize", "minNotional", "maxLeverage", "initialMarginBps", "maintenanceMarginBps", "makerFeeBps", "takerFeeBps", "priceBandBps", "maxBasisBps", "liquidationFeeBps", "partialLiquidationBps", "fundingRateCapBps", "fundingIntervalSec", "backstopSpreadBps", "backstopMaxSize"]
MARKET_T = f"(string,uint8,{PARAMS_T},uint64,int128,uint64,int64,int128,uint64,uint64,uint64,uint64)"
MARKET_FIELDS = ["symbol", "status", "params", "settlementPrice", "cumulativeFundingIndex", "lastFundingTime", "lastFundingRateBps", "premiumAccumulatorBps", "premiumSamples", "lastFillPrice", "openInterestLong", "openInterestShort"]
LEVEL_T = "(uint64,uint64,uint8)"

EVENTS = {
    "OrderPlaced": {"sig": "OrderPlaced(uint64,address,uint16,uint8,uint8,uint8,uint64,uint64,uint64,bool,uint32,uint64)", "indexed": ["uint64", "address", "uint16"], "data": "(uint8,uint8,uint8,uint64,uint64,uint64,bool,uint32,uint64)", "fields": ["orderId", "owner", "marketId", "side", "orderType", "tif", "size", "price", "triggerPrice", "reduceOnly", "userOrderId", "maxTs"]},
    "OrderCancelled": {"sig": "OrderCancelled(uint64,address,uint16,uint64,bytes32)", "indexed": ["uint64", "address", "uint16"], "data": "(uint64,bytes32)", "fields": ["orderId", "owner", "marketId", "unfilled", "reason"]},
    "OrderTriggered": {"sig": "OrderTriggered(uint64,uint16,uint64,uint64)", "indexed": ["uint64", "uint16"], "data": "(uint64,uint64)", "fields": ["orderId", "marketId", "triggerPrice", "observedPrice"]},
    "OrderFilled": {"sig": "OrderFilled(uint64,address,address,uint16,uint8,uint64,uint64,uint64,uint256,int256)", "indexed": ["uint64", "address", "address"], "data": "(uint16,uint8,uint64,uint64,uint64,uint256,int256)", "fields": ["takerOrderId", "taker", "maker", "marketId", "takerSide", "size", "price", "makerOrderId", "takerFee", "makerFee"]},
    "PositionChanged": {"sig": "PositionChanged(address,uint16,int64,int64,uint64,int256,int256)", "indexed": ["address", "uint16"], "data": "(int64,int64,uint64,int256,int256)", "fields": ["account", "marketId", "sizeBefore", "sizeAfter", "entryPrice", "realizedPnlDelta", "fundingPaid"]},
    "FundingUpdated": {"sig": "FundingUpdated(uint16,int64,int128,uint64,uint64)", "indexed": ["uint16"], "data": "(int64,int128,uint64,uint64)", "fields": ["marketId", "rateBps", "cumulativeIndex", "fundingTime", "samples"]},
    "Liquidated": {"sig": "Liquidated(address,uint16,address,uint64,uint64,uint256,uint256,uint256)", "indexed": ["address", "uint16", "address"], "data": "(uint64,uint64,uint256,uint256,uint256)", "fields": ["account", "marketId", "liquidator", "sizeClosed", "price", "liquidatorFee", "badDebt", "insuranceUsed"]},
    "AutoDeleveraged": {"sig": "AutoDeleveraged(address,uint16,uint64,uint64,uint256)", "indexed": ["address", "uint16"], "data": "(uint64,uint64,uint256)", "fields": ["account", "marketId", "sizeClosed", "price", "socialised"]},
    "MarketStatusChanged": {"sig": "MarketStatusChanged(uint16,uint8,uint64)", "indexed": ["uint16"], "data": "(uint8,uint64)", "fields": ["marketId", "status", "settlementPrice"]},
    "AccountInitialized": {"sig": "AccountInitialized(address)", "indexed": ["address"], "data": "()", "fields": ["account"]},
    "Deposited": {"sig": "Deposited(address,uint256)", "indexed": ["address"], "data": "(uint256)", "fields": ["account", "amount"]},
    "Withdrawn": {"sig": "Withdrawn(address,uint256)", "indexed": ["address"], "data": "(uint256)", "fields": ["account", "amount"]},
    "AdminTransferred": {"sig": "AdminTransferred(address,address)", "indexed": ["address", "address"], "data": "()", "fields": ["previous", "current"]},
    "Settled": {"sig": "Settled(address,uint16,uint64,int256)", "indexed": ["address", "uint16"], "data": "(uint64,int256)", "fields": ["account", "marketId", "price", "realizedPnlDelta"]},
}
TOPICS = {abi.topic(e["sig"]): name for name, e in EVENTS.items()}


def load_deployment(file: Path = DEPLOYMENTS) -> dict:
    if not Path(file).exists():
        raise ChainUnreachable(f"no deployment at {file} -- run the deploy script against anvil first")
    return json.loads(Path(file).read_text(encoding="utf-8"))


class PerpDex:
    def __init__(self, url: str = RPC, deployment: dict | None = None) -> None:
        self.url = url
        self.d = deployment or load_deployment()
        self.sender = Sender(url, ERRORS)
        self.ex = self.d["exchange"]

    # ---------------------------------------------------------------- chain
    def chain_id(self) -> int:
        return int(rpc("eth_chainId", [], self.url), 16)

    def accounts(self) -> list[str]:
        return rpc("eth_accounts", [], self.url)

    def block_number(self) -> int:
        return int(rpc("eth_blockNumber", [], self.url), 16)

    def block(self, n) -> dict | None:
        return rpc("eth_getBlockByNumber", [hex(n) if isinstance(n, int) else n, False], self.url)

    def deploy_contract(self, from_: str, bytecode: str, ctor_types: str, ctor_args: list) -> str:
        """Deploy raw bytecode with ABI-encoded constructor args from an unlocked account; returns the address."""
        self.sender.assert_chain()
        code = bytecode if bytecode.startswith("0x") else "0x" + bytecode
        data = code + abi.encode_tuple(abi.parse_type(ctor_types).components, ctor_args)
        tx_hash = rpc("eth_sendTransaction", [{"from": from_, "data": data, "gas": hex(30_000_000)}], self.url)
        receipt = self.sender.wait_for_receipt(tx_hash)
        if receipt.get("status") != "0x1" or not receipt.get("contractAddress"):
            raise RuntimeError("deployment failed: " + json.dumps(receipt))
        return receipt["contractAddress"]

    def mine(self, n: int = 1) -> None:
        for _ in range(n):
            rpc("evm_mine", [], self.url)

    def warp(self, seconds: int) -> None:
        rpc("evm_increaseTime", [seconds], self.url)
        self.mine()

    def snapshot(self) -> str:
        return rpc("evm_snapshot", [], self.url)

    def revert(self, snap: str) -> bool:
        return rpc("evm_revert", [snap], self.url)

    # ---------------------------------------------------------------- reads
    def view(self, signature: str, args: list, types: str, fields: list[str] | None = None):
        data = abi.encode_call(signature, args)
        try:
            raw = rpc("eth_call", [{"to": self.ex, "data": data}, "latest"], self.url)
        except RevertError as err:
            raise self.sender._translate(err, signature) from err
        vals = abi.decode(types, raw)
        return abi.named(fields, vals[0]) if fields else vals

    def get_account(self, a): return self.view("getAccount(address)", [a], f"({ACCOUNT_T})", ACCOUNT_FIELDS)
    def account_exists(self, a): return self.view("accountExists(address)", [a], "(bool)")[0]
    def get_position(self, a, m): return self.view("getPosition(address,uint16)", [a, m], f"({POSITION_T})", POSITION_FIELDS)

    def get_order(self, oid):
        o = self.view("getOrder(uint64)", [oid], f"({ORDER_T})", ORDER_FIELDS)
        o["statusName"] = ORDER_STATUS[o["status"]]
        return o

    def get_open_orders(self, a):
        (lst,) = self.view("getOpenOrders(address)", [a], f"({ORDER_T}[])")
        return [{**abi.named(ORDER_FIELDS, v), "statusName": ORDER_STATUS[v[16]]} for v in lst]

    def get_market(self, m):
        mk = self.view("getMarket(uint16)", [m], f"({MARKET_T})", MARKET_FIELDS)
        mk["params"] = abi.named(PARAMS_FIELDS, mk["params"])
        mk["statusName"] = MARKET_STATUS_NAMES[mk["status"]]
        return mk

    def get_market_params(self, m): return self.view("getMarketParams(uint16)", [m], f"({PARAMS_T})", PARAMS_FIELDS)

    def get_order_book(self, m, depth=5):
        bids, asks = self.view("getOrderBook(uint16,uint8)", [m, depth], f"({LEVEL_T}[],{LEVEL_T}[])")
        lv = lambda x: {"price": x[0], "size": x[1], "source": x[2]}  # noqa: E731
        return {"bids": [lv(x) for x in bids], "asks": [lv(x) for x in asks]}

    def get_mark_price(self, m): return self.view("getMarkPrice(uint16)", [m], "(uint64)")[0]

    def get_index_price(self, m):
        p, t = self.view("getIndexPrice(uint16)", [m], "(uint64,uint64)")
        return {"price": p, "publishTime": t}

    def get_funding_rate(self, m):
        return abi.named(["lastRateBps", "cumulativeIndex", "lastFundingTime", "nextFundingTime"], self.view("getFundingRate(uint16)", [m], "(int64,int128,uint64,uint64)"))

    def equity(self, a): return self.view("equity(address)", [a], "(int256)")[0]
    def free_collateral(self, a): return self.view("freeCollateral(address)", [a], "(int256)")[0]

    def margin_requirements(self, a):
        i, m = self.view("marginRequirements(address)", [a], "(uint256,uint256)")
        return {"initial": i, "maintenance": m}

    def is_liquidatable(self, a): return self.view("isLiquidatable(address)", [a], "(bool)")[0]
    def estimated_liquidation_price(self, a, m): return self.view("estimatedLiquidationPrice(address,uint16)", [a, m], "(uint64)")[0]
    def clock_micros(self): return self.view("clockMicros()", [], "(uint64)")[0]
    def market_count(self): return self.view("marketCount()", [], "(uint16)")[0]
    def paused(self): return self.view("paused()", [], "(bool)")[0]
    def admin(self): return self.view("admin()", [], "(address)")[0]
    def pending_admin(self): return self.view("pendingAdmin()", [], "(address)")[0]
    def pending_trigger_ids(self, m): return self.view("pendingTriggerIds(uint16)", [m], "(uint64[])")[0]
    def holders_of(self, m): return self.view("holdersOf(uint16)", [m], "(address[])")[0]
    def next_order_id(self): return self.view("nextOrderId()", [], "(uint64)")[0]

    def vault_balance(self, a): return abi.decode("(int128)", call(self.d["vault"], "balanceOf(address)", [a], self.url))[0]

    def vault_reserves(self):
        held, ledger = abi.decode("(uint256,int128)", call(self.d["vault"], "reserves()", [], self.url))
        return {"held": held, "ledger": ledger}

    def vault_total(self): return abi.decode("(int128)", call(self.d["vault"], "totalBalances()", [], self.url))[0]
    def usdc_balance(self, a): return abi.decode("(uint256)", call(self.d["usdc"], "balanceOf(address)", [a], self.url))[0]

    def oracle_peek(self, m):
        p, t, s = abi.decode("(uint64,uint64,bool)", call(self.d["oracle"], "peek(uint16)", [m], self.url))
        return {"price": p, "publishTime": t, "isStale": s}

    # ---------------------------------------------------------------- writes
    def initialize_account(self, from_): return self.sender.send(from_, self.ex, "initializeAccount()", [])
    def deposit(self, from_, amount): return self.sender.send(from_, self.ex, "deposit(uint256)", [amount])
    def withdraw(self, from_, amount): return self.sender.send(from_, self.ex, "withdraw(uint256)", [amount])

    def place_order(self, from_, p: dict) -> dict:
        args = [[p["marketId"], SIDE[p["side"]], ORDER_TYPE[p["orderType"]], TIF[p.get("tif", "GTC")], p["size"], p.get("price", 0), p.get("triggerPrice", 0), TRIGGER[p.get("triggerSource", "Index")], bool(p.get("reduceOnly", False)), p.get("userOrderId", 0), p.get("maxTs", 0)]]
        receipt = self.sender.send(from_, self.ex, f"placeOrder({ORDER_PARAMS_T})", args, "placeOrder")
        events = self.decode_logs(receipt)
        placed = next((e for e in events if e["name"] == "OrderPlaced"), None)
        return {"receipt": receipt, "events": events, "orderId": placed["orderId"] if placed else None}

    def cancel_order(self, from_, oid): return self.sender.send(from_, self.ex, "cancelOrder(uint64)", [oid])
    def cancel_all(self, from_, market_id=0xFFFF): return self.sender.send(from_, self.ex, "cancelAll(uint16)", [market_id])
    def trigger_order(self, from_, oid): return self.sender.send(from_, self.ex, "triggerOrder(uint64)", [oid])
    def update_funding(self, from_, m): return self.sender.send(from_, self.ex, "updateFunding(uint16)", [m])
    def liquidate(self, from_, a, m): return self.sender.send(from_, self.ex, "liquidate(address,uint16)", [a, m])
    def settle_position(self, from_, a, m): return self.sender.send(from_, self.ex, "settlePosition(address,uint16)", [a, m])
    def set_paused(self, from_, v): return self.sender.send(from_, self.ex, "setPaused(bool)", [v])
    def set_market_status(self, from_, m, status, settlement_price=0): return self.sender.send(from_, self.ex, "setMarketStatus(uint16,uint8,uint64)", [m, MARKET_STATUS[status], settlement_price])
    def set_fees(self, from_, m, maker, taker): return self.sender.send(from_, self.ex, "setFees(uint16,int16,uint16)", [m, maker, taker])
    def transfer_admin(self, from_, to): return self.sender.send(from_, self.ex, "transferAdmin(address)", [to])
    def accept_admin(self, from_): return self.sender.send(from_, self.ex, "acceptAdmin()", [])
    def set_mock_price(self, from_, m, price): return self.sender.send(from_, self.d["oracle"], "setMockPrice(uint16,uint64)", [m, price])
    def set_mock_reading(self, from_, m, price, publish_time): return self.sender.send(from_, self.d["oracle"], "setMockReading(uint16,uint64,uint64)", [m, price, publish_time])
    def lock_mock(self, from_, m): return self.sender.send(from_, self.d["oracle"], "lockMock(uint16)", [m])
    def mint(self, from_, to, amount): return self.sender.send(from_, self.d["usdc"], "mint(address,uint256)", [to, amount])
    def approve_vault(self, from_, amount): return self.sender.send(from_, self.d["usdc"], "approve(address,uint256)", [self.d["vault"], amount])

    def fund_trader(self, who, amount) -> None:
        self.mint(who, who, amount)
        self.approve_vault(who, amount)
        if not self.account_exists(who):
            self.initialize_account(who)
        self.deposit(who, amount)

    # ---------------------------------------------------------------- events
    def decode_logs(self, receipt: dict) -> list[dict]:
        out = []
        for log in receipt.get("logs", []):
            name = TOPICS.get(log["topics"][0])
            if not name:
                continue
            e = EVENTS[name]
            indexed = [abi.decode(f"({t})", log["topics"][i + 1])[0] for i, t in enumerate(e["indexed"])]
            data = [] if e["data"] == "()" else abi.decode(e["data"], log["data"])
            decoded = abi.named(e["fields"], indexed + data)
            decoded["name"] = name
            decoded["logIndex"] = int(log["logIndex"], 16)
            decoded["txHash"] = log["transactionHash"]
            decoded["blockNumber"] = int(log["blockNumber"], 16)
            out.append(decoded)
        return out

    def logs(self, from_block: int, to_block="latest") -> list[dict]:
        raw = rpc("eth_getLogs", [{"address": self.ex, "fromBlock": hex(from_block), "toBlock": to_block}], self.url)
        return self.decode_logs({"logs": raw})


__all__ = ["PerpDex", "Reverted", "WrongChain", "ChainUnreachable", "SIDE", "ORDER_TYPE", "TIF", "TRIGGER", "ORDER_STATUS", "MARKET_STATUS", "EVENTS", "ERRORS", "load_deployment", "RPC"]

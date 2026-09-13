"""The live protocol's public HTTP endpoints. No key, no wallet, read-only.

Mirror of ``node/be/api/venues/gmx.js`` -- see there for the scaling notes.
Ticker prices are integers at 10^(30 - tokenDecimals); USD amounts in
``markets/values`` are 30-decimal.

Every transport failure surfaces as ``VenueUnreachable`` so a step can turn it
into "unobservable" rather than "failed". A shape this adapter did not expect
is raised as is: that is a fault here, not an outage there.
"""

from __future__ import annotations

import json
import socket
import urllib.error
import urllib.request

PRICES = "https://arbitrum-api.gmxinfra.io"
MARKETS = "https://arbitrum.gmxapi.io"
USER_AGENT = "qa-automation-crypto-perp/1.0 (read-only invariants)"
TIMEOUT_S = 20

USD_DECIMALS = 30

MARKETS_UNDER_TEST = {
    "ETH": {"symbol": "ETH", "decimals": 18, "marketName": "ETH/USD [WETH-USDC]", "pair": "ETH/USD"},
    "BTC": {"symbol": "BTC", "decimals": 8, "marketName": "BTC/USD [BTC-USDC]", "pair": "BTC/USD"},
    "SOL": {"symbol": "SOL", "decimals": 9, "marketName": "SOL/USD [SOL-USDC]", "pair": "SOL/USD"},
}


class VenueUnreachable(Exception):
    """The venue did not answer, or answered with an availability error."""


def get_json(url: str, expect_status: int | None = 200) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as res:
            status = res.status
            text = res.read().decode("utf-8")
    except urllib.error.HTTPError as err:
        status = err.code
        text = err.read().decode("utf-8", errors="replace")
        if status >= 500 or status == 429:
            raise VenueUnreachable(f"GET {url} -- HTTP {status}") from err
    except (urllib.error.URLError, socket.timeout, TimeoutError, OSError) as err:
        raise VenueUnreachable(f"GET {url} -- {err}") from err
    try:
        body = json.loads(text)
    except json.JSONDecodeError:
        body = text
    return {"status": status, "body": body}


def price_to_usd(raw: str, token_decimals: int) -> float:
    return int(raw) / 10 ** (USD_DECIMALS - token_decimals)


def usd30(raw: str) -> float:
    return int(raw) / 1e30


def tickers() -> list[dict]:
    body = get_json(f"{PRICES}/prices/tickers")["body"]
    if not isinstance(body, list):
        raise TypeError(f"prices/tickers: expected a list, got {type(body).__name__}")
    return body


def ticker(symbol: str) -> dict:
    t = next((x for x in tickers() if x["tokenSymbol"] == symbol), None)
    if t is None:
        raise LookupError(f"prices/tickers has no entry for {symbol}")
    d = MARKETS_UNDER_TEST[symbol]["decimals"]
    return {
        **t,
        "minPrice": int(t["minPrice"]),
        "maxPrice": int(t["maxPrice"]),
        "minPriceUsd": price_to_usd(t["minPrice"], d),
        "maxPriceUsd": price_to_usd(t["maxPrice"], d),
        "updatedAtMs": int(t["updatedAt"]),
    }


def day(symbol: str) -> dict:
    body = get_json(f"{PRICES}/prices/24h")["body"]
    d = next((x for x in body if x["tokenSymbol"] == symbol), None)
    if d is None:
        raise LookupError(f"prices/24h has no entry for {symbol}")
    return d


def candles(symbol: str, period: str = "1m", limit: int = 10) -> list[dict]:
    body = get_json(f"{PRICES}/prices/candles?tokenSymbol={symbol}&period={period}&limit={limit}")["body"]
    if not isinstance(body, dict) or not isinstance(body.get("candles"), list):
        raise TypeError(f"prices/candles: unexpected shape {str(body)[:120]}")
    return [{"t": t, "open": o, "high": h, "low": lo, "close": c} for t, o, h, lo, c in body["candles"]]


def candles_raw(query: str) -> dict:
    """Raw status + body for a request expected to be rejected."""
    return get_json(f"{PRICES}/prices/candles?{query}", expect_status=None)


def market_config(symbol: str) -> dict:
    body = get_json(f"{MARKETS}/v1/markets/config")["body"]
    name = MARKETS_UNDER_TEST[symbol]["marketName"]
    m = next((x for x in body if x["name"] == name), None)
    if m is None:
        raise LookupError(f"markets/config has no market named {name}")
    return m


def market_values(symbol: str) -> dict:
    cfg = market_config(symbol)
    body = get_json(f"{MARKETS}/v1/markets/values")["body"]
    v = next((x for x in body if x["marketTokenAddress"] == cfg["marketTokenAddress"]), None)
    if v is None:
        raise LookupError(f"markets/values has no entry for {cfg['marketTokenAddress']}")
    return {
        **v,
        "config": cfg,
        "longInterestUsd": usd30(v["longInterestUsd"]),
        "shortInterestUsd": usd30(v["shortInterestUsd"]),
        "poolValueMinUsd": usd30(v["poolValueMin"]),
        "poolValueMaxUsd": usd30(v["poolValueMax"]),
        "updatedAtMs": int(v["updatedAt"]),
    }

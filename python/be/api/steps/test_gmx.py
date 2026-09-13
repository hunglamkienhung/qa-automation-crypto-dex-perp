"""The public-API tier of the live protocol. Binds ../../features/be-api-gmx.feature.

HTTPS only -- no browser. Mirror of node/be/api/steps/gmx.steps.js. The Givens
live in givens.py (a plugin loaded by the domain conftest) because the FE
feature uses them too.
"""

from __future__ import annotations

import time

from pytest_bdd import parsers, scenarios, then

from be.api.venues import gmx as venue
from qa_core.recorder import relative_gap

scenarios("be-api-gmx.feature")

PERIOD_SECONDS = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400}


# ---------------------------------------------------------------- Then


@then("the ticker minimum price does not exceed its maximum price")
def ticker_ordered(qa):
    t = qa.api["ticker"] if qa.api else None
    qa.observe("ticker minPrice <= maxPrice",
               lambda: (t["minPrice"] <= t["maxPrice"], f"min ${t['minPriceUsd']}, max ${t['maxPriceUsd']}"))


@then("both ticker prices are above zero")
def ticker_positive(qa):
    t = qa.api["ticker"] if qa.api else None
    qa.observe("ticker prices > 0",
               lambda: (t["minPrice"] > 0 and t["maxPrice"] > 0, f"min {t['minPrice']}, max {t['maxPrice']}"))


@then("the 24 hour open lies between the low and the high")
def day_open_in_range(qa):
    d = qa.api["day"] if qa.api else None
    qa.observe("24h low <= open <= high",
               lambda: (d["low"] <= d["open"] <= d["high"], f"low {d['low']}, open {d['open']}, high {d['high']}"))


@then("the 24 hour close lies between the low and the high")
def day_close_in_range(qa):
    d = qa.api["day"] if qa.api else None
    qa.observe("24h low <= close <= high",
               lambda: (d["low"] <= d["close"] <= d["high"], f"low {d['low']}, close {d['close']}, high {d['high']}"))


@then("the candles are newest first with strictly decreasing timestamps")
def candles_decreasing(qa):
    def evaluate():
        c = qa.api["candles"]
        bad = next((i for i in range(1, len(c)) if not c[i]["t"] < c[i - 1]["t"]), -1)
        return (len(c) > 1 and bad < 0,
                f"{len(c)} candles" if bad < 0 else f"candle {bad} ({c[bad]['t']}) is not before candle {bad - 1} ({c[bad - 1]['t']})")
    qa.observe("candle timestamps strictly decreasing", evaluate)


@then("consecutive candles are exactly one period apart")
def candles_spaced(qa):
    def evaluate():
        c = qa.api["candles"]
        step = PERIOD_SECONDS[qa.api["period"]]
        bad = next((i for i in range(1, len(c)) if c[i - 1]["t"] - c[i]["t"] != step), -1)
        return (bad < 0, f"every gap is {step}s" if bad < 0 else f"gap between candle {bad - 1} and {bad} is {c[bad - 1]['t'] - c[bad]['t']}s, expected {step}s")
    qa.observe("candles spaced by one period", evaluate)


@then("every candle keeps its open and close between its low and high")
def candles_well_formed(qa):
    def evaluate():
        c = qa.api["candles"]
        bad = next((i for i, x in enumerate(c) if not (x["low"] <= x["open"] <= x["high"] and x["low"] <= x["close"] <= x["high"])), -1)
        return (bad < 0, f"{len(c)} candles well formed" if bad < 0 else f"candle {bad}: {c[bad]}")
    qa.observe("each candle: low <= open,close <= high", evaluate)


@then(parsers.parse("the ticker price is within {pct:g} percent of the latest candle close"))
def ticker_vs_candle(qa, pct):
    def evaluate():
        t = qa.api["ticker"]
        mid = (t["minPriceUsd"] + t["maxPriceUsd"]) / 2
        close = qa.api["candles"][0]["close"]
        gap = relative_gap(mid, close)
        qa.evidence("tickerVsCandle", {"tickerMid": mid, "candleClose": close, "gapPct": gap * 100})
        return (gap <= pct / 100, f"ticker ${mid:.4f}, candle close ${close}, gap {gap * 100:.4f}%")
    qa.observe(f"ticker within {pct}% of latest candle close", evaluate)


@then(parsers.parse("the ticker was updated within the last {max_s:d} seconds"))
def ticker_fresh(qa, max_s):
    def evaluate():
        age = time.time() - qa.api["ticker"]["updatedAtMs"] / 1000
        qa.evidence("tickerAgeSeconds", age)
        return (age <= max_s, f"updated {age:.1f}s ago")
    qa.observe(f"ticker updatedAt within {max_s}s", evaluate)


@then("the ticker is not stamped in the future")
def ticker_not_future(qa):
    def evaluate():
        skew = qa.api["ticker"]["updatedAtMs"] / 1000 - time.time()
        return (skew <= 5, f"updatedAt is {skew:.1f}s relative to now")
    qa.observe("ticker updatedAt <= now", evaluate)


@then("the market's index token is the ticker's token address")
def market_index_token(qa):
    def evaluate():
        a = str(qa.api["config"]["indexTokenAddress"]).lower()
        b = str(qa.api["ticker"]["tokenAddress"]).lower()
        return (a == b, f"market {a}, ticker {b}")
    qa.observe("market indexTokenAddress == ticker tokenAddress", evaluate)


@then("the market is not disabled")
def market_enabled(qa):
    qa.observe("market isDisabled == false",
               lambda: (qa.api["config"]["isDisabled"] is False, f"isDisabled = {qa.api['config']['isDisabled']!r}"))


@then("long and short open interest are both non-negative")
def oi_non_negative(qa):
    def evaluate():
        v = qa.api["values"]
        return (v["longInterestUsd"] >= 0 and v["shortInterestUsd"] >= 0, f"long ${v['longInterestUsd']:.0f}, short ${v['shortInterestUsd']:.0f}")
    qa.observe("longInterestUsd >= 0 and shortInterestUsd >= 0", evaluate)


@then(parsers.parse("the market values were updated within the last {max_s:d} seconds"))
def values_fresh(qa, max_s):
    def evaluate():
        age = time.time() - qa.api["values"]["updatedAtMs"] / 1000
        return (age <= max_s, f"updated {age:.1f}s ago")
    qa.observe(f"market values updatedAt within {max_s}s", evaluate)


@then(parsers.parse("the venue answers {status:d}"))
def venue_status(qa, status):
    qa.observe(f"HTTP {status}", lambda: (qa.api["raw"]["status"] == status, f"got HTTP {qa.api['raw']['status']}"))


@then("the error body names the supported periods")
def error_lists_periods(qa):
    def evaluate():
        text = str(qa.api["raw"]["body"])
        return ("supported periods" in text.lower() and "1m" in text, text[:160])
    qa.observe("error body lists supported periods", evaluate)


@then("the error body says the token is unsupported")
def error_unsupported_token(qa):
    def evaluate():
        text = str(qa.api["raw"]["body"])
        return ("unsupported token" in text.lower(), text[:160])
    qa.observe("error body says unsupported token", evaluate)

"""Expanded v2 market invariants for the GMX public API (features 282-301).
Mirror of the additions in node/be/api/steps/gmx.steps.js -- a plugin module.

The venue adapter overrides the USD fields with floats for reporting; the
tokens fields stay raw integer strings, so each side is compared on whether it
is zero rather than by value.
"""

from __future__ import annotations

from pytest_bdd import given, parsers, then, when

from be.api.venues import gmx as venue

UNREACHABLE = (venue.VenueUnreachable,)


@given("the venue publishes the full ticker set")
def publish_ticker_set(qa):
    def fetch():
        qa.api = getattr(qa, "api", None) or {}
        qa.api["tickers"] = venue.tickers()
        qa.evidence("tickerCount", len(qa.api["tickers"]))
    qa.fetch_or_block(UNREACHABLE, fetch)


@then("the market is not spot-only")
def market_not_spot_only(qa):
    qa.observe("market is not spot-only", lambda: (qa.api["config"]["isSpotOnly"] is False, f"isSpotOnly {qa.api['config']['isSpotOnly']}"))


@then("the pool value minimum does not exceed its maximum")
def pool_value_ordered(qa):
    def ev():
        v = qa.api["values"]
        return (int(v["poolValueMin"]) <= int(v["poolValueMax"]), f"min {v['poolValueMinUsd']:.0f}, max {v['poolValueMaxUsd']:.0f} USD")
    qa.observe("poolValueMin <= poolValueMax", ev)


@then("the reserve factors and the minimum collateral factor are positive")
def risk_factors_positive(qa):
    def ev():
        c = qa.api["config"]
        ok = int(c["reserveFactorLong"]) > 0 and int(c["reserveFactorShort"]) > 0 and int(c["minCollateralFactor"]) > 0
        return (ok, f"reserveL {c['reserveFactorLong']}, reserveS {c['reserveFactorShort']}, minColl {c['minCollateralFactor']}")
    qa.observe("reserve/min-collateral factors > 0", ev)


def _is_zero(v):
    return v == 0 if isinstance(v, (int, float)) else int(v) == 0


def _both_set(tokens, usd):
    return _is_zero(tokens) == _is_zero(usd)


@then("the long open interest in tokens is set exactly when the long interest in USD is")
def long_oi_agrees(qa):
    def ev():
        v = qa.api["values"]
        return (_both_set(v["longInterestInTokens"], v["longInterestUsd"]), f"tokens {v['longInterestInTokens']}, usd {v['longInterestUsd']}")
    qa.observe("long OI tokens <-> USD", ev)


@then("the short open interest in tokens is set exactly when the short interest in USD is")
def short_oi_agrees(qa):
    def ev():
        v = qa.api["values"]
        return (_both_set(v["shortInterestInTokens"], v["shortInterestUsd"]), f"tokens {v['shortInterestInTokens']}, usd {v['shortInterestUsd']}")
    qa.observe("short OI tokens <-> USD", ev)


@then("the borrowing factors for both sides are non-negative")
def borrowing_factors_nonneg(qa):
    def ev():
        v = qa.api["values"]
        return (int(v["borrowingFactorPerSecondForLongs"]) >= 0 and int(v["borrowingFactorPerSecondForShorts"]) >= 0, f"long {v['borrowingFactorPerSecondForLongs']}, short {v['borrowingFactorPerSecondForShorts']}")
    qa.observe("borrowing factors >= 0", ev)


@then("the per-second funding factor is present")
def funding_factor_present(qa):
    def ev():
        v = qa.api["values"]
        return (v.get("fundingFactorPerSecond") is not None, f"fundingFactorPerSecond {v.get('fundingFactorPerSecond')}")
    qa.observe("fundingFactorPerSecond present", ev)


@then("the values entry is keyed by the configured market token address")
def values_keyed_by_config(qa):
    def ev():
        v, c = qa.api["values"], qa.api["config"]
        return (v["marketTokenAddress"].lower() == c["marketTokenAddress"].lower(), f"values {v['marketTokenAddress']}, config {c['marketTokenAddress']}")
    qa.observe("values.marketTokenAddress == config.marketTokenAddress", ev)


@then("every ticker entry has a minimum price at most its maximum, both above zero")
def every_ticker_ordered(qa):
    def ev():
        bad = [t for t in qa.api["tickers"] if not (int(t["minPrice"]) > 0 and int(t["minPrice"]) <= int(t["maxPrice"]))]
        return (not bad, ", ".join(t["tokenSymbol"] for t in bad[:3]) if bad else f"{len(qa.api['tickers'])} tickers ordered and positive")
    qa.observe("every ticker min<=max>0", ev)


@then("no token symbol appears more than once")
def ticker_symbols_unique(qa):
    def ev():
        seen: dict = {}
        for t in qa.api["tickers"]:
            seen[t["tokenSymbol"]] = seen.get(t["tokenSymbol"], 0) + 1
        dup = [(s, n) for s, n in seen.items() if n > 1]
        return (not dup, ", ".join(f"{s}x{n}" for s, n in dup) if dup else f"{len(seen)} unique symbols")
    qa.observe("ticker tokenSymbols are unique", ev)


@then("the ticker set contains ETH, BTC and SOL")
def ticker_covers_markets(qa):
    def ev():
        syms = {t["tokenSymbol"] for t in qa.api["tickers"]}
        missing = [s for s in ("ETH", "BTC", "SOL") if s not in syms]
        return (not missing, "missing " + ", ".join(missing) if missing else "all present")
    qa.observe("ticker set covers the tested markets", ev)


@then("the response is a client error")
def response_client_error(qa):
    def ev():
        s = qa.api["raw"]["status"]
        return (400 <= s < 500, f"HTTP {s}")
    qa.observe("response is a 4xx", ev)


@when("candles are requested with no token symbol")
def candles_no_token(qa):
    def fetch():
        qa.api = getattr(qa, "api", None) or {}
        qa.api["raw"] = venue.candles_raw("tokenSymbol=&period=1m")
        qa.evidence("response", {"status": qa.api["raw"]["status"]})
    qa.fetch_or_block(UNREACHABLE, fetch)

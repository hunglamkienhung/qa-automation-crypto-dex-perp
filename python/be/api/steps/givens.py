"""Givens of the public-API tier, shared with the FE feature.

pytest-bdd registers a step into the module that DEFINES it, so a Given the FE
steps also need cannot simply be imported there. These live in their own
module, loaded as a plugin from the domain conftest, and are visible to every
test module in the domain.
"""

from __future__ import annotations

from pytest_bdd import given, parsers, when

from be.api.venues import gmx as venue

UNREACHABLE = (venue.VenueUnreachable,)


def _api(qa) -> dict:
    if qa.api is None:
        qa.api = {}
    return qa.api


@given(parsers.parse('the venue publishes the "{symbol}" ticker'))
def venue_ticker(qa, symbol):
    def fetch():
        t = venue.ticker(symbol)
        _api(qa)["ticker"] = t
        qa.evidence("ticker", {"symbol": symbol, "minUsd": t["minPriceUsd"], "maxUsd": t["maxPriceUsd"], "updatedAt": t["updatedAt"]})
    qa.fetch_or_block(UNREACHABLE, fetch)


@given(parsers.parse('the venue publishes the "{symbol}" 24 hour summary'))
def venue_day(qa, symbol):
    def fetch():
        _api(qa)["day"] = venue.day(symbol)
        qa.evidence("day", qa.api["day"])
    qa.fetch_or_block(UNREACHABLE, fetch)


@given(parsers.parse('the venue publishes the last {n:d} "{period}" candles for "{symbol}"'))
def venue_candles(qa, n, period, symbol):
    def fetch():
        c = venue.candles(symbol, period, n)
        _api(qa)["candles"] = c
        qa.api["period"] = period
        qa.evidence("candles", {"symbol": symbol, "period": period, "count": len(c), "latest": c[0] if c else None})
    qa.fetch_or_block(UNREACHABLE, fetch)


@given(parsers.parse('the venue publishes the "{symbol}" market configuration'))
def venue_config(qa, symbol):
    def fetch():
        m = venue.market_config(symbol)
        _api(qa)["config"] = m
        qa.evidence("marketConfig", {"name": m["name"], "marketToken": m["marketTokenAddress"], "indexToken": m["indexTokenAddress"], "isDisabled": m["isDisabled"]})
    qa.fetch_or_block(UNREACHABLE, fetch)


@given(parsers.parse('the venue publishes the "{symbol}" market values'))
def venue_values(qa, symbol):
    def fetch():
        v = venue.market_values(symbol)
        _api(qa)["values"] = v
        qa.api["symbol"] = symbol
        qa.evidence("marketValues", {"longInterestUsd": v["longInterestUsd"], "shortInterestUsd": v["shortInterestUsd"], "updatedAt": v["updatedAt"]})
    qa.fetch_or_block(UNREACHABLE, fetch)


@when(parsers.parse('candles are requested with period "{period}" for "{symbol}"'))
def request_candles_raw(qa, period, symbol):
    def fetch():
        _api(qa)["raw"] = venue.candles_raw(f"tokenSymbol={symbol}&period={period}")
        qa.evidence("response", qa.api["raw"])
    qa.fetch_or_block(UNREACHABLE, fetch)



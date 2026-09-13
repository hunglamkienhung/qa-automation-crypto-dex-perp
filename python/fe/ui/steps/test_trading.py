"""The FE branch: the live trading screen against the API and the chain.
Binds ../../features/fe-trading-screen.feature.

The only module in this domain that touches a browser. The `page` fixture is
pytest-playwright's. Mirror of node/fe/ui/steps/trading.steps.js.

The comparison figures come from the BE Givens (be/*/steps/givens.py, loaded
as plugins by the domain conftest): the FE branch checks the screen against
what the BE branch already reads.
"""

from __future__ import annotations

from pytest_bdd import given, parsers, scenarios, then

from be.api.venues import gmx as venue
from fe.ui.pages.trading import ScreenNotReady, TradingPage
from qa_core.recorder import relative_gap

scenarios("fe-trading-screen.feature")

UNREACHABLE = (ScreenNotReady,)


@given("the trading screen is open")
def trading_screen_open(page, qa):
    page.set_viewport_size({"width": 1600, "height": 1000})
    qa.trading = TradingPage(page)
    qa.fetch_or_block(UNREACHABLE, qa.trading.open)


@given(parsers.parse('the screen shows the "{pair}" market'))
def screen_shows_market(qa, pair):
    def fetch():
        qa.trading.select_market(pair)
        qa.screen = qa.trading.read_header()
        s = qa.screen
        qa.evidence("screen", {"pair": s["pair"], "pool": s["pool"], "price": s["price"],
                               "oiLong": s["oiLong"], "oiShort": s["oiShort"], "oiSplit": s["oiSplit"], "raw": s["raw"]})
    qa.fetch_or_block(UNREACHABLE, fetch)


# ---------------------------------------------------------------- Then


@then(parsers.parse("the price on screen is within {pct:g} percent of the ticker price"))
def price_vs_ticker(qa, pct):
    def evaluate():
        s = qa.screen["price"]["value"]
        t = (qa.api["ticker"]["minPriceUsd"] + qa.api["ticker"]["maxPriceUsd"]) / 2
        gap = relative_gap(s, t)
        return (gap <= pct / 100, f"screen ${s}, ticker ${t:.4f}, gap {gap * 100:.4f}%")
    qa.observe(f"screen price within {pct}% of ticker", evaluate)


def _oi_check(qa, side: str):
    """Screen OI is interest-in-tokens x current price (measured; see the Node
    step for the figures). Tolerance: the screen's display unit + 2 %."""
    symbol = qa.api["symbol"]
    decimals = venue.MARKETS_UNDER_TEST[symbol]["decimals"]
    tokens_raw = qa.api["values"]["longInterestInTokens" if side == "long" else "shortInterestInTokens"]
    tokens = int(tokens_raw) / 10 ** decimals
    price = (qa.api["ticker"]["minPriceUsd"] + qa.api["ticker"]["maxPriceUsd"]) / 2
    expected = tokens * price
    shown = qa.screen["oiLong" if side == "long" else "oiShort"]
    tolerance = shown["unit"] + expected * 0.02
    diff = abs(shown["value"] - expected)
    qa.evidence("oi_" + side, {"shownUsd": shown["value"], "displayUnit": shown["unit"], "tokens": tokens,
                               "price": price, "expectedUsd": expected, "diffUsd": diff})
    return (diff <= tolerance,
            f"screen ${shown['value']} (shown to ${shown['unit']}), {tokens:.3f} tokens x ${price:.2f} = ${expected:.0f}, "
            f"diff ${diff:.0f}, tolerance ${tolerance:.0f}")


@then("the long open interest on screen equals long interest in tokens times the ticker price")
def long_oi_on_screen(qa):
    qa.observe("screen long OI == longInterestInTokens x price", lambda: _oi_check(qa, "long"))


@then("the short open interest on screen equals short interest in tokens times the ticker price")
def short_oi_on_screen(qa):
    qa.observe("screen short OI == shortInterestInTokens x price", lambda: _oi_check(qa, "short"))


@then("the long percentage on screen matches long over long plus short")
def oi_split_consistent(qa):
    def evaluate():
        lo, sh, split = qa.screen["oiLong"], qa.screen["oiShort"], qa.screen["oiSplit"]
        total = lo["value"] + sh["value"]
        derived = 0 if total == 0 else lo["value"] / total * 100
        slack = 100 if total == 0 else (lo["unit"] + sh["unit"]) / total * 100 + 0.5
        diff = abs(split["long"] - derived)
        return (diff <= slack, f"screen {split['long']}%, derived {derived:.2f}% from ${lo['value']} / ${sh['value']}, slack {slack:.2f} pts")
    qa.observe("screen L% == long / (long + short)", evaluate)


@then(parsers.parse("the price on screen is within {pct:g} percent of the on-chain maximum price"))
def price_vs_chain(qa, pct):
    def evaluate():
        s = qa.screen["price"]["value"]
        c = qa.chain["maxPriceUsd"]
        gap = relative_gap(s, c)
        return (gap <= pct / 100, f"screen ${s}, chain ${c:.4f}, gap {gap * 100:.4f}%")
    qa.observe(f"screen price within {pct}% of Vault.getMaxPrice", evaluate)

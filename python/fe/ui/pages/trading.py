"""The live DEX trading screen, read by LABEL.

Mirror of ``node/fe/ui/pages/trading.js`` -- see there for why labels, why
readiness is "a label with a number", and why the market is chosen through
the dropdown rather than the URL.
"""

from __future__ import annotations

import re
import time

URL = "https://app.gmx.io/#/trade"


class ScreenNotReady(Exception):
    """The screen did not load, or never filled in the labelled figure."""


def parse_money(text: str) -> dict | None:
    """'$ 6.0m' -> {value: 6000000, unit: 100000}; '$ 2,522.99' -> {2522.99, 0.01}."""
    m = re.match(r"^([-+]?\d+(?:\.\d+)?)([kmb])?$", re.sub(r"[$,\s]", "", str(text)), re.I)
    if not m:
        return None
    n = float(m.group(1))
    mult = {"k": 1e3, "m": 1e6, "b": 1e9}.get((m.group(2) or "").lower(), 1)
    decimals = len(m.group(1).split(".")[1]) if "." in m.group(1) else 0
    return {"value": n * mult, "unit": mult / 10 ** decimals}


def parse_percent(text: str) -> float | None:
    """'- 0.0010%' -> -0.000010 (a fraction)."""
    m = re.match(r"^([-+])?(\d+(?:\.\d+)?)%$", re.sub(r"\s", "", str(text)))
    if not m:
        return None
    return (-1 if m.group(1) == "-" else 1) * float(m.group(2)) / 100


def parse_split(text: str) -> dict | None:
    m = re.search(r"\((\d+)%/(\d+)%\)", str(text))
    return {"long": int(m.group(1)), "short": int(m.group(2))} if m else None


def _body_lines(page) -> list[str]:
    return page.evaluate("() => document.body.innerText.split('\\n').map(s => s.trim()).filter(Boolean)")


class TradingPage:
    def __init__(self, page) -> None:
        self.page = page

    def open(self) -> None:
        try:
            self.page.goto(URL, wait_until="domcontentloaded", timeout=60_000)
        except Exception as err:  # playwright raises its own Error subclasses
            raise ScreenNotReady(f"could not open {URL} -- {str(err).splitlines()[0]}") from err

    def select_market(self, pair: str, attempts: int = 3) -> None:
        """Choose a market through the pair dropdown, then wait for its header.

        The app re-renders the header while prices stream in, so a click can
        land on a node that was just replaced. Three attempts; any interaction
        failure is ScreenNotReady -- a dropdown that would not open has not
        shown a wrong number.
        """
        last_err: Exception | None = None
        for _ in range(attempts):
            try:
                self.wait_for_header()
                current = self.read_header()
                if current["pair"] == pair:
                    return
                self.page.get_by_text(re.compile("^" + re.escape(current["pair"]) + "$")).first.click(timeout=15_000)
                self.page.get_by_text(re.compile("^" + re.escape(pair) + "$")).first.click(timeout=15_000)
                self.wait_for_header(pair)
                return
            except ScreenNotReady:
                raise
            except Exception as err:  # playwright's own error classes
                last_err = err
                try:
                    self.page.keyboard.press("Escape")
                except Exception:
                    pass
                self.page.wait_for_timeout(1_500)
        raise ScreenNotReady(
            f"could not select market {pair} after {attempts} attempts -- {str(last_err).splitlines()[0]}"
        )

    def wait_for_header(self, pair: str | None = None, timeout_s: float = 60) -> None:
        started = time.monotonic()
        while time.monotonic() - started < timeout_s:
            lines = _body_lines(self.page)
            i = next((k for k, l in enumerate(lines) if re.match(r"^24H VOLUME$", l, re.I)), -1)
            pair_line = next((l for l in reversed(lines[:i]) if l.endswith("/USD")), None) if i > 0 else None
            if i > 0 and re.search(r"\d", lines[i + 1] if i + 1 < len(lines) else "") and (not pair or pair_line == pair):
                return
            self.page.wait_for_timeout(1_000)
        raise ScreenNotReady(
            "the trading header never showed a 24H VOLUME figure"
            + (f" for {pair}" if pair else "") + f" within {timeout_s:.0f}s"
        )

    def read_header(self) -> dict:
        lines = _body_lines(self.page)
        i_vol = next((k for k, l in enumerate(lines) if re.match(r"^24H VOLUME$", l, re.I)), -1)
        if i_vol < 0:
            raise ScreenNotReady("no 24H VOLUME label on the page")

        before = lines[max(0, i_vol - 6):i_vol]
        pair = next((l for l in reversed(before) if l.endswith("/USD")), None)
        pool = next((l for l in before if re.match(r"^\[.+\]$", l)), None)
        price_text = next((l for l in before if re.match(r"^\$\s?[\d,]+(\.\d+)?$", l)), None)
        change_text = next((l for l in before if re.match(r"^[-+]?\d+(\.\d+)?%$", l)), None)

        i_oi = next((k for k, l in enumerate(lines) if k > i_vol and re.match(r"^OPEN INTEREST", l, re.I)), -1)
        i_rate = next((k for k, l in enumerate(lines) if k > i_vol and re.match(r"^NET RATE", l, re.I)), -1)
        if i_oi < 0 or i_rate < 0:
            raise ScreenNotReady("header is missing OPEN INTEREST or NET RATE")

        return {
            "pair": pair,
            "pool": pool,
            "price": parse_money(price_text) if price_text else None,
            "change": parse_percent(change_text) if change_text else None,
            "volume24h": parse_money(lines[i_vol + 1]),
            "oiSplit": parse_split(lines[i_oi]),
            "oiLong": parse_money(lines[i_oi + 1]),
            "oiShort": parse_money(lines[i_oi + 3]),
            "netRateLong": parse_percent(lines[i_rate + 1]),
            "netRateShort": parse_percent(lines[i_rate + 3]),
            "raw": lines[i_vol - 4:i_rate + 4],
        }

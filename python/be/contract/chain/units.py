"""Decimal strings to contract units, exactly -- never via a float.
Mirror of node/be/contract/chain/units.js."""

from __future__ import annotations

import re
from decimal import Decimal


def to_units(text, decimals: int) -> int:
    s = str(text).strip().replace("$", "").replace(",", "").replace(" ", "")
    m = re.match(r"^(-)?(\d+)(?:\.(\d+))?$", s)
    if not m:
        # pytest-bdd hands floats for {float}; render them exactly through Decimal
        d = Decimal(str(text))
        s = format(d, "f")
        m = re.match(r"^(-)?(\d+)(?:\.(\d+))?$", s)
        if not m:
            raise ValueError("not a decimal: " + str(text))
    frac = (m.group(3) or "").ljust(decimals, "0")
    if len(frac) > decimals:
        raise ValueError(f"{text} has more than {decimals} decimals")
    n = int(m.group(2) + frac)
    return -n if m.group(1) else n


def from_units(n: int, decimals: int) -> str:
    neg = n < 0
    s = str(-n if neg else n).rjust(decimals + 1, "0")
    int_part = s[: len(s) - decimals]
    frac = s[len(s) - decimals :].rstrip("0")
    return ("-" if neg else "") + int_part + ("." + frac if frac else "")


def price(t) -> int:
    return to_units(t, 8)


def size(t) -> int:
    return to_units(t, 8)


def usd(t) -> int:
    return to_units(t, 6)


def show_price(n: int) -> str:
    return from_units(n, 8)


def show_size(n: int) -> str:
    return from_units(n, 8)


def show_usd(n: int) -> str:
    return from_units(n, 6)


def notional(size_units: int, price_units: int) -> int:
    return (size_units * price_units) // 10_000_000_000

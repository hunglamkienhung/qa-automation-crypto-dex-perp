"""Expanded contract invariants for the live GMX v1 Vault (features 265-281).
Mirror of node/be/contract/steps/gmx-extra.steps.js -- a plugin module.

The per-token invariants read every whitelisted token (~140 sequential
eth_calls); the enumeration is memoised for the process so the token scenarios
pay for it once. Only whitelisted tokens have a live price feed -- getMinPrice
reverts for a de-listed entry -- so per-token Vault state is read only for the
live ones. A memoised fetch never caches a failure.
"""

from __future__ import annotations

from pytest_bdd import parsers, then

from be.contract.chain import gmx
from be.contract.chain.ethcall import ChainUnreachable

_memo: dict = {"config": None, "tokens": None}


def _load_config():
    if _memo["config"] is None:
        _memo["config"] = gmx.global_config()
    return _memo["config"]


def _load_tokens():
    if _memo["tokens"] is None:
        out = []
        for t in gmx.whitelist():
            if t["whitelisted"]:
                out.append({**t, **gmx.token_reads(t["address"]), "hasReads": True})
            else:
                out.append({**t, "hasReads": False})
        _memo["tokens"] = out
    return _memo["tokens"]


def _with_data(qa, description, load, fn):
    if qa.source_error:
        qa.unobservable(description, "the source could not be reached -- " + qa.source_error)
        return
    try:
        data = load()
    except ChainUnreachable as err:
        qa.unobservable(description, str(err))
        return
    passed, detail = fn(data)
    qa.check(description, passed, detail)


def _whitelisted(tokens):
    return [t for t in tokens if t["whitelisted"]]


# ---------------------------------------------------------------- config invariants


@then("the whitelisted token count matches the array's whitelisted entries")
def whitelisted_count_matches(qa):
    if qa.source_error:
        qa.unobservable("whitelistedTokenCount == array whitelisted entries", "the source could not be reached -- " + qa.source_error)
        return
    try:
        cfg, tokens = _load_config(), _load_tokens()
    except ChainUnreachable as err:
        qa.unobservable("whitelistedTokenCount == array whitelisted entries", str(err))
        return
    counted = len(_whitelisted(tokens))
    qa.check("whitelistedTokenCount() equals the count of whitelisted array entries", cfg["whitelistedTokenCount"] == counted, f"count() {cfg['whitelistedTokenCount']}, array {counted}")


@then("the swap fee is at least the stable swap fee")
def swap_fee_ge_stable(qa):
    _with_data(qa, "swapFeeBasisPoints >= stableSwapFeeBasisPoints", _load_config,
               lambda c: (c["swapBps"] >= c["stableSwapBps"], f"swap {c['swapBps']} bps, stable swap {c['stableSwapBps']} bps"))


@then(parsers.parse("the core basis-point fees are each at most {cap:d} basis points"))
def core_fees_bounded(qa, cap):
    def ev(c):
        over = [(k, v) for k, v in {"tax": c["taxBps"], "stableTax": c["stableTaxBps"], "mintBurn": c["mintBurnBps"], "swap": c["swapBps"], "stableSwap": c["stableSwapBps"]}.items() if v > cap]
        return (not over, ", ".join(f"{k} {v}" for k, v in over) if over else f"all within {cap} bps")
    _with_data(qa, f"core fees within {cap} bps", _load_config, ev)


@then("the funding interval is exactly one hour")
def funding_interval_hour(qa):
    _with_data(qa, "fundingInterval == 3600", _load_config, lambda c: (c["fundingInterval"] == 3600, f"fundingInterval {c['fundingInterval']}s"))


@then("the minimum profit time is positive and at most one day")
def min_profit_time(qa):
    _with_data(qa, "0 < minProfitTime <= 86400", _load_config, lambda c: (0 < c["minProfitTime"] <= 86400, f"minProfitTime {c['minProfitTime']}s"))


@then("dynamic fees are enabled")
def dynamic_fees(qa):
    _with_data(qa, "hasDynamicFees == true", _load_config, lambda c: (c["hasDynamicFees"] == 1, f"hasDynamicFees {c['hasDynamicFees']}"))


@then(parsers.parse("the liquidation fee is positive and at most ${cap:d}"))
def liquidation_fee_bounded(qa, cap):
    def ev(c):
        usd = c["liquidationFeeUsd"] / 1e30
        return (c["liquidationFeeUsd"] > 0 and usd <= cap, f"${usd:.2f}")
    _with_data(qa, f"0 < liquidationFeeUsd <= ${cap}", _load_config, ev)


@then(parsers.parse("both funding rate factors are positive and at most {cap:d}"))
def funding_factors_bounded(qa, cap):
    _with_data(qa, f"0 < funding rate factors <= {cap}", _load_config,
               lambda c: (0 < c["fundingRateFactor"] <= cap and 0 < c["stableFundingRateFactor"] <= cap, f"factor {c['fundingRateFactor']}, stable {c['stableFundingRateFactor']}"))


@then(parsers.parse("the cached total token weight is {n:d}"))
def cached_total_weight(qa, n):
    _with_data(qa, f"totalTokenWeights == {n}", _load_config, lambda c: (c["totalTokenWeights"] == n, f"totalTokenWeights {c['totalTokenWeights']}"))


# ---------------------------------------------------------------- per-token invariants


@then("every whitelisted token reserves no more than its pool")
def every_reserved_le_pool(qa):
    def ev(tokens):
        bad = [t for t in _whitelisted(tokens) if t["reservedAmount"] > t["poolAmount"]]
        return (not bad, ", ".join(t["address"] for t in bad) if bad else f"{len(_whitelisted(tokens))} tokens within pool")
    _with_data(qa, "reserved <= pool, every whitelisted token", _load_tokens, ev)


@then("every whitelisted token has a minimum price at most its maximum, both above zero")
def every_ordered_price(qa):
    def ev(tokens):
        bad = [t for t in _whitelisted(tokens) if not (t["minPrice"] > 0 and t["minPrice"] <= t["maxPrice"])]
        return (not bad, ", ".join(t["address"] for t in bad) if bad else f"{len(_whitelisted(tokens))} tokens ordered and positive")
    _with_data(qa, "min<=max>0, every whitelisted token", _load_tokens, ev)


@then("every whitelisted token has positive decimals")
def every_positive_decimals(qa):
    def ev(tokens):
        bad = [t for t in _whitelisted(tokens) if t["decimals"] <= 0]
        return (not bad, ", ".join(t["address"] for t in bad) if bad else f"{len(_whitelisted(tokens))} tokens have decimals")
    _with_data(qa, "decimals > 0, every whitelisted token", _load_tokens, ev)


@then("every whitelisted token carries a positive weight and every de-listed entry carries none")
def weight_tracks_whitelisting(qa):
    def ev(tokens):
        bad = [t for t in tokens if (t["weight"] <= 0 if t["whitelisted"] else t["weight"] != 0)]
        return (not bad, ", ".join(f"{t['address']} whitelisted={t['whitelisted']} weight={t['weight']}" for t in bad) if bad else f"{len(tokens)} entries consistent")
    _with_data(qa, "weight tracks whitelisting", _load_tokens, ev)


@then("every token's non-zero short interest has a non-zero average price")
def every_short_has_average(qa):
    def ev(tokens):
        priced = _whitelisted(tokens)
        bad = [t for t in priced if t["globalShortSize"] > 0 and t["globalShortAveragePrice"] == 0]
        return (not bad, ", ".join(t["address"] for t in bad) if bad else f"{len(priced)} tokens consistent")
    _with_data(qa, "short size 0 or avg price > 0, every token", _load_tokens, ev)


@then("every whitelisted token holds a positive pool amount")
def every_positive_pool(qa):
    def ev(tokens):
        bad = [t for t in _whitelisted(tokens) if t["poolAmount"] <= 0]
        return (not bad, ", ".join(f"{t['address']} pool=0" for t in bad) if bad else f"{len(_whitelisted(tokens))} tokens funded")
    _with_data(qa, "poolAmount > 0, every whitelisted token", _load_tokens, ev)


@then("every stable token is flagged, carries a positive weight, and holds zero guaranteed USD")
def stablecoins_consistent(qa):
    def ev(tokens):
        stables = [t for t in _whitelisted(tokens) if t["stable"]]
        bad = [t for t in stables if not (t["weight"] > 0 and t["guaranteedUsd"] == 0)]
        return (len(stables) > 0 and not bad, ", ".join(f"{t['address']} weight={t['weight']} guaranteedUsd={t['guaranteedUsd']}" for t in bad) if bad else f"{len(stables)} stablecoins consistent")
    _with_data(qa, "stablecoins weighted, flagged, zero guaranteed USD", _load_tokens, ev)


@then("every token's cumulative funding rate is non-negative")
def every_cumulative_funding_nonneg(qa):
    def ev(tokens):
        priced = _whitelisted(tokens)
        bad = [t for t in priced if t["cumulativeFundingRate"] < 0]
        return (not bad, ", ".join(t["address"] for t in bad) if bad else f"{len(priced)} tokens non-negative")
    _with_data(qa, "cumulativeFundingRate >= 0, every token", _load_tokens, ev)

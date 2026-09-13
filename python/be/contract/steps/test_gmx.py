"""The contract tier: read-only eth_call against a live perpetuals protocol.

Binds ../../features/be-contract-gmx.feature. No browser, no wallet, no key, no gas.

Values are compared as Python integers wherever the comparison decides the
verdict. The scaled numbers in failure messages exist only so a human can read
"$2528.31" instead of thirty-three digits; comparing the floats instead would
silently lose the precision the assertion depends on.

Mirror of node/be/contract/steps/gmx.steps.js.
"""

from __future__ import annotations

import time

from pytest_bdd import parsers, scenarios, then

from be.contract.chain import gmx
from be.contract.chain.ethcall import ChainUnreachable, call_uint

scenarios("be-contract-gmx.feature")

UNREACHABLE = (ChainUnreachable,)


# ---------------------------------------------------------------- Then


@then("the reserved amount does not exceed the pool amount")
def reserved_within_pool(qa):
    def evaluate():
        pool = qa.chain["poolAmount"]
        reserved = qa.chain["reservedAmount"]
        scale = 10 ** qa.chain["decimals"]
        # Utilisation is reported because on a fully-reserved pool this
        # assertion sits right at its boundary, and a reader deserves to see it.
        utilisation = 0.0 if pool == 0 else reserved / pool * 100
        return (
            reserved <= pool,
            f"pool {pool / scale:.6f}, reserved {reserved / scale:.6f} "
            f"({utilisation:.4f}% utilised)",
        )

    qa.observe("reservedAmount <= poolAmount", evaluate)


@then("the minimum price does not exceed the maximum price")
def spread_not_inverted(qa):
    def evaluate():
        c = qa.chain
        return (
            c["minPrice"] <= c["maxPrice"],
            f'min ${c["minPriceUsd"]:.2f}, max ${c["maxPriceUsd"]:.2f}',
        )

    qa.observe("getMinPrice <= getMaxPrice", evaluate)


@then("the whitelisted token weights sum to the cached total")
def weights_sum_to_total(qa):
    result = qa.fetch_or_block(UNREACHABLE, gmx.whitelisted_weights)

    def evaluate():
        qa.evidence("tokensCounted", result["counted"])
        qa.evidence("weightSum", result["sum"])
        qa.evidence("totalTokenWeights", result["cached"])
        return (
            result["sum"] == result["cached"],
            f'summed {result["sum"]} over {result["counted"]} whitelisted tokens, '
            f'cached total {result["cached"]}',
        )

    qa.observe("the whitelisted token weights sum to totalTokenWeights()", evaluate)


@then(parsers.parse("the maximum leverage is between {low:d} and {high:d} times"))
def max_leverage_in_band(qa, low, high):
    def fetch():
        if qa.chain_config is None:
            qa.chain_config = gmx.config()

    qa.fetch_or_block(UNREACHABLE, fetch)

    def evaluate():
        x = qa.chain_config["maxLeverageX"]
        qa.evidence("maxLeverageX", x)
        return low <= x <= high, f"maxLeverage() reports {x}x"

    qa.observe(f"max leverage is between {low}x and {high}x", evaluate)


@then("the implied initial margin is above zero")
def initial_margin_above_zero(qa):
    def evaluate():
        x = qa.chain_config["maxLeverageX"] if qa.chain_config else 0
        margin_pct = 100 / x if x > 0 else 0
        return margin_pct > 0, f"1 / {x}x = {margin_pct:.3f}%"

    qa.observe("initial margin implied by max leverage is above zero", evaluate)


@then(parsers.parse("the margin fee is at most {cap:d} basis points"))
def margin_fee_bounded(qa, cap):
    def fetch():
        if qa.chain_config is None:
            qa.chain_config = gmx.config()

    qa.fetch_or_block(UNREACHABLE, fetch)

    def evaluate():
        bps = qa.chain_config["marginFeeBps"]
        qa.evidence("marginFeeBps", bps)
        return bps <= cap, f"{bps} bps ({bps / 100}%), cap {cap} bps"

    qa.observe(f"marginFeeBasisPoints <= {cap}", evaluate)


@then("the last funding time is not in the future")
def funding_not_in_future(qa):
    def evaluate():
        now = int(time.time())
        t = qa.funding["lastFundingTime"]
        return t <= now, f"lastFundingTime {t}, now {now}"

    qa.observe("lastFundingTime is not in the future", evaluate)


@then("the last funding time lands on a funding interval boundary")
def funding_on_boundary(qa):
    """Note what this does NOT assert: that funding is recent.

    It is the obvious assertion and it would be the wrong one. This protocol
    advances funding when someone interacts with the market, so on a quiet
    market the timestamp is simply old -- measured here at over a hundred days.
    That is market activity, not protocol correctness, and a suite that failed
    on it would be reporting "nobody traded" as a defect.

    Landing on an interval boundary is a correctness property: it is how the
    contract computes the value, and it holds whether the market is busy or
    asleep. The age is still reported, because a reader should see it.
    """
    def evaluate():
        last = qa.funding["lastFundingTime"]
        interval = qa.funding["fundingInterval"]
        age_days = (int(time.time()) - last) / 86400
        remainder = 1 if interval == 0 else last % interval
        return (
            remainder == 0,
            f"lastFundingTime {last} mod {interval} = {remainder} "
            f"(market last advanced {age_days:.1f} days ago -- reported, not asserted)",
        )

    qa.observe("lastFundingTime is a whole multiple of fundingInterval", evaluate)


@then(parsers.parse('the "{symbol}" token is whitelisted'))
def token_whitelisted(qa, symbol):
    value = qa.fetch_or_block(
        UNREACHABLE,
        lambda: call_uint(gmx.VAULT, "whitelistedTokens(address)", [gmx.TOKENS[symbol]["address"]]),
    )
    qa.observe(f"{symbol} is whitelisted",
            lambda: (value == 1, f"whitelistedTokens() returned {value}"))


@then(parsers.parse('the "{symbol}" token is not marked as a stablecoin'))
def token_not_stable(qa, symbol):
    value = qa.fetch_or_block(
        UNREACHABLE,
        lambda: call_uint(gmx.VAULT, "stableTokens(address)", [gmx.TOKENS[symbol]["address"]]),
    )
    qa.observe(f"{symbol} is not a stablecoin",
            lambda: (value == 0, f"stableTokens() returned {value}"))


@then("a non-zero short open interest has a non-zero average price")
def short_oi_has_average_price(qa):
    def evaluate():
        size = qa.chain["globalShortSize"]
        average = qa.chain["globalShortAveragePrice"]
        qa.evidence("globalShortSizeUsd", round(size / 1e30, 0))
        qa.evidence("globalShortAveragePriceUsd", round(average / 1e30, 2))
        return (
            size == 0 or average > 0,
            f"short OI ${size / 1e30:.0f}, average entry ${average / 1e30:.2f}",
        )

    qa.observe("a non-zero short size implies a non-zero average entry price", evaluate)

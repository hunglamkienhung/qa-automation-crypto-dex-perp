"""Protocol adapter: GMX v1 Vault on Arbitrum, read-only.

The same seam the venue adapter uses -- one normalised shape in front of one
protocol's particular getters, so the assertions are about perpetuals rather
than about GMX.

Units, which are where on-chain reads usually go wrong
------------------------------------------------------
These are not incidental. Getting one wrong produces a number that is off by
twelve orders of magnitude and still looks like a number.

    USD values      30 decimals   $5 is 5_000000000000000000000000000000
    token amounts   the token's own decimals (WETH: 18)
    basis points    10000 = 100%  margin_fee_bps 10 means 0.1%
    leverage        10000 = 1x    max_leverage 1000000 means 100x

Declared once here rather than spelled out at each call site where one of them
can quietly drift. Mirror of node/src/chain/gmx.js.
"""

from __future__ import annotations

from be.contract.chain.ethcall import ChainUnreachable, call, call_uint, chain_id

ARBITRUM_CHAIN_ID = 42161

VAULT = "0x489ee077994B6658eAfA855C308275EAd8097C4A"

TOKENS = {
    "WETH": {"address": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", "decimals": 18, "symbol": "ETH"},
    "WBTC": {"address": "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", "decimals": 8, "symbol": "BTC"},
}

USD_DECIMALS = 30
BASIS_POINTS_DIVISOR = 10000

NAME = "gmx-v1-arbitrum"


def config() -> dict:
    """Global protocol parameters."""
    max_leverage_raw = call_uint(VAULT, "maxLeverage()")
    return {
        "protocol": NAME,
        "maxLeverageRaw": max_leverage_raw,
        "maxLeverageX": max_leverage_raw / BASIS_POINTS_DIVISOR,
        "liquidationFeeUsd": call_uint(VAULT, "liquidationFeeUsd()"),
        "marginFeeBps": call_uint(VAULT, "marginFeeBasisPoints()"),
        "fundingRateFactor": call_uint(VAULT, "fundingRateFactor()"),
        "stableFundingRateFactor": call_uint(VAULT, "stableFundingRateFactor()"),
    }


def market_state(symbol: str) -> dict:
    """Per-token pool state and oracle prices."""
    token = TOKENS.get(symbol)
    if token is None:
        raise ValueError(f"unknown token {symbol}; known: {', '.join(TOKENS)}")

    address = token["address"]
    min_price = call_uint(VAULT, "getMinPrice(address)", [address])
    max_price = call_uint(VAULT, "getMaxPrice(address)", [address])

    return {
        "protocol": NAME,
        "symbol": token["symbol"],
        "token": address,
        "decimals": token["decimals"],
        "poolAmount": call_uint(VAULT, "poolAmounts(address)", [address]),
        "reservedAmount": call_uint(VAULT, "reservedAmounts(address)", [address]),
        "minPrice": min_price,
        "maxPrice": max_price,
        "globalShortSize": call_uint(VAULT, "globalShortSizes(address)", [address]),
        # maxGlobalShortSizes lives on the PositionManager, not the Vault --
        # calling it here reverts. Confirmed by probing every getter
        # individually rather than assuming the ABI.
        "globalShortAveragePrice": call_uint(VAULT, "globalShortAveragePrices(address)", [address]),
        # Convenience for messages and cross-source comparison. Equality is
        # always decided on the integers above, never on these.
        "minPriceUsd": min_price / 10 ** USD_DECIMALS,
        "maxPriceUsd": max_price / 10 ** USD_DECIMALS,
    }


def funding_state(symbol: str) -> dict:
    address = TOKENS[symbol]["address"]
    return {
        "lastFundingTime": call_uint(VAULT, "lastFundingTimes(address)", [address]),
        "fundingInterval": call_uint(VAULT, "fundingInterval()"),
    }


def whitelisted_weights() -> dict:
    """Enumerate every listed token and sum the weights of the live ones."""
    length = call_uint(VAULT, "allWhitelistedTokensLength()")
    total = 0
    counted = 0

    for index in range(length):
        address = "0x" + call(VAULT, "allWhitelistedTokens(uint256)", [index])[-40:]
        # A de-listed token keeps its entry in the array with weight zero; only
        # the currently whitelisted ones are counted into the cached total.
        if call_uint(VAULT, "whitelistedTokens(address)", [address]) == 1:
            total += call_uint(VAULT, "tokenWeights(address)", [address])
            counted += 1

    return {"sum": total, "counted": counted, "cached": call_uint(VAULT, "totalTokenWeights()")}


def global_config() -> dict:
    """The extra global parameters the expanded config invariants read."""
    return {
        "totalTokenWeights": call_uint(VAULT, "totalTokenWeights()"),
        "whitelistedTokenCount": call_uint(VAULT, "whitelistedTokenCount()"),
        "taxBps": call_uint(VAULT, "taxBasisPoints()"),
        "stableTaxBps": call_uint(VAULT, "stableTaxBasisPoints()"),
        "mintBurnBps": call_uint(VAULT, "mintBurnFeeBasisPoints()"),
        "swapBps": call_uint(VAULT, "swapFeeBasisPoints()"),
        "stableSwapBps": call_uint(VAULT, "stableSwapFeeBasisPoints()"),
        "minProfitTime": call_uint(VAULT, "minProfitTime()"),
        "fundingInterval": call_uint(VAULT, "fundingInterval()"),
        "hasDynamicFees": call_uint(VAULT, "hasDynamicFees()"),
        "fundingRateFactor": call_uint(VAULT, "fundingRateFactor()"),
        "stableFundingRateFactor": call_uint(VAULT, "stableFundingRateFactor()"),
        "marginFeeBps": call_uint(VAULT, "marginFeeBasisPoints()"),
        "liquidationFeeUsd": call_uint(VAULT, "liquidationFeeUsd()"),
        "maxLeverageRaw": call_uint(VAULT, "maxLeverage()"),
    }


def whitelist() -> list[dict]:
    """Enumerate the whitelisted-token array with the per-token flags the aggregate invariants need."""
    length = call_uint(VAULT, "allWhitelistedTokensLength()")
    out = []
    for index in range(length):
        address = "0x" + call(VAULT, "allWhitelistedTokens(uint256)", [index])[-40:]
        out.append({
            "index": index,
            "address": address,
            "decimals": call_uint(VAULT, "tokenDecimals(address)", [address]),
            "stable": call_uint(VAULT, "stableTokens(address)", [address]) == 1,
            "whitelisted": call_uint(VAULT, "whitelistedTokens(address)", [address]) == 1,
            "weight": call_uint(VAULT, "tokenWeights(address)", [address]),
        })
    return out


def token_reads(address: str) -> dict:
    """The per-token Vault state the aggregate invariants read, for one token."""
    return {
        "address": address,
        "poolAmount": call_uint(VAULT, "poolAmounts(address)", [address]),
        "reservedAmount": call_uint(VAULT, "reservedAmounts(address)", [address]),
        "bufferAmount": call_uint(VAULT, "bufferAmounts(address)", [address]),
        "minPrice": call_uint(VAULT, "getMinPrice(address)", [address]),
        "maxPrice": call_uint(VAULT, "getMaxPrice(address)", [address]),
        "globalShortSize": call_uint(VAULT, "globalShortSizes(address)", [address]),
        "globalShortAveragePrice": call_uint(VAULT, "globalShortAveragePrices(address)", [address]),
        "guaranteedUsd": call_uint(VAULT, "guaranteedUsd(address)", [address]),
        "cumulativeFundingRate": call_uint(VAULT, "cumulativeFundingRates(address)", [address]),
        "usdgAmount": call_uint(VAULT, "usdgAmounts(address)", [address]),
    }


def verify_chain() -> int:
    """Confirm the RPC is actually pointed at Arbitrum before trusting any read."""
    found = chain_id()
    if found != ARBITRUM_CHAIN_ID:
        raise RuntimeError(
            f"RPC reports chain {found}, expected {ARBITRUM_CHAIN_ID} (Arbitrum One). "
            "Every address in this adapter is chain-specific; reading them on "
            "another chain returns whatever happens to live at that address, "
            "which is worse than an error because it looks like data."
        )
    return found


__all__ = [
    "NAME", "VAULT", "TOKENS", "USD_DECIMALS", "BASIS_POINTS_DIVISOR", "ARBITRUM_CHAIN_ID",
    "config", "market_state", "funding_state", "whitelisted_weights", "verify_chain",
    "global_config", "whitelist", "token_reads",
    "ChainUnreachable",
]

'use strict';

const { call, callUint, words, chainId, ChainUnreachable } = require('./ethcall');

/**
 * Protocol adapter: GMX v1 Vault on Arbitrum, read-only.
 *
 * The same seam the venue adapter uses -- one normalised shape in front of one
 * protocol's particular getters, so the assertions are about perpetuals rather
 * than about GMX.
 *
 * Units, which are where on-chain reads usually go wrong
 * ------------------------------------------------------
 * These are not incidental. Getting one wrong produces a number that is off by
 * twelve orders of magnitude and still looks like a number.
 *
 *   USD values        30 decimals   $5 is 5_000000000000000000000000000000
 *   token amounts     the token's own decimals (WETH: 18)
 *   basis points      10000 = 100%  marginFeeBasisPoints 10 means 0.1%
 *   leverage          10000 = 1x    maxLeverage 1000000 means 100x
 *
 * They are declared once here and used everywhere, rather than being spelled
 * out again at each call site where one of them can quietly drift.
 */

const ARBITRUM_CHAIN_ID = 42161;

const VAULT = '0x489ee077994B6658eAfA855C308275EAd8097C4A';

const TOKENS = {
  WETH: { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18, symbol: 'ETH' },
  WBTC: { address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', decimals: 8, symbol: 'BTC' },
};

const USD_DECIMALS = 30;
const BASIS_POINTS_DIVISOR = 10000n;

const NAME = 'gmx-v1-arbitrum';

/** Global protocol parameters. */
async function config() {
  const [maxLeverageRaw, liquidationFeeUsd, marginFeeBps, fundingRateFactor, stableFundingRateFactor] =
    await Promise.all([
      callUint(VAULT, 'maxLeverage()'),
      callUint(VAULT, 'liquidationFeeUsd()'),
      callUint(VAULT, 'marginFeeBasisPoints()'),
      callUint(VAULT, 'fundingRateFactor()'),
      callUint(VAULT, 'stableFundingRateFactor()'),
    ]);

  return {
    protocol: NAME,
    maxLeverageRaw,
    maxLeverageX: Number(maxLeverageRaw) / Number(BASIS_POINTS_DIVISOR),
    liquidationFeeUsd,
    marginFeeBps,
    fundingRateFactor,
    stableFundingRateFactor,
  };
}

/** Per-token pool state and oracle prices. */
async function marketState(symbol) {
  const token = TOKENS[symbol];
  if (!token) throw new Error(`unknown token ${symbol}; known: ${Object.keys(TOKENS).join(', ')}`);

  const [poolAmount, reservedAmount, minPrice, maxPrice, globalShortSize, globalShortAveragePrice] =
    await Promise.all([
      callUint(VAULT, 'poolAmounts(address)', [token.address]),
      callUint(VAULT, 'reservedAmounts(address)', [token.address]),
      callUint(VAULT, 'getMinPrice(address)', [token.address]),
      callUint(VAULT, 'getMaxPrice(address)', [token.address]),
      callUint(VAULT, 'globalShortSizes(address)', [token.address]),
      // maxGlobalShortSizes lives on the PositionManager, not the Vault -- calling
      // it here reverts. Confirmed by probing every getter individually rather
      // than assuming the ABI.
      callUint(VAULT, 'globalShortAveragePrices(address)', [token.address]),
    ]);

  return {
    protocol: NAME,
    symbol: token.symbol,
    token: token.address,
    decimals: token.decimals,
    poolAmount,
    reservedAmount,
    minPrice,
    maxPrice,
    globalShortSize,
    globalShortAveragePrice,
    // Convenience for messages and for cross-source comparison. Equality is
    // always decided on the BigInt values above, never on these.
    minPriceUsd: Number(minPrice) / 10 ** USD_DECIMALS,
    maxPriceUsd: Number(maxPrice) / 10 ** USD_DECIMALS,
  };
}

/** The extra global parameters the expanded config invariants read. */
async function globalConfig() {
  const [totalTokenWeights, whitelistedTokenCount, taxBps, stableTaxBps, mintBurnBps, swapBps, stableSwapBps, minProfitTime, fundingInterval, hasDynamicFees, fundingRateFactor, stableFundingRateFactor, marginFeeBps, liquidationFeeUsd, maxLeverageRaw] =
    await Promise.all([
      callUint(VAULT, 'totalTokenWeights()'),
      callUint(VAULT, 'whitelistedTokenCount()'),
      callUint(VAULT, 'taxBasisPoints()'),
      callUint(VAULT, 'stableTaxBasisPoints()'),
      callUint(VAULT, 'mintBurnFeeBasisPoints()'),
      callUint(VAULT, 'swapFeeBasisPoints()'),
      callUint(VAULT, 'stableSwapFeeBasisPoints()'),
      callUint(VAULT, 'minProfitTime()'),
      callUint(VAULT, 'fundingInterval()'),
      callUint(VAULT, 'hasDynamicFees()'),
      callUint(VAULT, 'fundingRateFactor()'),
      callUint(VAULT, 'stableFundingRateFactor()'),
      callUint(VAULT, 'marginFeeBasisPoints()'),
      callUint(VAULT, 'liquidationFeeUsd()'),
      callUint(VAULT, 'maxLeverage()'),
    ]);
  return { totalTokenWeights, whitelistedTokenCount, taxBps, stableTaxBps, mintBurnBps, swapBps, stableSwapBps, minProfitTime, fundingInterval, hasDynamicFees, fundingRateFactor, stableFundingRateFactor, marginFeeBps, liquidationFeeUsd, maxLeverageRaw };
}

/** Enumerate the whitelisted-token array with the per-token flags the aggregate invariants need. */
async function whitelist() {
  const length = await callUint(VAULT, 'allWhitelistedTokensLength()');
  const out = [];
  for (let i = 0n; i < length; i++) {
    const raw = await call(VAULT, 'allWhitelistedTokens(uint256)', [i]);
    const address = '0x' + raw.slice(-40);
    const [decimals, stable, whitelisted, weight] = await Promise.all([
      callUint(VAULT, 'tokenDecimals(address)', [address]),
      callUint(VAULT, 'stableTokens(address)', [address]),
      callUint(VAULT, 'whitelistedTokens(address)', [address]),
      callUint(VAULT, 'tokenWeights(address)', [address]),
    ]);
    out.push({ index: Number(i), address, decimals: Number(decimals), stable: stable === 1n, whitelisted: whitelisted === 1n, weight });
  }
  return out;
}

/** The per-token Vault state the aggregate invariants read, for one token. */
async function tokenReads(address) {
  const [poolAmount, reservedAmount, bufferAmount, minPrice, maxPrice, globalShortSize, globalShortAveragePrice, guaranteedUsd, cumulativeFundingRate, usdgAmount] =
    await Promise.all([
      callUint(VAULT, 'poolAmounts(address)', [address]),
      callUint(VAULT, 'reservedAmounts(address)', [address]),
      callUint(VAULT, 'bufferAmounts(address)', [address]),
      callUint(VAULT, 'getMinPrice(address)', [address]),
      callUint(VAULT, 'getMaxPrice(address)', [address]),
      callUint(VAULT, 'globalShortSizes(address)', [address]),
      callUint(VAULT, 'globalShortAveragePrices(address)', [address]),
      callUint(VAULT, 'guaranteedUsd(address)', [address]),
      callUint(VAULT, 'cumulativeFundingRates(address)', [address]),
      callUint(VAULT, 'usdgAmounts(address)', [address]),
    ]);
  return { address, poolAmount, reservedAmount, bufferAmount, minPrice, maxPrice, globalShortSize, globalShortAveragePrice, guaranteedUsd, cumulativeFundingRate, usdgAmount };
}

/** Confirm the RPC is actually pointed at Arbitrum before trusting any read. */
async function verifyChain() {
  const id = await chainId();
  if (id !== ARBITRUM_CHAIN_ID) {
    throw new Error(
      `RPC reports chain ${id}, expected ${ARBITRUM_CHAIN_ID} (Arbitrum One). ` +
      'Every address in this adapter is chain-specific; reading them on another ' +
      'chain returns whatever happens to live at that address, which is worse ' +
      'than an error because it looks like data.'
    );
  }
  return id;
}

module.exports = {
  NAME, VAULT, TOKENS, USD_DECIMALS, BASIS_POINTS_DIVISOR, ARBITRUM_CHAIN_ID,
  config, marketState, verifyChain, ChainUnreachable, call, words,
  globalConfig, whitelist, tokenReads,
};

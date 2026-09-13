'use strict';

const { Given, Then } = require('@cucumber/cucumber');
const gmx = require('../chain/gmx');
const { callUint, call, ChainUnreachable } = require('../chain/ethcall');

/**
 * Steps for features/contract.feature.
 *
 * Read-only eth_call. No browser, no wallet, no key, no gas.
 *
 * Values are compared as BigInt wherever the comparison decides the verdict.
 * The scaled numbers that appear in failure messages exist only so a human can
 * read "$2528.31" instead of thirty-three digits; converting a 30-decimal USD
 * value to a float and comparing THAT would silently lose the precision the
 * assertion depends on.
 */

Given('the RPC is pointed at the expected chain', async function () {
  await this.fetchOrBlock([ChainUnreachable], async () => {
    const id = await gmx.verifyChain();
    this.evidence('chainId', id);
    this.evidence('vault', gmx.VAULT);
  });
});

Given('the protocol publishes the {string} market state', async function (symbol) {
  await this.fetchOrBlock([ChainUnreachable], async () => {
    this.chain = await gmx.marketState(symbol);
    this.evidence('symbol', this.chain.symbol);
    this.evidence('poolAmount', this.chain.poolAmount.toString());
    this.evidence('reservedAmount', this.chain.reservedAmount.toString());
    this.evidence('oraclePriceUsd', this.chain.minPriceUsd);
  });
});

Given('the protocol publishes the {string} funding state', async function (symbol) {
  await this.fetchOrBlock([ChainUnreachable], async () => {
    const token = gmx.TOKENS[symbol];
    const [lastFundingTime, fundingInterval] = await Promise.all([
      callUint(gmx.VAULT, 'lastFundingTimes(address)', [token.address]),
      callUint(gmx.VAULT, 'fundingInterval()'),
    ]);
    this.funding = { lastFundingTime, fundingInterval };
    this.evidence('lastFundingTime', lastFundingTime.toString());
    this.evidence('fundingIntervalSeconds', fundingInterval.toString());
  });
});

// ---------------------------------------------------------------- Then

Then('the reserved amount does not exceed the pool amount', function () {
  this.observe('reservedAmount <= poolAmount', () => {
    const { poolAmount, reservedAmount, decimals } = this.chain;
    const scale = (v) => (Number(v) / 10 ** decimals).toFixed(6);
    // Utilisation is reported because on a fully-reserved pool this assertion
    // sits right at its boundary, and a reader deserves to see that.
    const utilisation = poolAmount === 0n ? 0 : Number((reservedAmount * 1000000n) / poolAmount) / 10000;
    return {
      passed: reservedAmount <= poolAmount,
      detail: `pool ${scale(poolAmount)}, reserved ${scale(reservedAmount)} (${utilisation.toFixed(4)}% utilised)`,
    };
  });
});

Then('the minimum price does not exceed the maximum price', function () {
  this.observe('getMinPrice <= getMaxPrice', () => {
    const { minPrice, maxPrice, minPriceUsd, maxPriceUsd } = this.chain;
    return {
      passed: minPrice <= maxPrice,
      detail: `min $${minPriceUsd.toFixed(2)}, max $${maxPriceUsd.toFixed(2)}`,
    };
  });
});

// Enumerating every whitelisted token is roughly thirty sequential RPC reads,
// so this one step needs longer than Cucumber's five-second default.
Then('the whitelisted token weights sum to the cached total', { timeout: 90_000 }, async function () {
  if (this.sourceError) {
    this.unobservable('token weights sum to totalTokenWeights', 'the source could not be reached -- ' + this.sourceError);
    return;
  }

  let sum = 0n;
  let counted = 0;
  let cached;
  try {
    const length = await callUint(gmx.VAULT, 'allWhitelistedTokensLength()');
    for (let i = 0n; i < length; i++) {
      const raw = await call(gmx.VAULT, 'allWhitelistedTokens(uint256)', [i]);
      const address = '0x' + raw.slice(-40);
      const [weight, whitelisted] = await Promise.all([
        callUint(gmx.VAULT, 'tokenWeights(address)', [address]),
        callUint(gmx.VAULT, 'whitelistedTokens(address)', [address]),
      ]);
      // A de-listed token keeps its entry in the array with weight zero; only
      // the currently whitelisted ones are counted into the cached total.
      if (whitelisted === 1n) { sum += weight; counted++; }
    }
    cached = await callUint(gmx.VAULT, 'totalTokenWeights()');
  } catch (err) {
    if (err instanceof ChainUnreachable) {
      this.unobservable('token weights sum to totalTokenWeights', 'the source could not be reached -- ' + err.message);
      return;
    }
    throw err;
  }

  this.evidence('tokensCounted', counted);
  this.evidence('weightSum', sum.toString());
  this.evidence('totalTokenWeights', cached.toString());

  this.check(
    'the whitelisted token weights sum to totalTokenWeights()',
    sum === cached,
    `summed ${sum} over ${counted} whitelisted tokens, cached total ${cached}`
  );
});

Then('the maximum leverage is between {int} and {int} times', async function (low, high) {
  await this.fetchOrBlock([ChainUnreachable], async () => {
    if (!this.chainConfig) this.chainConfig = await gmx.config();
  });
  this.observe(`max leverage is between ${low}x and ${high}x`, () => {
    const x = this.chainConfig.maxLeverageX;
    this.evidence('maxLeverageX', x);
    return { passed: x >= low && x <= high, detail: `maxLeverage() reports ${x}x` };
  });
});

Then('the implied initial margin is above zero', function () {
  this.observe('initial margin implied by max leverage is above zero', () => {
    const x = this.chainConfig ? this.chainConfig.maxLeverageX : 0;
    const marginPct = x > 0 ? 100 / x : 0;
    return { passed: marginPct > 0, detail: `1 / ${x}x = ${marginPct.toFixed(3)}%` };
  });
});

Then('the margin fee is at most {int} basis points', async function (cap) {
  await this.fetchOrBlock([ChainUnreachable], async () => {
    if (!this.chainConfig) this.chainConfig = await gmx.config();
  });
  this.observe(`marginFeeBasisPoints <= ${cap}`, () => {
    const bps = Number(this.chainConfig.marginFeeBps);
    this.evidence('marginFeeBps', bps);
    return { passed: bps <= cap, detail: `${bps} bps (${bps / 100}%), cap ${cap} bps` };
  });
});

Then('the last funding time is not in the future', function () {
  this.observe('lastFundingTime is not in the future', () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const t = this.funding.lastFundingTime;
    return { passed: t <= now, detail: `lastFundingTime ${t}, now ${now}` };
  });
});

/**
 * Note what this does NOT assert: that funding is recent.
 *
 * It is the obvious assertion and it would be the wrong one. This protocol
 * advances funding when someone interacts with the market, so on a quiet market
 * the timestamp is simply old -- measured here at over a hundred days. That is
 * market activity, not protocol correctness, and a suite that failed on it
 * would be reporting "nobody traded" as a defect.
 *
 * Landing on an interval boundary is a correctness property: it is how the
 * contract computes the value, and it holds whether the market is busy or
 * asleep. The age is still reported, because a reader should see it.
 */
Then('the last funding time lands on a funding interval boundary', function () {
  this.observe('lastFundingTime is a whole multiple of fundingInterval', () => {
    const { lastFundingTime, fundingInterval } = this.funding;
    const now = BigInt(Math.floor(Date.now() / 1000));
    const ageDays = Number(now - lastFundingTime) / 86400;
    const remainder = fundingInterval === 0n ? 1n : lastFundingTime % fundingInterval;

    return {
      passed: remainder === 0n,
      detail: `lastFundingTime ${lastFundingTime} mod ${fundingInterval} = ${remainder} ` +
        `(market last advanced ${ageDays.toFixed(1)} days ago -- reported, not asserted)`,
    };
  });
});

Then('the {string} token is whitelisted', async function (symbol) {
  let value;
  await this.fetchOrBlock([ChainUnreachable], async () => {
    value = await callUint(gmx.VAULT, 'whitelistedTokens(address)', [gmx.TOKENS[symbol].address]);
  });
  this.observe(`${symbol} is whitelisted`, () => ({
    passed: value === 1n,
    detail: `whitelistedTokens() returned ${value}`,
  }));
});

Then('the {string} token is not marked as a stablecoin', async function (symbol) {
  let value;
  await this.fetchOrBlock([ChainUnreachable], async () => {
    value = await callUint(gmx.VAULT, 'stableTokens(address)', [gmx.TOKENS[symbol].address]);
  });
  this.observe(`${symbol} is not a stablecoin`, () => ({
    passed: value === 0n,
    detail: `stableTokens() returned ${value}`,
  }));
});

Then('a non-zero short open interest has a non-zero average price', async function () {
  let shortSize, averagePrice;
  await this.fetchOrBlock([ChainUnreachable], async () => {
    const token = gmx.TOKENS.WETH.address;
    [shortSize, averagePrice] = await Promise.all([
      callUint(gmx.VAULT, 'globalShortSizes(address)', [token]),
      callUint(gmx.VAULT, 'globalShortAveragePrices(address)', [token]),
    ]);
  });
  this.observe('a non-zero short size implies a non-zero average entry price', () => {
    this.evidence('globalShortSizeUsd', Number(shortSize) / 1e30);
    this.evidence('globalShortAveragePriceUsd', Number(averagePrice) / 1e30);
    const consistent = shortSize === 0n || averagePrice > 0n;
    return {
      passed: consistent,
      detail: `short OI $${(Number(shortSize) / 1e30).toFixed(0)}, average entry $${(Number(averagePrice) / 1e30).toFixed(2)}`,
    };
  });
});


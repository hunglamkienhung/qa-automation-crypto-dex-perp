'use strict';

const { Given, Then } = require('@cucumber/cucumber');
const { TradingPage, ScreenNotReady } = require('../pages/trading');
const venue = require('../../../be/api/venues/gmx');
const { relativeGap } = require('@portfolio/core/harness/recorder');

/**
 * Steps for features/fe-trading-screen.feature. The only steps in this domain
 * that touch a browser.
 *
 * The comparison figures come from the BE steps ("the venue publishes ...",
 * "the protocol publishes ..."), which is the point: the FE branch checks the
 * screen against what the BE branch already knows how to read.
 */

Given('the trading screen is open', { timeout: 90_000 }, async function () {
  this.trading = new TradingPage(this.page);
  await this.fetchOrBlock([ScreenNotReady], async () => {
    await this.trading.open();
  });
});

Given('the screen shows the {string} market', { timeout: 90_000 }, async function (pair) {
  await this.fetchOrBlock([ScreenNotReady], async () => {
    await this.trading.selectMarket(pair);
    this.screen = await this.trading.readHeader();
    this.evidence('screen', {
      pair: this.screen.pair, pool: this.screen.pool, price: this.screen.price,
      oiLong: this.screen.oiLong, oiShort: this.screen.oiShort, oiSplit: this.screen.oiSplit,
      raw: this.screen.raw,
    });
  });
});

// ---------------------------------------------------------------- Then

Then('the price on screen is within {float} percent of the ticker price', function (pct) {
  this.observe(`screen price within ${pct}% of ticker`, () => {
    const s = this.screen.price.value;
    const t = (this.api.ticker.minPriceUsd + this.api.ticker.maxPriceUsd) / 2;
    const gap = relativeGap(s, t);
    return { passed: gap <= pct / 100, detail: `screen $${s}, ticker $${t.toFixed(4)}, gap ${(gap * 100).toFixed(4)}%` };
  });
});

/**
 * The screen shows open interest at the CURRENT price: interest in tokens
 * times the ticker. The API's longInterestUsd is at entry prices and differs
 * by up to 15 % (measured), so that is NOT the figure compared here.
 *
 * Tolerance is what the screen rounded to ("$ 6.0m" is one unit of 0.1m) plus
 * 2 % of the value, because the two reads are seconds apart and the price
 * moves between them.
 */
function oiCheck(world, side) {
  const symbol = world.api.symbol;
  const decimals = venue.MARKETS_UNDER_TEST[symbol].decimals;
  const tokensRaw = side === 'long' ? world.api.values.longInterestInTokens : world.api.values.shortInterestInTokens;
  const tokens = Number(BigInt(tokensRaw)) / 10 ** decimals;
  const price = (world.api.ticker.minPriceUsd + world.api.ticker.maxPriceUsd) / 2;
  const expected = tokens * price;
  const shown = side === 'long' ? world.screen.oiLong : world.screen.oiShort;
  const tolerance = shown.unit + expected * 0.02;
  const diff = Math.abs(shown.value - expected);
  world.evidence('oi_' + side, { shownUsd: shown.value, displayUnit: shown.unit, tokens, price, expectedUsd: expected, diffUsd: diff });
  return {
    passed: diff <= tolerance,
    detail: `screen $${shown.value} (shown to $${shown.unit}), ${tokens.toFixed(3)} tokens x $${price.toFixed(2)} = $${expected.toFixed(0)}, diff $${diff.toFixed(0)}, tolerance $${tolerance.toFixed(0)}`,
  };
}

Then('the long open interest on screen equals long interest in tokens times the ticker price', function () {
  this.observe('screen long OI == longInterestInTokens x price', () => oiCheck(this, 'long'));
});

Then('the short open interest on screen equals short interest in tokens times the ticker price', function () {
  this.observe('screen short OI == shortInterestInTokens x price', () => oiCheck(this, 'short'));
});

Then('the long percentage on screen matches long over long plus short', function () {
  this.observe('screen L% == long / (long + short)', () => {
    const { oiLong, oiShort, oiSplit } = this.screen;
    const total = oiLong.value + oiShort.value;
    const derived = total === 0 ? 0 : (oiLong.value / total) * 100;
    // both amounts are rounded to `unit`; that rounding alone can move the
    // derived percentage by up to (unit / total) * 100 on each side
    const slack = total === 0 ? 100 : ((oiLong.unit + oiShort.unit) / total) * 100 + 0.5;
    const diff = Math.abs(oiSplit.long - derived);
    return { passed: diff <= slack, detail: `screen ${oiSplit.long}%, derived ${derived.toFixed(2)}% from $${oiLong.value} / $${oiShort.value}, slack ${slack.toFixed(2)} pts` };
  });
});

Then('the price on screen is within {float} percent of the on-chain maximum price', function (pct) {
  this.observe(`screen price within ${pct}% of Vault.getMaxPrice`, () => {
    const s = this.screen.price.value;
    const c = this.chain.maxPriceUsd;
    const gap = relativeGap(s, c);
    return { passed: gap <= pct / 100, detail: `screen $${s}, chain $${c.toFixed(4)}, gap ${(gap * 100).toFixed(4)}%` };
  });
});

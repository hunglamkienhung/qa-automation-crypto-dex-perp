'use strict';

const { test, expect } = require('@portfolio/core/harness/playwright');
const { relativeGap } = require('@portfolio/core/harness/recorder');
const { TradingPage, ScreenNotReady } = require('../pages/trading');
const venue = require('../../../be/api/venues/gmx');
const gmx = require('../../../be/contract/chain/gmx');
const { ChainUnreachable } = require('../../../be/contract/chain/ethcall');

/**
 * The same FE cases as fe-trading-screen.feature, written as plain Playwright
 * Test specs. Two entries, one recorder, one queue: a reader who looks for the
 * word "Playwright" finds this file; a reader who looks for Gherkin finds the
 * feature. Both must grade every case identically -- the gate checks that.
 *
 * The feature file is the specification; this file must not assert anything
 * the feature does not.
 */

const MARKETS = [
  { pair: 'ETH/USD', symbol: 'ETH', token: 'WETH', price: 32, oi: 35, split: 38, chain: 41 },
  { pair: 'BTC/USD', symbol: 'BTC', token: 'WBTC', price: 33, oi: 36, split: 39, chain: 42 },
  { pair: 'SOL/USD', symbol: 'SOL', token: null, price: 34, oi: 37, split: 40, chain: null },
];

test.setTimeout(180_000);

/** Open the screen on a market, or route "could not" into Blocked. */
async function screenFor(page, qa, pair) {
  const trading = new TradingPage(page);
  let header = null;
  await qa.fetchOrBlock([ScreenNotReady], async () => {
    await trading.open();
    await trading.selectMarket(pair);
    header = await trading.readHeader();
    qa.evidence('screen', { pair: header.pair, price: header.price, oiLong: header.oiLong, oiShort: header.oiShort, oiSplit: header.oiSplit, raw: header.raw });
  });
  return header;
}

for (const m of MARKETS) {
  test(`C${m.price}: the ${m.pair} price on screen agrees with the ticker`, async ({ page, qa }) => {
    qa.case(m.price);
    const screen = await screenFor(page, qa, m.pair);
    let ticker;
    await qa.fetchOrBlock([venue.VenueUnreachable], async () => { ticker = await venue.ticker(m.symbol); });
    qa.observe('screen price within 0.5% of ticker', () => {
      const t = (ticker.minPriceUsd + ticker.maxPriceUsd) / 2;
      const gap = relativeGap(screen.price.value, t);
      return { passed: gap <= 0.005, detail: `screen $${screen.price.value}, ticker $${t.toFixed(4)}, gap ${(gap * 100).toFixed(4)}%` };
    });
  });

  test(`C${m.oi}: the ${m.pair} open interest on screen is the API's tokens at the current price`, async ({ page, qa }) => {
    qa.case(m.oi);
    const screen = await screenFor(page, qa, m.pair);
    let ticker, values;
    await qa.fetchOrBlock([venue.VenueUnreachable], async () => {
      ticker = await venue.ticker(m.symbol);
      values = await venue.marketValues(m.symbol);
    });
    const decimals = venue.MARKETS_UNDER_TEST[m.symbol].decimals;
    for (const side of ['long', 'short']) {
      qa.observe(`screen ${side} OI == ${side}InterestInTokens x price`, () => {
        const tokens = Number(BigInt(side === 'long' ? values.longInterestInTokens : values.shortInterestInTokens)) / 10 ** decimals;
        const price = (ticker.minPriceUsd + ticker.maxPriceUsd) / 2;
        const expected = tokens * price;
        const shown = side === 'long' ? screen.oiLong : screen.oiShort;
        const diff = Math.abs(shown.value - expected);
        const tolerance = shown.unit + expected * 0.02;
        qa.evidence('oi_' + side, { shownUsd: shown.value, displayUnit: shown.unit, tokens, price, expectedUsd: expected, diffUsd: diff });
        return { passed: diff <= tolerance, detail: `screen $${shown.value}, ${tokens.toFixed(3)} x $${price.toFixed(2)} = $${expected.toFixed(0)}, diff $${diff.toFixed(0)}, tolerance $${tolerance.toFixed(0)}` };
      });
    }
  });

  test(`C${m.split}: the ${m.pair} open-interest split is consistent with its own figures`, async ({ page, qa }) => {
    qa.case(m.split);
    const screen = await screenFor(page, qa, m.pair);
    qa.observe('screen L% == long / (long + short)', () => {
      const { oiLong, oiShort, oiSplit } = screen;
      const total = oiLong.value + oiShort.value;
      const derived = total === 0 ? 0 : (oiLong.value / total) * 100;
      const slack = total === 0 ? 100 : ((oiLong.unit + oiShort.unit) / total) * 100 + 0.5;
      const diff = Math.abs(oiSplit.long - derived);
      return { passed: diff <= slack, detail: `screen ${oiSplit.long}%, derived ${derived.toFixed(2)}%, slack ${slack.toFixed(2)} pts` };
    });
  });

  if (m.chain) {
    test(`C${m.chain}: the ${m.pair} price on screen agrees with the on-chain oracle`, async ({ page, qa }) => {
      qa.case(m.chain);
      const screen = await screenFor(page, qa, m.pair);
      let chain;
      await qa.fetchOrBlock([ChainUnreachable], async () => {
        chain = await gmx.marketState(m.token);
        qa.evidence('oraclePriceUsd', chain.maxPriceUsd);
      });
      qa.observe('screen price within 0.5% of Vault.getMaxPrice', () => {
        const gap = relativeGap(screen.price.value, chain.maxPriceUsd);
        return { passed: gap <= 0.005, detail: `screen $${screen.price.value}, chain $${chain.maxPriceUsd.toFixed(4)}, gap ${(gap * 100).toFixed(4)}%` };
      });
    });
  }
}

// `expect` is exported by the harness for specs that want matcher-style
// assertions through qa.assert(); this file uses observe() so the failure text
// matches the Cucumber steps word for word.
void expect;

'use strict';

const { Given, When, Then } = require('@cucumber/cucumber');
const venue = require('../venues/gmx');
const { relativeGap } = require('@portfolio/core/harness/recorder');

/**
 * Steps for features/be-api-gmx.feature. HTTPS only -- no browser.
 *
 * The Givens also serve fe-trading-screen.feature: the FE branch reuses
 * "the venue publishes ..." to fetch the figure the screen is compared with.
 */

const PERIOD_SECONDS = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };
const UNREACHABLE = [venue.VenueUnreachable];

Given('the venue publishes the {string} ticker', { timeout: 30_000 }, async function (symbol) {
  await this.fetchOrBlock(UNREACHABLE, async () => {
    this.api = this.api || {};
    this.api.ticker = await venue.ticker(symbol);
    this.evidence('ticker', { symbol, minUsd: this.api.ticker.minPriceUsd, maxUsd: this.api.ticker.maxPriceUsd, updatedAt: this.api.ticker.updatedAt });
  });
});

Given('the venue publishes the {string} 24 hour summary', { timeout: 30_000 }, async function (symbol) {
  await this.fetchOrBlock(UNREACHABLE, async () => {
    this.api = this.api || {};
    this.api.day = await venue.day(symbol);
    this.evidence('day', this.api.day);
  });
});

Given('the venue publishes the last {int} {string} candles for {string}', { timeout: 30_000 }, async function (n, period, symbol) {
  await this.fetchOrBlock(UNREACHABLE, async () => {
    this.api = this.api || {};
    this.api.candles = await venue.candles(symbol, period, n);
    this.api.period = period;
    this.evidence('candles', { symbol, period, count: this.api.candles.length, latest: this.api.candles[0] });
  });
});

Given('the venue publishes the {string} market configuration', { timeout: 30_000 }, async function (symbol) {
  await this.fetchOrBlock(UNREACHABLE, async () => {
    this.api = this.api || {};
    this.api.config = await venue.marketConfig(symbol);
    this.evidence('marketConfig', { name: this.api.config.name, marketToken: this.api.config.marketTokenAddress, indexToken: this.api.config.indexTokenAddress, isDisabled: this.api.config.isDisabled });
  });
});

Given('the venue publishes the {string} market values', { timeout: 30_000 }, async function (symbol) {
  await this.fetchOrBlock(UNREACHABLE, async () => {
    this.api = this.api || {};
    this.api.values = await venue.marketValues(symbol);
    this.api.symbol = symbol;
    this.evidence('marketValues', { longInterestUsd: this.api.values.longInterestUsd, shortInterestUsd: this.api.values.shortInterestUsd, updatedAt: this.api.values.updatedAt });
  });
});

When('candles are requested with period {string} for {string}', { timeout: 30_000 }, async function (period, symbol) {
  await this.fetchOrBlock(UNREACHABLE, async () => {
    this.api = this.api || {};
    this.api.raw = await venue.candlesRaw(`tokenSymbol=${symbol}&period=${period}`);
    this.evidence('response', { status: this.api.raw.status, body: this.api.raw.body });
  });
});

// ---------------------------------------------------------------- Then

Then('the ticker minimum price does not exceed its maximum price', function () {
  this.observe('ticker minPrice <= maxPrice', () => {
    const t = this.api.ticker;
    return { passed: t.minPrice <= t.maxPrice, detail: `min $${t.minPriceUsd}, max $${t.maxPriceUsd}` };
  });
});

Then('both ticker prices are above zero', function () {
  this.observe('ticker prices > 0', () => {
    const t = this.api.ticker;
    return { passed: t.minPrice > 0n && t.maxPrice > 0n, detail: `min ${t.minPrice}, max ${t.maxPrice}` };
  });
});

Then('the 24 hour open lies between the low and the high', function () {
  this.observe('24h low <= open <= high', () => {
    const d = this.api.day;
    return { passed: d.low <= d.open && d.open <= d.high, detail: `low ${d.low}, open ${d.open}, high ${d.high}` };
  });
});

Then('the 24 hour close lies between the low and the high', function () {
  this.observe('24h low <= close <= high', () => {
    const d = this.api.day;
    return { passed: d.low <= d.close && d.close <= d.high, detail: `low ${d.low}, close ${d.close}, high ${d.high}` };
  });
});

Then('the candles are newest first with strictly decreasing timestamps', function () {
  this.observe('candle timestamps strictly decreasing', () => {
    const c = this.api.candles;
    const bad = c.findIndex((x, i) => i > 0 && !(x.t < c[i - 1].t));
    return { passed: c.length > 1 && bad < 0, detail: bad < 0 ? `${c.length} candles` : `candle ${bad} (${c[bad].t}) is not before candle ${bad - 1} (${c[bad - 1].t})` };
  });
});

Then('consecutive candles are exactly one period apart', function () {
  this.observe('candles spaced by one period', () => {
    const c = this.api.candles;
    const step = PERIOD_SECONDS[this.api.period];
    const bad = c.findIndex((x, i) => i > 0 && c[i - 1].t - x.t !== step);
    return { passed: bad < 0, detail: bad < 0 ? `every gap is ${step}s` : `gap between candle ${bad - 1} and ${bad} is ${c[bad - 1].t - c[bad].t}s, expected ${step}s` };
  });
});

Then('every candle keeps its open and close between its low and high', function () {
  this.observe('each candle: low <= open,close <= high', () => {
    const c = this.api.candles;
    const bad = c.findIndex((x) => !(x.low <= x.open && x.open <= x.high && x.low <= x.close && x.close <= x.high));
    return { passed: bad < 0, detail: bad < 0 ? `${c.length} candles well formed` : `candle ${bad}: ${JSON.stringify(c[bad])}` };
  });
});

Then('the ticker price is within {float} percent of the latest candle close', function (pct) {
  this.observe(`ticker within ${pct}% of latest candle close`, () => {
    const mid = (this.api.ticker.minPriceUsd + this.api.ticker.maxPriceUsd) / 2;
    const close = this.api.candles[0].close;
    const gap = relativeGap(mid, close);
    this.evidence('tickerVsCandle', { tickerMid: mid, candleClose: close, gapPct: gap * 100 });
    return { passed: gap <= pct / 100, detail: `ticker $${mid.toFixed(4)}, candle close $${close}, gap ${(gap * 100).toFixed(4)}%` };
  });
});

Then('the ticker was updated within the last {int} seconds', function (max) {
  this.observe(`ticker updatedAt within ${max}s`, () => {
    const age = (Date.now() - this.api.ticker.updatedAtMs) / 1000;
    this.evidence('tickerAgeSeconds', age);
    return { passed: age <= max, detail: `updated ${age.toFixed(1)}s ago` };
  });
});

Then('the ticker is not stamped in the future', function () {
  this.observe('ticker updatedAt <= now', () => {
    const skew = (this.api.ticker.updatedAtMs - Date.now()) / 1000;
    // a few seconds of clock skew between two machines is not a future stamp
    return { passed: skew <= 5, detail: `updatedAt is ${skew.toFixed(1)}s relative to now` };
  });
});

Then("the market's index token is the ticker's token address", function () {
  this.observe('market indexTokenAddress == ticker tokenAddress', () => {
    const a = String(this.api.config.indexTokenAddress).toLowerCase();
    const b = String(this.api.ticker.tokenAddress).toLowerCase();
    return { passed: a === b, detail: `market ${a}, ticker ${b}` };
  });
});

Then('the market is not disabled', function () {
  this.observe('market isDisabled == false', () => ({
    passed: this.api.config.isDisabled === false,
    detail: `isDisabled = ${JSON.stringify(this.api.config.isDisabled)}`,
  }));
});

Then('long and short open interest are both non-negative', function () {
  this.observe('longInterestUsd >= 0 and shortInterestUsd >= 0', () => {
    const v = this.api.values;
    return { passed: v.longInterestUsd >= 0 && v.shortInterestUsd >= 0, detail: `long $${v.longInterestUsd.toFixed(0)}, short $${v.shortInterestUsd.toFixed(0)}` };
  });
});

Then('the market values were updated within the last {int} seconds', function (max) {
  this.observe(`market values updatedAt within ${max}s`, () => {
    const age = (Date.now() - this.api.values.updatedAtMs) / 1000;
    return { passed: age <= max, detail: `updated ${age.toFixed(1)}s ago` };
  });
});

Then('the venue answers {int}', function (status) {
  this.observe(`HTTP ${status}`, () => ({
    passed: this.api.raw.status === status,
    detail: `got HTTP ${this.api.raw.status}`,
  }));
});

Then('the error body names the supported periods', function () {
  this.observe('error body lists supported periods', () => {
    const text = JSON.stringify(this.api.raw.body);
    return { passed: /supported periods/i.test(text) && /1m/.test(text), detail: text.slice(0, 160) };
  });
});

Then('the error body says the token is unsupported', function () {
  this.observe('error body says unsupported token', () => {
    const text = JSON.stringify(this.api.raw.body);
    return { passed: /unsupported token/i.test(text), detail: text.slice(0, 160) };
  });
});

// ---------------------------------------------------------------- expanded v2 market invariants (282-301)

Given('the venue publishes the full ticker set', { timeout: 30_000 }, async function () {
  await this.fetchOrBlock(UNREACHABLE, async () => {
    this.api = this.api || {};
    this.api.tickers = await venue.tickers();
    this.evidence('tickerCount', this.api.tickers.length);
  });
});

// "the market is not disabled" is already defined above (case 24-26 reuses it).
Then('the market is not spot-only', function () {
  this.observe('market is not spot-only', () => ({ passed: this.api.config.isSpotOnly === false, detail: 'isSpotOnly ' + this.api.config.isSpotOnly }));
});
Then('the pool value minimum does not exceed its maximum', function () {
  this.observe('poolValueMin <= poolValueMax', () => { const v = this.api.values; return { passed: BigInt(v.poolValueMin) <= BigInt(v.poolValueMax), detail: `min ${v.poolValueMinUsd.toFixed(0)}, max ${v.poolValueMaxUsd.toFixed(0)} USD` }; });
});
Then('the reserve factors and the minimum collateral factor are positive', function () {
  this.observe('reserve/min-collateral factors > 0', () => { const c = this.api.config; const ok = BigInt(c.reserveFactorLong) > 0n && BigInt(c.reserveFactorShort) > 0n && BigInt(c.minCollateralFactor) > 0n; return { passed: ok, detail: `reserveL ${c.reserveFactorLong}, reserveS ${c.reserveFactorShort}, minColl ${c.minCollateralFactor}` }; });
});
// The venue adapter overrides the USD fields with floats for reporting; the
// tokens field stays a raw integer string. Compare each on whether it is zero.
const isZero = (v) => (typeof v === 'number' ? v === 0 : BigInt(v) === 0n);
const bothSet = (tokens, usd) => isZero(tokens) === isZero(usd);
Then('the long open interest in tokens is set exactly when the long interest in USD is', function () {
  this.observe('long OI tokens <-> USD', () => { const v = this.api.values; return { passed: bothSet(v.longInterestInTokens, v.longInterestUsd), detail: `tokens ${v.longInterestInTokens}, usd ${v.longInterestUsd}` }; });
});
Then('the short open interest in tokens is set exactly when the short interest in USD is', function () {
  this.observe('short OI tokens <-> USD', () => { const v = this.api.values; return { passed: bothSet(v.shortInterestInTokens, v.shortInterestUsd), detail: `tokens ${v.shortInterestInTokens}, usd ${v.shortInterestUsd}` }; });
});
Then('the borrowing factors for both sides are non-negative', function () {
  this.observe('borrowing factors >= 0', () => { const v = this.api.values; return { passed: BigInt(v.borrowingFactorPerSecondForLongs) >= 0n && BigInt(v.borrowingFactorPerSecondForShorts) >= 0n, detail: `long ${v.borrowingFactorPerSecondForLongs}, short ${v.borrowingFactorPerSecondForShorts}` }; });
});
Then('the per-second funding factor is present', function () {
  this.observe('fundingFactorPerSecond present', () => { const v = this.api.values; return { passed: v.fundingFactorPerSecond !== undefined && v.fundingFactorPerSecond !== null, detail: 'fundingFactorPerSecond ' + v.fundingFactorPerSecond }; });
});
Then('the values entry is keyed by the configured market token address', function () {
  this.observe('values.marketTokenAddress == config.marketTokenAddress', () => { const v = this.api.values, c = this.api.config; return { passed: v.marketTokenAddress.toLowerCase() === c.marketTokenAddress.toLowerCase(), detail: `values ${v.marketTokenAddress}, config ${c.marketTokenAddress}` }; });
});
Then('every ticker entry has a minimum price at most its maximum, both above zero', function () {
  this.observe('every ticker min<=max>0', () => { const bad = this.api.tickers.filter((t) => !(BigInt(t.minPrice) > 0n && BigInt(t.minPrice) <= BigInt(t.maxPrice))); return { passed: bad.length === 0, detail: bad.length ? bad.slice(0, 3).map((t) => t.tokenSymbol).join(', ') : this.api.tickers.length + ' tickers ordered and positive' }; });
});
Then('no token symbol appears more than once', function () {
  this.observe('ticker tokenSymbols are unique', () => { const seen = new Map(); for (const t of this.api.tickers) seen.set(t.tokenSymbol, (seen.get(t.tokenSymbol) || 0) + 1); const dup = [...seen].filter(([, n]) => n > 1); return { passed: dup.length === 0, detail: dup.length ? dup.map(([s, n]) => `${s}x${n}`).join(', ') : seen.size + ' unique symbols' }; });
});
Then('the ticker set contains ETH, BTC and SOL', function () {
  this.observe('ticker set covers the tested markets', () => { const syms = new Set(this.api.tickers.map((t) => t.tokenSymbol)); const missing = ['ETH', 'BTC', 'SOL'].filter((s) => !syms.has(s)); return { passed: missing.length === 0, detail: missing.length ? 'missing ' + missing.join(', ') : 'all present' }; });
});
Then('the response is a client error', function () {
  this.observe('response is a 4xx', () => { const s = this.api.raw.status; return { passed: s >= 400 && s < 500, detail: 'HTTP ' + s }; });
});

When('candles are requested with no token symbol', { timeout: 30_000 }, async function () {
  await this.fetchOrBlock(UNREACHABLE, async () => {
    this.api = this.api || {};
    this.api.raw = await venue.candlesRaw('tokenSymbol=&period=1m');
    this.evidence('response', { status: this.api.raw.status });
  });
});

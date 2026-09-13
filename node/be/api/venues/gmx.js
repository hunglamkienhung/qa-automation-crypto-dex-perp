'use strict';

/**
 * The live protocol's public HTTP endpoints. No key, no wallet, read-only.
 *
 * Two hosts, both public:
 *
 *   PRICES   prices/tickers   one entry per token: min/max price, updatedAt
 *            prices/24h       open/high/low/close per token, plain floats
 *            prices/candles   OHLC series per token and period
 *   MARKETS  v1/markets/values   pool amounts, open interest, funding factor per market
 *            v1/markets/config   token addresses and risk parameters per market
 *
 * Scaling, measured rather than assumed: ticker prices are integers at
 * 10^(30 - tokenDecimals). ETH (18 decimals) "2522129207984375" is $2522.13;
 * BTC (8) "771878920836641450000000000" is $77187.89; SOL (9) is 21 decimals.
 * The 24h endpoint returns floats already in USD, which is what the ticker
 * scaling is checked against in the feature -- a wrong decimals entry in the
 * table below would show up there as a 10x disagreement.
 *
 * USD amounts in markets/values (open interest, pool value) are 30-decimal.
 *
 * Every transport failure surfaces as VenueUnreachable, so a step can turn it
 * into "unobservable" rather than "failed". Anything else -- a shape this
 * adapter did not expect -- is thrown as is: that is a fault here, not an
 * outage there.
 */

const PRICES = 'https://arbitrum-api.gmxinfra.io';
const MARKETS = 'https://arbitrum.gmxapi.io';
const USER_AGENT = 'qa-automation-crypto-perp/1.0 (read-only invariants)';
const TIMEOUT_MS = 20_000;

const USD_DECIMALS = 30;

/** The three markets this domain measures. Names match the venue's own labels. */
const MARKETS_UNDER_TEST = {
  ETH: { symbol: 'ETH', decimals: 18, marketName: 'ETH/USD [WETH-USDC]', pair: 'ETH/USD' },
  BTC: { symbol: 'BTC', decimals: 8, marketName: 'BTC/USD [BTC-USDC]', pair: 'BTC/USD' },
  SOL: { symbol: 'SOL', decimals: 9, marketName: 'SOL/USD [SOL-USDC]', pair: 'SOL/USD' },
};

class VenueUnreachable extends Error {
  constructor(message) {
    super(message);
    this.name = 'VenueUnreachable';
  }
}

async function getJson(url, { expectStatus = 200 } = {}) {
  let res;
  try {
    res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new VenueUnreachable('GET ' + url + ' -- ' + (err.cause?.code || err.name || err.message));
  }
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (expectStatus !== null && res.status !== expectStatus) {
    // 5xx and 429 are the venue being unavailable, not the venue being wrong.
    if (res.status >= 500 || res.status === 429) {
      throw new VenueUnreachable('GET ' + url + ' -- HTTP ' + res.status);
    }
  }
  return { status: res.status, body, headers: res.headers };
}

/** Scale a 30-decimal-based integer string into USD, as a float for reporting. */
function priceToUsd(raw, tokenDecimals) {
  return Number(BigInt(raw)) / 10 ** (USD_DECIMALS - tokenDecimals);
}

function usd30(raw) {
  return Number(BigInt(raw)) / 1e30;
}

async function tickers() {
  const { body } = await getJson(PRICES + '/prices/tickers');
  if (!Array.isArray(body)) throw new Error('prices/tickers: expected an array, got ' + typeof body);
  return body;
}

async function ticker(symbol) {
  const all = await tickers();
  const t = all.find((x) => x.tokenSymbol === symbol);
  if (!t) throw new Error('prices/tickers has no entry for ' + symbol);
  const d = MARKETS_UNDER_TEST[symbol].decimals;
  return {
    ...t,
    minPrice: BigInt(t.minPrice),
    maxPrice: BigInt(t.maxPrice),
    minPriceUsd: priceToUsd(t.minPrice, d),
    maxPriceUsd: priceToUsd(t.maxPrice, d),
    updatedAtMs: Number(t.updatedAt),
  };
}

async function day(symbol) {
  const { body } = await getJson(PRICES + '/prices/24h');
  const d = body.find((x) => x.tokenSymbol === symbol);
  if (!d) throw new Error('prices/24h has no entry for ' + symbol);
  return d; // { high, low, open, close } floats
}

async function candles(symbol, period = '1m', limit = 10) {
  const { body } = await getJson(PRICES + `/prices/candles?tokenSymbol=${symbol}&period=${period}&limit=${limit}`);
  if (!body || !Array.isArray(body.candles)) throw new Error('prices/candles: unexpected shape ' + JSON.stringify(body).slice(0, 120));
  // [timestamp, open, high, low, close], newest first
  return body.candles.map(([t, o, h, l, c]) => ({ t, open: o, high: h, low: l, close: c }));
}

/** Raw status + body for a request expected to be rejected. */
async function candlesRaw(query) {
  return getJson(PRICES + '/prices/candles?' + query, { expectStatus: null });
}

async function marketConfig(symbol) {
  const { body } = await getJson(MARKETS + '/v1/markets/config');
  const name = MARKETS_UNDER_TEST[symbol].marketName;
  const m = body.find((x) => x.name === name);
  if (!m) throw new Error('markets/config has no market named ' + name);
  return m;
}

async function marketValues(symbol) {
  const cfg = await marketConfig(symbol);
  const { body } = await getJson(MARKETS + '/v1/markets/values');
  const v = body.find((x) => x.marketTokenAddress === cfg.marketTokenAddress);
  if (!v) throw new Error('markets/values has no entry for ' + cfg.marketTokenAddress);
  return {
    ...v,
    config: cfg,
    longInterestUsd: usd30(v.longInterestUsd),
    shortInterestUsd: usd30(v.shortInterestUsd),
    poolValueMinUsd: usd30(v.poolValueMin),
    poolValueMaxUsd: usd30(v.poolValueMax),
    updatedAtMs: Number(v.updatedAt),
  };
}

module.exports = {
  PRICES, MARKETS, MARKETS_UNDER_TEST, USD_DECIMALS,
  VenueUnreachable, getJson, priceToUsd, usd30,
  tickers, ticker, day, candles, candlesRaw, marketConfig, marketValues,
};

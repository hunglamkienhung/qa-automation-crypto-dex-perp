'use strict';

/**
 * Decimal strings to contract units, exactly. "2502.5" at 8 decimals is
 * 250250000000n -- never via a float, which would turn 0.1 into
 * 0.1000000000000000055.
 */
function toUnits(text, decimals) {
  const s = String(text).trim().replace(/[$,\s]/g, '');
  const m = s.match(/^(-)?(\d+)(?:\.(\d+))?$/);
  if (!m) throw new Error('not a decimal: ' + text);
  const frac = (m[3] || '').padEnd(decimals, '0');
  if (frac.length > decimals) throw new Error(`${text} has more than ${decimals} decimals`);
  const n = BigInt(m[2] + frac);
  return m[1] ? -n : n;
}

function fromUnits(n, decimals) {
  const neg = n < 0n;
  const s = (neg ? -n : n).toString().padStart(decimals + 1, '0');
  const int = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, '');
  return (neg ? '-' : '') + int + (frac ? '.' + frac : '');
}

const price = (t) => toUnits(t, 8);
const size = (t) => toUnits(t, 8);
const usd = (t) => toUnits(t, 6);
const showPrice = (n) => fromUnits(n, 8);
const showSize = (n) => fromUnits(n, 8);
const showUsd = (n) => fromUnits(n, 6);

/** USDC notional of size at price, as the contract computes it. */
function notional(sizeUnits, priceUnits) {
  return (sizeUnits * priceUnits) / 10_000_000_000n;
}

module.exports = { toUnits, fromUnits, price, size, usd, showPrice, showSize, showUsd, notional };

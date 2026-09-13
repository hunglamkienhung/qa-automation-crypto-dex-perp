'use strict';

const { Then } = require('@cucumber/cucumber');
const gmx = require('../chain/gmx');
const { ChainUnreachable } = require('../chain/ethcall');

/**
 * Expanded contract invariants for the live GMX v1 Vault (features 265-281).
 *
 * The per-token invariants read every whitelisted token, which is ~140
 * sequential eth_calls. The enumeration is memoised for the process so the ten
 * token scenarios pay for it once rather than ten times; the numbers are pool
 * balances and oracle prices that do not move meaningfully within one run, and
 * every assertion here is a structural relationship (ordering, sign, sum), not
 * a snapshot value, so a small drift between scenarios changes nothing.
 *
 * A memoised fetch never caches a failure: if the node was unreachable the next
 * scenario tries again and, failing, grades Blocked.
 */

let configMemo = null;
let tokensMemo = null;

async function loadConfig() {
  if (!configMemo) configMemo = gmx.globalConfig();
  try { return await configMemo; } catch (err) { configMemo = null; throw err; }
}

async function loadTokens() {
  if (!tokensMemo) {
    tokensMemo = (async () => {
      const list = await gmx.whitelist();
      const out = [];
      // Only whitelisted tokens have a live price feed; getMinPrice reverts for
      // a de-listed entry, so per-token Vault state is read only for the live
      // ones. The de-listed entries are kept with their meta (weight, flag) so
      // "weight tracks whitelisting" can still see them.
      for (const t of list) out.push(t.whitelisted ? { ...t, ...(await gmx.tokenReads(t.address)), hasReads: true } : { ...t, hasReads: false });
      return out;
    })();
  }
  try { return await tokensMemo; } catch (err) { tokensMemo = null; throw err; }
}

/** Fetch (config | tokens), routing an outage to Blocked, then evaluate `fn(data)`. */
async function withData(world, description, load, fn) {
  if (world.sourceError) { world.unobservable(description, 'the source could not be reached -- ' + world.sourceError); return; }
  let data;
  try { data = await load(); } catch (err) {
    if (err instanceof ChainUnreachable) { world.unobservable(description, err.message); return; }
    throw err;
  }
  const { passed, detail } = fn(data);
  world.check(description, passed, detail);
}

const OPT = { timeout: 120_000 };
const whitelisted = (tokens) => tokens.filter((t) => t.whitelisted);

// ---------------------------------------------------------------- config invariants

Then('the whitelisted token count matches the array\'s whitelisted entries', OPT, async function () {
  if (this.sourceError) { this.unobservable('whitelistedTokenCount == array whitelisted entries', 'the source could not be reached -- ' + this.sourceError); return; }
  let cfg, tokens;
  try { cfg = await loadConfig(); tokens = await loadTokens(); } catch (err) {
    if (err instanceof ChainUnreachable) { this.unobservable('whitelistedTokenCount == array whitelisted entries', err.message); return; }
    throw err;
  }
  const counted = BigInt(whitelisted(tokens).length);
  this.check('whitelistedTokenCount() equals the count of whitelisted array entries', cfg.whitelistedTokenCount === counted, `count() ${cfg.whitelistedTokenCount}, array ${counted}`);
});

Then('the swap fee is at least the stable swap fee', async function () {
  await withData(this, 'swapFeeBasisPoints >= stableSwapFeeBasisPoints', loadConfig, (c) => ({ passed: c.swapBps >= c.stableSwapBps, detail: `swap ${c.swapBps} bps, stable swap ${c.stableSwapBps} bps` }));
});

Then('the core basis-point fees are each at most {int} basis points', async function (cap) {
  await withData(this, 'core fees within ' + cap + ' bps', loadConfig, (c) => {
    const over = Object.entries({ tax: c.taxBps, stableTax: c.stableTaxBps, mintBurn: c.mintBurnBps, swap: c.swapBps, stableSwap: c.stableSwapBps }).filter(([, v]) => v > BigInt(cap));
    return { passed: over.length === 0, detail: over.length ? over.map(([k, v]) => `${k} ${v}`).join(', ') : 'all within ' + cap + ' bps' };
  });
});

Then('the funding interval is exactly one hour', async function () {
  await withData(this, 'fundingInterval == 3600', loadConfig, (c) => ({ passed: c.fundingInterval === 3600n, detail: 'fundingInterval ' + c.fundingInterval + 's' }));
});

Then('the minimum profit time is positive and at most one day', async function () {
  await withData(this, '0 < minProfitTime <= 86400', loadConfig, (c) => ({ passed: c.minProfitTime > 0n && c.minProfitTime <= 86400n, detail: 'minProfitTime ' + c.minProfitTime + 's' }));
});

Then('dynamic fees are enabled', async function () {
  await withData(this, 'hasDynamicFees == true', loadConfig, (c) => ({ passed: c.hasDynamicFees === 1n, detail: 'hasDynamicFees ' + c.hasDynamicFees }));
});

Then('the liquidation fee is positive and at most ${int}', async function (cap) {
  await withData(this, '0 < liquidationFeeUsd <= $' + cap, loadConfig, (c) => {
    const usd = Number(c.liquidationFeeUsd) / 1e30;
    return { passed: c.liquidationFeeUsd > 0n && usd <= cap, detail: '$' + usd.toFixed(2) };
  });
});

Then('both funding rate factors are positive and at most {int}', async function (cap) {
  await withData(this, '0 < funding rate factors <= ' + cap, loadConfig, (c) => ({ passed: c.fundingRateFactor > 0n && c.fundingRateFactor <= BigInt(cap) && c.stableFundingRateFactor > 0n && c.stableFundingRateFactor <= BigInt(cap), detail: `factor ${c.fundingRateFactor}, stable ${c.stableFundingRateFactor}` }));
});

Then('the cached total token weight is {int}', async function (n) {
  await withData(this, 'totalTokenWeights == ' + n, loadConfig, (c) => ({ passed: c.totalTokenWeights === BigInt(n), detail: 'totalTokenWeights ' + c.totalTokenWeights }));
});

// ---------------------------------------------------------------- per-token invariants

Then('every whitelisted token reserves no more than its pool', OPT, async function () {
  await withData(this, 'reserved <= pool, every whitelisted token', loadTokens, (tokens) => {
    const bad = whitelisted(tokens).filter((t) => t.reservedAmount > t.poolAmount);
    return { passed: bad.length === 0, detail: bad.length ? bad.map((t) => t.address + ' reserved>pool').join(', ') : whitelisted(tokens).length + ' tokens within pool' };
  });
});

Then('every whitelisted token has a minimum price at most its maximum, both above zero', OPT, async function () {
  await withData(this, 'min<=max>0, every whitelisted token', loadTokens, (tokens) => {
    const bad = whitelisted(tokens).filter((t) => !(t.minPrice > 0n && t.minPrice <= t.maxPrice));
    return { passed: bad.length === 0, detail: bad.length ? bad.map((t) => t.address).join(', ') : whitelisted(tokens).length + ' tokens ordered and positive' };
  });
});

Then('every whitelisted token has positive decimals', OPT, async function () {
  await withData(this, 'decimals > 0, every whitelisted token', loadTokens, (tokens) => {
    const bad = whitelisted(tokens).filter((t) => t.decimals <= 0);
    return { passed: bad.length === 0, detail: bad.length ? bad.map((t) => t.address).join(', ') : whitelisted(tokens).length + ' tokens have decimals' };
  });
});

Then('every whitelisted token carries a positive weight and every de-listed entry carries none', OPT, async function () {
  await withData(this, 'weight tracks whitelisting', loadTokens, (tokens) => {
    const bad = tokens.filter((t) => (t.whitelisted ? t.weight <= 0n : t.weight !== 0n));
    return { passed: bad.length === 0, detail: bad.length ? bad.map((t) => `${t.address} whitelisted=${t.whitelisted} weight=${t.weight}`).join(', ') : tokens.length + ' entries consistent' };
  });
});

Then('every token\'s non-zero short interest has a non-zero average price', OPT, async function () {
  await withData(this, 'short size 0 or avg price > 0, every token', loadTokens, (tokens) => {
    const priced = whitelisted(tokens);
    const bad = priced.filter((t) => t.globalShortSize > 0n && t.globalShortAveragePrice === 0n);
    return { passed: bad.length === 0, detail: bad.length ? bad.map((t) => t.address).join(', ') : priced.length + ' tokens consistent' };
  });
});

Then('every whitelisted token holds a positive pool amount', OPT, async function () {
  await withData(this, 'poolAmount > 0, every whitelisted token', loadTokens, (tokens) => {
    const bad = whitelisted(tokens).filter((t) => t.poolAmount <= 0n);
    return { passed: bad.length === 0, detail: bad.length ? bad.map((t) => `${t.address} pool=0`).join(', ') : whitelisted(tokens).length + ' tokens funded' };
  });
});

Then('every stable token is flagged, carries a positive weight, and holds zero guaranteed USD', OPT, async function () {
  await withData(this, 'stablecoins weighted, flagged, zero guaranteed USD', loadTokens, (tokens) => {
    const stables = whitelisted(tokens).filter((t) => t.stable);
    const bad = stables.filter((t) => !(t.weight > 0n && t.guaranteedUsd === 0n));
    return { passed: stables.length > 0 && bad.length === 0, detail: bad.length ? bad.map((t) => `${t.address} weight=${t.weight} guaranteedUsd=${t.guaranteedUsd}`).join(', ') : stables.length + ' stablecoins consistent' };
  });
});

Then('every token\'s cumulative funding rate is non-negative', OPT, async function () {
  await withData(this, 'cumulativeFundingRate >= 0, every token', loadTokens, (tokens) => {
    const priced = whitelisted(tokens);
    const bad = priced.filter((t) => t.cumulativeFundingRate < 0n);
    return { passed: bad.length === 0, detail: bad.length ? bad.map((t) => t.address).join(', ') : priced.length + ' tokens non-negative' };
  });
});

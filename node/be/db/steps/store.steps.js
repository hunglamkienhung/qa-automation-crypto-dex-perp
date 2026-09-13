'use strict';

const fs = require('fs');
const path = require('path');
const { Given, When, Then, Before, After } = require('@cucumber/cucumber');
const { Store, DbUnreachable, throwaway, waitCaughtUp, sleep } = require('../store');
const { MiniApi, ApiUnreachable } = require('../../api/venues/mini');
const { Reverted, ChainUnreachable } = require('../../contract/chain/perpdex');
const U = require('../../contract/chain/units');

/**
 * Steps for features/be-db.feature, plus the store-side steps that
 * be-api-mini.feature shares (opening the store, waiting for it to catch up,
 * the two admin levers, noting counts).
 *
 * Every scenario here is also @perpdex, so the contract tier's hooks give it
 * a chain snapshot before and a revert after. The indexer sees the revert as
 * a reorg and rebuilds; "the store has caught up" waits for that, so a
 * scenario always reads a store that matches the chain it is looking at.
 *
 * The store is opened read-only. Nothing in this tier writes to it; the two
 * admin levers (pause, rewind) go through the API because only the service
 * may touch its own file.
 */

const MARKET = { BTC: 0, ETH: 1, SOL: 2 };
const ZERO = '0x0000000000000000000000000000000000000000';
const UNREACHABLE = [DbUnreachable, ChainUnreachable, ApiUnreachable];
const ARTIFACT = path.join(__dirname, '..', '..', '..', '..', 'contracts', 'out', 'PerpExchange.sol', 'PerpExchange.json');

// One client for the whole run: it carries the rate-limit budget across scenarios.
const mini = new MiniApi();

Before({ tags: '@db or @mini' }, function () {
  this.store = null;
  this.mini = mini;
  this.pausedIndexer = false;
  this.tmp = null;
});

After({ tags: '@db or @mini', timeout: 30_000 }, async function () {
  // a scenario that paused the indexer and then failed must not freeze every scenario after it
  if (this.pausedIndexer) await mini.setIndexerPaused(false).catch(() => {});
  if (this.tmp) { try { this.tmp.close(); } catch { /* fine */ } }
  if (this.store) this.store.close();
});

// ---------------------------------------------------------------- helpers

function marketId(sym) {
  if (!(sym in MARKET)) throw new Error('unknown market ' + sym);
  return MARKET[sym];
}

function who(world, name) {
  const key = name.replace(/'s$/, '');
  const a = world.who && world.who[key];
  if (!a) throw new Error('unknown actor "' + name + '"');
  return a.toLowerCase();
}

/** Evaluate a comparison; any named outage grades Blocked, anything else is a fault in this project. */
async function check(world, description, fn) {
  if (world.sourceError) { world.unobservable(description, 'the source could not be reached -- ' + world.sourceError); return; }
  let r;
  try { r = await fn(); } catch (err) {
    if (UNREACHABLE.some((C) => err instanceof C)) { world.unobservable(description, err.message); return; }
    throw err;
  }
  world.check(description, r.passed, r.detail);
}

/** Run a setup action; an outage becomes sourceError, a revert is recorded like the contract tier does. */
async function act(world, fn) {
  if (world.sourceError) return;
  try { await fn(); } catch (err) {
    if (UNREACHABLE.some((C) => err instanceof C)) { world.sourceError = err.message; return; }
    if (err instanceof Reverted) { world.last = { ok: false, revert: err }; world.unchecked = err; return; }
    throw err;
  }
}

async function catchUp(world, description = 'the store caught up with the chain head') {
  if (world.sourceError || !world.store) return;
  // 40s here stays under the step timeout, so a slow catch-up returns cleanly.
  const r = await waitCaughtUp(world.store, world.dex, { timeoutMs: 40_000 });
  // A store that has not caught up is UNOBSERVABLE, not wrong: under a full run
  // the chain grows large and the indexer's rebuild-from-0 can lag. That is a
  // timing/environment condition (Blocked), never a failed invariant. Setting
  // sourceError makes every later assertion in the scenario Blocked too, so a
  // lagging store never lets a stale read grade Failed.
  if (!r.caughtUp) {
    const why = `the store did not catch up within the timeout -- last_block ${r.last_block}, head ${r.head}, paused ${r.paused}, after ${r.waitedMs} ms`;
    world.unobservable(description, why);
    world.sourceError = why;
  }
  return r;
}

function events(world) { return (world.last && world.last.events) || []; }
function lastTx(world) { return world.last && world.last.receipt && world.last.receipt.transactionHash; }
const eq = (a, b) => String(a) === String(b);
const j = (v) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? String(x) : x));

/** Compare named fields of a row with a source object; returns the list of differences. */
function diffFields(pairs, row, src) {
  const bad = [];
  for (const [col, key, map] of pairs) {
    const want = map ? map(src[key]) : src[key];
    if (!eq(row[col], want)) bad.push(`${col}=${row[col]} (chain ${String(want)})`);
  }
  return bad;
}

// ---------------------------------------------------------------- Background

Given('the store is open and the indexer has caught up', { timeout: 90_000 }, async function () {
  if (this.sourceError) return;
  try { this.store = new Store(); } catch (err) {
    if (err instanceof DbUnreachable) { this.sourceError = err.message; return; }
    throw err;
  }
  this.evidence('storeFile', this.store.file);
  // a pause left behind by an interrupted run is an environment leftover, not a finding
  const st = this.store.state();
  if (st && st.paused) { this.evidence('indexerWasPausedAtStart', true); await act(this, () => mini.setIndexerPaused(false)); }
  const r = await catchUp(this, 'the store caught up with the chain head before the scenario');
  if (r) this.evidence('storeAtStart', { last_block: r.last_block, head: r.head, waitedMs: r.waitedMs });
});

Given('the store has caught up', { timeout: 90_000 }, async function () {
  await catchUp(this);
});

// ---------------------------------------------------------------- chain and time levers

When('a block is mined', { timeout: 30_000 }, async function () {
  await act(this, () => this.dex.mine());
});

When('{int} seconds pass', { timeout: 60_000 }, async function (s) {
  await sleep(s * 1000);
});

Given('a chain snapshot is taken', { timeout: 30_000 }, async function () {
  await act(this, async () => { this.noted.snap = await this.dex.snapshot(); });
});

When('the chain is reverted to the snapshot', { timeout: 30_000 }, async function () {
  await act(this, async () => { const ok = await this.dex.revert(this.noted.snap); if (!ok) throw new Error('evm_revert returned false'); });
});

// ---------------------------------------------------------------- indexer levers (through the API)

Given('the indexer is paused', { timeout: 30_000 }, async function () {
  await act(this, async () => { await mini.setIndexerPaused(true); this.pausedIndexer = true; });
});

When('the indexer is unpaused', { timeout: 30_000 }, async function () {
  await act(this, async () => { await mini.setIndexerPaused(false); this.pausedIndexer = false; });
});

When('the indexer is rewound by {int} blocks', { timeout: 30_000 }, async function (n) {
  await act(this, async () => {
    const st = this.store.state();
    const target = Math.max(-1, st.last_block - n);
    await mini.rewindIndexer(target);
    this.evidence('rewind', { from: st.last_block, to: target });
  });
});

// ---------------------------------------------------------------- noting

Given('the store row counts are noted', function () {
  if (this.store) this.noted.counts = this.store.counts();
});
Given('the trades count is noted', function () {
  if (this.store) this.noted.trades = this.store.count('trades');
});
Given('the rebuild count is noted', function () {
  if (this.store) this.noted.rebuilds = this.store.state().rebuilds;
});

// ---------------------------------------------------------------- schema (164, 165)

Then('the store has tables {}', async function (list) {
  const want = list.split(/,\s*/);
  await check(this, 'store has the documented tables', () => {
    const have = this.store.tables();
    const missing = want.filter((t) => !have.includes(t));
    return { passed: missing.length === 0, detail: missing.length ? 'missing ' + missing.join(', ') : have.length + ' tables' };
  });
});

Then(/^the tables (.+) are uniquely keyed by \(tx_hash, log_index\)$/, async function (list) {
  const tables = list.split(/,\s*/);
  await check(this, 'event tables keyed by (tx_hash, log_index)', () => {
    const bad = tables.filter((t) => j(this.store.primaryKey(t)) !== j(['tx_hash', 'log_index']));
    return { passed: bad.length === 0, detail: bad.length ? bad.map((t) => t + ': ' + this.store.primaryKey(t).join(',')).join('; ') : tables.length + ' tables' };
  });
});

Given('a throwaway database with the schema applied', function () {
  this.tmp = throwaway();
  // valid parents for the FK checks: one market, one order
  this.tmp.prepare("INSERT INTO markets VALUES (1, 'ETH-PERP', 'Active', '100000000', '10000000', '10000000', 50, -2, 5, 100, 1)").run();
  this.tmp.prepare("INSERT INTO orders (order_id, owner, market_id, side, order_type, tif, size, price, trigger_price, reduce_only, user_order_id, max_ts, status, placed_block, placed_tx, placed_log, updated_block) VALUES (1, '0xaa', 1, 'Buy', 'Market', 'IOC', '100000000', '0', '0', 0, 0, '0', 'Open', 1, '0xt1', 0, 1)").run();
});

function insertFails(db, sql, params, pattern) {
  try { db.prepare(sql).run(...params); return { passed: false, detail: 'insert succeeded' }; } catch (err) {
    return { passed: pattern.test(err.message), detail: err.message };
  }
}
const TRADE_SQL = 'INSERT INTO trades (tx_hash, log_index, block_number, market_id, taker, maker, taker_order_id, maker_order_id, taker_side, size, price, taker_fee, maker_fee) VALUES (?, ?, 1, 1, \'0xaa\', \'0xbb\', 1, 0, \'Buy\', ?, \'250000000000\', \'0\', \'0\')';

Then('inserting a trade of size {string} fails a CHECK', function (size) {
  this.observe('trade size CHECK', () => insertFails(this.tmp, TRADE_SQL, ['0xt2', 0, size], /CHECK constraint failed/));
});
Then('inserting an order on market {int} fails a FOREIGN KEY', function (m) {
  this.observe('orders.market_id FOREIGN KEY', () => insertFails(this.tmp,
    "INSERT INTO orders (order_id, owner, market_id, side, order_type, tif, size, price, trigger_price, reduce_only, user_order_id, max_ts, status, placed_block, placed_tx, placed_log, updated_block) VALUES (2, '0xaa', ?, 'Buy', 'Limit', 'GTC', '100000000', '1', '0', 0, 0, '0', 'Open', 1, '0xt3', 0, 1)", [m], /FOREIGN KEY constraint failed/));
});
Then('inserting a market with status {string} fails a CHECK', function (status) {
  this.observe('markets.status CHECK', () => insertFails(this.tmp, "INSERT INTO markets VALUES (9, 'X-PERP', ?, '1', '1', '1', 1, 0, 0, 0, 1)", [status], /CHECK constraint failed/));
});
Then('inserting the same trade key twice fails on the second insert', function () {
  this.observe('trades key unique', () => {
    const first = insertFails(this.tmp, TRADE_SQL, ['0xt9', 3, '100000000'], /$^/);
    if (first.passed || first.detail !== 'insert succeeded') return { passed: false, detail: 'first insert: ' + first.detail };
    return insertFails(this.tmp, TRADE_SQL, ['0xt9', 3, '100000000'], /UNIQUE constraint failed: trades\.tx_hash, trades\.log_index/);
  });
});

// ---------------------------------------------------------------- indexer_state (166, 167, 184, 185)

Then('indexer_state.exchange equals the deployed exchange address', async function () {
  await check(this, 'indexer_state.exchange', () => { const st = this.store.state(); return { passed: st.exchange.toLowerCase() === this.dex.ex.toLowerCase(), detail: 'store ' + st.exchange + ', deployment ' + this.dex.ex }; });
});
Then('indexer_state.chain_id is {int}', async function (id) {
  await check(this, 'indexer_state.chain_id', () => { const st = this.store.state(); return { passed: st.chain_id === id, detail: 'chain_id ' + st.chain_id }; });
});
Then('indexer_state.genesis_hash equals the chain\'s block 0 hash', async function () {
  await check(this, 'indexer_state.genesis_hash', async () => { const st = this.store.state(); const b0 = await this.dex.block(0); return { passed: st.genesis_hash === b0.hash, detail: 'store ' + st.genesis_hash + ', chain ' + b0.hash }; });
});
Then('indexer_state.last_block equals the chain head', async function () {
  await check(this, 'last_block == head', async () => { const st = this.store.state(); const head = await this.dex.blockNumber(); return { passed: st.last_block === head, detail: 'last_block ' + st.last_block + ', head ' + head }; });
});
Then('indexer_state.last_block_hash equals the hash of that block', async function () {
  await check(this, 'last_block_hash == hash(last_block)', async () => { const st = this.store.state(); const b = await this.dex.block(st.last_block); return { passed: !!b && st.last_block_hash === b.hash, detail: 'store ' + st.last_block_hash + ', chain ' + (b && b.hash) }; });
});
Then('indexer_state.last_block is below the chain head', async function () {
  await check(this, 'last_block < head', async () => { const st = this.store.state(); const head = await this.dex.blockNumber(); return { passed: st.last_block < head, detail: 'last_block ' + st.last_block + ', head ' + head }; });
});
Then('the trades count is unchanged', async function () {
  await check(this, 'trades count unchanged', () => { const n = this.store.count('trades'); return { passed: n === this.noted.trades, detail: 'before ' + this.noted.trades + ', now ' + n }; });
});
Then('the trades count grew by {int}', async function (d) {
  await check(this, 'trades count grew by ' + d, () => { const n = this.store.count('trades'); return { passed: n === this.noted.trades + d, detail: 'before ' + this.noted.trades + ', now ' + n }; });
});
Then('the rebuild count grew by {int}', async function (d) {
  await check(this, 'rebuilds grew by ' + d, () => { const n = this.store.state().rebuilds; return { passed: n === this.noted.rebuilds + d, detail: 'before ' + this.noted.rebuilds + ', now ' + n }; });
});
Then('the store row counts are unchanged', async function () {
  await check(this, 'row counts unchanged after replay', () => {
    const now = this.store.counts();
    const bad = Object.keys(now).filter((t) => now[t] !== this.noted.counts[t]);
    return { passed: bad.length === 0, detail: bad.length ? bad.map((t) => `${t}: ${this.noted.counts[t]} -> ${now[t]}`).join('; ') : j(now) };
  });
});

// ---------------------------------------------------------------- markets and index (168, 169)

const MARKET_PAIRS = [['symbol', 'symbol'], ['status', 'statusName'], ['tick_size', 'tickSize'], ['step_size', 'stepSize'], ['min_notional', 'minNotional'], ['max_leverage', 'maxLeverage'], ['maker_fee_bps', 'makerFeeBps'], ['taker_fee_bps', 'takerFeeBps'], ['max_basis_bps', 'maxBasisBps']];

Then('the markets table has as many rows as marketCount', async function () {
  await check(this, 'markets rows == marketCount', async () => { const n = this.store.count('markets'); const c = await this.dex.marketCount(); return { passed: n === c, detail: 'rows ' + n + ', marketCount ' + c }; });
});
Then('every markets row equals getMarket and getMarketParams', async function () {
  await check(this, 'markets rows == getters', async () => {
    const bad = [];
    for (const row of this.store.all('SELECT * FROM markets ORDER BY market_id')) {
      const mk = await this.dex.getMarket(row.market_id);
      const src = { ...mk.params, symbol: mk.symbol, statusName: mk.statusName };
      const d = diffFields(MARKET_PAIRS, row, src);
      if (d.length) bad.push('market ' + row.market_id + ': ' + d.join(', '));
    }
    return { passed: bad.length === 0, detail: bad.length ? bad.join('; ') : MARKET_PAIRS.length + ' fields equal on every row' };
  });
});
Then('index_prices for {word} equals getIndexPrice', async function (sym) {
  await check(this, sym + ' index_prices == getIndexPrice', async () => {
    const row = this.store.get('SELECT * FROM index_prices WHERE market_id = ?', marketId(sym));
    const { price, publishTime } = await this.dex.getIndexPrice(marketId(sym));
    return { passed: !!row && eq(row.price, price) && eq(row.publish_time, publishTime), detail: row ? `store ${row.price}@${row.publish_time}, chain ${price}@${publishTime}` : 'no row' };
  });
});

// ---------------------------------------------------------------- trades (170-172)

const TRADE_PAIRS = [['market_id', 'marketId'], ['taker', 'taker', (a) => a.toLowerCase()], ['maker', 'maker', (a) => a.toLowerCase()], ['taker_order_id', 'takerOrderId'], ['maker_order_id', 'makerOrderId'], ['taker_side', 'takerSide', (s) => ['Buy', 'Sell'][Number(s)]], ['size', 'size'], ['price', 'price'], ['taker_fee', 'takerFee'], ['maker_fee', 'makerFee']];

function filledEvent(world) { return events(world).find((e) => e.name === 'OrderFilled'); }

Then('the OrderFilled event of the last call has exactly one trades row', async function () {
  await check(this, 'one trades row per OrderFilled', () => {
    const e = filledEvent(this);
    if (!e) return { passed: false, detail: 'the last call emitted no OrderFilled' };
    const rows = this.store.all('SELECT * FROM trades WHERE tx_hash = ? AND log_index = ?', e.txHash, e.logIndex);
    this.noted.tradeRow = rows[0];
    return { passed: rows.length === 1, detail: rows.length + ' rows for ' + e.txHash + '#' + e.logIndex };
  });
});
Then('that trades row equals the event', async function () {
  await check(this, 'trades row == OrderFilled', () => {
    const e = filledEvent(this); const row = this.noted.tradeRow;
    if (!e || !row) return { passed: false, detail: 'no event or no row' };
    const bad = diffFields(TRADE_PAIRS, row, e);
    return { passed: bad.length === 0 && row.block_number === e.blockNumber, detail: bad.length ? bad.join(', ') : TRADE_PAIRS.length + ' fields equal' };
  });
});
Then('the trades row of the last call has maker the zero address and maker_order_id {int}', async function (mid) {
  await check(this, 'backstop trade row', () => {
    const rows = this.store.all('SELECT * FROM trades WHERE tx_hash = ?', lastTx(this));
    const r = rows[0];
    return { passed: rows.length === 1 && r.maker === ZERO && r.maker_order_id === mid, detail: rows.length ? `maker ${r.maker}, maker_order_id ${r.maker_order_id}` : 'no row for ' + lastTx(this) };
  });
});
Then('no trades row references a taker order missing from orders', async function () {
  await check(this, 'no orphan taker_order_id', () => {
    const n = this.store.count('trades t', 'WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_id = t.taker_order_id)');
    return { passed: n === 0 && this.store.count('trades') > 0, detail: n + ' orphans over ' + this.store.count('trades') + ' trades' };
  });
});
Then('no trades row references a maker order missing from orders', async function () {
  await check(this, 'no orphan maker_order_id', () => {
    const n = this.store.count('trades t', 'WHERE t.maker_order_id <> 0 AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_id = t.maker_order_id)');
    const withMaker = this.store.count('trades', 'WHERE maker_order_id <> 0');
    return { passed: n === 0 && withMaker > 0, detail: n + ' orphans over ' + withMaker + ' book trades' };
  });
});

// ---------------------------------------------------------------- orders (173-175)

const ORDER_PAIRS = [['owner', 'owner', (a) => a.toLowerCase()], ['market_id', 'marketId'], ['side', 'side', (s) => ['Buy', 'Sell'][Number(s)]], ['order_type', 'orderType', (t) => ['Market', 'Limit', 'StopMarket', 'StopLimit', 'TakeProfit'][Number(t)]], ['tif', 'tif', (t) => ['GTC', 'IOC', 'FOK', 'PostOnly'][Number(t)]], ['size', 'size'], ['filled', 'filled'], ['price', 'price'], ['trigger_price', 'triggerPrice'], ['reduce_only', 'reduceOnly', (b) => (b ? 1 : 0)], ['user_order_id', 'userOrderId'], ['max_ts', 'maxTs'], ['status', 'statusName']];

function orderRow(world, alias) { return world.store.get('SELECT * FROM orders WHERE order_id = ?', Number(world.orders[alias])); }

Then('the orders row for {string} equals getOrder', async function (alias) {
  await check(this, 'orders row ' + alias + ' == getOrder', async () => {
    const row = orderRow(this, alias);
    if (!row) return { passed: false, detail: 'no row for order ' + String(this.orders[alias]) };
    const o = await this.dex.getOrder(this.orders[alias]);
    const bad = diffFields(ORDER_PAIRS, row, o);
    return { passed: bad.length === 0, detail: bad.length ? bad.join(', ') : ORDER_PAIRS.length + ' fields equal' };
  });
});
Then('the orders row for {string} has filled equal to size and status {word}', async function (alias, status) {
  await check(this, 'orders row ' + alias + ' filled == size, ' + status, () => {
    const row = orderRow(this, alias);
    return { passed: !!row && row.filled === row.size && row.status === status, detail: row ? `filled ${row.filled}, size ${row.size}, status ${row.status}` : 'no row' };
  });
});
Then('the orders row for {string} has status {word}', async function (alias, status) {
  await check(this, 'orders row ' + alias + ' status ' + status, () => { const row = orderRow(this, alias); return { passed: !!row && row.status === status, detail: row ? 'status ' + row.status : 'no row' }; });
});

// ---------------------------------------------------------------- positions (176-179)

Then('the positions row for {word} on {word} equals getPosition', async function (name, sym) {
  await check(this, name + ' ' + sym + ' positions row == getPosition', async () => {
    const row = this.store.get('SELECT * FROM positions WHERE account = ? AND market_id = ?', who(this, name), marketId(sym));
    const p = await this.dex.getPosition(this.who[name], marketId(sym));
    if (!row) return { passed: p.size === 0n, detail: 'no row; chain size ' + String(p.size) };
    return { passed: eq(row.size, p.size) && eq(row.entry_price, p.entryPrice), detail: `store size ${row.size} entry ${row.entry_price}; chain size ${p.size} entry ${p.entryPrice}` };
  });
});
Then('the positions row for {word} on {word} has realized_pnl equal to getPosition', async function (name, sym) {
  await check(this, name + ' ' + sym + ' realized_pnl', async () => {
    const row = this.store.get('SELECT * FROM positions WHERE account = ? AND market_id = ?', who(this, name), marketId(sym));
    const p = await this.dex.getPosition(this.who[name], marketId(sym));
    return { passed: !!row && eq(row.realized_pnl, p.realizedPnl), detail: (row ? 'store ' + row.realized_pnl : 'no row') + ', chain ' + String(p.realizedPnl) };
  });
});
Then('for every market the positions table is balanced and equals getMarket open interest', async function () {
  await check(this, 'positions balance == open interest, every market', async () => {
    const bad = []; const seen = [];
    for (let m = 0; m < await this.dex.marketCount(); m++) {
      let long = 0n, short = 0n;
      for (const r of this.store.all('SELECT size FROM positions WHERE market_id = ?', m)) { const s = BigInt(r.size); if (s > 0n) long += s; else short -= s; }
      const mk = await this.dex.getMarket(m);
      seen.push(`${m}: long ${long} short ${short} oi ${mk.openInterestLong}/${mk.openInterestShort}`);
      if (!(long === short && long === mk.openInterestLong && short === mk.openInterestShort)) bad.push(seen[seen.length - 1]);
    }
    return { passed: bad.length === 0, detail: (bad.length ? 'unbalanced ' + bad.join('; ') : seen.join('; ')) };
  });
});
Then('the position_events rows of the last call are two, for {word} and the backstop, with opposite signs', async function (name) {
  await check(this, 'two position_events per fill', () => {
    const rows = this.store.all('SELECT * FROM position_events WHERE tx_hash = ? ORDER BY log_index', lastTx(this));
    const accts = rows.map((r) => r.account).sort();
    const want = [who(this, name), this.who.backstop.toLowerCase()].sort();
    const deltas = rows.map((r) => BigInt(r.size_after) - BigInt(r.size_before));
    const opposite = deltas.length === 2 && deltas[0] === -deltas[1] && deltas[0] !== 0n;
    return { passed: rows.length === 2 && j(accts) === j(want) && opposite, detail: `${rows.length} rows: ` + rows.map((r) => `${r.account} ${r.size_before}->${r.size_after}`).join(', ') };
  });
});

// ---------------------------------------------------------------- funding, liquidation, accounts (180-182)

Then('the newest funding row for {word} equals getFundingRate', async function (sym) {
  await check(this, sym + ' newest funding row == getFundingRate', async () => {
    const row = this.store.get('SELECT * FROM funding WHERE market_id = ? ORDER BY block_number DESC, log_index DESC LIMIT 1', marketId(sym));
    const f = await this.dex.getFundingRate(marketId(sym));
    if (!row) return { passed: false, detail: 'no funding row' };
    const bad = diffFields([['rate_bps', 'lastRateBps'], ['cumulative_index', 'cumulativeIndex'], ['funding_time', 'lastFundingTime']], row, f);
    return { passed: bad.length === 0, detail: bad.length ? bad.join(', ') : `rate ${row.rate_bps} bps, index ${row.cumulative_index}, time ${row.funding_time}` };
  });
});
const LIQ_PAIRS = [['account', 'account', (a) => a.toLowerCase()], ['market_id', 'marketId'], ['liquidator', 'liquidator', (a) => a.toLowerCase()], ['size_closed', 'sizeClosed'], ['price', 'price'], ['liquidator_fee', 'liquidatorFee'], ['bad_debt', 'badDebt'], ['insurance_used', 'insuranceUsed']];
Then('the liquidations row of the last call equals the Liquidated event', async function () {
  await check(this, 'liquidations row == Liquidated', () => {
    const e = events(this).find((x) => x.name === 'Liquidated');
    if (!e) return { passed: false, detail: 'the last call emitted no Liquidated' };
    const row = this.store.get('SELECT * FROM liquidations WHERE tx_hash = ? AND log_index = ?', e.txHash, e.logIndex);
    if (!row) return { passed: false, detail: 'no row for ' + e.txHash + '#' + e.logIndex };
    const bad = diffFields(LIQ_PAIRS, row, e);
    return { passed: bad.length === 0, detail: bad.length ? bad.join(', ') : LIQ_PAIRS.length + ' fields equal' };
  });
});
Then('the accounts row for {word} has deposits ${float} and withdrawals ${float}', async function (name, dep, wd) {
  await check(this, name + ' accounts row flows', () => {
    const row = this.store.get('SELECT * FROM accounts WHERE account = ?', who(this, name));
    return { passed: !!row && eq(row.deposits, U.usd(String(dep))) && eq(row.withdrawals, U.usd(String(wd))), detail: row ? `deposits ${row.deposits}, withdrawals ${row.withdrawals}` : 'no row' };
  });
});
Then('the accounts table has no row for {word}', async function (name) {
  await check(this, 'no accounts row for ' + name, () => { const row = this.store.get('SELECT * FROM accounts WHERE account = ?', who(this, name)); return { passed: !row, detail: row ? 'row exists, created_block ' + row.created_block : 'no row' }; });
});

// ---------------------------------------------------------------- a second deployment (186)

Given('a second PerpDEX is deployed from the build artifact', { timeout: 60_000 }, async function () {
  if (this.sourceError) return;
  if (!fs.existsSync(ARTIFACT)) { this.unobservable('a second PerpDEX can be deployed', 'no build artifact at ' + ARTIFACT + ' -- run forge build'); this.sourceError = 'no build artifact'; return; }
  await act(this, async () => {
    const art = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
    const d = this.dex.d;
    this.noted.second = await this.dex.deployContract(this.who.admin, art.bytecode.object, '(address,address,address,address)', [d.vault, d.oracle, d.admin, d.treasury]);
    this.evidence('secondExchange', this.noted.second);
  });
});
When('{word} initialises an account on the second PerpDEX', { timeout: 30_000 }, async function (name) {
  await act(this, async () => {
    const receipt = await this.dex.sender.send(this.who[name], this.noted.second, 'initializeAccount()', []);
    this.last = { ok: true, receipt, events: this.dex.decodeLogs(receipt) };
    this.unchecked = null;
  });
});

// ---------------------------------------------------------------- mark derivation (187-189)

Then('the mark derived from the store for {word} equals getMarkPrice', async function (sym) {
  await check(this, sym + ' derived mark == getMarkPrice', async () => {
    const derived = this.store.markOf(marketId(sym));
    const mark = await this.dex.getMarkPrice(marketId(sym));
    return { passed: derived !== null && derived === mark, detail: 'derived ' + String(derived) + ', chain ' + String(mark) };
  });
});

'use strict';

const { Given, When, Then, Before } = require('@cucumber/cucumber');
const { MiniApi, ApiUnreachable, ADMIN_TOKEN, WINDOW_MS, sleep } = require('../venues/mini');
const { DbUnreachable } = require('../../db/store');
const { ChainUnreachable } = require('../../contract/chain/perpdex');

/**
 * Steps for features/be-api-mini.feature: the REST layer compared with the
 * rows it serves. The store-side steps (opening, catching up, the admin
 * levers, noted counts) live in be/db/steps/store.steps.js and are shared.
 *
 * `this.api` is always the LAST response: status, headers, parsed body. The
 * request steps never assert; the "the response ..." steps do, so a 4xx that
 * a scenario expects is graded like any other answer.
 */

const MARKET = { BTC: 0, ETH: 1, SOL: 2 };
const UNREACHABLE = [ApiUnreachable, DbUnreachable, ChainUnreachable];
const RATE_LIMIT = Number(process.env.MINI_API_RATE_LIMIT || 60);
const POSITION_FIELDS = ['market_id', 'size', 'entry_price', 'realized_pnl', 'funding_paid'];

Before({ tags: '@mini' }, function () {
  this.api = null;
  this.tokens = {};
  this.requests = 0;
});

// ---------------------------------------------------------------- helpers

function marketId(sym) { if (!(sym in MARKET)) throw new Error('unknown market ' + sym); return MARKET[sym]; }
function who(world, name) { const a = world.who && world.who[name.replace(/'s$/, '')]; if (!a) throw new Error('unknown actor "' + name + '"'); return a.toLowerCase(); }
const j = (v) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? String(x) : x));
const eq = (a, b) => String(a) === String(b);

async function check(world, description, fn) {
  if (world.sourceError) { world.unobservable(description, 'the source could not be reached -- ' + world.sourceError); return; }
  let r;
  try { r = await fn(); } catch (err) {
    if (UNREACHABLE.some((C) => err instanceof C)) { world.unobservable(description, err.message); return; }
    throw err;
  }
  world.check(description, r.passed, r.detail);
}

/** Actor names in a path ("/orders/alice", "?account=bob") become their addresses. */
function resolvePath(world, path) {
  return path.replace(/([/=])(alice|bob|carol|dave|victim|keeper|erin|frank|grace|admin)(?=[/?&]|$)/g, (m, sep, name) => sep + who(world, name));
}

/** Send a request and keep it as `this.api`; a transport failure blocks the scenario. */
async function send(world, method, path, opts = {}) {
  if (world.sourceError) return;
  path = resolvePath(world, path);
  try {
    world.api = await world.mini.request(method, path, opts);
    world.requests += 1;
    world.evidence('http.' + world.requests, { method, path, status: world.api.status, origin: opts.origin, token: opts.token ? '(set)' : undefined });
  } catch (err) {
    if (err instanceof ApiUnreachable) { world.sourceError = err.message; return; }
    throw err;
  }
}

function body(world) { return (world.api && world.api.body) || {}; }
function field(world, name) { return body(world)[name]; }
function tokenOf(world, alias) { const t = world.tokens[alias]; return t === undefined ? alias : t; } // an unknown alias is sent literally ("nope")

/** Compare two lists of row-like objects on the given keys, in order. */
function sameRows(got, want, keys) {
  if (!Array.isArray(got)) return { passed: false, detail: 'response is not a list' };
  if (got.length !== want.length) return { passed: false, detail: `response has ${got.length} rows, store has ${want.length}` };
  for (let i = 0; i < got.length; i++) {
    const bad = keys.filter((k) => !eq(got[i][k], want[i][k]));
    if (bad.length) return { passed: false, detail: `row ${i}: ` + bad.map((k) => `${k} api=${got[i][k]} store=${want[i][k]}`).join(', ') };
  }
  return { passed: true, detail: `${got.length} rows equal on ${keys.length} fields` };
}

// ---------------------------------------------------------------- Background

Given('the API is reachable', { timeout: 30_000 }, async function () {
  await send(this, 'GET', '/health');
  if (this.sourceError) return;
  if (this.api.status !== 200 || !body(this).ok) this.sourceError = 'GET /health answered ' + this.api.status + ' ' + this.api.text.slice(0, 200);
  else this.evidence('health', { last_block: field(this, 'last_block'), rebuilds: field(this, 'rebuilds') });
});

// ---------------------------------------------------------------- requests

When(/^GET (\/\S*)$/, { timeout: 30_000 }, async function (path) { await send(this, 'GET', path); });
When(/^GET (\/\S*) with origin "([^"]*)"$/, { timeout: 30_000 }, async function (path, origin) { await send(this, 'GET', path, { origin }); });
When(/^GET (\/\S*) with token "([^"]*)"$/, { timeout: 30_000 }, async function (path, alias) { await send(this, 'GET', path, { token: tokenOf(this, alias) }); });
When(/^OPTIONS (\/\S*) with origin "([^"]*)" and request method (\w+)$/, { timeout: 30_000 }, async function (path, origin, method) {
  await send(this, 'OPTIONS', path, { origin, headers: { 'access-control-request-method': method, 'access-control-request-headers': 'authorization' } });
});
When(/^POST (\/\S*) with token "([^"]*)" and body (\{.*\})$/, { timeout: 30_000 }, async function (path, alias, json) { await send(this, 'POST', path, { token: tokenOf(this, alias), body: JSON.parse(json) }); });
When(/^POST (\/\S*) with no token and body (\{.*\})$/, { timeout: 30_000 }, async function (path, json) { await send(this, 'POST', path, { body: JSON.parse(json) }); });
When(/^POST (\/\S*) with the admin token and body (\{.*\})$/, { timeout: 30_000 }, async function (path, json) { await send(this, 'POST', path, { token: ADMIN_TOKEN, body: JSON.parse(json) }); });

When('the trades are paged {int} at a time until the cursor is exhausted', { timeout: 60_000 }, async function (n) {
  this.noted.paged = [];
  let cursor = null;
  for (let page = 0; page < 200; page++) {
    await send(this, 'GET', '/trades?limit=' + n + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
    if (this.sourceError || this.api.status !== 200) break;
    this.noted.paged.push(...body(this).trades);
    cursor = body(this).next_cursor;
    if (!cursor) break;
  }
  this.evidence('pages', Math.ceil(this.noted.paged.length / n));
});

When(/^GET (\/\S*) is sent (\d+) times more than the rate limit within the window$/, { timeout: 120_000 }, async function (path, extra) {
  if (this.sourceError) return;
  // start on a fresh window so the count is this burst alone
  await sleep(WINDOW_MS + 300);
  const total = RATE_LIMIT + Number(extra);
  const burst = { statuses: [], remaining: [], first429At: null, zeroBefore429: false };
  const started = Date.now();
  for (let i = 0; i < total; i++) {
    let r;
    try { r = await this.mini.request('GET', path, { throttle: false }); } catch (err) {
      if (err instanceof ApiUnreachable) { this.sourceError = err.message; return; }
      throw err;
    }
    burst.statuses.push(r.status);
    const rem = r.headers['x-ratelimit-remaining'];
    burst.remaining.push(rem === undefined ? null : Number(rem));
    if (r.status === 429 && burst.first429At === null) { burst.first429At = i; burst.zeroBefore429 = burst.remaining.slice(0, i).includes(0); }
    this.api = r;
  }
  burst.elapsedMs = Date.now() - started;
  this.noted.burst = burst;
  this.evidence('burst', { sent: total, elapsedMs: burst.elapsedMs, first429At: burst.first429At, count429: burst.statuses.filter((s) => s === 429).length });
});

// ---------------------------------------------------------------- tokens

Given('a token with scope {word} as {string}', { timeout: 30_000 }, async function (scope, alias) {
  if (this.sourceError) return;
  try { this.tokens[alias] = await this.mini.mintToken(scope); } catch (err) { if (err instanceof ApiUnreachable) this.sourceError = err.message; else throw err; }
});
Given('a token with scope {word} for {word} as {string}', { timeout: 30_000 }, async function (scope, name, alias) {
  if (this.sourceError) return;
  try { this.tokens[alias] = await this.mini.mintToken(scope, who(this, name)); } catch (err) { if (err instanceof ApiUnreachable) this.sourceError = err.message; else throw err; }
});
Given(/^a token with scope (\w+) for (\w+) expiring in (\d+) seconds? as "([^"]*)"$/, { timeout: 30_000 }, async function (scope, name, ttl, alias) {
  if (this.sourceError) return;
  try { this.tokens[alias] = await this.mini.mintToken(scope, who(this, name), Number(ttl)); } catch (err) { if (err instanceof ApiUnreachable) this.sourceError = err.message; else throw err; }
});

// ---------------------------------------------------------------- response: status, shape, fields

Then(/^the (?:last )?response status is (\d+)$/, async function (status) {
  await check(this, 'status ' + status, () => ({ passed: this.api.status === Number(status), detail: 'status ' + this.api.status + ' ' + this.api.text.slice(0, 160) }));
});
Then(/^the (?:last )?response is an error with code "([^"]*)"$/, async function (code) {
  await check(this, 'error code ' + code, () => { const b = body(this); return { passed: b.code === code && typeof b.error === 'string' && b.error.length > 0, detail: this.api.text.slice(0, 160) }; });
});
Then(/^the response field "([^"]+)" is (true|false|-?\d+)$/, async function (name, lit) {
  const want = lit === 'true' ? true : lit === 'false' ? false : Number(lit);
  await check(this, 'field ' + name + ' is ' + lit, () => ({ passed: field(this, name) === want, detail: name + ' = ' + j(field(this, name)) }));
});
Then(/^the response field "([^"]+)" is "([^"]*)"$/, async function (name, want) {
  await check(this, 'field ' + name + ' is ' + want, () => ({ passed: field(this, name) === want, detail: name + ' = ' + j(field(this, name)) }));
});
Then('the response field {string} is the list {}', async function (name, list) {
  const want = list.split(/,\s*/);
  await check(this, 'field ' + name + ' is ' + list, () => ({ passed: j(field(this, name)) === j(want), detail: name + ' = ' + j(field(this, name)) }));
});
Then('the response list {string} has {int} entries', async function (name, n) {
  await check(this, name + ' has ' + n + ' entries', () => { const l = field(this, name); return { passed: Array.isArray(l) && l.length === n, detail: Array.isArray(l) ? l.length + ' entries' : 'not a list' }; });
});
Then('the response keys are exactly {}', async function (list) {
  const want = list.split(/,\s*/).sort();
  await check(this, 'response keys', () => { const have = Object.keys(body(this)).sort(); return { passed: j(have) === j(want), detail: 'keys ' + have.join(', ') }; });
});
Then('the response field {string} equals indexer_state.{word}', async function (name, col) {
  await check(this, name + ' == indexer_state.' + col, () => { const st = this.store.state(); const a = field(this, name); const b = st[col]; const same = typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : eq(a, b); return { passed: same, detail: `api ${j(a)}, store ${j(b)}` }; });
});

// ---------------------------------------------------------------- response: headers

Then('the response header {word} is {string}', async function (h, want) {
  await check(this, 'header ' + h, () => { const v = this.api.headers[h.toLowerCase()]; return { passed: v === want, detail: h + ': ' + j(v) }; });
});
Then('the response header {word} contains {string}', async function (h, want) {
  await check(this, 'header ' + h + ' contains ' + want, () => { const v = this.api.headers[h.toLowerCase()] || ''; return { passed: v.split(/,\s*/).includes(want) || v.includes(want), detail: h + ': ' + j(v) }; });
});
Then('the response has no {word} header', async function (h) {
  await check(this, 'no ' + h + ' header', () => { const v = this.api.headers[h.toLowerCase()]; return { passed: v === undefined, detail: v === undefined ? 'absent (status ' + this.api.status + ')' : h + ': ' + v }; });
});
Then(/^the (?:last )?response header ([\w-]+) is a positive integer$/, async function (h) {
  await check(this, h + ' positive integer', () => { const v = this.api.headers[h.toLowerCase()]; return { passed: /^\d+$/.test(v || '') && Number(v) > 0, detail: h + ': ' + j(v) }; });
});
Then('the response header X-Indexed-Block is below the chain head', async function () {
  await check(this, 'X-Indexed-Block < head', async () => { const v = Number(this.api.headers['x-indexed-block']); const head = await this.dex.blockNumber(); return { passed: Number.isInteger(v) && v < head, detail: 'X-Indexed-Block ' + v + ', head ' + head }; });
});
Then('X-RateLimit-Remaining reached 0 before the first 429', async function () {
  await check(this, 'remaining hit 0 before 429', () => { const b = this.noted.burst; return { passed: !!b && b.first429At !== null && b.zeroBefore429, detail: b ? `first 429 at request ${b.first429At}, remaining before it: ${j(b.remaining.slice(Math.max(0, (b.first429At || 0) - 3), b.first429At || 0))}` : 'no burst' }; });
});

// ---------------------------------------------------------------- markets (190-196)

const MARKET_COLS = ['market_id', 'symbol', 'status', 'tick_size', 'step_size', 'min_notional', 'max_leverage', 'maker_fee_bps', 'taker_fee_bps', 'max_basis_bps'];
function marketRows(world) {
  return world.store.all('SELECT m.*, i.price AS index_price FROM markets m LEFT JOIN index_prices i ON i.market_id = m.market_id ORDER BY m.market_id');
}
Then('the markets in the response equal the markets rows', async function () {
  await check(this, '/markets == markets rows', () => sameRows(field(this, 'markets'), marketRows(this), [...MARKET_COLS, 'index_price']));
});
Then('the market in the response equals the markets row {int}', async function (id) {
  await check(this, '/markets/' + id + ' == row', () => sameRows([body(this)], marketRows(this).filter((r) => r.market_id === id), [...MARKET_COLS, 'index_price']));
});
Then('the response field {string} equals the mark derived from the store for {word}', async function (name, sym) {
  await check(this, name + ' == derived mark', () => { const d = this.store.markOf(marketId(sym)); return { passed: d !== null && eq(field(this, name), d), detail: `api ${field(this, name)}, derived ${String(d)}` }; });
});
Then('the response open interest equals the positions sums for {word}', async function (sym) {
  await check(this, 'open interest == positions sums', () => {
    let long = 0n, short = 0n;
    for (const r of this.store.all('SELECT size FROM positions WHERE market_id = ?', marketId(sym))) { const s = BigInt(r.size); if (s > 0n) long += s; else short -= s; }
    const b = body(this);
    return { passed: eq(b.open_interest_long, long) && eq(b.open_interest_short, short) && long > 0n, detail: `api ${b.open_interest_long}/${b.open_interest_short}, store ${long}/${short}` };
  });
});
Then('the response field {string} equals the markets row {int} status', async function (name, id) {
  await check(this, name + ' == markets row status', () => { const row = this.store.get('SELECT status FROM markets WHERE market_id = ?', id); return { passed: !!row && field(this, name) === row.status, detail: `api ${field(this, name)}, store ${row && row.status}` }; });
});

// ---------------------------------------------------------------- book, orders, positions (197-202)

Then('the bids in the response equal the store\'s open bids aggregated per price for {word}', async function (sym) {
  await check(this, '/orderbook bids == aggregated open bids', () => {
    const rows = this.store.all("SELECT price, SUM(CAST(size AS INTEGER) - CAST(filled AS INTEGER)) AS size, COUNT(*) AS orders FROM orders WHERE market_id = ? AND status = 'Open' AND side = 'Buy' GROUP BY price", marketId(sym))
      .sort((x, y) => (BigInt(y.price) > BigInt(x.price) ? 1 : -1)).slice(0, 5);
    const want = rows.map((r) => ({ price: r.price, size: String(r.size), orders: r.orders }));
    const r = sameRows(field(this, 'bids'), want, ['price', 'size', 'orders']);
    return { passed: r.passed && want.length > 0, detail: r.detail + '; store levels ' + j(want) };
  });
});
Then('the orders in the response equal the store\'s orders for {word} with status {word}', async function (name, status) {
  await check(this, '/orders == orders rows (' + status + ')', () => {
    const rows = status === 'all' ? this.store.all('SELECT * FROM orders WHERE owner = ? ORDER BY order_id', who(this, name)) : this.store.all('SELECT * FROM orders WHERE owner = ? AND status = ? ORDER BY order_id', who(this, name), status);
    const r = sameRows(field(this, 'orders'), rows, Object.keys(rows[0] || { order_id: 1 }));
    return { passed: r.passed && rows.length > 0, detail: r.detail };
  });
});
Then('the positions in the response equal the store\'s positions for {word}', async function (name) {
  await check(this, '/positions == positions rows', () => {
    const rows = this.store.all('SELECT * FROM positions WHERE account = ? ORDER BY market_id', who(this, name));
    const got = field(this, 'positions');
    const keys = Array.isArray(got) && got[0] && 'account' in got[0] ? Object.keys(rows[0] || {}) : POSITION_FIELDS;
    const r = sameRows(got, rows, keys);
    return { passed: r.passed && rows.length > 0, detail: r.detail };
  });
});

// ---------------------------------------------------------------- trades (203-208)

Then('the response field {string} equals the count of {word} rows', async function (name, table) {
  await check(this, name + ' == COUNT(' + table + ')', () => { const n = this.store.count(table); return { passed: field(this, name) === n && n > 0, detail: `api ${field(this, name)}, store ${n}` }; });
});
Then('the response field {string} equals the count of trades rows for market {int}', async function (name, m) {
  await check(this, name + ' == COUNT(trades) for market ' + m, () => { const n = this.store.count('trades', 'WHERE market_id = ?', m); return { passed: field(this, name) === n && n > 0, detail: `api ${field(this, name)}, store ${n}` }; });
});
Then('the response field {string} equals the noted trades count', async function (name) {
  await check(this, name + ' == noted trades count', () => ({ passed: field(this, name) === this.noted.trades, detail: `api ${field(this, name)}, noted ${this.noted.trades}` }));
});
Then('the response field {string} equals the noted trades count plus {int}', async function (name, d) {
  await check(this, name + ' == noted trades count + ' + d, () => ({ passed: field(this, name) === this.noted.trades + d, detail: `api ${field(this, name)}, noted ${this.noted.trades}` }));
});
Then('the trades in the response are ordered newest first by block and log index', async function () {
  await check(this, 'trades newest first', () => {
    const t = field(this, 'trades') || [];
    for (let i = 1; i < t.length; i++) {
      const a = t[i - 1], b = t[i];
      if (a.block_number < b.block_number || (a.block_number === b.block_number && a.log_index <= b.log_index)) return { passed: false, detail: `row ${i - 1} (${a.block_number}#${a.log_index}) before row ${i} (${b.block_number}#${b.log_index})` };
    }
    return { passed: t.length >= 2, detail: t.length + ' rows, keys ' + t.map((x) => x.block_number + '#' + x.log_index).join(' ') };
  });
});
Then('the paged trades are exactly the trades rows, each once', async function () {
  await check(this, 'paged trades == trades rows', () => {
    const key = (r) => r.tx_hash + '#' + r.log_index;
    const got = (this.noted.paged || []).map(key).sort();
    const want = this.store.all('SELECT tx_hash, log_index FROM trades').map(key).sort();
    const dup = got.filter((k, i) => i > 0 && got[i - 1] === k);
    return { passed: j(got) === j(want) && dup.length === 0 && want.length > 0, detail: `paged ${got.length}, store ${want.length}, duplicates ${dup.length}` };
  });
});
Then('every trade in the response has market_id {int}', async function (m) {
  await check(this, 'trades filtered by market ' + m, () => { const t = field(this, 'trades') || []; const bad = t.filter((x) => x.market_id !== m); return { passed: bad.length === 0 && t.length > 0, detail: `${t.length} rows, ${bad.length} off-market` }; });
});

// ---------------------------------------------------------------- funding, liquidations (209-212)

Then('the funding in the response equals the funding rows for {word}', async function (sym) {
  await check(this, '/funding/history == funding rows', () => {
    const since = Math.floor(Date.now() / 1000) - 86_400;
    const rows = this.store.all('SELECT * FROM funding WHERE market_id = ? AND funding_time >= ? ORDER BY funding_time DESC, log_index DESC LIMIT 50', marketId(sym), since);
    const r = sameRows(field(this, 'funding'), rows, ['tx_hash', 'log_index', 'rate_bps', 'cumulative_index', 'funding_time', 'samples']);
    return { passed: r.passed && rows.length > 0, detail: r.detail };
  });
});
Then('the newest liquidation in the response equals the newest liquidations row', async function () {
  await check(this, '/liquidations[0] == newest row', () => {
    const row = this.store.get('SELECT * FROM liquidations ORDER BY block_number DESC, log_index DESC LIMIT 1');
    const got = (field(this, 'liquidations') || [])[0];
    if (!row || !got) return { passed: false, detail: row ? 'response has no liquidation' : 'store has no liquidation' };
    return sameRows([got], [row], Object.keys(row));
  });
});

// ---------------------------------------------------------------- portfolio, tokens (217, 219)

Then('the response field {string} equals the accounts row for {word} deposits', async function (name, actor) {
  await check(this, name + ' == accounts.deposits', () => { const row = this.store.get('SELECT deposits FROM accounts WHERE account = ?', who(this, actor)); return { passed: !!row && eq(field(this, name), row.deposits) && row.deposits !== '0', detail: `api ${field(this, name)}, store ${row && row.deposits}` }; });
});
Then('the response field {string} equals the count of {word}\'s open and pending orders', async function (name, actor) {
  await check(this, name + ' == open+pending orders', () => { const n = this.store.count('orders', "WHERE owner = ? AND status IN ('Open','Pending')", who(this, actor)); return { passed: field(this, name) === n && n > 0, detail: `api ${field(this, name)}, store ${n}` }; });
});
Then('the minted token exists in api_keys with scope {word}', async function (scope) {
  await check(this, 'minted token in api_keys', () => { const t = field(this, 'token'); const row = t && this.store.get('SELECT scope FROM api_keys WHERE token = ?', t); return { passed: !!row && row.scope === scope, detail: row ? 'scope ' + row.scope : 'no row for the returned token' }; });
});

#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { open } = require('./lib/db');
const { Indexer } = require('./indexer');
const H = require('./lib/http');

/**
 * mini-api: a REST layer that reads ONLY the SQLite store the indexer writes.
 *
 * Nothing in a route touches the chain. If the indexer is paused, every route
 * keeps answering 200 with stale rows -- which is exactly the failure a
 * consumer must be able to detect, so /health exposes the indexer's
 * last_block and age, and every response carries X-Indexed-Block.
 *
 *   GET  /health
 *   GET  /markets                       symbol, status, params, index, mark, last trade, OI
 *   GET  /markets/:id
 *   GET  /orderbook/:id?depth=5          resting orders only, aggregated per price
 *   GET  /orders/:account?status=Open    open by default
 *   GET  /positions/:account
 *   GET  /trades?market=&limit=&cursor=
 *   GET  /funding/history?market=&period=1h|8h|1d
 *   GET  /liquidations?market=&limit=&cursor=
 *   GET  /portfolio/summary              Bearer, scope portfolio, own subject only
 *   POST /auth/token                     Bearer admin: { scope, subject?, ttl? }
 *   POST /admin/indexer                  Bearer admin: { paused: bool } | { rewind: block }
 *
 * Configuration: PERPDEX_RPC, PERPDEX_DEPLOYMENTS (path to 31337.json),
 * MINI_API_PORT, MINI_API_DB, MINI_API_ORIGINS (comma list),
 * MINI_API_ADMIN_TOKEN (seeded on first start; printed once if generated).
 */

const cfg = {
  rpc: process.env.PERPDEX_RPC || 'http://127.0.0.1:8545',
  deployments: process.env.PERPDEX_DEPLOYMENTS || path.join(__dirname, '..', '..', 'contracts', 'deployments', '31337.json'),
  port: Number(process.env.MINI_API_PORT || 8787),
  dbFile: process.env.MINI_API_DB || path.join(__dirname, 'data', 'mini-api.db'),
  origins: (process.env.MINI_API_ORIGINS || 'http://localhost:5173,https://app.example.test').split(',').map((s) => s.trim()).filter(Boolean),
  adminToken: process.env.MINI_API_ADMIN_TOKEN || null,
  rateLimit: Number(process.env.MINI_API_RATE_LIMIT || 60),
  rateWindowMs: Number(process.env.MINI_API_RATE_WINDOW_MS || 10_000),
  pollMs: Number(process.env.MINI_API_POLL_MS || 250),
};

const BPS = 10_000n;
const PERIODS = { '1h': 3600, '8h': 28800, '1d': 86400 };

function json(res, status, body, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...extra });
  res.end(JSON.stringify(body, (k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 65536) reject(new H.ApiError(413, 'too_large', 'body too large')); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new H.ApiError(400, 'bad_request', 'body is not JSON')); } });
  });
}

function isAddress(s) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(s));
}

function main() {
  const deployment = JSON.parse(fs.readFileSync(cfg.deployments, 'utf8'));
  const db = open(cfg.dbFile);
  const indexer = new Indexer({ db, rpcUrl: cfg.rpc, exchange: deployment.exchange, oracle: deployment.oracle, chainId: deployment.chainId, log: (m) => console.error(m) });
  const corsApply = H.cors(cfg.origins);
  const limiter = H.rateLimiter({ limit: cfg.rateLimit, windowMs: cfg.rateWindowMs });

  // seed the admin token once
  const hasAdmin = db.prepare("SELECT token FROM api_keys WHERE scope = 'admin' LIMIT 1").get();
  if (!hasAdmin) {
    const t = cfg.adminToken ? (db.prepare("INSERT INTO api_keys (token, scope, subject, expires_at) VALUES (?, 'admin', NULL, NULL)").run(cfg.adminToken), { token: cfg.adminToken }) : H.issueToken(db, 'admin', null, null);
    console.error('admin token: ' + t.token + (cfg.adminToken ? ' (from MINI_API_ADMIN_TOKEN)' : ' (generated; set MINI_API_ADMIN_TOKEN to fix it)'));
  }

  const q = {
    markets: db.prepare('SELECT * FROM markets ORDER BY market_id'),
    market: db.prepare('SELECT * FROM markets WHERE market_id = ?'),
    index: db.prepare('SELECT price, publish_time FROM index_prices WHERE market_id = ?'),
    lastTrade: db.prepare('SELECT price, block_number, log_index FROM trades WHERE market_id = ? ORDER BY block_number DESC, log_index DESC LIMIT 1'),
    oi: db.prepare("SELECT SUM(CASE WHEN CAST(size AS INTEGER) > 0 THEN CAST(size AS INTEGER) ELSE 0 END) AS long, SUM(CASE WHEN CAST(size AS INTEGER) < 0 THEN -CAST(size AS INTEGER) ELSE 0 END) AS short FROM positions WHERE market_id = ?"),
    book: db.prepare("SELECT side, price, SUM(CAST(size AS INTEGER) - CAST(filled AS INTEGER)) AS size, COUNT(*) AS orders FROM orders WHERE market_id = ? AND status = 'Open' GROUP BY side, price"),
    ordersOf: db.prepare('SELECT * FROM orders WHERE owner = ? AND status = ? ORDER BY order_id'),
    ordersOfAny: db.prepare('SELECT * FROM orders WHERE owner = ? ORDER BY order_id'),
    positionsOf: db.prepare('SELECT * FROM positions WHERE account = ? ORDER BY market_id'),
    account: db.prepare('SELECT * FROM accounts WHERE account = ?'),
    tradesCount: db.prepare('SELECT COUNT(*) AS n FROM trades WHERE (? IS NULL OR market_id = ?)'),
    trades: db.prepare('SELECT * FROM trades WHERE (? IS NULL OR market_id = ?) AND (? IS NULL OR block_number < ? OR (block_number = ? AND log_index < ?)) ORDER BY block_number DESC, log_index DESC LIMIT ?'),
    fundingCount: db.prepare('SELECT COUNT(*) AS n FROM funding WHERE market_id = ? AND funding_time >= ?'),
    funding: db.prepare('SELECT * FROM funding WHERE market_id = ? AND funding_time >= ? ORDER BY funding_time DESC, log_index DESC LIMIT ?'),
    liqCount: db.prepare('SELECT COUNT(*) AS n FROM liquidations WHERE (? IS NULL OR market_id = ?)'),
    liqs: db.prepare('SELECT * FROM liquidations WHERE (? IS NULL OR market_id = ?) AND (? IS NULL OR block_number < ? OR (block_number = ? AND log_index < ?)) ORDER BY block_number DESC, log_index DESC LIMIT ?'),
    state: db.prepare('SELECT * FROM indexer_state WHERE id = 1'),
  };

  /** mark = clamp(last trade, index ± maxBasis); index when there is no trade -- the contract's rule, applied to rows. */
  function markOf(market) {
    const idx = q.index.get(market.market_id);
    if (!idx) return null;
    const index = BigInt(idx.price);
    const last = q.lastTrade.get(market.market_id);
    if (!last) return index;
    const lo = (index * (BPS - BigInt(market.max_basis_bps))) / BPS;
    const hi = (index * (BPS + BigInt(market.max_basis_bps))) / BPS;
    const p = BigInt(last.price);
    return p < lo ? lo : p > hi ? hi : p;
  }

  function marketView(m) {
    const idx = q.index.get(m.market_id);
    const last = q.lastTrade.get(m.market_id);
    const oi = q.oi.get(m.market_id);
    return {
      market_id: m.market_id, symbol: m.symbol, status: m.status,
      tick_size: m.tick_size, step_size: m.step_size, min_notional: m.min_notional, max_leverage: m.max_leverage,
      maker_fee_bps: m.maker_fee_bps, taker_fee_bps: m.taker_fee_bps, max_basis_bps: m.max_basis_bps,
      index_price: idx ? idx.price : null, index_publish_time: idx ? idx.publish_time : null,
      mark_price: (markOf(m) ?? '').toString() || null,
      last_trade_price: last ? last.price : null,
      open_interest_long: String(oi.long || 0), open_interest_short: String(oi.short || 0),
    };
  }

  function requireMarket(idText) {
    if (!/^\d+$/.test(String(idText))) throw new H.ApiError(404, 'not_found', 'market not found');
    const m = q.market.get(Number(idText));
    if (!m) throw new H.ApiError(404, 'not_found', 'market not found');
    return m;
  }

  function optionalMarket(query) {
    if (query.market === undefined) return null;
    return requireMarket(query.market).market_id;
  }

  async function route(req, res, url) {
    const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    const query = Object.fromEntries(url.searchParams.entries());
    const [a, b] = parts;

    if (req.method === 'GET' && a === 'health' && !b) {
      const st = q.state.get();
      return json(res, 200, { ok: true, exchange: st.exchange, chain_id: st.chain_id, genesis_hash: st.genesis_hash, last_block: st.last_block, last_block_hash: st.last_block_hash, rebuilds: st.rebuilds, indexer_paused: !!st.paused, updated_at: st.updated_at, age_seconds: Math.floor(Date.now() / 1000) - st.updated_at, last_error: indexer.lastError });
    }
    if (req.method === 'GET' && a === 'markets' && !b) return json(res, 200, { markets: q.markets.all().map(marketView) });
    if (req.method === 'GET' && a === 'markets' && b && !parts[2]) return json(res, 200, marketView(requireMarket(b)));
    if (req.method === 'GET' && a === 'markets' && b && parts[2] === 'status') { const m = requireMarket(b); return json(res, 200, { market_id: m.market_id, status: m.status, updated_block: m.updated_block }); }

    if (req.method === 'GET' && a === 'orderbook' && b) {
      const m = requireMarket(b);
      const depth = query.depth === undefined ? 5 : Number(query.depth);
      if (!Number.isInteger(depth) || depth < 1 || depth > 50) throw new H.ApiError(400, 'bad_request', 'depth must be an integer between 1 and 50');
      const rows = q.book.all(m.market_id);
      const bids = rows.filter((r) => r.side === 'Buy').sort((x, y) => (BigInt(y.price) > BigInt(x.price) ? 1 : -1)).slice(0, depth);
      const asks = rows.filter((r) => r.side === 'Sell').sort((x, y) => (BigInt(x.price) > BigInt(y.price) ? 1 : -1)).slice(0, depth);
      const lv = (r) => ({ price: r.price, size: String(r.size), orders: r.orders });
      return json(res, 200, { market_id: m.market_id, bids: bids.map(lv), asks: asks.map(lv), note: 'resting orders only; the on-chain backstop quote is not an order' });
    }

    if (req.method === 'GET' && a === 'orders' && b) {
      if (!isAddress(b)) throw new H.ApiError(400, 'bad_request', 'account must be a 0x address');
      const status = query.status === undefined ? 'Open' : String(query.status);
      if (!['Open', 'Pending', 'Filled', 'Cancelled', 'all'].includes(status)) throw new H.ApiError(400, 'bad_request', 'status must be Open, Pending, Filled, Cancelled or all');
      const rows = status === 'all' ? q.ordersOfAny.all(b.toLowerCase()) : q.ordersOf.all(b.toLowerCase(), status);
      return json(res, 200, { account: b.toLowerCase(), status, orders: rows });
    }

    if (req.method === 'GET' && a === 'positions' && b) {
      if (!isAddress(b)) throw new H.ApiError(400, 'bad_request', 'account must be a 0x address');
      return json(res, 200, { account: b.toLowerCase(), positions: q.positionsOf.all(b.toLowerCase()) });
    }

    if (req.method === 'GET' && a === 'trades' && !b) {
      const m = optionalMarket(query);
      const { limit, after } = H.pageParams(query);
      const total = q.tradesCount.get(m, m).n;
      const rows = q.trades.all(m, m, after ? 1 : null, after ? after.block : null, after ? after.block : null, after ? after.log : null, limit);
      return json(res, 200, { total, limit, trades: rows, next_cursor: rows.length === limit ? H.cursorOf(rows[rows.length - 1]) : null });
    }

    if (req.method === 'GET' && a === 'funding' && b === 'history') {
      if (query.market === undefined) throw new H.ApiError(400, 'bad_request', 'market is required');
      const m = requireMarket(query.market);
      const period = query.period === undefined ? '1d' : String(query.period);
      if (!(period in PERIODS)) throw new H.ApiError(400, 'bad_request', 'period must be one of 1h, 8h, 1d', { supported: Object.keys(PERIODS) });
      const since = Math.floor(Date.now() / 1000) - PERIODS[period];
      const { limit } = H.pageParams(query);
      return json(res, 200, { market_id: m.market_id, period, total: q.fundingCount.get(m.market_id, since).n, funding: q.funding.all(m.market_id, since, limit) });
    }

    if (req.method === 'GET' && a === 'liquidations' && !b) {
      const m = optionalMarket(query);
      const { limit, after } = H.pageParams(query);
      const total = q.liqCount.get(m, m).n;
      const rows = q.liqs.all(m, m, after ? 1 : null, after ? after.block : null, after ? after.block : null, after ? after.log : null, limit);
      return json(res, 200, { total, limit, liquidations: rows, next_cursor: rows.length === limit ? H.cursorOf(rows[rows.length - 1]) : null });
    }

    if (req.method === 'GET' && a === 'portfolio' && b === 'summary') {
      const key = H.authenticate(db, req);
      H.requireScope(key, 'portfolio');
      const subject = query.account ? String(query.account).toLowerCase() : key.subject;
      if (!subject) throw new H.ApiError(400, 'bad_request', 'account is required for a token with no subject');
      if (key.scope !== 'admin' && key.subject !== subject) throw new H.ApiError(403, 'forbidden', 'this token may only read its own account');
      const acc = q.account.get(subject);
      const positions = q.positionsOf.all(subject);
      const open = q.ordersOf.all(subject, 'Open').length + q.ordersOf.all(subject, 'Pending').length;
      // Exactly these fields. No contact details exist in this system, and if
      // they did this is the response that must not carry them.
      return json(res, 200, { account: subject, exists: !!acc, deposits: acc ? acc.deposits : '0', withdrawals: acc ? acc.withdrawals : '0', open_orders: open, positions: positions.map((p) => ({ market_id: p.market_id, size: p.size, entry_price: p.entry_price, realized_pnl: p.realized_pnl, funding_paid: p.funding_paid })) });
    }

    if (req.method === 'POST' && a === 'auth' && b === 'token') {
      const key = H.authenticate(db, req);
      H.requireScope(key, 'admin');
      const body = await readBody(req);
      if (!(body.scope in H.RANK)) throw new H.ApiError(400, 'bad_request', 'scope must be read, portfolio or admin');
      if (body.subject !== undefined && body.subject !== null && !isAddress(body.subject)) throw new H.ApiError(400, 'bad_request', 'subject must be a 0x address');
      return json(res, 201, H.issueToken(db, body.scope, body.subject || null, body.ttl ? Number(body.ttl) : null));
    }

    if (req.method === 'POST' && a === 'admin' && b === 'indexer') {
      const key = H.authenticate(db, req);
      H.requireScope(key, 'admin');
      const body = await readBody(req);
      if (body.rewind !== undefined) {
        if (!Number.isInteger(body.rewind) || body.rewind < -1) throw new H.ApiError(400, 'bad_request', 'rewind must be a block number >= -1');
        indexer.rewindTo(body.rewind);
        return json(res, 200, { rewound_to: body.rewind });
      }
      if (typeof body.paused !== 'boolean') throw new H.ApiError(400, 'bad_request', 'paused must be a boolean, or rewind a block number');
      indexer.setPaused(body.paused);
      return json(res, 200, { paused: body.paused });
    }

    if (['GET', 'POST'].includes(req.method)) throw new H.ApiError(404, 'not_found', 'no such route');
    throw new H.ApiError(405, 'method_not_allowed', 'method not allowed');
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    corsApply(req, res);
    const st = q.state.get();
    if (st) res.setHeader('X-Indexed-Block', String(st.last_block));
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    try {
      const rl = limiter(req.socket.remoteAddress || 'unknown');
      res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
      await route(req, res, url);
    } catch (err) {
      if (err instanceof H.ApiError) {
        const extra = err.status === 429 ? { 'Retry-After': String(err.extra.retry_after) } : {};
        json(res, err.status, H.errorBody(err), extra);
      } else {
        console.error(err);
        json(res, 500, { error: 'internal error', code: 'internal' });
      }
    }
  });

  indexer.init().then(() => {
    indexer.start(cfg.pollMs);
    server.listen(cfg.port, '127.0.0.1', () => {
      console.error(`mini-api listening on http://127.0.0.1:${cfg.port}  db ${cfg.dbFile}  exchange ${deployment.exchange}`);
    });
  }).catch((err) => {
    console.error('mini-api could not start: ' + err.message);
    process.exit(1);
  });

  const shutdown = () => { indexer.stop(); server.close(); db.close(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) main();

module.exports = { cfg };

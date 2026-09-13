'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

/**
 * Read-only access to the indexer's SQLite store -- the same file mini-api
 * writes. The DB tier asserts on rows here directly; the API tier reads rows
 * here to compare with HTTP responses.
 *
 * Every read is its own implicit transaction, so each call sees the latest
 * committed state (WAL readers never block the writer, and never see a
 * half-applied block range: the indexer commits a range in one transaction).
 *
 * A missing file is DbUnreachable and grades Blocked: the service is not
 * running, which says nothing about whether its rows would be right.
 */

const DB_FILE = process.env.MINI_API_DB
  || path.join(__dirname, '..', '..', '..', 'services', 'mini-api', 'data', 'mini-api.db');

class DbUnreachable extends Error {}

class Store {
  constructor(file = DB_FILE) {
    if (!fs.existsSync(file)) throw new DbUnreachable('no store at ' + file + ' -- start mini-api (services/mini-api/serve.sh up)');
    this.file = file;
    try {
      this.db = new DatabaseSync(file, { readOnly: true });
    } catch (err) {
      throw new DbUnreachable('cannot open ' + file + ': ' + err.message);
    }
  }

  close() { try { this.db.close(); } catch { /* already closed */ } }

  all(sql, ...params) { return this.db.prepare(sql).all(...params); }
  get(sql, ...params) { return this.db.prepare(sql).get(...params); }
  count(table, where = '', ...params) { return Number(this.get(`SELECT COUNT(*) AS n FROM ${table} ${where}`, ...params).n); }

  state() { return this.get('SELECT * FROM indexer_state WHERE id = 1'); }
  tables() { return this.all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((r) => r.name); }

  /** The columns of the table's PRIMARY KEY, in order. */
  primaryKey(table) {
    return this.all(`PRAGMA table_info(${table})`).filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
  }

  /** Row counts of every derived table, for "nothing changed" comparisons. */
  counts() {
    const out = {};
    for (const t of ['orders', 'trades', 'positions', 'position_events', 'funding', 'liquidations', 'accounts', 'applied_logs', 'index_prices']) out[t] = this.count(t);
    return out;
  }

  /** mark = clamp(last trade, index ± maxBasis); index when there is no trade -- the contract's rule, from rows. */
  markOf(marketId) {
    const m = this.get('SELECT max_basis_bps FROM markets WHERE market_id = ?', marketId);
    const idx = this.get('SELECT price FROM index_prices WHERE market_id = ?', marketId);
    if (!m || !idx) return null;
    const index = BigInt(idx.price);
    const last = this.get('SELECT price FROM trades WHERE market_id = ? ORDER BY block_number DESC, log_index DESC LIMIT 1', marketId);
    if (!last) return index;
    const lo = (index * (10_000n - BigInt(m.max_basis_bps))) / 10_000n;
    const hi = (index * (10_000n + BigInt(m.max_basis_bps))) / 10_000n;
    const p = BigInt(last.price);
    return p < lo ? lo : p > hi ? hi : p;
  }
}

/**
 * A throwaway store with the schema applied, for constraint checks that must
 * not touch the live file. Foreign keys are enforced per connection, so it is
 * turned on here the way the service turns it on.
 */
function throwaway() {
  const schema = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'services', 'mini-api', 'db', 'schema.sql'), 'utf8');
  const db = new DatabaseSync(':memory:');
  db.exec(schema.replace(/PRAGMA journal_mode = WAL;/, ''));
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait until the store has indexed exactly the chain head: last_block equals
 * eth_blockNumber AND last_block_hash equals that block's hash. The hash
 * condition is what makes this correct across an EVM revert: the old
 * last_block may be numerically above the new head, or equal to it with a
 * different hash, and either way the store must first rebuild.
 */
async function waitCaughtUp(store, dex, { timeoutMs = 60_000, pollMs = 150 } = {}) {
  const started = Date.now();
  let last = null;
  for (;;) {
    const head = await dex.blockNumber();
    const st = store.state();
    last = { head, last_block: st ? st.last_block : null, paused: st ? st.paused : null };
    if (st && st.last_block === head) {
      const blk = await dex.block(head);
      if (blk && blk.hash === st.last_block_hash) return { caughtUp: true, ...last, waitedMs: Date.now() - started };
    }
    if (Date.now() - started > timeoutMs) return { caughtUp: false, ...last, waitedMs: Date.now() - started };
    await sleep(pollMs);
  }
}

module.exports = { Store, DbUnreachable, DB_FILE, throwaway, waitCaughtUp, sleep };

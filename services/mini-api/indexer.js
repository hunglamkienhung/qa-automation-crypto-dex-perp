'use strict';

const abi = require('./lib/abi');
const { rpc, call } = require('./lib/rpc');
const { TOPICS } = require('./lib/constants');

/**
 * The indexer: exchange (and oracle) logs -> SQLite rows.
 *
 * It follows ONE exchange address. A second PerpDEX deployed on the same chain
 * is invisible to it, by design -- an API serves the deployment it was
 * configured for, and a test that compares API figures with the wrong
 * deployment is measuring its own mistake.
 *
 * Idempotent: every mirrored event is keyed by (tx_hash, log_index) with
 * INSERT OR IGNORE, so a block range can be replayed without duplicating a
 * row. `last_block` advances only after a range has been fully applied, in
 * the same transaction as the rows.
 *
 * `paused` is a lever for tests: while set, the loop keeps running but does
 * not advance, so the store freezes while the API keeps answering 200. That is
 * the failure mode a reader must be able to recognise from the outside.
 *
 * Reorgs: the hash of the last indexed block is kept. If the chain no longer
 * has that block (a real reorg, or a test reverting an EVM snapshot), the
 * store is rebuilt from block 0 -- every derived row dropped, markets
 * re-seeded, logs replayed. A production indexer would keep a reorg buffer;
 * on a local chain a rebuild is exact and takes a moment, and "the store
 * matches the chain again after a revert" is something a test can assert.
 */

const SIDE = ['Buy', 'Sell'];
const ORDER_TYPE = ['Market', 'Limit', 'StopMarket', 'StopLimit', 'TakeProfit'];
const TIF = ['GTC', 'IOC', 'FOK', 'PostOnly'];
const STATUS = ['Active', 'Paused', 'ReduceOnly', 'Settling'];
const PARAMS_T = '(uint64,uint64,uint64,uint16,uint16,uint16,int16,uint16,uint16,uint16,uint16,uint16,uint16,uint64,uint16,uint64)';
const MARKET_T = `(string,uint8,${PARAMS_T},uint64,int128,uint64,int64,int128,uint64,uint64,uint64,uint64)`;

const s = (v) => String(v);

class Indexer {
  constructor({ db, rpcUrl, exchange, oracle, chainId, log = () => {} }) {
    this.db = db;
    this.rpcUrl = rpcUrl;
    this.exchange = exchange.toLowerCase();
    this.oracle = oracle.toLowerCase();
    this.chainId = chainId;
    this.log = log;
    this.timer = null;
    this.stopped = false;
    this.lastError = null;
    this.stmts = this._prepare();
  }

  _prepare() {
    const p = (sql) => this.db.prepare(sql);
    return {
      state: p('SELECT * FROM indexer_state WHERE id = 1'),
      initState: p('INSERT OR IGNORE INTO indexer_state (id, exchange, chain_id, genesis_hash, last_block, updated_at, paused) VALUES (1, ?, ?, ?, ?, ?, 0)'),
      setBlock: p('UPDATE indexer_state SET last_block = ?, last_block_hash = ?, updated_at = ? WHERE id = 1'),
      rewind: p('UPDATE indexer_state SET last_block = ?, last_block_hash = NULL, updated_at = ? WHERE id = 1'),
      rebuilds: p('UPDATE indexer_state SET rebuilds = rebuilds + 1 WHERE id = 1'),
      setPaused: p('UPDATE indexer_state SET paused = ?, updated_at = ? WHERE id = 1'),
      upsertMarket: p(`INSERT INTO markets (market_id, symbol, status, tick_size, step_size, min_notional, max_leverage, maker_fee_bps, taker_fee_bps, max_basis_bps, updated_block)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(market_id) DO UPDATE SET symbol = excluded.symbol, status = excluded.status, tick_size = excluded.tick_size, step_size = excluded.step_size,
          min_notional = excluded.min_notional, max_leverage = excluded.max_leverage, maker_fee_bps = excluded.maker_fee_bps, taker_fee_bps = excluded.taker_fee_bps, max_basis_bps = excluded.max_basis_bps, updated_block = excluded.updated_block`),
      marketStatus: p('UPDATE markets SET status = ?, updated_block = ? WHERE market_id = ?'),
      insertOrder: p(`INSERT OR IGNORE INTO orders (order_id, owner, market_id, side, order_type, tif, size, filled, price, trigger_price, reduce_only, user_order_id, max_ts, status, placed_block, placed_tx, placed_log, updated_block)
        VALUES (?, ?, ?, ?, ?, ?, ?, '0', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      orderStatus: p('UPDATE orders SET status = ?, updated_block = ? WHERE order_id = ?'),
      orderFill: p('UPDATE orders SET filled = ?, status = CASE WHEN ? = size THEN \'Filled\' ELSE status END, updated_block = ? WHERE order_id = ?'),
      getOrder: p('SELECT size, filled FROM orders WHERE order_id = ?'),
      insertTrade: p(`INSERT OR IGNORE INTO trades (tx_hash, log_index, block_number, market_id, taker, maker, taker_order_id, maker_order_id, taker_side, size, price, taker_fee, maker_fee)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      insertPositionEvent: p(`INSERT OR IGNORE INTO position_events (tx_hash, log_index, block_number, account, market_id, size_before, size_after, entry_price, realized_delta, funding_paid)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      getPosition: p('SELECT realized_pnl, funding_paid FROM positions WHERE account = ? AND market_id = ?'),
      upsertPosition: p(`INSERT INTO positions (account, market_id, size, entry_price, realized_pnl, funding_paid, updated_block, updated_tx) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account, market_id) DO UPDATE SET size = excluded.size, entry_price = excluded.entry_price, realized_pnl = excluded.realized_pnl, funding_paid = excluded.funding_paid, updated_block = excluded.updated_block, updated_tx = excluded.updated_tx`),
      insertFunding: p('INSERT OR IGNORE INTO funding (tx_hash, log_index, block_number, market_id, rate_bps, cumulative_index, funding_time, samples) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
      insertLiquidation: p('INSERT OR IGNORE INTO liquidations (tx_hash, log_index, block_number, account, market_id, liquidator, size_closed, price, liquidator_fee, bad_debt, insurance_used) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
      upsertAccount: p('INSERT OR IGNORE INTO accounts (account, created_block) VALUES (?, ?)'),
      accountFlow: p('UPDATE accounts SET deposits = ?, withdrawals = ? WHERE account = ?'),
      getAccount: p('SELECT deposits, withdrawals FROM accounts WHERE account = ?'),
      upsertIndex: p(`INSERT INTO index_prices (market_id, price, publish_time, block_number) VALUES (?, ?, ?, ?)
        ON CONFLICT(market_id) DO UPDATE SET price = excluded.price, publish_time = excluded.publish_time, block_number = excluded.block_number`),
      markApplied: p('INSERT OR IGNORE INTO applied_logs (tx_hash, log_index, block_number) VALUES (?, ?, ?)'),
    };
  }

  // ---------------------------------------------------------------- lifecycle

  async init() {
    const chain = Number(BigInt(await rpc(this.rpcUrl, 'eth_chainId', [])));
    if (chain !== this.chainId) throw new Error(`indexer configured for chain ${this.chainId}, node reports ${chain}`);
    // A fresh anvil deploys to the same addresses as the last one, so the
    // address alone cannot tell two chain instances apart. Block 0 can.
    const genesis = (await rpc(this.rpcUrl, 'eth_getBlockByNumber', ['0x0', false])).hash;
    this.stmts.initState.run(this.exchange, this.chainId, genesis, -1, now());
    const state = this.stmts.state.get();
    if (state.exchange.toLowerCase() !== this.exchange) {
      throw new Error(`this store follows ${state.exchange}, not ${this.exchange}. A store follows one exchange for its whole life; use another file.`);
    }
    if (state.genesis_hash !== genesis) {
      throw new Error(`this store was built against a different chain instance (genesis ${state.genesis_hash} vs ${genesis}). Delete the store and start again.`);
    }
    await this.seedMarkets();
  }

  /** Market rows come from the contract's own getters, not from events (there is no MarketAdded payload for params). */
  async seedMarkets() {
    const [count] = await call(this.rpcUrl, this.exchange, 'marketCount()', [], '(uint16)');
    const block = Number(BigInt(await rpc(this.rpcUrl, 'eth_blockNumber', [])));
    for (let i = 0; i < Number(count); i++) {
      const [m] = await call(this.rpcUrl, this.exchange, 'getMarket(uint16)', [i], `(${MARKET_T})`);
      const [symbol, status, params] = m;
      this.stmts.upsertMarket.run(i, symbol, STATUS[Number(status)], s(params[0]), s(params[1]), s(params[2]), Number(params[3]), Number(params[6]), Number(params[7]), Number(params[9]), block);
      // snapshot the index price too, so the API has one before any PriceSet lands in range
      const [price, publishTime] = await call(this.rpcUrl, this.exchange, 'getIndexPrice(uint16)', [i], '(uint64,uint64)');
      this.stmts.upsertIndex.run(i, s(price), Number(publishTime), block);
    }
  }

  start(intervalMs = 500) {
    const tick = async () => {
      if (this.stopped) return;
      try {
        await this.sync();
        this.lastError = null;
      } catch (err) {
        this.lastError = err.message;
        this.log('indexer: ' + err.message);
      }
      this.timer = setTimeout(tick, intervalMs);
    };
    tick();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  setPaused(flag) {
    this.stmts.setPaused.run(flag ? 1 : 0, now());
  }

  /** Test lever: forget everything after `block` WITHOUT dropping rows, so the next sync replays the range. */
  rewindTo(block) {
    this.stmts.rewind.run(block, now());
  }

  /** Drop every derived row and start from block 0. Markets are re-seeded from the contract. */
  async rebuild(reason) {
    this.log('indexer: rebuilding store -- ' + reason);
    this.db.exec('BEGIN');
    try {
      // markets last: it is FK-referenced by several tables above, and a market
      // added then reverted must not survive as a phantom row (seedMarkets only
      // upserts the current set, it does not remove extras).
      for (const t of ['applied_logs', 'trades', 'position_events', 'positions', 'funding', 'liquidations', 'orders', 'accounts', 'index_prices', 'markets']) {
        this.db.exec('DELETE FROM ' + t);
      }
      this.stmts.rewind.run(-1, now());
      this.stmts.rebuilds.run();
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    await this.seedMarkets();
  }

  state() {
    return this.stmts.state.get();
  }

  // ---------------------------------------------------------------- sync

  async sync(maxRange = 2000) {
    let state = this.stmts.state.get();
    if (state.paused) return { advanced: false, paused: true };
    const head = Number(BigInt(await rpc(this.rpcUrl, 'eth_blockNumber', [])));

    // Is the block we last indexed still the block the chain has at that height?
    if (state.last_block >= 0 && state.last_block_hash) {
      const blk = await rpc(this.rpcUrl, 'eth_getBlockByNumber', ['0x' + state.last_block.toString(16), false]);
      if (!blk || blk.hash !== state.last_block_hash) {
        await this.rebuild('block ' + state.last_block + ' is ' + (blk ? 'now ' + blk.hash : 'gone') + ', had ' + state.last_block_hash);
        state = this.stmts.state.get();
      }
    }
    if (head <= state.last_block) return { advanced: false, head };

    const from = state.last_block + 1;
    const to = Math.min(head, from + maxRange - 1);
    const logs = await rpc(this.rpcUrl, 'eth_getLogs', [{
      address: [this.exchange, this.oracle], fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16),
    }]);
    logs.sort((a, b) => (Number(BigInt(a.blockNumber)) - Number(BigInt(b.blockNumber))) || (Number(BigInt(a.logIndex)) - Number(BigInt(b.logIndex))));

    this.db.exec('BEGIN');
    try {
      for (const log of logs) this.apply(log);
      const tip = await rpc(this.rpcUrl, 'eth_getBlockByNumber', ['0x' + to.toString(16), false]);
      this.stmts.setBlock.run(to, tip ? tip.hash : null, now());
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return { advanced: true, from, to, logs: logs.length };
  }

  /** Decode one log and apply it. Unknown topics are skipped; malformed known ones throw and roll the range back. */
  apply(log) {
    const spec = TOPICS[log.topics[0]];
    if (!spec) return;
    const indexed = spec.indexed.map((t, i) => abi.decode(`(${t})`, log.topics[i + 1])[0]);
    const data = spec.data === '()' ? [] : abi.decode(spec.data, log.data);
    const e = abi.named(spec.fields, [...indexed, ...data]);
    const tx = log.transactionHash;
    const li = Number(BigInt(log.logIndex));
    const bn = Number(BigInt(log.blockNumber));
    const addrOk = log.address.toLowerCase() === (spec.name === 'PriceSet' ? this.oracle : this.exchange);
    if (!addrOk) return; // a look-alike event from another contract in the same range
    if (this.stmts.markApplied.run(tx, li, bn).changes === 0) return; // already applied: replay is a no-op

    switch (spec.name) {
      case 'OrderPlaced':
        this.stmts.insertOrder.run(Number(e.orderId), e.owner.toLowerCase(), Number(e.marketId), SIDE[Number(e.side)], ORDER_TYPE[Number(e.orderType)], TIF[Number(e.tif)],
          s(e.size), s(e.price), s(e.triggerPrice), e.reduceOnly ? 1 : 0, Number(e.userOrderId), s(e.maxTs),
          [2, 3, 4].includes(Number(e.orderType)) ? 'Pending' : 'Open', bn, tx, li, bn);
        return;
      case 'OrderFilled': {
        this.stmts.insertTrade.run(tx, li, bn, Number(e.marketId), e.taker.toLowerCase(), e.maker.toLowerCase(), Number(e.takerOrderId), Number(e.makerOrderId), SIDE[Number(e.takerSide)], s(e.size), s(e.price), s(e.takerFee), s(e.makerFee));
        this._fill(Number(e.takerOrderId), e.size, bn);
        if (Number(e.makerOrderId) !== 0) this._fill(Number(e.makerOrderId), e.size, bn);
        return;
      }
      case 'OrderCancelled':
        this.stmts.orderStatus.run('Cancelled', bn, Number(e.orderId));
        return;
      case 'OrderTriggered':
        this.stmts.orderStatus.run('Open', bn, Number(e.orderId));
        return;
      case 'PositionChanged': {
        this.stmts.insertPositionEvent.run(tx, li, bn, e.account.toLowerCase(), Number(e.marketId), s(e.sizeBefore), s(e.sizeAfter), s(e.entryPrice), s(e.realizedPnlDelta), s(e.fundingPaid));
        const prev = this.stmts.getPosition.get(e.account.toLowerCase(), Number(e.marketId));
        const realized = s(BigInt(prev ? prev.realized_pnl : 0) + BigInt(e.realizedPnlDelta));
        const funding = s(BigInt(prev ? prev.funding_paid : 0) + BigInt(e.fundingPaid));
        this.stmts.upsertPosition.run(e.account.toLowerCase(), Number(e.marketId), s(e.sizeAfter), s(e.entryPrice), realized, funding, bn, tx);
        return;
      }
      case 'FundingUpdated':
        this.stmts.insertFunding.run(tx, li, bn, Number(e.marketId), Number(e.rateBps), s(e.cumulativeIndex), Number(e.fundingTime), Number(e.samples));
        return;
      case 'Liquidated':
        this.stmts.insertLiquidation.run(tx, li, bn, e.account.toLowerCase(), Number(e.marketId), e.liquidator.toLowerCase(), s(e.sizeClosed), s(e.price), s(e.liquidatorFee), s(e.badDebt), s(e.insuranceUsed));
        return;
      case 'MarketStatusChanged':
        this.stmts.marketStatus.run(STATUS[Number(e.status)], bn, Number(e.marketId));
        return;
      case 'AccountInitialized':
        this.stmts.upsertAccount.run(e.account.toLowerCase(), bn);
        return;
      case 'Deposited':
      case 'Withdrawn': {
        const a = e.account.toLowerCase();
        this.stmts.upsertAccount.run(a, bn);
        const row = this.stmts.getAccount.get(a);
        const dep = BigInt(row.deposits) + (spec.name === 'Deposited' ? BigInt(e.amount) : 0n);
        const wd = BigInt(row.withdrawals) + (spec.name === 'Withdrawn' ? BigInt(e.amount) : 0n);
        this.stmts.accountFlow.run(s(dep), s(wd), a);
        return;
      }
      case 'PriceSet':
        this.stmts.upsertIndex.run(Number(e.marketId), s(e.price), Number(e.publishTime), bn);
        return;
      default:
        return;
    }
  }

  _fill(orderId, size, bn) {
    const o = this.stmts.getOrder.get(orderId);
    if (!o) return; // an order placed before this store started following; nothing to update
    const filled = s(BigInt(o.filled) + BigInt(size));
    this.stmts.orderFill.run(filled, filled, bn, orderId);
  }
}

function now() {
  return Math.floor(Date.now() / 1000);
}

module.exports = { Indexer };

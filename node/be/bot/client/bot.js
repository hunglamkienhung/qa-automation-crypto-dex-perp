'use strict';

const { RiskEngine } = require('../risk/engine');
const { Reverted, ChainUnreachable } = require('../../contract/chain/perpdex');
const { rpc } = require('../../contract/chain/ethcall');
const U = require('../../contract/chain/units');

const MARKET = { BTC: 0, ETH: 1, SOL: 2 };

/**
 * A trading bot over PerpDEX. It is both a tool -- it drives the scenarios the
 * read-only tiers cannot -- and an object of test: its risk gate and its
 * operational discipline (retry classification, sequential nonces, cleanup)
 * are asserted directly.
 *
 * It never holds a key. On anvil the accounts are unlocked and the node signs;
 * the client refuses any chain but 31337 through the same Sender the contract
 * tier uses, and carries nothing secret to leak. Every write re-reads the
 * state it changed, so a caller sees the effect, not just a receipt.
 */
class Bot {
  constructor({ dex, account, risk, log = [] }) {
    this.dex = dex;
    this.account = account;
    this.risk = risk;
    this.log = log;         // human-readable trail; asserted to hold no secret
    this.nonces = [];       // nonce of each write, in order
    this.attempts = [];     // {op, tries, outcome} -- retry classification evidence
  }

  /** Build a bot whose risk specs are read from the chain for the given symbols. */
  static async fromChain(dex, account, { maxOrderSize, maxPositionSize, symbols = ['BTC', 'ETH', 'SOL'], killSwitch = false, dryRun = false } = {}) {
    const specs = {};
    for (const sym of symbols) {
      const p = await dex.getMarketParams(MARKET[sym]);
      specs[sym] = { tick: p.tickSize, step: p.stepSize, minNotional: p.minNotional, maxLeverage: p.maxLeverage };
    }
    const risk = new RiskEngine({ specs, maxOrderSize, maxPositionSize, killSwitch, dryRun });
    return new Bot({ dex, account, risk });
  }

  say(line) { this.log.push(line); }
  mid(sym) { return MARKET[sym]; }

  async nonce() { return Number(BigInt(await rpc('eth_getTransactionCount', [this.account, 'latest'], this.dex.url))); }

  /**
   * Retry a transient failure, never a deterministic one. A Reverted is the
   * contract's considered answer -- retrying it would loop forever and hide the
   * finding; it is re-raised on the first try. Only a transport failure
   * (ChainUnreachable) is retried. Records the attempt count either way.
   */
  async withRetry(op, fn, { max = 3 } = {}) {
    let tries = 0;
    for (;;) {
      tries += 1;
      try {
        const r = await fn();
        this.attempts.push({ op, tries, outcome: 'ok' });
        return r;
      } catch (err) {
        if (err instanceof Reverted) { this.attempts.push({ op, tries, outcome: 'reverted:' + err.error }); throw err; }
        if (err instanceof ChainUnreachable && tries < max) continue;
        this.attempts.push({ op, tries, outcome: err instanceof ChainUnreachable ? 'unreachable' : 'error' });
        throw err;
      }
    }
  }

  async fund(amountUsd) {
    await this.withRetry('fund', () => this.dex.fundTrader(this.account, U.usd(String(amountUsd))));
    this.say('funded account with $' + amountUsd);
  }

  /**
   * Plan an order through the risk gate, then place it if cleared. Returns the
   * decision plus, when it sent, the orderId and the re-read order.
   */
  async place({ sym, side, size, price = 0, orderType = 'Limit', tif = 'GTC', reduceOnly = false, userOrderId }) {
    const mid = this.mid(sym);
    let positionSize = 0n;
    let refPrice = 0n;
    try {
      positionSize = (await this.dex.getPosition(this.account, mid)).size;
      refPrice = orderType === 'Market' ? (await this.dex.getIndexPrice(mid)).price : 0n;
    } catch (err) {
      if (!(err instanceof ChainUnreachable)) throw err;
      return { sent: false, decision: { ok: false, reason: 'chain-unreachable', detail: err.message } };
    }
    const decision = this.risk.plan(
      { market: sym, side, size: U.size(String(size)), price: U.price(String(price)), orderType, reduceOnly, userOrderId },
      { positionSize, refPrice },
    );
    this.say('plan ' + side + ' ' + size + ' ' + sym + ' -> ' + (decision.ok ? decision.action : 'refused:' + decision.reason));
    if (!decision.ok || decision.action !== 'send') return { sent: false, decision };

    const nonceBefore = await this.nonce();
    const receipt = await this.withRetry('place', () => this.dex.placeOrder(this.account, {
      marketId: mid, side, orderType, tif, reduceOnly,
      size: decision.rounded.size, price: decision.rounded.price,
      ...(userOrderId !== undefined ? { userOrderId } : {}),
    }));
    this.nonces.push(nonceBefore);
    const orderId = receipt.orderId;
    const order = orderId !== undefined ? await this.dex.getOrder(orderId) : null;
    this.say('placed order ' + orderId);
    return { sent: true, decision, orderId, order, receipt };
  }

  async cancel(orderId) {
    const r = await this.withRetry('cancel', () => this.dex.cancelOrder(this.account, orderId));
    this.say('cancelled order ' + orderId);
    return r;
  }

  async cancelAll(sym) {
    const r = await this.withRetry('cancelAll', () => this.dex.cancelAll(this.account, sym === undefined ? 0xFFFF : this.mid(sym)));
    this.say('cancelled all orders' + (sym ? ' on ' + sym : ''));
    return r;
  }

  /**
   * Return to flat on a market: cancel resting orders, then close any open
   * position with a reduce-only market order, and re-read to confirm. The
   * discipline every scenario relies on so the next one starts clean.
   */
  async flatten(sym) {
    const mid = this.mid(sym);
    await this.cancelAll(sym);
    const pos = await this.dex.getPosition(this.account, mid);
    if (pos.size !== 0n) {
      const side = pos.size > 0n ? 'Sell' : 'Buy';
      const size = pos.size > 0n ? pos.size : -pos.size;
      await this.withRetry('close', () => this.dex.placeOrder(this.account, { marketId: mid, side, orderType: 'Market', tif: 'IOC', reduceOnly: true, size }));
      this.say('closed ' + U.showSize(size) + ' ' + sym);
    }
    const after = await this.dex.getPosition(this.account, mid);
    const acct = await this.dex.getAccount(this.account);
    return { flat: after.size === 0n && Number(acct.openOrders) === 0, positionSize: after.size, openOrders: Number(acct.openOrders) };
  }

  /** Does any recorded line look like it carries a 32-byte secret (64 hex chars)? */
  leakedSecret() {
    const re = /(^|[^0-9a-fx])[0-9a-fA-F]{64}([^0-9a-fA-F]|$)/;
    return this.log.find((line) => re.test(line)) || (this.privateKey !== undefined ? '(holds a privateKey field)' : null) || null;
  }
}

module.exports = { Bot, MARKET };

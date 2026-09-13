'use strict';

const U = require('../../contract/chain/units');

/**
 * The bot's risk gate: a PURE function from an order plus the account's current
 * position to a decision. No network, no chain -- so it is fully unit-testable,
 * and so the bot can reject an order it should never send before spending a
 * transaction to have the contract reject it.
 *
 * It rounds first, then checks, then decides. Rounding down to the market's
 * step and tick is a courtesy the contract does not do (it reverts on a bad
 * tick); the risk engine makes the order legal where it safely can and refuses
 * where it cannot.
 *
 * The decision is one of:
 *   { ok:true,  action:'send',      rounded }   place it
 *   { ok:true,  action:'dry-run',   rounded }   would place it; caller must not
 *   { ok:true,  action:'duplicate', rounded }   userOrderId already used; skip
 *   { ok:false, reason }                          refused; reason is machine-readable
 *
 * Everything is in contract units (bigint). A spec is a market's on-chain
 * parameters, fed in rather than read here, so the same engine serves a unit
 * test and a live run.
 */

const REASONS = {
  KILL_SWITCH: 'kill-switch',
  ZERO_SIZE: 'zero-size',
  MAX_ORDER_SIZE: 'max-order-size',
  MAX_POSITION: 'max-position',
  BELOW_MIN_NOTIONAL: 'below-min-notional',
  UNKNOWN_MARKET: 'unknown-market',
  NO_PRICE: 'no-reference-price',
};

class RiskEngine {
  /**
   * @param {object} cfg
   * @param {Record<string, {tick,step,minNotional,maxLeverage}>} cfg.specs  per-market params, bigint
   * @param {bigint} cfg.maxOrderSize       largest single order, size units
   * @param {bigint} cfg.maxPositionSize    largest |position| the bot will build, size units
   * @param {boolean} [cfg.killSwitch]      when set, every order is refused
   * @param {boolean} [cfg.dryRun]          when set, orders plan but never send
   */
  constructor({ specs, maxOrderSize, maxPositionSize, killSwitch = false, dryRun = false }) {
    this.specs = specs;
    this.maxOrderSize = BigInt(maxOrderSize);
    this.maxPositionSize = BigInt(maxPositionSize);
    this.killSwitch = killSwitch;
    this.dryRun = dryRun;
    this.seen = new Set(); // userOrderIds already acted on -- idempotence
  }

  setKillSwitch(on) { this.killSwitch = !!on; }

  /** Floor `value` to a multiple of `unit` (unit 0 => unchanged). */
  static floorTo(value, unit) { return unit > 0n ? value - (value % unit) : value; }

  /**
   * @param {object} order  { market, side, size (bigint), price (bigint, 0 for market),
   *                          orderType, reduceOnly, userOrderId }
   * @param {object} [ctx]  { positionSize (bigint, signed), refPrice (bigint) }
   */
  plan(order, ctx = {}) {
    const spec = this.specs[order.market];
    if (!spec) return { ok: false, reason: REASONS.UNKNOWN_MARKET, detail: 'no spec for market ' + order.market };

    if (this.killSwitch) return { ok: false, reason: REASONS.KILL_SWITCH, detail: 'the kill switch is engaged' };

    if (order.userOrderId !== undefined && this.seen.has(order.userOrderId)) {
      return { ok: true, action: 'duplicate', detail: 'userOrderId ' + order.userOrderId + ' already acted on', rounded: null };
    }

    const size = RiskEngine.floorTo(BigInt(order.size), BigInt(spec.step));
    if (size <= 0n) return { ok: false, reason: REASONS.ZERO_SIZE, detail: 'size rounds to zero at step ' + spec.step };

    const isLimit = order.orderType === 'Limit' || order.orderType === 'StopLimit' || order.orderType === 'PostOnly';
    const price = isLimit ? RiskEngine.floorTo(BigInt(order.price), BigInt(spec.tick)) : 0n;

    if (size > this.maxOrderSize) {
      return { ok: false, reason: REASONS.MAX_ORDER_SIZE, detail: 'size ' + U.showSize(size) + ' over max ' + U.showSize(this.maxOrderSize) };
    }

    // A reduce-only order shrinks the position, so it never breaches the cap.
    if (!order.reduceOnly) {
      const have = ctx.positionSize ? (ctx.positionSize < 0n ? -ctx.positionSize : ctx.positionSize) : 0n;
      if (have + size > this.maxPositionSize) {
        return { ok: false, reason: REASONS.MAX_POSITION, detail: 'position ' + U.showSize(have) + ' + ' + U.showSize(size) + ' over max ' + U.showSize(this.maxPositionSize) };
      }
    }

    const refPrice = isLimit ? price : (ctx.refPrice ? BigInt(ctx.refPrice) : 0n);
    if (refPrice <= 0n) return { ok: false, reason: REASONS.NO_PRICE, detail: 'a market order needs a reference price to size notional' };
    const notional = U.notional(size, refPrice);
    if (notional < BigInt(spec.minNotional)) {
      return { ok: false, reason: REASONS.BELOW_MIN_NOTIONAL, detail: 'notional $' + U.showUsd(notional) + ' below min $' + U.showUsd(BigInt(spec.minNotional)) };
    }

    if (order.userOrderId !== undefined) this.seen.add(order.userOrderId);
    const rounded = { size, price };
    return this.dryRun
      ? { ok: true, action: 'dry-run', detail: 'dry run: not sent', rounded }
      : { ok: true, action: 'send', detail: 'cleared', rounded };
  }
}

module.exports = { RiskEngine, REASONS };

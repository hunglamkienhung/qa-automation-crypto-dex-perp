'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RiskEngine, REASONS } = require('./engine');
const U = require('../../contract/chain/units');

// The same market shape the deploy script gives ETH-PERP.
const SPECS = { ETH: { tick: U.price('1'), step: U.size('0.001'), minNotional: U.usd('10'), maxLeverage: 50n } };
const base = (over = {}) => new RiskEngine({ specs: SPECS, maxOrderSize: U.size('5'), maxPositionSize: U.size('10'), ...over });
const order = (over = {}) => ({ market: 'ETH', side: 'Buy', size: U.size('1'), price: U.price('2500'), orderType: 'Limit', ...over });

test('a clean order is cleared and rounded', () => {
  const d = base().plan(order({ size: U.size('1.2345'), price: U.price('2500.7') }));
  assert.equal(d.ok, true);
  assert.equal(d.action, 'send');
  assert.equal(d.rounded.size, U.size('1.234'));   // floored to 0.001
  assert.equal(d.rounded.price, U.price('2500'));  // floored to tick 1
});

test('the kill switch refuses everything', () => {
  const d = base({ killSwitch: true }).plan(order());
  assert.equal(d.ok, false);
  assert.equal(d.reason, REASONS.KILL_SWITCH);
});

test('an order above the max order size is refused', () => {
  const d = base().plan(order({ size: U.size('6') }));
  assert.equal(d.reason, REASONS.MAX_ORDER_SIZE);
});

test('an order that would breach the max position is refused, unless reduce-only', () => {
  const r = base();
  assert.equal(r.plan(order({ size: U.size('4') }), { positionSize: U.size('7') }).reason, REASONS.MAX_POSITION);
  const reduce = r.plan(order({ size: U.size('4'), reduceOnly: true, userOrderId: 9 }), { positionSize: U.size('7') });
  assert.equal(reduce.ok, true);
});

test('size that rounds to zero is refused', () => {
  const d = base().plan(order({ size: U.size('0.0005') })); // below step 0.001
  assert.equal(d.reason, REASONS.ZERO_SIZE);
});

test('below the minimum notional is refused', () => {
  const d = base().plan(order({ size: U.size('0.001'), price: U.price('2500') })); // $2.5 < $10
  assert.equal(d.reason, REASONS.BELOW_MIN_NOTIONAL);
});

test('a market order needs a reference price for its notional', () => {
  assert.equal(base().plan(order({ orderType: 'Market', price: 0n })).reason, REASONS.NO_PRICE);
  assert.equal(base().plan(order({ orderType: 'Market', price: 0n }), { refPrice: U.price('2500') }).ok, true);
});

test('a repeated userOrderId is a no-op, not a second order', () => {
  const r = base();
  assert.equal(r.plan(order({ userOrderId: 1 })).action, 'send');
  assert.equal(r.plan(order({ userOrderId: 1 })).action, 'duplicate');
});

test('dry run clears but does not send', () => {
  const d = base({ dryRun: true }).plan(order());
  assert.equal(d.ok, true);
  assert.equal(d.action, 'dry-run');
});

test('an unknown market is refused', () => {
  assert.equal(base().plan(order({ market: 'DOGE' })).reason, REASONS.UNKNOWN_MARKET);
});

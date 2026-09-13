'use strict';

const { Given, When, Then, Before } = require('@cucumber/cucumber');
const { Bot } = require('../client/bot');
const { RiskEngine } = require('../risk/engine');
const { Reverted, ChainUnreachable } = require('../../contract/chain/perpdex');
const { rpc } = require('../../contract/chain/ethcall');
const U = require('../../contract/chain/units');

const j = (v) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? String(x) : x));

/**
 * Steps for features/be-bot.feature.
 *
 * The risk-gate scenarios build a RiskEngine directly with the deployed market
 * specs and never touch the chain, so they carry no @perpdex tag and the
 * contract tier's snapshot/revert hooks skip them.
 *
 * The chain scenarios are @perpdex, so those hooks give them a fresh venue and
 * a revert afterwards; the bot drives account `alice`, and reuses the contract
 * tier's Givens for counterparties ("a funded trader bob ...").
 */

// The three markets' parameters as the deploy script sets them. Fed to the
// pure risk engine so a unit scenario needs no chain, yet stays true to the venue.
const SPECS = {
  BTC: { tick: U.price('0.01'), step: U.size('0.0001'), minNotional: U.usd('10'), maxLeverage: 50n },
  ETH: { tick: U.price('0.01'), step: U.size('0.001'), minNotional: U.usd('10'), maxLeverage: 50n },
  SOL: { tick: U.price('0.001'), step: U.size('0.01'), minNotional: U.usd('10'), maxLeverage: 20n },
};

Before({ tags: '@bot' }, function () {
  this.risk = null;      // a bare RiskEngine, for the pure scenarios
  this.bot = null;       // a Bot over the chain, for the @perpdex scenarios
  this.plan = null;      // the last risk decision
  this.botLast = null;   // the last bot.place outcome (sent / decision / revert)
});

// ---------------------------------------------------------------- risk-only bot (pure)

Given('a risk-only bot with max order size {float} and max position {float}', function (maxOrder, maxPos) {
  this.risk = new RiskEngine({ specs: SPECS, maxOrderSize: U.size(String(maxOrder)), maxPositionSize: U.size(String(maxPos)) });
});
Given('the kill switch is engaged', function () { this.risk.setKillSwitch(true); });
Given('dry run is engaged', function () { this.risk.dryRun = true; });

function planOrder(world, over, ctx = {}) {
  const o = { market: 'ETH', side: 'Buy', size: U.size('1'), price: U.price('2500'), orderType: 'Limit', ...over };
  world.plan = world.risk.plan(o, ctx);
}

When('it plans a buy of {float} {word} at {float}', function (size, sym, price) {
  planOrder(this, { market: sym, size: U.size(String(size)), price: U.price(String(price)) });
});
When('it plans a buy of {float} {word} at {float} with user order id {int}', function (size, sym, price, uid) {
  planOrder(this, { market: sym, size: U.size(String(size)), price: U.price(String(price)), userOrderId: uid });
});
When('it plans a buy of {float} {word} at {float} against an existing position of {float} {word}', function (size, sym, price, pos, _u) {
  planOrder(this, { market: sym, size: U.size(String(size)), price: U.price(String(price)) }, { positionSize: U.size(String(pos)) });
});
When('it plans a reduce-only sell of {float} {word} at {float} against an existing position of {float} {word}', function (size, sym, price, pos, _u) {
  planOrder(this, { market: sym, side: 'Sell', size: U.size(String(size)), price: U.price(String(price)), reduceOnly: true, userOrderId: 999 }, { positionSize: U.size(String(pos)) });
});

// These read the pure risk decision (this.plan) or, for a chain bot that
// decided before sending, its last outcome (this.botLast.decision).
function decision(world) { return world.plan || (world.botLast && world.botLast.decision) || null; }
Then('the order is cleared to send', function () {
  const d = decision(this); this.observe('order cleared to send', () => ({ passed: !!d && d.ok && d.action === 'send', detail: j(d) }));
});
Then('the order is cleared as a dry run', function () {
  const d = decision(this); this.observe('order cleared as dry run', () => ({ passed: !!d && d.ok && d.action === 'dry-run', detail: j(d) }));
});
Then('the order is a duplicate', function () {
  const d = decision(this); this.observe('order is a duplicate', () => ({ passed: !!d && d.ok && d.action === 'duplicate', detail: j(d) }));
});
Then('the order is refused with reason {string}', function (reason) {
  // The decision is in `this.plan` for a pure risk scenario, or in the chain
  // bot's last outcome when the bot itself refused before sending.
  const d = this.plan || (this.botLast && this.botLast.decision);
  this.observe('order refused: ' + reason, () => ({ passed: !!d && d.ok === false && d.reason === reason, detail: j(d) }));
});
Then('the planned size is {float} {word}', function (size, _sym) {
  this.observe('planned size', () => ({ passed: this.plan.rounded && this.plan.rounded.size === U.size(String(size)), detail: this.plan.rounded ? U.showSize(this.plan.rounded.size) : 'no rounded' }));
});
Then('the planned price is {float}', function (price) {
  this.observe('planned price', () => ({ passed: this.plan.rounded && this.plan.rounded.price === U.price(String(price)), detail: this.plan.rounded ? U.showPrice(this.plan.rounded.price) : 'no rounded' }));
});

Then('a transient failure is retried up to the limit', async function () {
  const bot = new Bot({ dex: { url: '' }, account: '0x0', risk: this.risk });
  let calls = 0;
  try { await bot.withRetry('t', async () => { calls += 1; throw new ChainUnreachable('down'); }, { max: 3 }); }
  catch (err) { if (!(err instanceof ChainUnreachable)) throw err; }
  this.check('a transient is retried up to the limit', calls === 3, 'called ' + calls + ' times, expected 3');
});
Then('a revert is surfaced on the first attempt', async function () {
  const bot = new Bot({ dex: { url: '' }, account: '0x0', risk: this.risk });
  let calls = 0; let threw = false;
  try { await bot.withRetry('t', async () => { calls += 1; throw new Reverted({ name: 'PostOnlyWouldCross', args: [] }, 'x'); }, { max: 3 }); }
  catch (err) { if (!(err instanceof Reverted)) throw err; threw = true; }
  this.check('a revert is surfaced on the first attempt', threw && calls === 1, 'threw=' + threw + ', called ' + calls + ' times, expected 1');
});
Then('the bot\'s record contains no secret', function () {
  const bot = new Bot({ dex: { url: '' }, account: '0x0', risk: this.risk, log: ['funded account with $100000', 'plan Buy 1 ETH -> send', 'placed order 3'] });
  this.observe('no secret in the bot record', () => ({ passed: bot.leakedSecret() === null, detail: bot.leakedSecret() || 'clean' }));
});

// ---------------------------------------------------------------- bot over the chain

const CAPS = { maxOrderSize: U.size('1000'), maxPositionSize: U.size('1000') };

async function makeBot(world, usd, opts = {}) {
  if (world.sourceError) return;
  try {
    world.bot = await Bot.fromChain(world.dex, world.who.alice, { ...CAPS, ...opts });
    await world.bot.fund(usd);
    world.noted.nonce0 = null;
  } catch (err) {
    if (err instanceof ChainUnreachable) { world.sourceError = err.message; return; }
    throw err;
  }
}

Given('a bot funded with ${float}', { timeout: 60_000 }, async function (usd) { await makeBot(this, usd); });
Given('a dry-run bot funded with ${float}', { timeout: 60_000 }, async function (usd) { await makeBot(this, usd, { dryRun: true }); });
Given('the bot\'s kill switch is engaged', function () { if (this.bot) this.bot.risk.setKillSwitch(true); });

const SIDE = { buy: 'Buy', sell: 'Sell' };

/** Place through the bot, capturing a revert instead of throwing. */
async function botPlace(world, spec) {
  if (world.sourceError || !world.bot) { world.botLast = { skipped: true }; return; }
  try {
    world.botLast = await world.bot.place(spec);
    if (world.botLast.sent && world.botLast.orderId !== undefined) world.orders.bot = world.botLast.orderId;
  } catch (err) {
    if (err instanceof Reverted) { world.botLast = { sent: false, revert: err }; return; }
    if (err instanceof ChainUnreachable) { world.sourceError = err.message; world.botLast = { skipped: true }; return; }
    throw err;
  }
}

const placeStep = (kind) => async function (side, size, sym, price) {
  await botPlace(this, { sym, side: SIDE[side], size, price, orderType: kind.type, tif: kind.tif });
};
// Given/When share one registry in cucumber-js, so each text is defined once.
When('the bot places a limit {word} of {float} {word} at {float}', { timeout: 30_000 }, placeStep({ type: 'Limit', tif: 'GTC' }));
When('the bot places a post-only {word} of {float} {word} at {float}', { timeout: 30_000 }, placeStep({ type: 'Limit', tif: 'PostOnly' }));
When('the bot places an IOC {word} of {float} {word} at {float}', { timeout: 30_000 }, placeStep({ type: 'Limit', tif: 'IOC' }));
When('the bot places a {word} of {float} {word} at {float}', { timeout: 30_000 }, async function (side, size, sym, price) {
  await botPlace(this, { sym, side: SIDE[side], size, price, orderType: 'Limit', tif: 'GTC' });
});
When('the bot places a reduce-only {word} of {float} {word} at {float}', { timeout: 30_000 }, async function (side, size, sym, price) {
  await botPlace(this, { sym, side: SIDE[side], size, price, orderType: 'Limit', tif: 'GTC', reduceOnly: true });
});
When('the bot buys {float} {word} at market', { timeout: 30_000 }, async function (size, sym) {
  await botPlace(this, { sym, side: 'Buy', size, orderType: 'Market', tif: 'IOC' });
});

When('the bot cancels its order', { timeout: 30_000 }, async function () {
  if (!this.sourceError && this.bot) await this.bot.cancel(this.orders.bot).catch((e) => { if (!(e instanceof ChainUnreachable)) throw e; else this.sourceError = e.message; });
});
When('the bot cancels all its orders', { timeout: 30_000 }, async function () {
  if (!this.sourceError && this.bot) await this.bot.cancelAll().catch((e) => { if (!(e instanceof ChainUnreachable)) throw e; else this.sourceError = e.message; });
});
When('the bot flattens {word}', { timeout: 30_000 }, async function (sym) {
  if (!this.sourceError && this.bot) this.noted.flat = await this.bot.flatten(sym).catch((e) => { if (!(e instanceof ChainUnreachable)) throw e; else { this.sourceError = e.message; return null; } });
});

// ---------------------------------------------------------------- bot Thens (chain)

async function chk(world, description, fn) {
  if (world.sourceError) { world.unobservable(description, 'the source could not be reached -- ' + world.sourceError); return; }
  let r;
  try { r = await fn(); } catch (err) { if (err instanceof ChainUnreachable) { world.unobservable(description, err.message); return; } throw err; }
  world.check(description, r.passed, r.detail);
}

Then('the bot\'s order reverts with {word}', function (name) {
  this.observe('bot order reverts with ' + name, () => {
    if (!this.botLast || !this.botLast.revert) return { passed: false, detail: this.botLast && this.botLast.sent ? 'the order was sent, no revert' : 'no revert recorded (' + JSON.stringify(this.botLast) + ')' };
    return { passed: this.botLast.revert.error === name, detail: this.botLast.revert.message };
  });
});
Then('the bot tried the place once', function () {
  this.observe('place attempted once', () => { const a = (this.bot.attempts || []).filter((x) => x.op === 'place'); return { passed: a.length === 1 && a[0].tries === 1, detail: JSON.stringify(a) }; });
});
Then('the bot\'s account exists', async function () {
  await chk(this, 'bot account exists', async () => ({ passed: await this.dex.accountExists(this.who.alice), detail: 'accountExists false' }));
});
Then('the bot\'s vault balance is ${float}', async function (usd) {
  await chk(this, 'bot vault balance', async () => { const b = await this.dex.vaultBalance(this.who.alice); return { passed: b === U.usd(String(usd)), detail: '$' + U.showUsd(b) }; });
});
Then('the bot\'s order is Open', function () {
  this.observe('bot order Open', () => ({ passed: !!(this.botLast && this.botLast.order && this.botLast.order.statusName === 'Open'), detail: this.botLast && this.botLast.order ? this.botLast.order.statusName : JSON.stringify(this.botLast) }));
});
Then('the bot\'s order is Cancelled', async function () {
  await chk(this, 'bot order Cancelled', async () => { const o = await this.dex.getOrder(this.orders.bot); return { passed: o.statusName === 'Cancelled', detail: o.statusName }; });
});
Then('the bot\'s order size is {float} {word}', function (size, _u) {
  this.observe('bot order size', () => ({ passed: !!(this.botLast && this.botLast.order && this.botLast.order.size === U.size(String(size))), detail: this.botLast && this.botLast.order ? U.showSize(this.botLast.order.size) : 'no order' }));
});
Then('the bot\'s order price is {float}', function (price) {
  this.observe('bot order price', () => ({ passed: !!(this.botLast && this.botLast.order && this.botLast.order.price === U.price(String(price))), detail: this.botLast && this.botLast.order ? U.showPrice(this.botLast.order.price) : 'no order' }));
});
Then('the bot has {int} open orders', async function (n) {
  await chk(this, 'bot open orders ' + n, async () => { const a = await this.dex.getAccount(this.who.alice); return { passed: Number(a.openOrders) === n, detail: 'openOrders ' + a.openOrders }; });
});
Then('the bot is flat on {word}', async function (sym) {
  await chk(this, 'bot flat on ' + sym, () => ({ passed: !!(this.noted.flat && this.noted.flat.flat), detail: j(this.noted.flat) }));
});
Then('the bot\'s {word} position size is {float} {word}', async function (sym, size, _u) {
  const mid = { BTC: 0, ETH: 1, SOL: 2 }[sym];
  await chk(this, 'bot ' + sym + ' size', async () => { const p = await this.dex.getPosition(this.who.alice, mid); return { passed: p.size === U.size(String(size)), detail: U.showSize(p.size) }; });
});
// "the backstop's <sym> position size is ..." is already defined by the contract tier.
Then('the bot\'s {word} entry price is above 0', async function (sym) {
  const mid = { BTC: 0, ETH: 1, SOL: 2 }[sym];
  await chk(this, 'bot ' + sym + ' entry > 0', async () => { const p = await this.dex.getPosition(this.who.alice, mid); return { passed: p.entryPrice > 0n, detail: U.showPrice(p.entryPrice) }; });
});
Then('the bot\'s free collateral fell', async function () {
  await chk(this, 'bot free collateral fell', async () => { const f = await this.dex.freeCollateral(this.who.alice); const bal = await this.dex.vaultBalance(this.who.alice); return { passed: f < bal, detail: 'free $' + U.showUsd(f) + ' < balance $' + U.showUsd(bal) }; });
});
Then('the treasury\'s vault balance increased', async function () {
  await chk(this, 'treasury balance increased', async () => { const b = await this.dex.vaultBalance(this.who.treasury); return { passed: b > this.noted['bal.treasury'], detail: 'before ' + String(this.noted['bal.treasury']) + ', after ' + String(b) }; });
});
Then('the bot\'s fill was mined', function () {
  this.observe('fill mined', () => { const r = this.botLast && this.botLast.receipt && this.botLast.receipt.receipt; return { passed: !!r && r.status === '0x1' && !!r.blockNumber, detail: r ? 'status ' + r.status + ' block ' + Number(BigInt(r.blockNumber)) : 'no receipt' }; });
});
Then('the account nonce advanced by {int}', async function (n) {
  await chk(this, 'nonce advanced by ' + n, async () => {
    const now = Number(BigInt(await rpc('eth_getTransactionCount', [this.who.alice, 'latest'], this.dex.url)));
    const first = this.bot.nonces[0];
    const consecutive = this.bot.nonces.every((v, i) => i === 0 || v === this.bot.nonces[i - 1] + 1);
    return { passed: consecutive && now - first === n, detail: 'nonces ' + JSON.stringify(this.bot.nonces) + ', now ' + now };
  });
});
Then('the bot\'s {word} order clears the minimum notional', async function (sym) {
  const mid = { BTC: 0, ETH: 1, SOL: 2 }[sym];
  await chk(this, sym + ' order clears min notional', async () => {
    const o = this.botLast.order; const p = await this.dex.getMarketParams(mid);
    const notional = U.notional(o.size, o.price);
    return { passed: notional >= p.minNotional, detail: 'notional $' + U.showUsd(notional) + ' >= min $' + U.showUsd(p.minNotional) };
  });
});

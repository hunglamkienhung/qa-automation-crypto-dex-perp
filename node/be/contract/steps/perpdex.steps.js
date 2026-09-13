'use strict';

const { Given, When, Then, Before, After, BeforeAll } = require('@cucumber/cucumber');
const { PerpDex, Reverted, ChainUnreachable, MARKET_STATUS, ORDER_STATUS } = require('../chain/perpdex');
const U = require('../chain/units');

/**
 * Steps for features/be-contract-perpdex.feature.
 *
 * Isolation: an EVM snapshot before every @perpdex scenario and a revert after,
 * so each scenario starts from the freshly deployed venue. That is what lets a
 * scenario say "the insurance fund is drained" without cleaning up.
 *
 * Every write goes through `attempt()`, which records the receipt (and its
 * decoded events) or the decoded revert on the World. "the call reverts with
 * X" and "the call succeeds" read that record. A transport failure is
 * ChainUnreachable and grades Blocked, never Failed.
 */

const MARKET = { BTC: 0, ETH: 1, SOL: 2 };
const NAMES = ['admin', 'alice', 'bob', 'carol', 'dave', 'victim', 'keeper', 'erin', 'frank', 'grace'];
const UNREACHABLE = [ChainUnreachable];

let dex = null;
let accounts = null;
let pristine = null;

BeforeAll(async function () {
  // Left null when the chain is not there; every scenario then blocks with the reason.
  try {
    dex = new PerpDex();
    accounts = await dex.accounts();
    // Scenarios snapshot and revert, which restores the state at THEIR start,
    // not the state at deployment. A chain that already has orders on it will
    // make every scenario start from that history, so it is recorded here and
    // stamped into evidence rather than silently absorbed.
    const next = await dex.view('nextOrderId()', [], '(uint64)');
    pristine = next[0] === 1n;
  } catch (err) {
    dex = null;
    accounts = { error: err instanceof ChainUnreachable ? err.message : String(err.message) };
  }
});

Before({ tags: '@perpdex', timeout: 60_000 }, async function () {
  this.dex = dex;
  this.who = {};
  this.orders = {};
  this.noted = {};
  this.last = null;
  if (!dex) {
    this.sourceError = 'PerpDEX is not reachable -- ' + (accounts && accounts.error);
    return;
  }
  NAMES.forEach((n, i) => { this.who[n] = accounts[i]; });
  this.evidence('chainPristineAtStart', pristine);
  if (pristine === false) this.unobservable('scenario starts from a freshly deployed venue', 'the chain already had orders before the run began; redeploy anvil for a clean baseline');
  this.who.deployer = accounts[0];
  this.who.treasury = dex.d.treasury;
  this.who.backstop = dex.d.backstop;
  this.who.insurance = dex.d.insuranceFund;
  try {
    this.snapshot = await dex.snapshot();
  } catch (err) {
    this.sourceError = 'could not snapshot the chain -- ' + err.message;
  }
});

After({ tags: '@perpdex', timeout: 60_000 }, async function () {
  if (dex && this.snapshot) await dex.revert(this.snapshot).catch(() => {});
});

// ---------------------------------------------------------------- helpers

function addr(world, name) {
  const key = name.replace(/'s$/, '').replace(/'$/, '').replace(/^the /, '').replace(/ fund$/, '');
  const a = world.who[key];
  if (!a) throw new Error('unknown actor "' + name + '"');
  return a;
}

/** Run a write; record success or decoded revert; rethrow anything else. */
async function attempt(world, fn) {
  if (world.sourceError) { world.last = { skipped: true }; return; }
  try {
    const r = await fn();
    const receipt = r && r.receipt ? r.receipt : r;
    world.last = { ok: true, receipt, events: r && r.events ? r.events : (receipt && receipt.logs ? world.dex.decodeLogs(receipt) : []), result: r };
    world.unchecked = null;
  } catch (err) {
    if (err instanceof Reverted) { world.last = { ok: false, revert: err }; world.unchecked = err; return; }
    if (err instanceof ChainUnreachable) { world.sourceError = err.message; world.last = { skipped: true }; return; }
    throw err;
  }
}

/** Read; route an outage into Blocked. */
async function read(world, fn) {
  if (world.sourceError) return undefined;
  try { return await fn(); } catch (err) {
    if (err instanceof ChainUnreachable) { world.sourceError = err.message; return undefined; }
    throw err;
  }
}

function marketId(sym) {
  if (!(sym in MARKET)) throw new Error('unknown market ' + sym);
  return MARKET[sym];
}

async function placeAs(world, name, params, alias) {
  await attempt(world, () => world.dex.placeOrder(addr(world, name), params));
  if (world.last && world.last.ok && alias) world.orders[alias] = world.last.result.orderId;
  if (alias && world.last && world.last.ok) world.evidence('order.' + alias, String(world.orders[alias]));
}

async function fund(world, name, usdUnits) {
  await read(world, () => world.dex.fundTrader(addr(world, name), usdUnits));
}

async function marketParamsExcept(world, sym, field, value) {
  const p = await world.dex.getMarketParams(marketId(sym));
  const out = { ...p };
  if (field) out[field] = BigInt(value);
  return out;
}

// ---------------------------------------------------------------- Given: actors and funding

Given('a funded trader {word} with ${float}', { timeout: 60_000 }, async function (name, amount) {
  await fund(this, name, U.usd(String(amount)));
});

Given('a funded trader {word} with one unit less than the initial margin for {float} {word}', { timeout: 60_000 }, async function (name, size, sym) {
  const m = marketId(sym);
  const { price } = await this.dex.getIndexPrice(m);
  const p = await this.dex.getMarketParams(m);
  const required = (U.notional(U.size(String(size)), price) * p.initialMarginBps) / 10_000n;
  this.noted.required = required;
  await fund(this, name, required - 1n);
});

Given('a funded trader {word} with {int} percent of the notional of {float} {word}', { timeout: 60_000 }, async function (name, pct, size, sym) {
  const m = marketId(sym);
  const { price } = await this.dex.getIndexPrice(m);
  const n = (U.notional(U.size(String(size)), price) * BigInt(pct)) / 100n;
  this.noted.collateral = n;
  await fund(this, name, n);
});

Given('an unfunded address {word}', function (name) {
  // exists in the actor table; simply not initialised
  addr(this, name);
});

Given('an unfunded address {word} holding ${float} of USDC', { timeout: 30_000 }, async function (name, amount) {
  const a = addr(this, name);
  await read(this, async () => { await this.dex.mint(a, a, U.usd(String(amount))); await this.dex.approveVault(a, U.usd(String(amount))); });
});

Given('{word} has initialised an account', { timeout: 30_000 }, async function (name) {
  await read(this, () => this.dex.initializeAccount(addr(this, name)));
});

Given('the insurance fund is drained', { timeout: 30_000 }, async function () {
  await read(this, async () => {
    const bal = await this.dex.vaultBalance(this.dex.d.insuranceFund);
    if (bal > 0n) await this.dex.sender.send(this.who.admin, this.dex.d.insuranceFund, 'drain(address,uint256)', [this.who.admin, bal]);
  });
});

Given('the backstop is drained', { timeout: 30_000 }, async function () {
  await read(this, async () => {
    const bal = await this.dex.vaultBalance(this.dex.d.backstop);
    if (bal > 0n) await this.dex.sender.send(this.who.admin, this.dex.d.backstop, 'drain(address,uint256)', [this.who.admin, bal]);
  });
});

Given('the clock advances {int} seconds', { timeout: 30_000 }, async function (s) {
  await read(this, async () => {
    await this.dex.warp(s);
    // keep the oracle fresh: re-publish every index at its current value
    for (const m of [0, 1, 2]) {
      const { price } = await this.dex.oraclePeek(m);
      await this.dex.setMockPrice(this.who.admin, m, price);
    }
  });
});

Given('{word}\'s equity is noted', async function (name) {
  this.noted['equity.' + name] = await read(this, () => this.dex.equity(addr(this, name)));
});

Given('{word}\'s vault balance is noted', async function (name) {
  this.noted['bal.' + name] = await read(this, () => this.dex.vaultBalance(addr(this, name)));
});

Given('{word}\'s and {word}\'s vault balances are noted', async function (a, b) {
  this.noted['bal.' + a] = await read(this, () => this.dex.vaultBalance(addr(this, a)));
  this.noted['bal.' + b] = await read(this, () => this.dex.vaultBalance(addr(this, b)));
});

Given('the treasury\'s and insurance fund\'s vault balances are noted', async function () {
  this.noted['bal.treasury'] = await read(this, () => this.dex.vaultBalance(this.who.treasury));
  this.noted['bal.insurance'] = await read(this, () => this.dex.vaultBalance(this.who.insurance));
});

Given('the insurance fund\'s vault balance is noted', async function () {
  this.noted['bal.insurance'] = await read(this, () => this.dex.vaultBalance(this.who.insurance));
});

// ---------------------------------------------------------------- Given/When: trading (Given = must succeed, When = recorded)

const SIDE_OF = { buy: 'Buy', sell: 'Sell', buys: 'Buy', sells: 'Sell' };

async function marketOrder(world, name, verb, size, sym, alias) {
  await placeAs(world, name, { marketId: marketId(sym), side: SIDE_OF[verb], orderType: 'Market', tif: 'IOC', size: U.size(String(size)) }, alias);
}

Given('{word} buys {float} {word} at market', { timeout: 30_000 }, async function (name, size, sym) { await marketOrder(this, name, 'buy', size, sym, null); });
Given('{word} sells {float} {word} at market', { timeout: 30_000 }, async function (name, size, sym) { await marketOrder(this, name, 'sell', size, sym, null); });

When('{word} places a market {word} of {float} {word} as {string}', { timeout: 30_000 }, async function (name, side, size, sym, alias) {
  await marketOrder(this, name, side, size, sym, alias);
});

async function limitOrder(world, name, side, size, sym, price, alias, extra = {}) {
  await placeAs(world, name, { marketId: marketId(sym), side: SIDE_OF[side], orderType: 'Limit', tif: 'GTC', size: U.size(String(size)), price: U.price(String(price)), ...extra }, alias);
}

Given('{word} places a limit {word} of {float} {word} at {float} as {string}', { timeout: 30_000 }, async function (name, side, size, sym, price, alias) {
  await limitOrder(this, name, side, size, sym, price, alias);
});
When('{word} places a limit {word} of {float} {word} at {float} with user order id {int} as {string}', { timeout: 30_000 }, async function (name, side, size, sym, price, uid, alias) {
  await limitOrder(this, name, side, size, sym, price, alias, { userOrderId: uid });
});
When('{word} places an IOC limit {word} of {float} {word} at {float} as {string}', { timeout: 30_000 }, async function (name, side, size, sym, price, alias) {
  await limitOrder(this, name, side, size, sym, price, alias, { tif: 'IOC' });
});
When('{word} places a FOK limit {word} of {float} {word} at {float} as {string}', { timeout: 30_000 }, async function (name, side, size, sym, price, alias) {
  await limitOrder(this, name, side, size, sym, price, alias, { tif: 'FOK' });
});
When('{word} places a post-only limit {word} of {float} {word} at {float} as {string}', { timeout: 30_000 }, async function (name, side, size, sym, price, alias) {
  await limitOrder(this, name, side, size, sym, price, alias, { tif: 'PostOnly' });
});

When('{word} places a limit {word} of {float} {word} at {float} expiring {int} microsecond before the chain clock as {string}', { timeout: 30_000 }, async function (name, side, size, sym, price, us, alias) {
  const clock = await this.dex.clockMicros();
  await limitOrder(this, name, side, size, sym, price, alias, { maxTs: clock - BigInt(us) });
});
When('{word} places a limit {word} of {float} {word} at {float} expiring {int} seconds after the chain clock as {string}', { timeout: 30_000 }, async function (name, side, size, sym, price, secs, alias) {
  const clock = await this.dex.clockMicros();
  await limitOrder(this, name, side, size, sym, price, alias, { maxTs: clock + BigInt(secs) * 1_000_000n });
});

// per-market shape helpers
When('{word} places a limit {word} of one unit more than {float} {word} at {float} as {string}', { timeout: 30_000 }, async function (name, side, step, sym, price, alias) {
  await placeAs(this, name, { marketId: marketId(sym), side: SIDE_OF[side], orderType: 'Limit', size: U.size(String(step)) + 1n, price: U.price(String(price)) }, alias);
});
When('{word} places a limit {word} of {float} {word} at one unit more than {float} as {string}', { timeout: 30_000 }, async function (name, side, size, sym, price, alias) {
  await placeAs(this, name, { marketId: marketId(sym), side: SIDE_OF[side], orderType: 'Limit', size: U.size(String(size)), price: U.price(String(price)) + 1n }, alias);
});
When('{word} places a limit {word} of {float} {word} at one tick below the lower band as {string}', { timeout: 30_000 }, async function (name, side, size, sym, alias) {
  const m = marketId(sym);
  const { price } = await this.dex.getIndexPrice(m);
  const p = await this.dex.getMarketParams(m);
  const lower = (price * (10_000n - p.priceBandBps)) / 10_000n;
  const onTick = lower - (lower % p.tickSize) - p.tickSize;
  await placeAs(this, name, { marketId: m, side: SIDE_OF[side], orderType: 'Limit', size: U.size(String(size)), price: onTick }, alias);
});
When('{word} places a limit {word} of {float} {word} at exactly the lower band as {string}', { timeout: 30_000 }, async function (name, side, size, sym, alias) {
  const m = marketId(sym);
  const { price } = await this.dex.getIndexPrice(m);
  const p = await this.dex.getMarketParams(m);
  const lower = (price * (10_000n - p.priceBandBps)) / 10_000n;
  // the edge itself is accepted only if it sits on a tick; round UP to the first tick inside
  const onTick = lower % p.tickSize === 0n ? lower : lower + (p.tickSize - (lower % p.tickSize));
  await placeAs(this, name, { marketId: m, side: SIDE_OF[side], orderType: 'Limit', size: U.size(String(size)), price: onTick }, alias);
});

// trigger orders
async function triggerOrder(world, name, side, type, size, sym, trigger, limitPrice, source, alias, reduceOnly) {
  await placeAs(world, name, {
    marketId: marketId(sym), side: SIDE_OF[side], orderType: type, tif: type === 'StopLimit' ? 'GTC' : 'IOC',
    size: U.size(String(size)), price: limitPrice ? U.price(String(limitPrice)) : 0n,
    triggerPrice: U.price(String(trigger)), triggerSource: source === 'mark' ? 'Mark' : 'Index', reduceOnly: !!reduceOnly,
  }, alias);
}
Given('{word} places a stop-market {word} of {float} {word} triggered at {float} on the {word} as {string}', { timeout: 30_000 }, async function (n, s, sz, sym, t, src, alias) { await triggerOrder(this, n, s, 'StopMarket', sz, sym, t, null, src, alias, false); });
Given('{word} places a stop-limit {word} of {float} {word} triggered at {float} with limit {float} on the {word} as {string}', { timeout: 30_000 }, async function (n, s, sz, sym, t, lp, src, alias) { await triggerOrder(this, n, s, 'StopLimit', sz, sym, t, lp, src, alias, false); });
Given('{word} places a reduce-only take-profit {word} of {float} {word} triggered at {float} on the {word} as {string}', { timeout: 30_000 }, async function (n, s, sz, sym, t, src, alias) { await triggerOrder(this, n, s, 'TakeProfit', sz, sym, t, null, src, alias, true); });

When('a keeper triggers order {string}', { timeout: 30_000 }, async function (alias) {
  await attempt(this, () => this.dex.triggerOrder(this.who.keeper, this.orders[alias]));
});

// cancels
When('{word} cancels order {string}', { timeout: 30_000 }, async function (name, alias) {
  await attempt(this, () => this.dex.cancelOrder(addr(this, name), this.orders[alias]));
});
When('{word} cancels all orders on {word}', { timeout: 30_000 }, async function (name, sym) {
  await attempt(this, () => this.dex.cancelAll(addr(this, name), marketId(sym)));
});
When('{word} cancels all orders on every market', { timeout: 30_000 }, async function (name) {
  await attempt(this, () => this.dex.cancelAll(addr(this, name), 0xFFFF));
});

// account ops
When('{word} initialises an account', { timeout: 30_000 }, async function (name) {
  await attempt(this, () => this.dex.initializeAccount(addr(this, name)));
});
When('{word} deposits ${float}', { timeout: 30_000 }, async function (name, amount) {
  await attempt(this, () => this.dex.deposit(addr(this, name), U.usd(String(amount))));
});
When('{word} withdraws ${float}', { timeout: 30_000 }, async function (name, amount) {
  await attempt(this, () => this.dex.withdraw(addr(this, name), U.usd(String(amount))));
});
When('{word} withdraws one unit more than her free collateral', { timeout: 30_000 }, async function (name) {
  const free = await this.dex.freeCollateral(addr(this, name));
  await attempt(this, () => this.dex.withdraw(addr(this, name), free + 1n));
});
When('{word} withdraws exactly her free collateral', { timeout: 30_000 }, async function (name) {
  const free = await this.dex.freeCollateral(addr(this, name));
  await attempt(this, () => this.dex.withdraw(addr(this, name), free));
});
When('{word} calls the vault\'s transferBetween directly', { timeout: 30_000 }, async function (name) {
  await attempt(this, () => this.dex.sender.send(addr(this, name), this.dex.d.vault, 'transferBetween(address,address,int128,bytes32)', [this.who.alice, this.who.bob, 1n, '0x' + '00'.repeat(32)]));
});
When('{word} calls the vault\'s withdrawFor directly', { timeout: 30_000 }, async function (name) {
  await attempt(this, () => this.dex.sender.send(addr(this, name), this.dex.d.vault, 'withdrawFor(address,address,uint256)', [this.who.alice, this.who.alice, 1n]));
});

// keeper actions
When('a keeper updates funding for {word}', { timeout: 30_000 }, async function (sym) {
  const before = await read(this, () => this.dex.getFundingRate(marketId(sym)));
  this.noted['funding.before'] = before;
  await attempt(this, () => this.dex.updateFunding(this.who.keeper, marketId(sym)));
});
async function liquidate(world, victim, sym) {
  await attempt(world, () => world.dex.liquidate(world.who.keeper, addr(world, victim), marketId(sym)));
}
Given('a keeper liquidates {word} on {word}', { timeout: 30_000 }, async function (v, sym) { await liquidate(this, v, sym); });
When('a keeper settles {word} {word} position', { timeout: 30_000 }, async function (who, sym) {
  await attempt(this, () => this.dex.settlePosition(this.who.keeper, addr(this, who), marketId(sym)));
});

// admin & oracle
async function adminOrActor(world, name) { return name === 'the admin' || name === 'admin' ? world.who.admin : addr(world, name); }
When('{word} pauses the exchange', { timeout: 30_000 }, async function (name) { await attempt(this, async () => this.dex.setPaused(await adminOrActor(this, name), true)); });
Given('the admin pauses the exchange', { timeout: 30_000 }, async function () { await attempt(this, () => this.dex.setPaused(this.who.admin, true)); });
When('the admin unpauses the exchange', { timeout: 30_000 }, async function () { await attempt(this, () => this.dex.setPaused(this.who.admin, false)); });
When('the deployer pauses the exchange', { timeout: 30_000 }, async function () { await attempt(this, () => this.dex.setPaused(this.who.deployer, true)); });

async function setStatus(world, actor, sym, status, price) {
  await attempt(world, async () => world.dex.setMarketStatus(await adminOrActor(world, actor), marketId(sym), status, price ? U.price(String(price)) : 0n));
}
Given('the admin sets market {word} to {word}', { timeout: 30_000 }, async function (sym, status) { await setStatus(this, 'admin', sym, status, null); });
Given('the admin sets market {word} to Settling at {float}', { timeout: 30_000 }, async function (sym, price) { await setStatus(this, 'admin', sym, 'Settling', price); });
When('{word} sets market {word} to {word}', { timeout: 30_000 }, async function (name, sym, status) { await setStatus(this, name, sym, status, null); });

Given('the admin sets {word} fees to maker {int} and taker {int} bps', { timeout: 30_000 }, async function (sym, maker, taker) { await attempt(this, () => this.dex.setFees(this.who.admin, marketId(sym), maker, taker)); });
When('{word} sets {word} fees to maker {int} and taker {int} bps', { timeout: 30_000 }, async function (name, sym, maker, taker) { await attempt(this, () => this.dex.setFees(addr(this, name), marketId(sym), maker, taker)); });

When('the admin transfers admin to {word}', { timeout: 30_000 }, async function (to) { await attempt(this, () => this.dex.transferAdmin(this.who.admin, addr(this, to))); });
When('{word} transfers admin to {word}', { timeout: 30_000 }, async function (name, to) { await attempt(this, () => this.dex.transferAdmin(addr(this, name), addr(this, to))); });
When('{word} accepts admin', { timeout: 30_000 }, async function (name) { await attempt(this, () => this.dex.acceptAdmin(addr(this, name))); });

const PARAMS_T = '(uint64,uint64,uint64,uint16,uint16,uint16,int16,uint16,uint16,uint16,uint16,uint16,uint16,uint64,uint16,uint64)';
const PARAMS_FIELDS = ['tickSize', 'stepSize', 'minNotional', 'maxLeverage', 'initialMarginBps', 'maintenanceMarginBps', 'makerFeeBps', 'takerFeeBps', 'priceBandBps', 'maxBasisBps', 'liquidationFeeBps', 'partialLiquidationBps', 'fundingRateCapBps', 'fundingIntervalSec', 'backstopSpreadBps', 'backstopMaxSize'];
const tuple = (p) => PARAMS_FIELDS.map((f) => p[f]);

async function addMarket(world, actor, symbol, sym, field, value) {
  const p = await marketParamsExcept(world, sym, field, value);
  await attempt(world, async () => {
    const r = await world.dex.sender.send(await adminOrActor(world, actor), world.dex.ex, `addMarket(string,${PARAMS_T})`, [symbol, tuple(p)], 'addMarket');
    return r;
  });
  if (world.last && world.last.ok) world.noted.newMarketId = (await world.dex.marketCount()) - 1;
}
When('the admin adds market {string} with the {word} parameters', { timeout: 30_000 }, async function (symbol, sym) { await addMarket(this, 'admin', symbol, sym, null, null); });
When('{word} adds market {string} with the {word} parameters', { timeout: 30_000 }, async function (name, symbol, sym) { await addMarket(this, name, symbol, sym, null, null); });
When('the admin adds market {string} with the {word} parameters except {word} = {int}', { timeout: 30_000 }, async function (symbol, sym, field, value) { await addMarket(this, 'admin', symbol, sym, field, value); });
When('the admin adds markets until the count reaches {int}', { timeout: 120_000 }, async function (n) {
  await read(this, async () => {
    const p = await this.dex.getMarketParams(1);
    while ((await this.dex.marketCount()) < n) {
      await this.dex.sender.send(this.who.admin, this.dex.ex, `addMarket(string,${PARAMS_T})`, ['M', tuple(p)], 'addMarket');
    }
  });
});
When('the admin sets the {word} parameters to the {word} parameters except {word} = {int}', { timeout: 30_000 }, async function (sym, src, field, value) {
  const p = await marketParamsExcept(this, src, field, value);
  await attempt(this, () => this.dex.sender.send(this.who.admin, this.dex.ex, `setMarketParams(uint16,${PARAMS_T})`, [marketId(sym), tuple(p)], 'setMarketParams'));
});

// oracle
async function setIndex(world, actor, sym, price) {
  await attempt(world, async () => world.dex.setMockPrice(await adminOrActor(world, actor), marketId(sym), U.price(String(price))));
}
Given('the {word} index is set to {float}', { timeout: 30_000 }, async function (sym, price) { await setIndex(this, 'admin', sym, price); });
When('{word} sets the {word} mock index to {float}', { timeout: 30_000 }, async function (name, sym, price) { await setIndex(this, name, sym, price); });
When('{word} locks the {word} mock', { timeout: 30_000 }, async function (name, sym) { await attempt(this, async () => this.dex.lockMock(await adminOrActor(this, name), marketId(sym))); });
When('the admin locks the {word} mock', { timeout: 30_000 }, async function (sym) { await attempt(this, () => this.dex.lockMock(this.who.admin, marketId(sym))); });
When('the admin sets the {word} index through the admin feed to {float}', { timeout: 30_000 }, async function (sym, price) {
  await attempt(this, () => this.dex.sender.send(this.who.admin, this.dex.d.oracle, 'setPrice(uint16,uint64)', [marketId(sym), U.price(String(price))]));
});
When('{word} publishes an {word} reading of {float} stamped {int} seconds ago', { timeout: 30_000 }, async function (name, sym, price, ago) {
  const block = await this.dex.sender.call(this.who.admin, this.dex.ex, 'clockMicros()', []);
  const now = BigInt(block) / 1_000_000n;
  await attempt(this, () => this.dex.setMockReading(addr(this, name), marketId(sym), U.price(String(price)), now - BigInt(ago)));
});

// a fill that lands the mark above/below index by a percentage (for funding per market)
Given('a fill on {word} lands the mark {word} the index by {float} percent', { timeout: 60_000 }, async function (sym, direction, pct) {
  const m = marketId(sym);
  const { price: index } = await this.dex.getIndexPrice(m);
  const p = await this.dex.getMarketParams(m);
  const bps = BigInt(Math.round(pct * 100));
  let target = direction === 'above' ? (index * (10_000n + bps)) / 10_000n : (index * (10_000n - bps)) / 10_000n;
  target -= target % p.tickSize;
  // the maker's clip must clear minNotional on every market: 10 steps of SOL is under $10
  let clip = p.stepSize * 10n;
  while (U.notional(clip, target) < p.minNotional * 12n / 10n) clip += p.stepSize * 10n;
  const qty = p.backstopMaxSize + clip;
  if (direction === 'above') {
    await read(this, async () => {
      await this.dex.placeOrder(this.who.bob, { marketId: m, side: 'Sell', orderType: 'Limit', size: clip, price: target });
      await this.dex.placeOrder(this.who.alice, { marketId: m, side: 'Buy', orderType: 'Limit', size: qty, price: target });
    });
    this.noted.longSide = 'alice'; this.noted.shortSide = 'bob';
  } else {
    await read(this, async () => {
      await this.dex.placeOrder(this.who.bob, { marketId: m, side: 'Buy', orderType: 'Limit', size: clip, price: target });
      await this.dex.placeOrder(this.who.alice, { marketId: m, side: 'Sell', orderType: 'Limit', size: qty, price: target });
    });
    this.noted.longSide = 'bob'; this.noted.shortSide = 'alice';
  }
  this.evidence('markAfterFill', U.showPrice(await this.dex.getMarkPrice(m)));
});

// liquidation walk
When('the {word} index walks down in {float} percent steps until {word} is liquidatable, checking liquidate agrees at every tick', { timeout: 600_000 }, async function (sym, pct, name) {
  const m = marketId(sym);
  const who = addr(this, name);
  const p = await this.dex.getMarketParams(m);
  const pos = await this.dex.getPosition(who, m);
  const balance = await this.dex.vaultBalance(who);
  const { price: index0 } = await this.dex.getIndexPrice(m);
  const stepBps = BigInt(Math.round(pct * 100));

  // expected threshold from the contract's own arithmetic, for a single long:
  // equity = balance + size*(mark - entry)/1e10 ; maint = mm * size*mark/1e10
  // liquidatable when equity < maint  <=>  mark < (entry*size/1e10 - balance) / (size/1e10 * (1 - mm))
  // and mark = index * (1 + maxBasis) once the clamp binds, so index = mark / (1 + maxBasis)
  const size = pos.size < 0n ? -pos.size : pos.size;
  const entryNotional = Number(U.notional(size, pos.entryPrice)) / 1e6;
  const sizeF = Number(size) / 1e8;
  const mm = Number(p.maintenanceMarginBps) / 10_000;
  const markT = (entryNotional - Number(balance) / 1e6) / (sizeF * (1 - mm));
  const indexT = markT / (1 + Number(p.maxBasisBps) / 10_000);
  this.noted.expectedIndex = indexT;

  let index = index0;
  let result = { flipped: false, checks: 0 };
  await read(this, async () => {
    for (let i = 0; i < 2000; i++) {
      index = index - (index * stepBps) / 10_000n;
      await this.dex.setMockPrice(this.who.admin, m, index);
      const liq = await this.dex.isLiquidatable(who);
      result.checks++;
      if (!liq) {
        try {
          await this.dex.liquidate(this.who.keeper, who, m);
          result.disagree = 'liquidate succeeded while isLiquidatable was false at index ' + U.showPrice(index);
          return;
        } catch (err) {
          if (!(err instanceof Reverted) || err.error !== 'NotLiquidatable') throw err;
        }
      } else {
        const { maintenance } = await this.dex.marginRequirements(who);
        const eq = await this.dex.equity(who);
        result.equity = eq; result.maintenance = maintenance;
        await this.dex.liquidate(this.who.keeper, who, m);
        result.flipped = true;
        result.index = index;
        return;
      }
    }
  });
  this.walk = result;
  this.evidence('walk', { checks: result.checks, liquidatedAtIndex: result.index ? U.showPrice(result.index) : null, expectedIndex: indexT.toFixed(4), stepPct: pct });
});

// ---------------------------------------------------------------- Then: call outcome

// A revert that no "Then the call ..." step looked at is a precondition that
// silently failed. It is filed as a failed assertion, not swallowed.
After({ tags: '@perpdex' }, function () {
  if (this.unchecked) this.check('no unchecked revert during setup', false, 'a call reverted and no step asserted it: ' + this.unchecked.message);
});

Then('the call succeeds', function () {
  this.unchecked = null;
  this.observe('the call succeeded', () => ({
    passed: !!(this.last && this.last.ok),
    detail: this.last && this.last.revert ? this.last.revert.message : 'no call recorded',
  }));
});

Then('the call reverts with {word}', function (name) {
  this.unchecked = null;
  this.observe('the call reverts with ' + name, () => {
    if (!this.last) return { passed: false, detail: 'no call recorded' };
    if (this.last.ok) return { passed: false, detail: 'the call succeeded' };
    return { passed: this.last.revert.error === name, detail: this.last.revert.message };
  });
});

Then('the call reverts with BadParams {string}', function (what) {
  this.unchecked = null;
  this.observe('the call reverts with BadParams(' + what + ')', () => {
    if (!this.last || this.last.ok) return { passed: false, detail: this.last && this.last.ok ? 'the call succeeded' : 'no call' };
    const r = this.last.revert;
    return { passed: r.error === 'BadParams' && r.args[0] === what, detail: r.message };
  });
});

Then('the revert arguments are {float} and {float}', function (a, b) {
  this.observe('revert arguments', () => {
    const args = (this.last.revert && this.last.revert.args) || [];
    const want = [U.price(String(a)), U.price(String(b))];
    return { passed: args.length >= 2 && args[0] === want[0] && args[1] === want[1], detail: 'got ' + args.map(String).join(', ') + ', want ' + want.map(String).join(', ') };
  });
});

Then('the revert arguments are {float}, {float} and {float}', function (a, b, c) {
  this.observe('revert arguments', () => {
    const args = (this.last.revert && this.last.revert.args) || [];
    const want = [U.price(String(a)), U.price(String(b)), U.price(String(c))];
    return { passed: args.length >= 3 && want.every((w, i) => args[i] === w), detail: 'got ' + args.map(String).join(', ') };
  });
});

Then('the revert names order {string}', function (alias) {
  this.observe('revert names order ' + alias, () => {
    const args = (this.last.revert && this.last.revert.args) || [];
    return { passed: args[0] === this.orders[alias], detail: 'got ' + String(args[0]) + ', want ' + String(this.orders[alias]) };
  });
});

Then('the required collateral in the revert equals the initial margin for {float} {word}', function (_size, _sym) {
  this.observe('InsufficientCollateral.required == initial margin', () => {
    const args = (this.last.revert && this.last.revert.args) || [];
    return { passed: args[1] === this.noted.required, detail: 'required ' + String(args[1]) + ', computed ' + String(this.noted.required) };
  });
});

// ---------------------------------------------------------------- Then: state

async function check(world, description, fn) {
  if (world.sourceError) { world.unobservable(description, 'the source could not be reached -- ' + world.sourceError); return; }
  let r;
  try { r = await fn(); } catch (err) {
    if (err instanceof ChainUnreachable) { world.unobservable(description, err.message); return; }
    throw err;
  }
  world.check(description, r.passed, r.detail);
}

Then('{word}\'s account exists', async function (name) {
  await check(this, name + ' account exists', async () => ({ passed: await this.dex.accountExists(addr(this, name)), detail: 'accountExists() false' }));
});
Then('{word} has {int} open orders', async function (name, n) {
  await check(this, name + ' has ' + n + ' open orders', async () => { const a = await this.dex.getAccount(addr(this, name)); return { passed: Number(a.openOrders) === n, detail: 'openOrders = ' + String(a.openOrders) }; });
});
Then('{word}\'s account was created in the current block or earlier', async function (name) {
  await check(this, 'createdAt <= now', async () => { const a = await this.dex.getAccount(addr(this, name)); const now = (await this.dex.clockMicros()) / 1_000_000n; return { passed: a.createdAt > 0n && a.createdAt <= now, detail: 'createdAt ' + String(a.createdAt) + ', now ' + String(now) }; });
});
Then('{word}\'s vault balance is ${float}', async function (name, amount) {
  await check(this, name + ' vault balance', async () => { const b = await this.dex.vaultBalance(addr(this, name)); return { passed: b === U.usd(String(amount)), detail: 'balance $' + U.showUsd(b) }; });
});
Then('{word}\'s vault balance is below ${float}', async function (name, amount) {
  await check(this, name + ' vault balance below', async () => { const b = await this.dex.vaultBalance(addr(this, name)); return { passed: b < U.usd(String(amount)), detail: 'balance $' + U.showUsd(b) }; });
});
Then('{word}\'s vault balance is at least ${float}', async function (name, amount) {
  await check(this, name + ' vault balance at least', async () => { const b = await this.dex.vaultBalance(addr(this, name)); return { passed: b >= U.usd(String(amount)), detail: 'balance $' + U.showUsd(b) }; });
});
Then('{word}\'s vault balance changed by ${float}', async function (name, delta) {
  await check(this, name + ' balance delta', async () => { const b = await this.dex.vaultBalance(addr(this, name)); const d = b - this.noted['bal.' + name]; return { passed: d === U.usd(String(delta)), detail: 'delta $' + U.showUsd(d) + ', want $' + delta }; });
});
Then('{word}\'s vault balance decreased', async function (name) {
  await check(this, name + ' balance decreased', async () => { const b = await this.dex.vaultBalance(addr(this, name)); return { passed: b < this.noted['bal.' + name], detail: 'before ' + String(this.noted['bal.' + name]) + ', after ' + String(b) }; });
});
Then('{word}\'s vault balance increased', async function (name) {
  await check(this, name + ' balance increased', async () => { const b = await this.dex.vaultBalance(addr(this, name)); return { passed: b > this.noted['bal.' + name], detail: 'before ' + String(this.noted['bal.' + name]) + ', after ' + String(b) }; });
});
Then('the treasury\'s vault balance changed by ${float}', async function (delta) {
  await check(this, 'treasury balance delta', async () => { const b = await this.dex.vaultBalance(this.who.treasury); const d = b - this.noted['bal.treasury']; return { passed: d === U.usd(String(delta)), detail: 'delta $' + U.showUsd(d) }; });
});
Then('the insurance fund\'s vault balance changed by ${float}', async function (delta) {
  await check(this, 'insurance balance delta', async () => { const b = await this.dex.vaultBalance(this.who.insurance); const d = b - this.noted['bal.insurance']; return { passed: d === U.usd(String(delta)), detail: 'delta $' + U.showUsd(d) }; });
});
Then('the insurance fund\'s vault balance decreased', async function () {
  await check(this, 'insurance balance decreased', async () => { const b = await this.dex.vaultBalance(this.who.insurance); return { passed: b < this.noted['bal.insurance'], detail: 'before ' + String(this.noted['bal.insurance']) + ', after ' + String(b) }; });
});
Then('{word}\'s free collateral is at most ${float}', async function (name, amount) {
  await check(this, name + ' free collateral', async () => { const f = await this.dex.freeCollateral(addr(this, name)); return { passed: f <= U.usd(String(amount)), detail: 'free $' + U.showUsd(f) }; });
});
Then('the vault holds exactly its ledger', async function () {
  await check(this, 'vault tokens == ledger', async () => { const r = await this.dex.vaultReserves(); return { passed: r.held === BigInt(r.ledger), detail: 'held ' + String(r.held) + ', ledger ' + String(r.ledger) }; });
});

// positions
Then('{word}\'s {word} position size is {float} {word}', async function (name, sym, size, _unit) {
  await check(this, name + ' ' + sym + ' size', async () => { const p = await this.dex.getPosition(addr(this, name), marketId(sym)); return { passed: p.size === U.size(String(size)), detail: 'size ' + U.showSize(p.size) }; });
});
Then('the backstop\'s {word} position size is {float} {word}', async function (sym, size, _unit) {
  await check(this, 'backstop ' + sym + ' size', async () => { const p = await this.dex.getPosition(this.who.backstop, marketId(sym)); return { passed: p.size === U.size(String(size)), detail: 'size ' + U.showSize(p.size) }; });
});
Then('{word}\'s {word} entry price is {float}', async function (name, sym, price) {
  await check(this, name + ' ' + sym + ' entry', async () => { const p = await this.dex.getPosition(addr(this, name), marketId(sym)); return { passed: p.entryPrice === U.price(String(price)), detail: 'entry ' + U.showPrice(p.entryPrice) }; });
});
Then('{word}\'s {word} realised pnl is ${float}', async function (name, sym, pnl) {
  await check(this, name + ' ' + sym + ' realised pnl', async () => { const p = await this.dex.getPosition(addr(this, name), marketId(sym)); return { passed: p.realizedPnl === U.usd(String(pnl)), detail: 'realised $' + U.showUsd(p.realizedPnl) }; });
});
Then('{word} has {int} position holders', async function (sym, n) {
  await check(this, sym + ' holders', async () => { const h = await this.dex.holdersOf(marketId(sym)); return { passed: h.length === n, detail: 'holders ' + h.length }; });
});
Then('{word} open interest is {float} {word} long and {float} {word} short', async function (sym, l, _s1, s, _s2) {
  await check(this, sym + ' open interest', async () => { const m = await this.dex.getMarket(marketId(sym)); return { passed: m.openInterestLong === U.size(String(l)) && m.openInterestShort === U.size(String(s)), detail: 'long ' + U.showSize(m.openInterestLong) + ', short ' + U.showSize(m.openInterestShort) }; });
});
Then('{word}\'s equity changed by ${float}', async function (name, delta) {
  await check(this, name + ' equity delta', async () => { const e = await this.dex.equity(addr(this, name)); const d = e - this.noted['equity.' + name]; return { passed: d === U.usd(String(delta)), detail: 'delta $' + U.showUsd(d) }; });
});
Then('{word}\'s equity decreased', async function (name) {
  await check(this, name + ' equity decreased', async () => { const e = await this.dex.equity(addr(this, name)); return { passed: e < this.noted['equity.' + name], detail: 'before ' + String(this.noted['equity.' + name]) + ', after ' + String(e) }; });
});
Then('{word}\'s equity is above ${float}', async function (name, amount) {
  await check(this, name + ' equity above', async () => { const e = await this.dex.equity(addr(this, name)); return { passed: e > U.usd(String(amount)), detail: 'equity $' + U.showUsd(e) }; });
});
Then('{word}\'s estimated {word} liquidation price is below her entry and above 0', async function (name, sym) {
  await check(this, name + ' est. liq below entry', async () => { const a = addr(this, name); const l = await this.dex.estimatedLiquidationPrice(a, marketId(sym)); const p = await this.dex.getPosition(a, marketId(sym)); return { passed: l > 0n && l < p.entryPrice, detail: 'liq ' + U.showPrice(l) + ', entry ' + U.showPrice(p.entryPrice) }; });
});
Then('{word}\'s estimated {word} liquidation price is above his entry', async function (name, sym) {
  await check(this, name + ' est. liq above entry', async () => { const a = addr(this, name); const l = await this.dex.estimatedLiquidationPrice(a, marketId(sym)); const p = await this.dex.getPosition(a, marketId(sym)); return { passed: l > p.entryPrice, detail: 'liq ' + U.showPrice(l) + ', entry ' + U.showPrice(p.entryPrice) }; });
});
Then('{word} is liquidatable', async function (name) {
  await check(this, name + ' is liquidatable', async () => ({ passed: await this.dex.isLiquidatable(addr(this, name)), detail: 'isLiquidatable false' }));
});
Then('{word} is not liquidatable', async function (name) {
  await check(this, name + ' is not liquidatable', async () => ({ passed: !(await this.dex.isLiquidatable(addr(this, name))), detail: 'isLiquidatable true' }));
});
Then('{word}\'s liquidation count is {int}', async function (name, n) {
  await check(this, name + ' liquidationCount', async () => { const a = await this.dex.getAccount(addr(this, name)); return { passed: Number(a.liquidationCount) === n, detail: 'count ' + String(a.liquidationCount) }; });
});
Then('{word}\'s last liquidation was in the current block', async function (name) {
  await check(this, name + ' lastLiquidatedAt == now', async () => { const a = await this.dex.getAccount(addr(this, name)); const now = (await this.dex.clockMicros()) / 1_000_000n; return { passed: a.lastLiquidatedAt === now, detail: 'lastLiquidatedAt ' + String(a.lastLiquidatedAt) + ', now ' + String(now) }; });
});

// orders & book
Then('order {string} status is {word}', async function (alias, status) {
  await check(this, 'order ' + alias + ' status', async () => { const o = await this.dex.getOrder(this.orders[alias]); return { passed: o.statusName === status, detail: 'status ' + o.statusName }; });
});
Then('order {string} filled is {float} {word}', async function (alias, size, _unit) {
  await check(this, 'order ' + alias + ' filled', async () => { const o = await this.dex.getOrder(this.orders[alias]); return { passed: o.filled === U.size(String(size)), detail: 'filled ' + U.showSize(o.filled) }; });
});
Then('market {word} has {int} pending triggers', async function (sym, n) {
  await check(this, sym + ' pending triggers', async () => { const ids = await this.dex.pendingTriggerIds(marketId(sym)); return { passed: ids.length === n, detail: 'pending ' + ids.length }; });
});
Then('the {word} order book has a bid at {float} of {float} {word} from the {word}', async function (sym, price, size, _s, source) {
  await check(this, sym + ' bid level', async () => { const b = await this.dex.getOrderBook(marketId(sym), 10); const src = source === 'backstop' ? 1 : 0; const hit = b.bids.find((l) => l.price === U.price(String(price)) && l.source === src); return { passed: !!hit && hit.size === U.size(String(size)), detail: 'bids ' + b.bids.map((l) => U.showPrice(l.price) + '@' + U.showSize(l.size) + '/' + l.source).join(' ') }; });
});
Then('the {word} order book has an ask at {float} of {float} {word} from the {word}', async function (sym, price, size, _s, source) {
  await check(this, sym + ' ask level', async () => { const b = await this.dex.getOrderBook(marketId(sym), 10); const src = source === 'backstop' ? 1 : 0; const hit = b.asks.find((l) => l.price === U.price(String(price)) && l.source === src); return { passed: !!hit && hit.size === U.size(String(size)), detail: 'asks ' + b.asks.map((l) => U.showPrice(l.price) + '@' + U.showSize(l.size) + '/' + l.source).join(' ') }; });
});
Then('the {word} order book has no bid at {float}', async function (sym, price) {
  await check(this, sym + ' no bid', async () => { const b = await this.dex.getOrderBook(marketId(sym), 10); return { passed: !b.bids.some((l) => l.price === U.price(String(price))), detail: 'bids ' + b.bids.map((l) => U.showPrice(l.price)).join(' ') }; });
});
Then('the {word} order book has no backstop levels', async function (sym) {
  await check(this, sym + ' no backstop', async () => { const b = await this.dex.getOrderBook(marketId(sym), 10); return { passed: ![...b.bids, ...b.asks].some((l) => l.source === 1), detail: 'levels ' + [...b.bids, ...b.asks].length }; });
});

// prices & funding
Then('the mark price of {word} is {float}', async function (sym, price) {
  await check(this, sym + ' mark', async () => { const m = await this.dex.getMarkPrice(marketId(sym)); return { passed: m === U.price(String(price)), detail: 'mark ' + U.showPrice(m) }; });
});
Then('the mark price of {word} equals its index price', async function (sym) {
  await check(this, sym + ' mark == index', async () => { const m = await this.dex.getMarkPrice(marketId(sym)); const { price } = await this.dex.getIndexPrice(marketId(sym)); return { passed: m === price, detail: 'mark ' + U.showPrice(m) + ', index ' + U.showPrice(price) }; });
});
Then('the index price of {word} is {float}', async function (sym, price) {
  await check(this, sym + ' index', async () => { const { price: p } = await this.dex.getIndexPrice(marketId(sym)); return { passed: p === U.price(String(price)), detail: 'index ' + U.showPrice(p) }; });
});
Then('reading the {word} index reverts with {word}', async function (sym, name) {
  await check(this, sym + ' index reverts ' + name, async () => { try { await this.dex.getIndexPrice(marketId(sym)); return { passed: false, detail: 'did not revert' }; } catch (err) { return { passed: err instanceof Reverted && err.error === name, detail: err.message }; } });
});
Then('the {word} oracle peek reports stale', async function (sym) {
  await check(this, sym + ' peek stale', async () => { const r = await this.dex.oraclePeek(marketId(sym)); return { passed: r.isStale === true, detail: 'isStale ' + r.isStale }; });
});
Then('{word} funding did not advance', async function (sym) {
  await check(this, sym + ' funding unchanged', async () => { const f = await this.dex.getFundingRate(marketId(sym)); const b = this.noted['funding.before']; return { passed: f.cumulativeIndex === b.cumulativeIndex && f.lastFundingTime === b.lastFundingTime, detail: 'index ' + String(f.cumulativeIndex) + ', time ' + String(f.lastFundingTime) }; });
});
Then('{word} funding advanced', async function (sym) {
  await check(this, sym + ' funding advanced', async () => { const f = await this.dex.getFundingRate(marketId(sym)); const b = this.noted['funding.before']; return { passed: f.lastFundingTime > b.lastFundingTime, detail: 'time before ' + String(b.lastFundingTime) + ', after ' + String(f.lastFundingTime) }; });
});
Then('the {word} funding rate is {int} bps', async function (sym, bps) {
  await check(this, sym + ' rate', async () => { const f = await this.dex.getFundingRate(marketId(sym)); return { passed: f.lastRateBps === BigInt(bps), detail: 'rate ' + String(f.lastRateBps) + ' bps' }; });
});
Then('the {word} funding rate is positive', async function (sym) {
  await check(this, sym + ' rate > 0', async () => { const f = await this.dex.getFundingRate(marketId(sym)); return { passed: f.lastRateBps > 0n, detail: 'rate ' + String(f.lastRateBps) }; });
});
Then('the {word} funding rate is negative', async function (sym) {
  await check(this, sym + ' rate < 0', async () => { const f = await this.dex.getFundingRate(marketId(sym)); return { passed: f.lastRateBps < 0n, detail: 'rate ' + String(f.lastRateBps) }; });
});
Then('the {word} funding rate is at most {int} bps', async function (sym, bps) {
  await check(this, sym + ' rate <= cap', async () => { const f = await this.dex.getFundingRate(marketId(sym)); return { passed: f.lastRateBps <= BigInt(bps), detail: 'rate ' + String(f.lastRateBps) }; });
});
Then('the {word} funding rate is between {int} and {int} bps', async function (sym, lo, hi) {
  await check(this, sym + ' rate in range', async () => { const f = await this.dex.getFundingRate(marketId(sym)); return { passed: f.lastRateBps >= BigInt(lo) && f.lastRateBps <= BigInt(hi), detail: 'rate ' + String(f.lastRateBps) }; });
});
Then('market {word}\'s last funding time is on an interval boundary', async function (sym) {
  const mid = /^\d+$/.test(sym) ? Number(sym) : marketId(sym); // a symbol, or a freshly added market's id
  await check(this, sym + ' funding boundary', async () => { const f = await this.dex.getFundingRate(mid); const p = await this.dex.getMarketParams(mid); return { passed: f.lastFundingTime % p.fundingIntervalSec === 0n, detail: 'lastFundingTime ' + String(f.lastFundingTime) + ' mod ' + String(p.fundingIntervalSec) + ' = ' + String(f.lastFundingTime % p.fundingIntervalSec) }; });
});
Then('market {word}\'s last funding time is the most recent boundary', async function (sym) {
  await check(this, sym + ' most recent boundary', async () => { const f = await this.dex.getFundingRate(marketId(sym)); const p = await this.dex.getMarketParams(marketId(sym)); const now = (await this.dex.clockMicros()) / 1_000_000n; const want = now - (now % p.fundingIntervalSec); return { passed: f.lastFundingTime === want, detail: 'lastFundingTime ' + String(f.lastFundingTime) + ', want ' + String(want) }; });
});
Then('on the next touch the {word} on {word} pay funding', { timeout: 60_000 }, async function (payer, sym) {
  const m = marketId(sym);
  const name = payer === 'longs' ? this.noted.longSide : this.noted.shortSide;
  const who = addr(this, name);
  await check(this, payer + ' pay funding on touch', async () => {
    const p = await this.dex.getMarketParams(m);
    const pos = await this.dex.getPosition(who, m);
    // touch: reduce by a clip that clears minNotional at the index
    const { price: idx } = await this.dex.getIndexPrice(m);
    let clip = p.stepSize * 10n;
    while (U.notional(clip, idx) < p.minNotional * 12n / 10n) clip += p.stepSize * 10n;
    const side = pos.size > 0n ? 'Sell' : 'Buy';
    const r = await this.dex.placeOrder(who, { marketId: m, side, orderType: 'Market', tif: 'IOC', size: clip });
    const pc = r.events.find((e) => e.name === 'PositionChanged' && e.account.toLowerCase() === who.toLowerCase());
    return { passed: !!pc && pc.fundingPaid > 0n, detail: pc ? 'fundingPaid ' + String(pc.fundingPaid) : 'no PositionChanged for ' + name };
  });
});

// markets
Then('the new market id is {int}', function (n) {
  this.observe('new market id', () => ({ passed: this.noted.newMarketId === n, detail: 'id ' + this.noted.newMarketId }));
});
Then('market {int} is Active', async function (m) {
  await check(this, 'market ' + m + ' Active', async () => { const mk = await this.dex.getMarket(m); return { passed: mk.statusName === 'Active', detail: mk.statusName }; });
});
Then('the market count is {int}', async function (n) {
  await check(this, 'market count', async () => { const c = await this.dex.marketCount(); return { passed: c === n, detail: 'count ' + c }; });
});
Then('the {word} market parameters are:', async function (sym, table) {
  await check(this, sym + ' params', async () => {
    const p = await this.dex.getMarketParams(marketId(sym));
    const bad = [];
    for (const [field, value] of table.raw()) if (String(p[field]) !== value) bad.push(field + '=' + String(p[field]) + ' (want ' + value + ')');
    return { passed: bad.length === 0, detail: bad.length ? bad.join('; ') : table.raw().length + ' fields equal' };
  });
});
Then('the {word} market parameter {word} is {int}', async function (sym, field, value) {
  await check(this, sym + ' ' + field, async () => { const p = await this.dex.getMarketParams(marketId(sym)); return { passed: p[field] === BigInt(value), detail: field + ' = ' + String(p[field]) }; });
});
Then('the pending admin is {word}', async function (name) {
  await check(this, 'pendingAdmin', async () => { const a = await this.dex.pendingAdmin(); return { passed: a.toLowerCase() === addr(this, name).toLowerCase(), detail: a }; });
});
Then('the admin is still the deployer', async function () {
  await check(this, 'admin unchanged', async () => { const a = await this.dex.admin(); return { passed: a.toLowerCase() === this.who.deployer.toLowerCase(), detail: a }; });
});
Then('the admin is {word}', async function (name) {
  await check(this, 'admin', async () => { const a = await this.dex.admin(); return { passed: a.toLowerCase() === addr(this, name).toLowerCase(), detail: a }; });
});

// walk results
Then('the walk ended with a successful liquidation', function () {
  this.observe('walk flipped and liquidated', () => ({ passed: !!(this.walk && this.walk.flipped && !this.walk.disagree), detail: this.walk ? (this.walk.disagree || ('liquidated at index ' + U.showPrice(this.walk.index) + ' after ' + this.walk.checks + ' ticks')) : 'no walk' }));
});
Then('the liquidation index matched the equity-equals-maintenance arithmetic within one step', function () {
  this.observe('threshold matches arithmetic', () => {
    if (!this.walk || !this.walk.index) return { passed: false, detail: 'no liquidation index' };
    const got = Number(this.walk.index) / 1e8;
    const want = this.noted.expectedIndex;
    const stepFrac = 0.001;
    const ok = got <= want && got > want * (1 - stepFrac) * (1 - stepFrac);
    return { passed: ok, detail: 'first liquidatable index ' + got.toFixed(4) + ', computed threshold ' + want.toFixed(4) };
  });
});

// events
function events(world) { return (world.last && world.last.events) || []; }
Then('an AccountInitialized event names {word}', function (name) {
  this.observe('AccountInitialized', () => { const e = events(this).find((x) => x.name === 'AccountInitialized'); return { passed: !!e && e.account.toLowerCase() === addr(this, name).toLowerCase(), detail: e ? e.account : 'no event' }; });
});
Then('a Deposited event names {word} with amount ${float}', function (name, amount) {
  this.observe('Deposited', () => { const e = events(this).find((x) => x.name === 'Deposited'); return { passed: !!e && e.account.toLowerCase() === addr(this, name).toLowerCase() && e.amount === U.usd(String(amount)), detail: e ? 'amount ' + String(e.amount) : 'no event' }; });
});
Then('a MarketStatusChanged event reports {word} {word} at {float}', function (sym, status, price) {
  this.observe('MarketStatusChanged', () => { const e = events(this).find((x) => x.name === 'MarketStatusChanged'); return { passed: !!e && Number(e.marketId) === marketId(sym) && Number(e.status) === MARKET_STATUS[status] && e.settlementPrice === U.price(String(price)), detail: e ? JSON.stringify(e, (k, v) => typeof v === 'bigint' ? String(v) : v) : 'no event' }; });
});
Then('an OrderCancelled event has reason {string}', function (reason) {
  this.observe('OrderCancelled reason ' + reason, () => { const e = events(this).find((x) => x.name === 'OrderCancelled'); const got = e ? Buffer.from(e.reason.slice(2), 'hex').toString('utf8').replace(/\0+$/, '') : null; return { passed: got === reason, detail: 'reason ' + got }; });
});
Then('an OrderCancelled event has reason {string} and unfilled {float} {word}', function (reason, size, _unit) {
  this.observe('OrderCancelled', () => { const e = events(this).find((x) => x.name === 'OrderCancelled'); const got = e ? Buffer.from(e.reason.slice(2), 'hex').toString('utf8').replace(/\0+$/, '') : null; return { passed: got === reason && e.unfilled === U.size(String(size)), detail: 'reason ' + got + ', unfilled ' + (e ? U.showSize(e.unfilled) : '-') }; });
});
Then('an OrderTriggered event names order {string}', function (alias) {
  this.observe('OrderTriggered', () => { const e = events(this).find((x) => x.name === 'OrderTriggered'); return { passed: !!e && e.orderId === this.orders[alias], detail: e ? 'orderId ' + String(e.orderId) : 'no event' }; });
});
Then('an OrderPlaced event matches the placed order exactly', async function () {
  await check(this, 'OrderPlaced == order', async () => {
    const e = events(this).find((x) => x.name === 'OrderPlaced');
    if (!e) return { passed: false, detail: 'no event' };
    const o = await this.dex.getOrder(e.orderId);
    const same = ['marketId', 'side', 'orderType', 'tif', 'size', 'price', 'triggerPrice', 'reduceOnly', 'userOrderId', 'maxTs'].filter((f) => String(e[f]) !== String(o[f]));
    return { passed: same.length === 0 && e.owner.toLowerCase() === o.owner.toLowerCase(), detail: same.length ? 'differ: ' + same.join(',') : 'all fields equal' };
  });
});
Then('the OrderFilled events in order name makers {word} then the zero address', function (first) {
  this.observe('OrderFilled makers', () => { const f = events(this).filter((x) => x.name === 'OrderFilled'); return { passed: f.length === 2 && f[0].maker.toLowerCase() === addr(this, first).toLowerCase() && /^0x0{40}$/.test(f[1].maker), detail: f.map((x) => x.maker).join(', ') }; });
});
Then('the second OrderFilled event has makerOrderId {int}', function (n) {
  this.observe('second OrderFilled makerOrderId', () => { const f = events(this).filter((x) => x.name === 'OrderFilled'); return { passed: f.length >= 2 && f[1].makerOrderId === BigInt(n), detail: f.length >= 2 ? String(f[1].makerOrderId) : 'fewer than 2 fills' }; });
});
Then('there are {int} PositionChanged events', function (n) {
  this.observe('PositionChanged count', () => { const c = events(this).filter((x) => x.name === 'PositionChanged').length; return { passed: c === n, detail: 'count ' + c }; });
});
Then('the PositionChanged event for {word} reports sizeBefore {float} {word} and sizeAfter {float} {word}', function (name, b, _u1, a, _u2) {
  this.observe('PositionChanged ' + name, () => { const e = events(this).find((x) => x.name === 'PositionChanged' && x.account.toLowerCase() === addr(this, name).toLowerCase()); return { passed: !!e && e.sizeBefore === U.size(String(b)) && e.sizeAfter === U.size(String(a)), detail: e ? 'before ' + U.showSize(e.sizeBefore) + ', after ' + U.showSize(e.sizeAfter) : 'no event' }; });
});
Then('a FundingUpdated event reports {word} with samples at least {int} and a boundary-aligned time', async function (sym, n) {
  await check(this, 'FundingUpdated', async () => { const e = events(this).find((x) => x.name === 'FundingUpdated'); if (!e) return { passed: false, detail: 'no event' }; const p = await this.dex.getMarketParams(marketId(sym)); return { passed: Number(e.marketId) === marketId(sym) && e.samples >= BigInt(n) && e.fundingTime % p.fundingIntervalSec === 0n, detail: 'samples ' + String(e.samples) + ', time ' + String(e.fundingTime) }; });
});
Then('a Liquidated event reports badDebt above {int} and insuranceUsed equal to badDebt', function (_zero) {
  this.observe('Liquidated bad debt covered', () => { const e = events(this).find((x) => x.name === 'Liquidated'); return { passed: !!e && e.badDebt > 0n && e.insuranceUsed === e.badDebt, detail: e ? 'badDebt ' + String(e.badDebt) + ', insuranceUsed ' + String(e.insuranceUsed) : 'no event' }; });
});
Then('a Liquidated event reports sizeClosed {float} {word}, a fee above {int}, and insuranceUsed at most badDebt', function (size, _unit, _zero) {
  this.observe('Liquidated fields', () => { const e = events(this).find((x) => x.name === 'Liquidated'); return { passed: !!e && e.sizeClosed === U.size(String(size)) && e.liquidatorFee > 0n && e.insuranceUsed <= e.badDebt, detail: e ? 'sizeClosed ' + U.showSize(e.sizeClosed) + ', fee ' + String(e.liquidatorFee) + ', badDebt ' + String(e.badDebt) + ', insuranceUsed ' + String(e.insuranceUsed) : 'no event' }; });
});
Then('an AutoDeleveraged event names {word}', function (name) {
  this.observe('AutoDeleveraged ' + name, () => { const e = events(this).find((x) => x.name === 'AutoDeleveraged' && x.account.toLowerCase() === addr(this, name).toLowerCase()); return { passed: !!e, detail: e ? 'sizeClosed ' + U.showSize(e.sizeClosed) + ', socialised ' + String(e.socialised) : 'no event for ' + name }; });
});
Then('no AutoDeleveraged event names {word}', function (name) {
  this.observe('no AutoDeleveraged for ' + name, () => { const e = events(this).find((x) => x.name === 'AutoDeleveraged' && x.account.toLowerCase() === addr(this, name).toLowerCase()); return { passed: !e, detail: e ? 'found one' : 'none' }; });
});
Then('no AutoDeleveraged event was emitted', function () {
  this.observe('no AutoDeleveraged', () => { const c = events(this).filter((x) => x.name === 'AutoDeleveraged').length; return { passed: c === 0, detail: 'count ' + c }; });
});
Then('an AdminTransferred event names {word}', function (name) {
  this.observe('AdminTransferred', () => { const e = events(this).find((x) => x.name === 'AdminTransferred'); return { passed: !!e && e.current.toLowerCase() === addr(this, name).toLowerCase(), detail: e ? e.current : 'no event' }; });
});

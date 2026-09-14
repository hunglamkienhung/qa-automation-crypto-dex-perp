'use strict';

const fs = require('fs');
const path = require('path');
const { rpc, call, ChainUnreachable } = require('./ethcall');
const abi = require('./abi');
const { Sender, Reverted, WrongChain } = require('./sender');

/**
 * Client for the exchange in ../../../../contracts, over raw JSON-RPC.
 *
 * Everything the contract exposes that a test needs: the write calls, the
 * getters decoded into named objects, the custom errors decoded by name, and
 * the events decoded from receipts. The ABI is spelled out here by hand, from
 * the Solidity, so a mismatch is visible in one place.
 *
 * Addresses come from deployments/31337.json, written by the deploy script.
 */

const RPC = process.env.PERPDEX_RPC || 'http://127.0.0.1:8545';
const DEPLOYMENTS = process.env.PERPDEX_DEPLOYMENTS
  || path.join(__dirname, '..', '..', '..', '..', 'contracts', 'deployments', '31337.json');

const ERRORS = [
  'NotAdmin()', 'PendingAdminMismatch()', 'ExchangePaused()', 'AccountNotFound()', 'AccountExists()',
  'UnknownMarket(uint16)', 'MarketPaused(uint16)', 'MarketSettling(uint16)', 'MarketNotSettling(uint16)',
  'ReduceOnlyViolation()', 'PriceOutOfBand(uint64,uint64,uint64)', 'InvalidTick(uint64,uint64)', 'InvalidStep(uint64,uint64)',
  'BelowMinNotional(uint256,uint64)', 'OrderExpired(uint64,uint64)', 'DuplicateUserOrderId(uint32)', 'OrderSlotsFull()',
  'PostOnlyWouldCross(uint64,uint64)', 'InsufficientCollateral(int256,uint256)', 'SelfTradePrevented(uint64)',
  'FillOrKillUnfillable(uint64,uint64)', 'NotOrderOwner()', 'OrderNotOpen(uint64)', 'TriggerNotMet(uint64,uint64)',
  'NotLiquidatable(address)', 'NoPosition()', 'TooManyMarkets()', 'BadParams(string)', 'ZeroAmount()', 'WiringAlreadySet()',
  'InvalidLeverage()',
  // vault / oracle / token
  'NotExchange()', 'InsufficientBalance(int128,uint256)', 'TransferFailed()', 'MockIsLocked(uint16)', 'OracleStale(uint16,uint64,uint64)',
  'ZeroPrice()', 'InsufficientBalance(uint256,uint256)', 'InsufficientAllowance(uint256,uint256)',
];

// enums, as the contract numbers them
const SIDE = { Buy: 0, Sell: 1 };
const ORDER_TYPE = { Market: 0, Limit: 1, StopMarket: 2, StopLimit: 3, TakeProfit: 4 };
const TIF = { GTC: 0, IOC: 1, FOK: 2, PostOnly: 3 };
const TRIGGER = { Mark: 0, Index: 1 };
const ORDER_STATUS = ['Pending', 'Open', 'Filled', 'Cancelled'];
const MARKET_STATUS = { Active: 0, Paused: 1, ReduceOnly: 2, Settling: 3 };
const MARKET_STATUS_NAMES = ['Active', 'Paused', 'ReduceOnly', 'Settling'];

const ORDER_PARAMS_T = '(uint16,uint8,uint8,uint8,uint64,uint64,uint64,uint8,bool,uint32,uint64)';
const ORDER_T = '(uint64,address,uint16,uint8,uint8,uint8,uint64,uint64,uint64,uint64,uint8,bool,uint32,uint64,uint64,uint64,uint8)';
const ORDER_FIELDS = ['id', 'owner', 'marketId', 'side', 'orderType', 'tif', 'size', 'filled', 'price', 'triggerPrice', 'triggerSource', 'reduceOnly', 'userOrderId', 'maxTs', 'placedAt', 'seq', 'status'];
const POSITION_T = '(int64,uint64,int128,int128,uint64)';
const POSITION_FIELDS = ['size', 'entryPrice', 'realizedPnl', 'fundingIndexSnapshot', 'lastUpdated'];
const ACCOUNT_T = '(bool,uint8,uint32,uint64,uint64)';
const ACCOUNT_FIELDS = ['exists', 'openOrders', 'liquidationCount', 'lastLiquidatedAt', 'createdAt'];
const PARAMS_T = '(uint64,uint64,uint64,uint16,uint16,uint16,int16,uint16,uint16,uint16,uint16,uint16,uint16,uint64,uint16,uint64)';
const PARAMS_FIELDS = ['tickSize', 'stepSize', 'minNotional', 'maxLeverage', 'initialMarginBps', 'maintenanceMarginBps', 'makerFeeBps', 'takerFeeBps', 'priceBandBps', 'maxBasisBps', 'liquidationFeeBps', 'partialLiquidationBps', 'fundingRateCapBps', 'fundingIntervalSec', 'backstopSpreadBps', 'backstopMaxSize'];
const MARKET_T = `(string,uint8,${PARAMS_T},uint64,int128,uint64,int64,int128,uint64,uint64,uint64,uint64)`;
const MARKET_FIELDS = ['symbol', 'status', 'params', 'settlementPrice', 'cumulativeFundingIndex', 'lastFundingTime', 'lastFundingRateBps', 'premiumAccumulatorBps', 'premiumSamples', 'lastFillPrice', 'openInterestLong', 'openInterestShort'];
const LEVEL_T = '(uint64,uint64,uint8)';

const EVENTS = {
  OrderPlaced: { sig: 'OrderPlaced(uint64,address,uint16,uint8,uint8,uint8,uint64,uint64,uint64,bool,uint32,uint64)', indexed: ['uint64', 'address', 'uint16'], data: '(uint8,uint8,uint8,uint64,uint64,uint64,bool,uint32,uint64)', fields: ['orderId', 'owner', 'marketId', 'side', 'orderType', 'tif', 'size', 'price', 'triggerPrice', 'reduceOnly', 'userOrderId', 'maxTs'] },
  OrderCancelled: { sig: 'OrderCancelled(uint64,address,uint16,uint64,bytes32)', indexed: ['uint64', 'address', 'uint16'], data: '(uint64,bytes32)', fields: ['orderId', 'owner', 'marketId', 'unfilled', 'reason'] },
  OrderTriggered: { sig: 'OrderTriggered(uint64,uint16,uint64,uint64)', indexed: ['uint64', 'uint16'], data: '(uint64,uint64)', fields: ['orderId', 'marketId', 'triggerPrice', 'observedPrice'] },
  OrderFilled: { sig: 'OrderFilled(uint64,address,address,uint16,uint8,uint64,uint64,uint64,uint256,int256)', indexed: ['uint64', 'address', 'address'], data: '(uint16,uint8,uint64,uint64,uint64,uint256,int256)', fields: ['takerOrderId', 'taker', 'maker', 'marketId', 'takerSide', 'size', 'price', 'makerOrderId', 'takerFee', 'makerFee'] },
  PositionChanged: { sig: 'PositionChanged(address,uint16,int64,int64,uint64,int256,int256)', indexed: ['address', 'uint16'], data: '(int64,int64,uint64,int256,int256)', fields: ['account', 'marketId', 'sizeBefore', 'sizeAfter', 'entryPrice', 'realizedPnlDelta', 'fundingPaid'] },
  FundingUpdated: { sig: 'FundingUpdated(uint16,int64,int128,uint64,uint64)', indexed: ['uint16'], data: '(int64,int128,uint64,uint64)', fields: ['marketId', 'rateBps', 'cumulativeIndex', 'fundingTime', 'samples'] },
  Liquidated: { sig: 'Liquidated(address,uint16,address,uint64,uint64,uint256,uint256,uint256)', indexed: ['address', 'uint16', 'address'], data: '(uint64,uint64,uint256,uint256,uint256)', fields: ['account', 'marketId', 'liquidator', 'sizeClosed', 'price', 'liquidatorFee', 'badDebt', 'insuranceUsed'] },
  AutoDeleveraged: { sig: 'AutoDeleveraged(address,uint16,uint64,uint64,uint256)', indexed: ['address', 'uint16'], data: '(uint64,uint64,uint256)', fields: ['account', 'marketId', 'sizeClosed', 'price', 'socialised'] },
  MarketStatusChanged: { sig: 'MarketStatusChanged(uint16,uint8,uint64)', indexed: ['uint16'], data: '(uint8,uint64)', fields: ['marketId', 'status', 'settlementPrice'] },
  AccountInitialized: { sig: 'AccountInitialized(address)', indexed: ['address'], data: '()', fields: ['account'] },
  Deposited: { sig: 'Deposited(address,uint256)', indexed: ['address'], data: '(uint256)', fields: ['account', 'amount'] },
  Withdrawn: { sig: 'Withdrawn(address,uint256)', indexed: ['address'], data: '(uint256)', fields: ['account', 'amount'] },
  AdminTransferred: { sig: 'AdminTransferred(address,address)', indexed: ['address', 'address'], data: '()', fields: ['previous', 'current'] },
  Settled: { sig: 'Settled(address,uint16,uint64,int256)', indexed: ['address', 'uint16'], data: '(uint64,int256)', fields: ['account', 'marketId', 'price', 'realizedPnlDelta'] },
};
const TOPICS = Object.fromEntries(Object.entries(EVENTS).map(([name, e]) => [abi.topic(e.sig), name]));

function loadDeployment(file = DEPLOYMENTS) {
  if (!fs.existsSync(file)) {
    throw new ChainUnreachable('no deployment at ' + file + ' -- run the deploy script against anvil first');
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

class PerpDex {
  constructor({ url = RPC, deployment = null } = {}) {
    this.url = url;
    this.d = deployment || loadDeployment();
    this.sender = new Sender({ url, errors: ERRORS });
    this.ex = this.d.exchange;
  }

  // ------------------------------------------------------------ chain
  async chainId() { return Number(BigInt(await rpc('eth_chainId', [], this.url))); }
  async blockNumber() { return Number(BigInt(await rpc('eth_blockNumber', [], this.url))); }
  async accounts() { return rpc('eth_accounts', [], this.url); }
  async block(n) { return rpc('eth_getBlockByNumber', [typeof n === 'number' ? '0x' + n.toString(16) : n, false], this.url); }
  async mine(n = 1) { for (let i = 0; i < n; i++) await rpc('evm_mine', [], this.url); }
  /** Deploy raw bytecode with ABI-encoded constructor args from an unlocked account; returns the new address. */
  async deployContract(from, bytecode, ctorTypes, ctorArgs) {
    await this.sender.assertChain();
    const data = (bytecode.startsWith('0x') ? bytecode : '0x' + bytecode) + abi.encodeTuple(abi.parseType(ctorTypes).components, ctorArgs);
    const hash = await rpc('eth_sendTransaction', [{ from, data, gas: '0x' + (30_000_000).toString(16) }], this.url);
    const receipt = await this.sender.waitForReceipt(hash);
    if (receipt.status !== '0x1' || !receipt.contractAddress) throw new Error('deployment failed: ' + JSON.stringify(receipt));
    return receipt.contractAddress;
  }
  async warp(seconds) { await rpc('evm_increaseTime', [seconds], this.url); await this.mine(); }
  /** Force the NEXT mined block's timestamp, so a test can place a write at a known time. */
  async setNextBlockTimestamp(ts) { await rpc('evm_setNextBlockTimestamp', [Number(ts)], this.url); }
  async snapshot() { return rpc('evm_snapshot', [], this.url); }
  async revert(id) { return rpc('evm_revert', [id], this.url); }

  // ------------------------------------------------------------ reads (raw call, decoded)
  async view(signature, args, types, fields) {
    const data = abi.encodeCall(signature, args);
    let raw;
    try {
      raw = await rpc('eth_call', [{ to: this.ex, data }, 'latest'], this.url);
    } catch (err) {
      throw this.sender._translate(err, signature);
    }
    const vals = abi.decode(types, raw);
    return fields ? abi.named(fields, vals[0]) : vals;
  }

  async getAccount(a) { return this.view('getAccount(address)', [a], `(${ACCOUNT_T})`, ACCOUNT_FIELDS); }
  async accountExists(a) { return (await this.view('accountExists(address)', [a], '(bool)'))[0]; }
  async getPosition(a, m) { return this.view('getPosition(address,uint16)', [a, m], `(${POSITION_T})`, POSITION_FIELDS); }
  async getOrder(id) { const o = await this.view('getOrder(uint64)', [id], `(${ORDER_T})`, ORDER_FIELDS); o.statusName = ORDER_STATUS[Number(o.status)]; return o; }
  async getOpenOrders(a) { const [list] = await this.view('getOpenOrders(address)', [a], `(${ORDER_T}[])`); return list.map((v) => ({ ...abi.named(ORDER_FIELDS, v), statusName: ORDER_STATUS[Number(v[16])] })); }
  async getMarket(m) { const mk = await this.view('getMarket(uint16)', [m], `(${MARKET_T})`, MARKET_FIELDS); mk.params = abi.named(PARAMS_FIELDS, mk.params); mk.statusName = MARKET_STATUS_NAMES[Number(mk.status)]; return mk; }
  async getMarketParams(m) { return this.view('getMarketParams(uint16)', [m], `(${PARAMS_T})`, PARAMS_FIELDS); }
  async getOrderBook(m, depth = 5) {
    const [bids, asks] = await this.view('getOrderBook(uint16,uint8)', [m, depth], `(${LEVEL_T}[],${LEVEL_T}[])`);
    const lv = (x) => ({ price: x[0], size: x[1], source: Number(x[2]) });
    return { bids: bids.map(lv), asks: asks.map(lv) };
  }
  async getMarkPrice(m) { return (await this.view('getMarkPrice(uint16)', [m], '(uint64)'))[0]; }
  async getIndexPrice(m) { const [p, t] = await this.view('getIndexPrice(uint16)', [m], '(uint64,uint64)'); return { price: p, publishTime: t }; }
  async getFundingRate(m) { const v = await this.view('getFundingRate(uint16)', [m], '(int64,int128,uint64,uint64)'); return abi.named(['lastRateBps', 'cumulativeIndex', 'lastFundingTime', 'nextFundingTime'], v); }
  async equity(a) { return (await this.view('equity(address)', [a], '(int256)'))[0]; }
  async freeCollateral(a) { return (await this.view('freeCollateral(address)', [a], '(int256)'))[0]; }
  async marginRequirements(a) { const [i, m] = await this.view('marginRequirements(address)', [a], '(uint256,uint256)'); return { initial: i, maintenance: m }; }
  async isLiquidatable(a) { return (await this.view('isLiquidatable(address)', [a], '(bool)'))[0]; }
  async estimatedLiquidationPrice(a, m) { return (await this.view('estimatedLiquidationPrice(address,uint16)', [a, m], '(uint64)'))[0]; }
  async clockMicros() { return (await this.view('clockMicros()', [], '(uint64)'))[0]; }
  async marketCount() { return Number((await this.view('marketCount()', [], '(uint16)'))[0]); }
  async paused() { return (await this.view('paused()', [], '(bool)'))[0]; }
  async admin() { return (await this.view('admin()', [], '(address)'))[0]; }
  async pendingAdmin() { return (await this.view('pendingAdmin()', [], '(address)'))[0]; }
  async pendingTriggerIds(m) { return (await this.view('pendingTriggerIds(uint16)', [m], '(uint64[])'))[0]; }
  async holdersOf(m) { return (await this.view('holdersOf(uint16)', [m], '(address[])'))[0]; }

  async vaultBalance(a) {
    const raw = await call(this.d.vault, 'balanceOf(address)', [a], this.url);
    return abi.decode('(int128)', raw)[0];
  }
  async vaultReserves() {
    const raw = await call(this.d.vault, 'reserves()', [], this.url);
    const [held, ledger] = abi.decode('(uint256,int128)', raw);
    return { held, ledger };
  }
  async vaultTotal() { return abi.decode('(int128)', await call(this.d.vault, 'totalBalances()', [], this.url))[0]; }
  async usdcBalance(a) { return abi.decode('(uint256)', await call(this.d.usdc, 'balanceOf(address)', [a], this.url))[0]; }
  async oraclePeek(m) { const [p, t, s] = abi.decode('(uint64,uint64,bool)', await call(this.d.oracle, 'peek(uint16)', [m], this.url)); return { price: p, publishTime: t, isStale: s }; }

  // ------------------------------------------------------------ writes
  async initializeAccount(from) { return this.sender.send(from, this.ex, 'initializeAccount()', []); }
  async deposit(from, amount) { return this.sender.send(from, this.ex, 'deposit(uint256)', [amount]); }
  async withdraw(from, amount) { return this.sender.send(from, this.ex, 'withdraw(uint256)', [amount]); }
  async placeOrder(from, p) {
    const args = [[p.marketId, SIDE[p.side], ORDER_TYPE[p.orderType], TIF[p.tif || 'GTC'], p.size, p.price || 0n, p.triggerPrice || 0n, TRIGGER[p.triggerSource || 'Index'], !!p.reduceOnly, p.userOrderId || 0, p.maxTs || 0n]];
    const receipt = await this.sender.send(from, this.ex, `placeOrder(${ORDER_PARAMS_T})`, args, 'placeOrder');
    const events = this.decodeLogs(receipt);
    const placed = events.find((e) => e.name === 'OrderPlaced');
    return { receipt, events, orderId: placed ? placed.orderId : null };
  }
  async cancelOrder(from, id) { return this.sender.send(from, this.ex, 'cancelOrder(uint64)', [id]); }
  async cancelAll(from, marketId = 0xFFFF) { return this.sender.send(from, this.ex, 'cancelAll(uint16)', [marketId]); }
  async triggerOrder(from, id) { return this.sender.send(from, this.ex, 'triggerOrder(uint64)', [id]); }
  async updateFunding(from, m) { return this.sender.send(from, this.ex, 'updateFunding(uint16)', [m]); }
  async liquidate(from, a, m) { return this.sender.send(from, this.ex, 'liquidate(address,uint16)', [a, m]); }
  async settlePosition(from, a, m) { return this.sender.send(from, this.ex, 'settlePosition(address,uint16)', [a, m]); }
  // admin
  async setPaused(from, v) { return this.sender.send(from, this.ex, 'setPaused(bool)', [v]); }
  async setMarketStatus(from, m, status, settlementPrice = 0n) { return this.sender.send(from, this.ex, 'setMarketStatus(uint16,uint8,uint64)', [m, MARKET_STATUS[status], settlementPrice]); }
  async setFees(from, m, maker, taker) { return this.sender.send(from, this.ex, 'setFees(uint16,int16,uint16)', [m, maker, taker]); }
  async transferAdmin(from, to) { return this.sender.send(from, this.ex, 'transferAdmin(address)', [to]); }
  async acceptAdmin(from) { return this.sender.send(from, this.ex, 'acceptAdmin()', []); }
  // oracle
  async setMockPrice(from, m, price) { return this.sender.send(from, this.d.oracle, 'setMockPrice(uint16,uint64)', [m, price]); }
  async setMockReading(from, m, price, publishTime) { return this.sender.send(from, this.d.oracle, 'setMockReading(uint16,uint64,uint64)', [m, price, publishTime]); }
  async lockMock(from, m) { return this.sender.send(from, this.d.oracle, 'lockMock(uint16)', [m]); }
  // token
  async mint(from, to, amount) { return this.sender.send(from, this.d.usdc, 'mint(address,uint256)', [to, amount]); }
  async approveVault(from, amount) { return this.sender.send(from, this.d.usdc, 'approve(address,uint256)', [this.d.vault, amount]); }

  /** Mint, approve, initialise (if needed) and deposit: a funded trader in one call. */
  async fundTrader(who, amount) {
    await this.mint(who, who, amount);
    await this.approveVault(who, amount);
    if (!(await this.accountExists(who))) await this.initializeAccount(who);
    await this.deposit(who, amount);
  }

  // ------------------------------------------------------------ events
  decodeLogs(receipt) {
    const out = [];
    for (const log of receipt.logs || []) {
      const name = TOPICS[log.topics[0]];
      if (!name) continue;
      const e = EVENTS[name];
      const indexed = e.indexed.map((t, i) => abi.decode(`(${t})`, log.topics[i + 1])[0]);
      const data = e.data === '()' ? [] : abi.decode(e.data, log.data);
      const decoded = abi.named(e.fields, [...indexed, ...data]);
      decoded.name = name;
      decoded.logIndex = Number(BigInt(log.logIndex));
      decoded.txHash = log.transactionHash;
      decoded.blockNumber = Number(BigInt(log.blockNumber));
      out.push(decoded);
    }
    return out;
  }

  /** All exchange logs in a block range, decoded. */
  async logs(fromBlock, toBlock = 'latest') {
    const raw = await rpc('eth_getLogs', [{ address: this.ex, fromBlock: '0x' + fromBlock.toString(16), toBlock }], this.url);
    return this.decodeLogs({ logs: raw });
  }
}

module.exports = { PerpDex, SIDE, ORDER_TYPE, TIF, TRIGGER, ORDER_STATUS, MARKET_STATUS, EVENTS, ERRORS, Reverted, WrongChain, ChainUnreachable, loadDeployment, RPC };

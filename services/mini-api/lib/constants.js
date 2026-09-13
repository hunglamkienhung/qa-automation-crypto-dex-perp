'use strict';

/**
 * Selectors and topics this service needs, precomputed from the signatures
 * below with the repository's own Keccak (node/be/contract/chain).
 * Regenerate by re-running the generator in the commit that added this file.
 * The service ships no hashing code of its own; the signature is the source of truth.
 */

const SELECTORS = {
  'marketCount()': '0xec979082',
  'getMarket(uint16)': '0x13a30013',
  'getMarketParams(uint16)': '0xaabe30b4',
  'getMarkPrice(uint16)': '0xdd24e5bd',
  'getIndexPrice(uint16)': '0xb50c5620',
  'getPosition(address,uint16)': '0xd3d25221',
  'getOrder(uint64)': '0xcdf9d07c',
  'backstop()': '0x7dea1817',
  'insuranceFund()': '0xb7902303',
  'treasury()': '0x61d027b3',
  'equity(address)': '0x2e8a498c',
  'freeCollateral(address)': '0x29fd9747',
  'marginRequirements(address)': '0x711741c5',
  'isLiquidatable(address)': '0x042e02cf',
};

const TOPICS = {
  '0x3d927c4090684d05f81d55d80846b96f32b260daff5fdd1913a30f255bc0d407': { name: 'OrderPlaced', sig: 'OrderPlaced(uint64,address,uint16,uint8,uint8,uint8,uint64,uint64,uint64,bool,uint32,uint64)', indexed: ["uint64","address","uint16"], data: '(uint8,uint8,uint8,uint64,uint64,uint64,bool,uint32,uint64)', fields: ["orderId","owner","marketId","side","orderType","tif","size","price","triggerPrice","reduceOnly","userOrderId","maxTs"] },
  '0x7699531c6eb39eec48e152e4ebe83745d82fa78ffd7be3107217bc21657315f9': { name: 'OrderCancelled', sig: 'OrderCancelled(uint64,address,uint16,uint64,bytes32)', indexed: ["uint64","address","uint16"], data: '(uint64,bytes32)', fields: ["orderId","owner","marketId","unfilled","reason"] },
  '0xa154f7a4e116e29b5dd687613a6605fcb0f817f9ba08f2f0779edc5676048de0': { name: 'OrderTriggered', sig: 'OrderTriggered(uint64,uint16,uint64,uint64)', indexed: ["uint64","uint16"], data: '(uint64,uint64)', fields: ["orderId","marketId","triggerPrice","observedPrice"] },
  '0xa4634a94eba368e99c66dcc84b2ca5553591a59bb8a0ea180ac057c621295e44': { name: 'OrderFilled', sig: 'OrderFilled(uint64,address,address,uint16,uint8,uint64,uint64,uint64,uint256,int256)', indexed: ["uint64","address","address"], data: '(uint16,uint8,uint64,uint64,uint64,uint256,int256)', fields: ["takerOrderId","taker","maker","marketId","takerSide","size","price","makerOrderId","takerFee","makerFee"] },
  '0xc5ad73e9e069d93b45f75e30fb1abf67d02624391e46b08c7d5cc2cf2592834e': { name: 'PositionChanged', sig: 'PositionChanged(address,uint16,int64,int64,uint64,int256,int256)', indexed: ["address","uint16"], data: '(int64,int64,uint64,int256,int256)', fields: ["account","marketId","sizeBefore","sizeAfter","entryPrice","realizedPnlDelta","fundingPaid"] },
  '0xe6eb43177bfcd5f831187ad20f4229ee4821a11fbdab9363a21cfa54c5fad2cf': { name: 'FundingUpdated', sig: 'FundingUpdated(uint16,int64,int128,uint64,uint64)', indexed: ["uint16"], data: '(int64,int128,uint64,uint64)', fields: ["marketId","rateBps","cumulativeIndex","fundingTime","samples"] },
  '0x79121d666bd382d0e3664059469a9000198258b9ff85ba2bf76a65f600d31a3f': { name: 'Liquidated', sig: 'Liquidated(address,uint16,address,uint64,uint64,uint256,uint256,uint256)', indexed: ["address","uint16","address"], data: '(uint64,uint64,uint256,uint256,uint256)', fields: ["account","marketId","liquidator","sizeClosed","price","liquidatorFee","badDebt","insuranceUsed"] },
  '0x2cbc088f8b002fa17dcfb967a5a172f35d25972881617be5ff97033fc85d835c': { name: 'AutoDeleveraged', sig: 'AutoDeleveraged(address,uint16,uint64,uint64,uint256)', indexed: ["address","uint16"], data: '(uint64,uint64,uint256)', fields: ["account","marketId","sizeClosed","price","socialised"] },
  '0xae242870c2a2b25530a7033b75bc41098dd610187e1828909d23d0bdb2afa83c': { name: 'MarketStatusChanged', sig: 'MarketStatusChanged(uint16,uint8,uint64)', indexed: ["uint16"], data: '(uint8,uint64)', fields: ["marketId","status","settlementPrice"] },
  '0x9b44a2c7f9f0b5aa4e7da60d8a2325796c57f93a45559d66515743ffbd8a6103': { name: 'AccountInitialized', sig: 'AccountInitialized(address)', indexed: ["address"], data: '()', fields: ["account"] },
  '0x2da466a7b24304f47e87fa2e1e5a81b9831ce54fec19055ce277ca2f39ba42c4': { name: 'Deposited', sig: 'Deposited(address,uint256)', indexed: ["address"], data: '(uint256)', fields: ["account","amount"] },
  '0x7084f5476618d8e60b11ef0d7d3f06914655adb8793e28ff7f018d4c76d505d5': { name: 'Withdrawn', sig: 'Withdrawn(address,uint256)', indexed: ["address"], data: '(uint256)', fields: ["account","amount"] },
  '0xf8ccb027dfcd135e000e9d45e6cc2d662578a8825d4c45b5e32e0adf67e79ec6': { name: 'AdminTransferred', sig: 'AdminTransferred(address,address)', indexed: ["address","address"], data: '()', fields: ["previous","current"] },
  '0x494b5cc90c6141847a9eb6d51bc158b43964829684fadc7a333ea887130ecf8b': { name: 'Settled', sig: 'Settled(address,uint16,uint64,int256)', indexed: ["address","uint16"], data: '(uint64,int256)', fields: ["account","marketId","price","realizedPnlDelta"] },
  '0x88454b5881b17d3cbebe8932d1408bab11acd9cae379858987c8e2afad0aca01': { name: 'PriceSet', sig: 'PriceSet(uint16,uint64,uint64,address)', indexed: ['uint16','address'], data: '(uint64,uint64)', fields: ['marketId','by','price','publishTime'] },
};

module.exports = { SELECTORS, TOPICS };

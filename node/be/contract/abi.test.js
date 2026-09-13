'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const abi = require('./chain/abi');
const V = require('./chain/abi.vectors');

test('encodes placeOrder calldata byte-for-byte as cast does', () => {
  assert.equal(abi.encodeCall(V.placeOrderCalldata.signature, V.placeOrderCalldata.args), V.placeOrderCalldata.hex);
});

test('round-trips the order book return shape (two dynamic arrays of tuples)', () => {
  const t = abi.parseType(V.orderBookReturn.types);
  const enc = '0x' + abi.encodeTuple(t.components, V.orderBookReturn.values);
  assert.equal(enc, V.orderBookReturn.hex);
  assert.deepEqual(abi.decode(V.orderBookReturn.types, V.orderBookReturn.hex), V.orderBookReturn.values);
});

test('handles a string next to static fields and a nested static tuple', () => {
  const t = abi.parseType(V.mixedDynamic.types);
  assert.equal('0x' + abi.encodeTuple(t.components, V.mixedDynamic.values), V.mixedDynamic.hex);
  assert.deepEqual(abi.decode(V.mixedDynamic.types, V.mixedDynamic.hex), V.mixedDynamic.values);
});

test('signed integers, addresses, bools and bytes32', () => {
  const t = abi.parseType(V.signedAddressBoolBytes.types);
  assert.equal('0x' + abi.encodeTuple(t.components, V.signedAddressBoolBytes.values), V.signedAddressBoolBytes.hex);
  assert.deepEqual(abi.decode(V.signedAddressBoolBytes.types, V.signedAddressBoolBytes.hex), V.signedAddressBoolBytes.values);
});

test('error selectors and event topics agree with cast', () => {
  const table = abi.errorTable([V.errorSelector.signature]);
  assert.ok(table[V.errorSelector.hex.slice(2)], 'selector present');
  assert.equal(abi.topic(V.eventTopic.signature), V.eventTopic.hex);
});

test('decodes a custom error with arguments', () => {
  const table = abi.errorTable(['InsufficientCollateral(int256,uint256)', 'AccountNotFound()']);
  const data = V.errorSelector.hex + abi.word(-40000000n) + abi.word(50000000n);
  const e = abi.decodeError(data, table);
  assert.equal(e.name, 'InsufficientCollateral');
  assert.deepEqual(e.args, [-40000000n, 50000000n]);
  assert.equal(abi.decodeError('0xdeadbeef', table).name, 'unknown');
});

test('refuses values that do not fit their type', () => {
  assert.throws(() => abi.encodeCall('f(uint8)', [256n]), /does not fit/);
  assert.throws(() => abi.encodeCall('f(int8)', [128n]), /does not fit/);
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { keccak256, selector, selfCheck, VECTORS, SELECTOR_VECTORS } = require('./chain/keccak');

/**
 * Tests for the hash function the whole contract tier depends on.
 *
 * A contract call is a four-byte selector and nothing else identifies the
 * function being invoked. A wrong selector does not reliably fail: if it
 * collides with another function on the same contract, the node returns a
 * perfectly well-formed number that means something entirely different, and
 * nothing anywhere says so.
 *
 * So this is verified against published vectors before any of it is trusted.
 * An unverified hash function is not a hash function; it is a confident source
 * of wrong answers.
 */

test('published Keccak-256 vectors', () => {
  for (const [input, expected] of VECTORS) {
    assert.equal(keccak256(Buffer.from(input, 'utf8')).toString('hex'), expected,
      `keccak256(${JSON.stringify(input)})`);
  }
});

test('selectors every Ethereum developer can recite', () => {
  for (const [signature, expected] of SELECTOR_VECTORS) {
    assert.equal(selector(signature), expected, signature);
  }
});

test('selfCheck reports no failures', () => {
  assert.deepEqual(selfCheck(), []);
});

/**
 * The mistake this guards against is using the standard library by accident.
 *
 * `crypto.createHash('sha3-256')` exists, takes the same input, returns the
 * same number of bytes, and is a DIFFERENT function: SHA3 pads with 0x06 where
 * Keccak pads with 0x01. Reaching for it produces a plausible 32 bytes and a
 * selector that addresses nothing.
 */
test('Keccak-256 is not SHA3-256', () => {
  const input = Buffer.from('abc', 'utf8');
  const sha3 = crypto.createHash('sha3-256').update(input).digest('hex');
  const keccak = keccak256(input).toString('hex');

  assert.notEqual(keccak, sha3,
    'if these ever match, one of the two implementations is not what it claims to be');
  assert.equal(keccak, '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
});

test('a one-character change produces a completely different digest', () => {
  const a = keccak256(Buffer.from('poolAmounts(address)', 'utf8')).toString('hex');
  const b = keccak256(Buffer.from('poolAmounts(address )', 'utf8')).toString('hex');

  assert.notEqual(a, b);
  // Signatures are canonical: no spaces, no parameter names. A stray character
  // silently addresses a different function rather than raising anything.
  assert.notEqual(selector('poolAmounts(address)'), selector('poolAmounts(address )'));
});

test('the empty input has the well-known digest', () => {
  assert.equal(
    keccak256(Buffer.alloc(0)).toString('hex'),
    'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'
  );
});

test('input longer than one sponge block is absorbed correctly', () => {
  // 136 bytes is the rate for a 256-bit digest, so this crosses a block
  // boundary and exercises the absorb loop rather than a single permutation.
  const long = Buffer.alloc(200, 0x61);   // 200 * "a"
  const digest = keccak256(long).toString('hex');

  assert.equal(digest.length, 64);
  assert.notEqual(digest, keccak256(Buffer.alloc(136, 0x61)).toString('hex'));
});

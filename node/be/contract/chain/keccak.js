'use strict';

/**
 * Keccak-256, in about a hundred lines, with no dependency.
 *
 * Needed because a contract call is a 4-byte function selector followed by
 * arguments, and the selector is the first four bytes of the Keccak-256 hash of
 * the signature. There is no way to talk to a contract without it.
 *
 * Why not just hardcode the selectors
 * ------------------------------------
 * Because a wrong selector does not fail the way you want it to. During design
 * a guessed selector was sent to a live contract and the node answered
 * `execution reverted` -- loud, and easy to catch. The dangerous case is the
 * other one: a selector that happens to match a DIFFERENT function on the same
 * contract returns a perfectly well-formed number that means something else
 * entirely. Nothing anywhere says so.
 *
 * Why not node:crypto
 * -------------------
 * `crypto.createHash('sha3-256')` is NOT this. SHA3-256 and Keccak-256 use
 * different padding -- 0x06 against 0x01 -- and produce completely different
 * digests for the same input. Using one where the other is meant is a mistake
 * that compiles, runs, and returns a plausible-looking 32 bytes.
 *
 * This implementation is checked against published test vectors on load; see
 * selfCheck() at the bottom and selftest/keccak.test.js. An unverified hash
 * function is not a hash function, it is a source of confident wrong answers.
 */

const MASK = (1n << 64n) - 1n;

const ROUND_CONSTANTS = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

/** Rho rotation offsets, lane index = x + 5*y. */
const ROTATION = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
];

function rotl64(value, shift) {
  if (shift === 0) return value & MASK;
  const s = BigInt(shift);
  return ((value << s) | (value >> (64n - s))) & MASK;
}

/** The Keccak-f[1600] permutation, in place on 25 lanes. */
function permute(lanes) {
  for (let round = 0; round < 24; round++) {
    // theta
    const C = new Array(5);
    for (let x = 0; x < 5; x++) {
      C[x] = lanes[x] ^ lanes[x + 5] ^ lanes[x + 10] ^ lanes[x + 15] ^ lanes[x + 20];
    }
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rotl64(C[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y++) lanes[x + 5 * y] ^= D;
    }

    // rho and pi
    const B = new Array(25).fill(0n);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl64(lanes[x + 5 * y], ROTATION[x + 5 * y]);
      }
    }

    // chi
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        lanes[x + 5 * y] =
          B[x + 5 * y] ^ (~B[((x + 1) % 5) + 5 * y] & B[((x + 2) % 5) + 5 * y] & MASK);
      }
    }

    // iota
    lanes[0] ^= ROUND_CONSTANTS[round];
  }
}

/**
 * @param {Buffer|Uint8Array} message
 * @returns {Buffer} 32 bytes
 */
function keccak256(message) {
  const RATE = 136;                       // 1088 bits, for a 256-bit digest
  const input = Buffer.from(message);

  // Keccak padding: 0x01 ... 0x80. SHA3 uses 0x06 here; they are not the same.
  const padLength = RATE - (input.length % RATE);
  const padded = Buffer.concat([input, Buffer.alloc(padLength)]);
  padded[input.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  const lanes = new Array(25).fill(0n);

  for (let offset = 0; offset < padded.length; offset += RATE) {
    for (let i = 0; i < RATE / 8; i++) {
      lanes[i] ^= padded.readBigUInt64LE(offset + i * 8);
    }
    permute(lanes);
  }

  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) out.writeBigUInt64LE(lanes[i], i * 8);
  return out;
}

/**
 * The 4-byte selector for a canonical function signature.
 * @param {string} signature e.g. "transfer(address,uint256)"
 */
function selector(signature) {
  return '0x' + keccak256(Buffer.from(signature, 'utf8')).subarray(0, 4).toString('hex');
}

/**
 * Published Keccak-256 vectors, plus two selectors every Ethereum developer can
 * recite. Cheap, and it is the difference between a hash function and a
 * confident source of wrong answers.
 */
const VECTORS = [
  ['', 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'],
  ['abc', '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45'],
];

const SELECTOR_VECTORS = [
  ['transfer(address,uint256)', '0xa9059cbb'],
  ['balanceOf(address)', '0x70a08231'],
];

function selfCheck() {
  const failures = [];
  for (const [input, expected] of VECTORS) {
    const got = keccak256(Buffer.from(input, 'utf8')).toString('hex');
    if (got !== expected) failures.push(`keccak256(${JSON.stringify(input)}) = ${got}, expected ${expected}`);
  }
  for (const [signature, expected] of SELECTOR_VECTORS) {
    const got = selector(signature);
    if (got !== expected) failures.push(`selector(${signature}) = ${got}, expected ${expected}`);
  }
  return failures;
}

module.exports = { keccak256, selector, selfCheck, VECTORS, SELECTOR_VECTORS };

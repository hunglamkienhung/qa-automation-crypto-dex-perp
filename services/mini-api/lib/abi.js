'use strict';

// No hashing here: selectors and topics come precomputed from constants.js.
const { SELECTORS } = require('./constants');
function selector(signature) {
  const s = SELECTORS[signature];
  if (!s) throw new Error('no precomputed selector for ' + signature + ' -- add it to constants.js');
  return s;
}

/**
 * A small ABI coder: enough of the Solidity ABI to talk to PerpDEX.
 *
 *   static:  uintN intN address bool bytes32 uint8-enums
 *   dynamic: string bytes T[] and tuples that contain any of those
 *   nested:  tuple(...) to any depth, arrays of tuples
 *
 * A copy of the coder in node/be/contract/chain/abi.js, minus hashing: this
 * service is the object under test and must not import from the test code.
 * The two copies are compared byte-for-byte in the service selftest.
 *
 * Type strings use Solidity's canonical spelling, e.g.
 *   "placeOrder((uint16,uint8,uint8,uint8,uint64,uint64,uint64,uint8,bool,uint32,uint64))"
 *   "((uint64,uint64,uint8)[],(uint64,uint64,uint8)[])"
 */

// ---------------------------------------------------------------- type parsing

function parseType(s) {
  s = s.trim();
  const arr = s.match(/^(.*)\[(\d*)\]$/);
  if (arr) return { kind: 'array', inner: parseType(arr[1]), length: arr[2] === '' ? null : Number(arr[2]) };
  if (s.startsWith('(')) {
    if (!s.endsWith(')')) throw new Error('unbalanced tuple: ' + s);
    return { kind: 'tuple', components: splitTop(s.slice(1, -1)).map(parseType) };
  }
  let m;
  if ((m = s.match(/^uint(\d*)$/))) return { kind: 'uint', bits: m[1] ? Number(m[1]) : 256 };
  if ((m = s.match(/^int(\d*)$/))) return { kind: 'int', bits: m[1] ? Number(m[1]) : 256 };
  if (s === 'address') return { kind: 'address' };
  if (s === 'bool') return { kind: 'bool' };
  if ((m = s.match(/^bytes(\d+)$/))) return { kind: 'bytesN', n: Number(m[1]) };
  if (s === 'bytes') return { kind: 'bytes' };
  if (s === 'string') return { kind: 'string' };
  throw new Error('unsupported type: ' + s);
}

function splitTop(s) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === ',' && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  if (s.trim() !== '') out.push(s.slice(start));
  return out;
}

function isDynamic(t) {
  if (t.kind === 'string' || t.kind === 'bytes') return true;
  if (t.kind === 'array') return t.length === null || isDynamic(t.inner);
  if (t.kind === 'tuple') return t.components.some(isDynamic);
  return false;
}

/** Size in bytes of the head of a static type. */
function staticSize(t) {
  if (t.kind === 'array') return t.length * staticSize(t.inner);
  if (t.kind === 'tuple') return t.components.reduce((n, c) => n + staticSize(c), 0);
  return 32;
}

// ---------------------------------------------------------------- encoding

const MASK256 = (1n << 256n) - 1n;

function word(bi) {
  return ((BigInt(bi) & MASK256).toString(16)).padStart(64, '0');
}

function encodeValue(t, v) {
  switch (t.kind) {
    case 'uint': {
      const n = BigInt(v);
      if (n < 0n || n >= (1n << BigInt(t.bits))) throw new Error(`value ${v} does not fit uint${t.bits}`);
      return word(n);
    }
    case 'int': {
      const n = BigInt(v);
      const lim = 1n << BigInt(t.bits - 1);
      if (n < -lim || n >= lim) throw new Error(`value ${v} does not fit int${t.bits}`);
      return word(n < 0n ? (1n << 256n) + n : n);
    }
    case 'address': return String(v).toLowerCase().replace(/^0x/, '').padStart(64, '0');
    case 'bool': return word(v ? 1n : 0n);
    case 'bytesN': return String(v).replace(/^0x/, '').padEnd(64, '0');
    case 'string':
    case 'bytes': {
      const hex = t.kind === 'string' ? Buffer.from(String(v), 'utf8').toString('hex') : String(v).replace(/^0x/, '');
      const len = hex.length / 2;
      return word(len) + hex.padEnd(Math.ceil(len / 32) * 64, '0');
    }
    case 'array': {
      const items = Array.from(v);
      if (t.length !== null && items.length !== t.length) throw new Error('fixed array length mismatch');
      const body = encodeTuple(items.map(() => t.inner), items);
      return t.length === null ? word(items.length) + body : body;
    }
    case 'tuple': return encodeTuple(t.components, Array.isArray(v) ? v : t.components.map((_, i) => v[i]));
    default: throw new Error('cannot encode ' + t.kind);
  }
}

function encodeTuple(types, values) {
  if (types.length !== values.length) throw new Error(`expected ${types.length} values, got ${values.length}`);
  const heads = [], tails = [];
  let headSize = types.reduce((n, t) => n + (isDynamic(t) ? 32 : staticSize(t)), 0);
  let tailOffset = headSize;
  types.forEach((t, i) => {
    const enc = encodeValue(t, values[i]);
    if (isDynamic(t)) {
      heads.push(word(tailOffset));
      tails.push(enc);
      tailOffset += enc.length / 2;
    } else {
      heads.push(enc);
    }
  });
  return heads.join('') + tails.join('');
}

/** Full calldata for `signature` with `args`. */
function encodeCall(signature, args) {
  const open = signature.indexOf('(');
  const types = parseType(signature.slice(open)).components;
  return selector(signature) + encodeTuple(types, args);
}

// ---------------------------------------------------------------- decoding

function decodeValue(t, hex, offset) {
  // returns [value, bytesConsumedInHead]
  const at = (o) => hex.slice(o * 2, o * 2 + 64);
  switch (t.kind) {
    case 'uint': return [BigInt('0x' + at(offset)), 32];
    case 'int': {
      let n = BigInt('0x' + at(offset));
      if (n >= 1n << 255n) n -= 1n << 256n;
      return [n, 32];
    }
    case 'address': return ['0x' + at(offset).slice(24), 32];
    case 'bool': return [BigInt('0x' + at(offset)) !== 0n, 32];
    case 'bytesN': return ['0x' + at(offset).slice(0, t.n * 2), 32];
    case 'string':
    case 'bytes': {
      const len = Number(BigInt('0x' + at(offset)));
      const raw = hex.slice((offset + 32) * 2, (offset + 32) * 2 + len * 2);
      return [t.kind === 'string' ? Buffer.from(raw, 'hex').toString('utf8') : '0x' + raw, 32];
    }
    case 'array': {
      let base = offset, length = t.length;
      if (length === null) { length = Number(BigInt('0x' + at(offset))); base = offset + 32; }
      const [items] = decodeTuple(Array.from({ length }, () => t.inner), hex, base);
      return [items, t.length === null ? 32 : staticSize(t)];
    }
    case 'tuple': {
      const [vals] = decodeTuple(t.components, hex, offset);
      return [vals, isDynamic(t) ? 32 : staticSize(t)];
    }
    default: throw new Error('cannot decode ' + t.kind);
  }
}

function decodeTuple(types, hex, base) {
  const out = [];
  let cursor = base;
  for (const t of types) {
    if (isDynamic(t)) {
      const rel = Number(BigInt('0x' + hex.slice(cursor * 2, cursor * 2 + 64)));
      const [v] = decodeValue(t, hex, base + rel);
      out.push(v);
      cursor += 32;
    } else {
      const [v, used] = decodeValue(t, hex, cursor);
      out.push(v);
      cursor += used;
    }
  }
  return [out, cursor - base];
}

/** Decode return data / event data against a tuple type string like "(uint64,uint8)". */
function decode(typeString, hex) {
  const t = parseType(typeString.startsWith('(') ? typeString : '(' + typeString + ')');
  const body = String(hex).replace(/^0x/, '');
  const [vals] = decodeTuple(t.components, body, 0);
  return vals;
}

/** Name the fields of a decoded tuple. */
function named(fields, values) {
  const o = {};
  fields.forEach((f, i) => { o[f] = values[i]; });
  return o;
}

/** Decode a custom error `0x........<args>` given a table {selector: {name, types}}. */
function decodeError(data, table) {
  const hex = String(data || '').replace(/^0x/, '');
  if (hex.length < 8) return { name: 'unknown', args: [], raw: data };
  const sel = hex.slice(0, 8);
  const entry = table[sel];
  if (!entry) return { name: 'unknown', args: [], raw: data, selector: '0x' + sel };
  const args = entry.types === '()' ? [] : decode(entry.types, '0x' + hex.slice(8));
  return { name: entry.name, args, raw: data, selector: '0x' + sel };
}

/** Build a selector table from error signatures like "InsufficientCollateral(int256,uint256)". */
function errorTable(signatures) {
  const table = {};
  for (const sig of signatures) {
    const open = sig.indexOf('(');
    table[selector(sig).replace(/^0x/, '')] = { name: sig.slice(0, open), types: sig.slice(open) };
  }
  return table;
}

module.exports = { parseType, isDynamic, encodeCall, encodeTuple, encodeValue, decode, named, decodeError, errorTable, word };

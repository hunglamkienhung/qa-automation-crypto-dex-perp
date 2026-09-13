'use strict';

const { selector } = require('./keccak');

/**
 * Read-only contract calls over plain JSON-RPC. No wallet, no key, no gas, and
 * no web3 library.
 *
 * `eth_call` executes against a node's copy of state and returns bytes. Nothing
 * is signed and nothing is broadcast, so a public RPC endpoint is enough --
 * which is what lets this whole tier run from a fresh clone with no setup.
 *
 * Raw hex in, BigInt out
 * ----------------------
 * Values are read as hex words and parsed with BigInt, never through a
 * library's formatter. Two reasons, both learned the hard way:
 *
 *   - A formatter decides how to present a number, and that decision is
 *     invisible at the call site. A 30-decimal USD value rendered as a float
 *     silently loses precision long before anyone notices.
 *   - When a decode goes wrong it usually produces a plausible number rather
 *     than an error. Reading word N and parsing it yourself means the only way
 *     to be wrong is to pick the wrong word, and that shows up immediately as a
 *     value of an absurd magnitude.
 */

const DEFAULT_RPC = process.env.RPC_URL || 'https://arb1.arbitrum.io/rpc';
const TIMEOUT_MS = 20_000;

/**
 * Raised when the chain could not be reached or did not answer usefully.
 *
 * Deliberately distinct from an assertion failing. An RPC endpoint being down
 * means the measurement did not happen, which is Blocked -- reporting it as
 * Failed would file a defect against a protocol that is working fine.
 */
class ChainUnreachable extends Error {
  constructor(message) {
    super(message);
    this.name = 'ChainUnreachable';
  }
}

/** Left-pad an address or number into one 32-byte ABI word. */
function encodeWord(value) {
  const hex = typeof value === 'bigint' || typeof value === 'number'
    ? BigInt(value).toString(16)
    : String(value).toLowerCase().replace(/^0x/, '');
  if (hex.length > 64) throw new Error('argument does not fit in one word: ' + value);
  return hex.padStart(64, '0');
}

async function rpc(method, params, url = DEFAULT_RPC) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new ChainUnreachable(`${method} did not respond: ${err.message}`);
  }

  if (!response.ok) throw new ChainUnreachable(`${method} returned HTTP ${response.status}`);

  let body;
  try {
    body = await response.json();
  } catch (err) {
    throw new ChainUnreachable(`${method} returned a body that is not JSON: ${err.message}`);
  }

  if (body.error) {
    // A revert is a legitimate answer from a reachable node, but for a plain
    // getter it almost always means the selector is wrong -- so it is raised as
    // a hard error, not as "could not reach the chain".
    const message = body.error.message || JSON.stringify(body.error);
    if (/revert/i.test(message)) {
      const err = new Error(`${method} reverted: ${message}. A getter that reverts usually means the signature is wrong.`);
      // anvil (and most nodes) put the ABI-encoded revert payload in error.data;
      // a custom error's selector and arguments live there, not in the message.
      err.data = typeof body.error.data === 'string' ? body.error.data : (body.error.data && body.error.data.data) || null;
      err.reverted = true;
      throw err;
    }
    throw new ChainUnreachable(`${method} returned an RPC error: ${message}`);
  }

  if (body.result === undefined) throw new ChainUnreachable(`${method} returned no result`);
  return body.result;
}

/**
 * Call a view function and return the raw return data as hex.
 *
 * @param {string} to        contract address
 * @param {string} signature canonical, e.g. "poolAmounts(address)"
 * @param {Array}  args      one word each
 */
async function call(to, signature, args = [], url = DEFAULT_RPC) {
  const data = selector(signature) + args.map(encodeWord).join('');
  return rpc('eth_call', [{ to, data }, 'latest'], url);
}

/** Split return data into 32-byte words, as BigInt. */
function words(hex) {
  const body = String(hex).replace(/^0x/, '');
  const out = [];
  for (let i = 0; i < body.length; i += 64) out.push(BigInt('0x' + body.slice(i, i + 64)));
  return out;
}

/** A single-value getter: the first word. */
async function callUint(to, signature, args = [], url = DEFAULT_RPC) {
  const raw = await call(to, signature, args, url);
  const w = words(raw);
  if (w.length === 0) throw new Error(`${signature} returned no data`);
  return w[0];
}

async function chainId(url = DEFAULT_RPC) {
  return Number(BigInt(await rpc('eth_chainId', [], url)));
}

async function blockNumber(url = DEFAULT_RPC) {
  return Number(BigInt(await rpc('eth_blockNumber', [], url)));
}

/**
 * Scale a fixed-point integer to a Number for comparison only.
 *
 * Never used to decide equality. Chain values are compared as BigInt; this
 * exists so a failure message can say "$2528.31" instead of thirty-three
 * digits, and so a ratio can be checked against a percentage bound.
 */
function scaled(value, decimals) {
  return Number(value) / Number(10n ** BigInt(decimals));
}

module.exports = {
  call, callUint, words, rpc, chainId, blockNumber, scaled,
  encodeWord, ChainUnreachable, DEFAULT_RPC,
};

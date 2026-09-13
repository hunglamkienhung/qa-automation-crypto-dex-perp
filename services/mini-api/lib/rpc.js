'use strict';

const abi = require('./abi');

/** Minimal JSON-RPC over fetch. Errors carry the node's message; nothing is retried here. */
async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message || JSON.stringify(body.error)}`);
  return body.result;
}

async function call(url, to, signature, args, types) {
  const raw = await rpc(url, 'eth_call', [{ to, data: abi.encodeCall(signature, args) }, 'latest']);
  return abi.decode(types, raw);
}

module.exports = { rpc, call };

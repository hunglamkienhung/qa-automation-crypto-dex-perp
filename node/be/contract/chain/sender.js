'use strict';

const { rpc, ChainUnreachable } = require('./ethcall');
const abi = require('./abi');

/**
 * Sending transactions to the local chain -- and refusing to send anywhere else.
 *
 * Why no private keys anywhere in this repository
 * ------------------------------------------------
 * anvil starts with ten unlocked accounts and signs on their behalf through
 * `eth_sendTransaction`. That is the whole signing story here: the client
 * names a `from` address, the node signs. No key is read, stored, logged or
 * passed on a command line, and there is nothing to leak.
 *
 * The one guard that matters is the chain: before the first send, the sender
 * asks `eth_chainId` and refuses to continue unless it is 31337. A client
 * pointed at any other RPC by mistake -- a testnet, a fork, a mainnet -- gets
 * WrongChain, not a transaction.
 *
 * Reverts are decoded. A revert on a send is a legitimate answer from a
 * reachable chain, and its custom error is usually the very thing a test is
 * asserting, so it surfaces as `Reverted` with `name` and `args` decoded
 * against the exchange's error table. A transport failure is still
 * ChainUnreachable.
 */

const ANVIL_CHAIN_ID = 31337;

class WrongChain extends Error {
  constructor(actual) {
    super(`refusing to send: chainId is ${actual}, this client only writes to anvil (${ANVIL_CHAIN_ID})`);
    this.name = 'WrongChain';
  }
}

class Reverted extends Error {
  constructor(decoded, context) {
    super(`${context} reverted: ${decoded.name}(${decoded.args.map(String).join(', ')})`);
    this.name = 'Reverted';
    this.error = decoded.name;
    this.args = decoded.args;
    this.selector = decoded.selector;
    this.raw = decoded.raw;
  }
}

class Sender {
  constructor({ url, errors = [] }) {
    this.url = url;
    this.errorTable = abi.errorTable(errors);
    this.verified = false;
  }

  async assertChain() {
    if (this.verified) return;
    const id = Number(BigInt(await rpc('eth_chainId', [], this.url)));
    if (id !== ANVIL_CHAIN_ID) throw new WrongChain(id);
    this.verified = true;
  }

  /** eth_call from `from`, decoding a revert into a Reverted error. */
  async call(from, to, signature, args, context = signature) {
    const data = abi.encodeCall(signature, args);
    try {
      return await rpc('eth_call', [{ from, to, data }, 'latest'], this.url);
    } catch (err) {
      throw this._translate(err, context);
    }
  }

  /**
   * Send and wait for the receipt. Simulates first with eth_call so a revert
   * comes back decoded instead of as a mined failure with no reason.
   */
  async send(from, to, signature, args, context = signature) {
    await this.assertChain();
    const data = abi.encodeCall(signature, args);
    // simulate: anvil returns the revert data on eth_call, not on the receipt
    try {
      await rpc('eth_call', [{ from, to, data }, 'latest'], this.url);
    } catch (err) {
      throw this._translate(err, context);
    }
    const hash = await rpc('eth_sendTransaction', [{ from, to, data, gas: '0x' + (3_000_000).toString(16) }], this.url);
    const receipt = await this.waitForReceipt(hash);
    if (receipt.status !== '0x1') {
      // The simulation passed and the mined transaction did not: the state
      // moved between the two (on anvil, usually the block timestamp). Re-run
      // the call at the mined block to recover the actual reason.
      try {
        await rpc('eth_call', [{ from, to, data }, receipt.blockNumber], this.url);
      } catch (err) {
        throw this._translate(err, context + ' (mined but failed)');
      }
      throw new Reverted({ name: 'unknown', args: [], raw: null }, context + ' (mined but failed; no reason recoverable)');
    }
    return receipt;
  }

  async waitForReceipt(hash, attempts = 50) {
    for (let i = 0; i < attempts; i++) {
      const r = await rpc('eth_getTransactionReceipt', [hash], this.url).catch(() => null);
      if (r) return r;
      await new Promise((res) => setTimeout(res, 100));
    }
    throw new ChainUnreachable('no receipt for ' + hash + ' after ' + attempts + ' polls');
  }

  _translate(err, context) {
    if (err instanceof ChainUnreachable) return err;
    if (!err.reverted) return err;
    const decoded = abi.decodeError(err.data || '0x', this.errorTable);
    return new Reverted(decoded, context);
  }
}

module.exports = { Sender, WrongChain, Reverted, ANVIL_CHAIN_ID };

"""Sending transactions to the local chain -- and refusing to send anywhere else.

Mirror of node/be/contract/chain/sender.js. anvil signs for its unlocked
accounts through ``eth_sendTransaction``; the client never holds a key. The
one guard that matters is the chain id: 31337 or nothing.
"""

from __future__ import annotations

import time

from be.contract.chain import abi
from be.contract.chain.ethcall import ChainUnreachable, RevertError, rpc

ANVIL_CHAIN_ID = 31337


class WrongChain(Exception):
    def __init__(self, actual: int) -> None:
        super().__init__(f"refusing to send: chainId is {actual}, this client only writes to anvil ({ANVIL_CHAIN_ID})")


class Reverted(Exception):
    def __init__(self, decoded: dict, context: str) -> None:
        args = ", ".join(str(a) for a in decoded["args"])
        super().__init__(f"{context} reverted: {decoded['name']}({args})")
        self.error = decoded["name"]
        self.args = decoded["args"]
        self.selector = decoded.get("selector")
        self.raw = decoded.get("raw")


class Sender:
    def __init__(self, url: str, errors: list[str]) -> None:
        self.url = url
        self.error_table = abi.error_table(errors)
        self.verified = False

    def assert_chain(self) -> None:
        if self.verified:
            return
        cid = int(rpc("eth_chainId", [], self.url), 16)
        if cid != ANVIL_CHAIN_ID:
            raise WrongChain(cid)
        self.verified = True

    def call(self, from_: str, to: str, signature: str, args: list, context: str | None = None) -> str:
        data = abi.encode_call(signature, args)
        try:
            return rpc("eth_call", [{"from": from_, "to": to, "data": data}, "latest"], self.url)
        except RevertError as err:
            raise self._translate(err, context or signature) from err

    def send(self, from_: str, to: str, signature: str, args: list, context: str | None = None) -> dict:
        self.assert_chain()
        ctx = context or signature
        data = abi.encode_call(signature, args)
        try:
            rpc("eth_call", [{"from": from_, "to": to, "data": data}, "latest"], self.url)
        except RevertError as err:
            raise self._translate(err, ctx) from err
        tx_hash = rpc("eth_sendTransaction", [{"from": from_, "to": to, "data": data, "gas": hex(3_000_000)}], self.url)
        receipt = self.wait_for_receipt(tx_hash)
        if receipt.get("status") != "0x1":
            try:
                rpc("eth_call", [{"from": from_, "to": to, "data": data}, receipt["blockNumber"]], self.url)
            except RevertError as err:
                raise self._translate(err, ctx + " (mined but failed)") from err
            raise Reverted({"name": "unknown", "args": [], "raw": None}, ctx + " (mined but failed; no reason recoverable)")
        return receipt

    def wait_for_receipt(self, tx_hash: str, attempts: int = 50) -> dict:
        for _ in range(attempts):
            try:
                r = rpc("eth_getTransactionReceipt", [tx_hash], self.url)
            except ChainUnreachable:
                r = None
            if r:
                return r
            time.sleep(0.1)
        raise ChainUnreachable(f"no receipt for {tx_hash} after {attempts} polls")

    def _translate(self, err: RevertError, context: str) -> Reverted:
        decoded = abi.decode_error(err.data or "0x", self.error_table)
        return Reverted(decoded, context)

"""Read-only contract calls over plain JSON-RPC. Standard library only.

No wallet, no key, no gas, no web3 package. ``eth_call`` executes against a
node's copy of state and returns bytes; nothing is signed and nothing is
broadcast, so a public endpoint is enough -- which is what lets this tier run
from a fresh clone with no setup.

Raw hex in, int out
-------------------
Values are read as hex words and parsed as integers, never through a library's
formatter. A formatter decides how to present a number and that decision is
invisible at the call site: a 30-decimal USD value rendered as a float loses
precision long before anyone notices. And when a decode goes wrong it usually
produces a plausible number rather than an error, so the fewer layers between
the bytes and the assertion, the better.

Mirror of node/src/chain/ethcall.py.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

from be.contract.chain.keccak import selector

DEFAULT_RPC = os.environ.get("RPC_URL", "https://arb1.arbitrum.io/rpc")
TIMEOUT_S = 20
USER_AGENT = "perp-qa/1.0 (+https://github.com/hunglamkienhung/perp-qa)"


class RevertError(RuntimeError):
    """The node answered and the call reverted. ``data`` is the ABI-encoded reason."""

    def __init__(self, message: str, data: str | None = None) -> None:
        super().__init__(message)
        self.data = data


class ChainUnreachable(Exception):
    """The chain could not be reached, or did not answer usefully.

    Deliberately distinct from an assertion failing. An RPC endpoint being down
    means the measurement did not happen, which is Blocked -- reporting it as
    Failed would file a defect against a protocol that is working fine.
    """


def encode_word(value) -> str:
    """Left-pad an address or integer into one 32-byte ABI word."""
    if isinstance(value, int):
        hex_value = format(value, "x")
    else:
        hex_value = str(value).lower().removeprefix("0x")
    if len(hex_value) > 64:
        raise ValueError(f"argument does not fit in one word: {value}")
    return hex_value.rjust(64, "0")


def rpc(method: str, params: list, url: str = DEFAULT_RPC):
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    request = urllib.request.Request(
        url,
        data=payload,
        headers={
            "content-type": "application/json",
            # Public RPC endpoints reject urllib's default User-Agent
            # ("Python-urllib/3.x") with a 403 while accepting the same request
            # from anything else. The Node side of this project talks to the
            # identical endpoint and never saw it, because fetch sends a
            # browser-shaped agent.
            #
            # Worth stating plainly: this is the transport refusing the client,
            # not the chain refusing the call. Without the header the whole tier
            # would report Blocked on every run and look like an outage.
            "user-agent": USER_AGENT,
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
            raw = response.read()
    except urllib.error.HTTPError as err:
        raise ChainUnreachable(f"{method} returned HTTP {err.code}") from err
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        raise ChainUnreachable(f"{method} did not respond: {err}") from err

    try:
        body = json.loads(raw)
    except json.JSONDecodeError as err:
        raise ChainUnreachable(f"{method} returned a body that is not JSON: {err}") from err

    if body.get("error"):
        message = body["error"].get("message", json.dumps(body["error"]))
        # A revert is a legitimate answer from a reachable node, but for a plain
        # getter it almost always means the signature is wrong -- so it is a
        # hard error, not "could not reach the chain".
        if "revert" in message.lower():
            # anvil (and most nodes) put the ABI-encoded revert payload in
            # error.data; a custom error's selector and arguments live there.
            data = body["error"].get("data")
            if isinstance(data, dict):
                data = data.get("data")
            raise RevertError(
                f"{method} reverted: {message}. "
                "A getter that reverts usually means the signature is wrong.",
                data=data if isinstance(data, str) else None,
            )
        raise ChainUnreachable(f"{method} returned an RPC error: {message}")

    if "result" not in body:
        raise ChainUnreachable(f"{method} returned no result")
    return body["result"]


def call(to: str, signature: str, args: list | None = None, url: str = DEFAULT_RPC) -> str:
    """Call a view function; returns the raw return data as hex."""
    data = selector(signature) + "".join(encode_word(a) for a in (args or []))
    return rpc("eth_call", [{"to": to, "data": data}, "latest"], url)


def words(hex_data: str) -> list[int]:
    """Split return data into 32-byte words, as integers."""
    body = str(hex_data).removeprefix("0x")
    return [int(body[i:i + 64], 16) for i in range(0, len(body), 64)]


def call_uint(to: str, signature: str, args: list | None = None, url: str = DEFAULT_RPC) -> int:
    """A single-value getter: the first word."""
    result = words(call(to, signature, args, url))
    if not result:
        raise RuntimeError(f"{signature} returned no data")
    return result[0]


def chain_id(url: str = DEFAULT_RPC) -> int:
    return int(rpc("eth_chainId", [], url), 16)


def block_number(url: str = DEFAULT_RPC) -> int:
    return int(rpc("eth_blockNumber", [], url), 16)

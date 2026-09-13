"""Keccak-256, in about a hundred lines, with no dependency.

Needed because a contract call is a 4-byte function selector followed by
arguments, and the selector is the first four bytes of the Keccak-256 hash of
the signature. There is no way to talk to a contract without it.

Why not just hardcode the selectors
------------------------------------
Because a wrong selector does not fail the way you want it to. During design a
guessed selector was sent to a live contract and the node answered
``execution reverted`` -- loud, and easy to catch. The dangerous case is the
other one: a selector that happens to match a DIFFERENT function on the same
contract returns a perfectly well-formed number that means something else
entirely. Nothing anywhere says so.

Why not hashlib
---------------
``hashlib.sha3_256`` is NOT this. SHA3-256 and Keccak-256 use different padding
-- 0x06 against 0x01 -- and produce completely different digests for the same
input. Using one where the other is meant is a mistake that imports, runs, and
returns a plausible-looking 32 bytes.

Verified against published vectors before any of it is trusted; see
``self_check`` below and selftest/test_keccak.py. Mirror of
node/src/chain/keccak.js.
"""

from __future__ import annotations

MASK = (1 << 64) - 1

ROUND_CONSTANTS = [
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
    0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
    0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
    0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
    0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
    0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
]

#: Rho rotation offsets, lane index = x + 5*y.
ROTATION = [
    0, 1, 62, 28, 27,
    36, 44, 6, 55, 20,
    3, 10, 43, 25, 39,
    41, 45, 15, 21, 8,
    18, 2, 61, 56, 14,
]

RATE = 136          # 1088 bits, for a 256-bit digest


def _rotl64(value: int, shift: int) -> int:
    if shift == 0:
        return value & MASK
    return ((value << shift) | (value >> (64 - shift))) & MASK


def _permute(lanes: list[int]) -> None:
    """Keccak-f[1600], in place on 25 lanes."""
    for rnd in range(24):
        # theta
        C = [lanes[x] ^ lanes[x + 5] ^ lanes[x + 10] ^ lanes[x + 15] ^ lanes[x + 20]
             for x in range(5)]
        for x in range(5):
            D = C[(x + 4) % 5] ^ _rotl64(C[(x + 1) % 5], 1)
            for y in range(5):
                lanes[x + 5 * y] ^= D

        # rho and pi
        B = [0] * 25
        for x in range(5):
            for y in range(5):
                B[y + 5 * ((2 * x + 3 * y) % 5)] = _rotl64(lanes[x + 5 * y], ROTATION[x + 5 * y])

        # chi
        for x in range(5):
            for y in range(5):
                lanes[x + 5 * y] = B[x + 5 * y] ^ (
                    (~B[((x + 1) % 5) + 5 * y] & MASK) & B[((x + 2) % 5) + 5 * y]
                )

        # iota
        lanes[0] ^= ROUND_CONSTANTS[rnd]


def keccak256(message: bytes) -> bytes:
    """32-byte Keccak-256 digest."""
    # Keccak padding: 0x01 ... 0x80. SHA3 uses 0x06 here; they are not the same.
    pad_length = RATE - (len(message) % RATE)
    padded = bytearray(message) + bytearray(pad_length)
    padded[len(message)] = 0x01
    padded[-1] |= 0x80

    lanes = [0] * 25
    for offset in range(0, len(padded), RATE):
        for i in range(RATE // 8):
            lanes[i] ^= int.from_bytes(padded[offset + i * 8: offset + i * 8 + 8], "little")
        _permute(lanes)

    return b"".join(lane.to_bytes(8, "little") for lane in lanes[:4])


def selector(signature: str) -> str:
    """The 4-byte selector for a canonical function signature.

    Canonical means no spaces and no parameter names: ``transfer(address,uint256)``.
    A stray character silently addresses a different function.
    """
    return "0x" + keccak256(signature.encode("utf-8"))[:4].hex()


#: Published Keccak-256 vectors.
VECTORS = [
    ("", "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"),
    ("abc", "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"),
]

#: Two selectors every Ethereum developer can recite.
SELECTOR_VECTORS = [
    ("transfer(address,uint256)", "0xa9059cbb"),
    ("balanceOf(address)", "0x70a08231"),
]


def self_check() -> list[str]:
    """Returns the problems found; empty means the implementation is sound."""
    failures = []
    for text, expected in VECTORS:
        got = keccak256(text.encode("utf-8")).hex()
        if got != expected:
            failures.append(f"keccak256({text!r}) = {got}, expected {expected}")
    for signature, expected in SELECTOR_VECTORS:
        got = selector(signature)
        if got != expected:
            failures.append(f"selector({signature}) = {got}, expected {expected}")
    return failures

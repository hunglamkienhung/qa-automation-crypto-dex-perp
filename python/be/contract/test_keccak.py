"""Tests for the hash function the whole contract tier depends on.

A contract call is a four-byte selector and nothing else identifies the function
being invoked. A wrong selector does not reliably fail: if it collides with
another function on the same contract, the node returns a perfectly well-formed
number that means something entirely different, and nothing anywhere says so.

So this is verified against published vectors before any of it is trusted. An
unverified hash function is not a hash function; it is a confident source of
wrong answers.

Mirror of node/selftest/keccak.test.js.
"""

from __future__ import annotations

import hashlib

from be.contract.chain.keccak import SELECTOR_VECTORS, VECTORS, keccak256, selector, self_check


def test_published_keccak_vectors():
    for text, expected in VECTORS:
        assert keccak256(text.encode()).hex() == expected, f"keccak256({text!r})"


def test_selectors_every_ethereum_developer_can_recite():
    for signature, expected in SELECTOR_VECTORS:
        assert selector(signature) == expected, signature


def test_self_check_reports_no_failures():
    assert self_check() == []


def test_keccak256_is_not_sha3_256():
    """The mistake this guards against is using the standard library by accident.

    ``hashlib.sha3_256`` exists, takes the same input, returns the same number
    of bytes, and is a DIFFERENT function: SHA3 pads with 0x06 where Keccak pads
    with 0x01. Reaching for it produces a plausible 32 bytes and a selector that
    addresses nothing.
    """
    data = b"abc"
    assert keccak256(data).hex() != hashlib.sha3_256(data).hexdigest(), (
        "if these ever match, one of the two implementations is not what it claims to be"
    )
    assert keccak256(data).hex() == "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"


def test_one_character_changes_the_whole_digest():
    # Signatures are canonical: no spaces, no parameter names. A stray character
    # silently addresses a different function rather than raising anything.
    assert selector("poolAmounts(address)") != selector("poolAmounts(address )")


def test_empty_input_has_the_well_known_digest():
    assert keccak256(b"").hex() == (
        "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
    )


def test_input_longer_than_one_sponge_block():
    # 136 bytes is the rate for a 256-bit digest, so 200 bytes crosses a block
    # boundary and exercises the absorb loop rather than a single permutation.
    long_digest = keccak256(b"a" * 200).hex()
    assert len(long_digest) == 64
    assert long_digest != keccak256(b"a" * 136).hex()


def test_the_two_stacks_agree_on_a_real_selector():
    """The Node implementation independently produces this value.

    Two implementations of the same algorithm in two languages agreeing on a
    selector is a stronger statement than either one passing its own vectors.
    """
    assert selector("maxLeverage()") == "0xae3302c2"
    assert selector("poolAmounts(address)") == "0x52f55eed"
    assert selector("reservedAmounts(address)") == "0xc3c7b9e9"

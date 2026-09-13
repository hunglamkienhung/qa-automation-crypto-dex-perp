"""The ABI coder against cast's bytes. Mirror of node/be/contract/abi.test.js."""

from be.contract.chain import abi
from be.contract.chain import abi_vectors as V


def test_encodes_place_order_calldata_as_cast_does():
    assert abi.encode_call(V.PLACE_ORDER["signature"], V.PLACE_ORDER["args"]) == V.PLACE_ORDER["hex"]


def test_round_trips_the_order_book_shape():
    t = abi.parse_type(V.ORDER_BOOK["types"])
    assert "0x" + abi.encode_tuple(t.components, V.ORDER_BOOK["values"]) == V.ORDER_BOOK["hex"]
    assert abi.decode(V.ORDER_BOOK["types"], V.ORDER_BOOK["hex"]) == V.ORDER_BOOK["values"]


def test_string_next_to_static_and_nested_tuple():
    t = abi.parse_type(V.MIXED["types"])
    assert "0x" + abi.encode_tuple(t.components, V.MIXED["values"]) == V.MIXED["hex"]
    assert abi.decode(V.MIXED["types"], V.MIXED["hex"]) == V.MIXED["values"]


def test_signed_address_bool_bytes():
    t = abi.parse_type(V.SIGNED["types"])
    assert "0x" + abi.encode_tuple(t.components, V.SIGNED["values"]) == V.SIGNED["hex"]
    assert abi.decode(V.SIGNED["types"], V.SIGNED["hex"]) == V.SIGNED["values"]


def test_error_selectors_and_event_topics_agree_with_cast():
    table = abi.error_table([V.ERROR_SELECTOR["signature"]])
    assert V.ERROR_SELECTOR["hex"][2:] in table
    assert abi.topic(V.EVENT_TOPIC["signature"]) == V.EVENT_TOPIC["hex"]


def test_decodes_a_custom_error_with_arguments():
    table = abi.error_table(["InsufficientCollateral(int256,uint256)", "AccountNotFound()"])
    data = V.ERROR_SELECTOR["hex"] + abi.word(-40000000) + abi.word(50000000)
    e = abi.decode_error(data, table)
    assert e["name"] == "InsufficientCollateral"
    assert e["args"] == [-40000000, 50000000]
    assert abi.decode_error("0xdeadbeef", table)["name"] == "unknown"


def test_refuses_values_that_do_not_fit():
    import pytest
    with pytest.raises(ValueError):
        abi.encode_call("f(uint8)", [256])
    with pytest.raises(ValueError):
        abi.encode_call("f(int8)", [128])

"""Tests for the measurement tooling, in both directions.

A comparison tool can be wrong two ways, and they are not equally visible:

    over-reporting   loud and obvious -- a scary number nobody can reproduce
    under-reporting  silent -- the number is small, everyone relaxes, and a real
                     difference was never shown to anyone

Testing only that clean data comes back clean catches the first and is
completely blind to the second, so both are asserted here.

Mirror of node/selftest/controls.test.js.
"""

from __future__ import annotations

import copy

from qa_core.diff import compare_datasets, compare_records, resolve_value, run_controls


def test_identical_input_produces_zero_differences():
    a = {"r1": {"x": "one", "y": "two"}, "r2": {"x": "three", "y": "four"}}
    assert compare_datasets(a, copy.deepcopy(a)) == []


def test_a_planted_difference_is_found_and_only_that_one():
    a = {"r1": {"x": "one", "y": "two"}, "r2": {"x": "three", "y": "four"}}
    b = copy.deepcopy(a)
    b["r2"]["y"] = "FOUR"

    diffs = compare_datasets(a, b)
    assert len(diffs) == 1
    assert diffs[0]["id"] == "r2"
    assert diffs[0]["key"] == "y"


def test_wrapped_values_compare_by_text_not_by_reference():
    """The regression behind resolve_value.

    Comparing wrapper objects rather than the text inside them made every
    populated field differ, because two distinct objects are never equal.
    Roughly six hundred cells were reported as changed when four had actually
    changed.
    """
    left = {"r1": {"cell": {"text": "same content"}}}
    right = {"r1": {"cell": {"text": "same content"}}}

    assert compare_datasets(left, right) == [], (
        "two distinct wrapper objects holding equal text must compare equal"
    )


def test_crlf_and_lf_forms_of_the_same_value_compare_equal():
    # One side comes from a file, the other from an HTTP API. Comparing raw
    # produces a false difference in every multi-line field.
    assert resolve_value("line1\r\nline2") == resolve_value("line1\nline2")


def test_a_leading_byte_order_mark_does_not_create_a_difference():
    assert resolve_value("﻿value") == resolve_value("value")


def test_a_missing_record_is_reported_rather_than_skipped():
    diffs = compare_datasets({"r1": {"x": "1"}}, {})
    assert len(diffs) == 1
    assert diffs[0]["key"] == "*"


def test_a_key_present_on_one_side_only_is_a_difference():
    diffs = compare_records({"a": "1"}, {"a": "1", "b": "2"})
    assert len(diffs) == 1
    assert diffs[0]["key"] == "b"


def test_run_controls_passes_both_directions_on_a_healthy_tool():
    sample = {"r1": {"a": "x", "b": "multi\r\nline"}, "r2": {"a": "y", "b": "z"}}
    controls = run_controls(sample)

    assert controls["negative"]["ok"] is True, "clean input must come back clean"
    assert controls["positive"]["ok"] is True, "a planted difference must be detected"
    assert controls["ok"] is True


def test_run_controls_reports_which_direction_failed():
    controls = run_controls({"r1": {"a": "x"}})
    assert "negative control" in controls["negative"]["name"]
    assert "positive control" in controls["positive"]["name"]
    assert controls["positive"]["planted"] == "r1.a"

"""Tests for the grading rule itself.

These matter more than any individual product test. A wrong product test
reports one case incorrectly; a wrong grading rule reports every case
incorrectly, and in the specific direction that hides real defects.

Mirror of node/selftest/grading.test.js.
"""

from __future__ import annotations

import pytest

from qa_core.grading import (
    Assertion,
    GradingError,
    Outcome,
    Status,
    Verdict,
    grade,
    validate_record,
)


def a_pass(aid: str) -> Assertion:
    return Assertion(aid, "observed and matching", Outcome.PASS)


def a_fail(aid: str, detail: str) -> Assertion:
    return Assertion(aid, "observed and contradicted", Outcome.FAIL, detail)


def a_unobs(aid: str, why: str) -> Assertion:
    return Assertion(aid, "could not be observed", Outcome.UNOBSERVABLE, why)


def test_every_assertion_matching_gives_passed():
    v = grade("1", [a_pass("a1"), a_pass("a2")])
    assert v.status is Status.PASSED
    assert v.reason == ""
    assert validate_record(v) == []


def test_one_contradiction_gives_failed_with_a_reason():
    v = grade("2", [a_pass("a1"), a_fail("a2", "got 2, wanted 6")])
    assert v.status is Status.FAILED
    assert "a2" in v.reason
    assert "got 2, wanted 6" in v.reason
    assert validate_record(v) == []


def test_unobservable_with_nothing_failing_gives_blocked_with_a_note():
    v = grade("3", [a_pass("a1"), a_unobs("a2", "no endpoint exposes it")])
    assert v.status is Status.BLOCKED
    assert v.reason == ""
    assert "no endpoint exposes it" in v.note
    assert validate_record(v) == []


def test_failed_outranks_blocked_when_a_case_is_both():
    """The regression this whole module exists for.

    A case that is both failing and partly unmeasurable must be Failed. Getting
    this backwards is not cosmetic: the real defect is filed under "could not
    measure", no bug is opened, and nothing anywhere reports an error. The suite
    stays green while a genuine failure disappears.
    """
    v = grade(
        "8",
        [
            a_fail("a1", "only 1 distinct image, expected 6"),
            a_unobs("a2", "cache policy not published"),
        ],
    )
    assert v.status is Status.FAILED, "a case with a real failure must never be graded Blocked"
    assert "a1" in v.reason


def test_failed_outranks_blocked_regardless_of_assertion_order():
    unobservable_first = grade("8", [a_unobs("a1", "no endpoint"), a_fail("a2", "mismatch")])
    fail_first = grade("8", [a_fail("a2", "mismatch"), a_unobs("a1", "no endpoint")])

    assert unobservable_first.status is Status.FAILED
    assert fail_first.status is Status.FAILED


def test_a_failed_case_still_reports_its_unobservable_assertions():
    v = grade("8", [a_fail("a1", "mismatch"), a_unobs("a2", "cache policy not published")])

    # The blocked part must not vanish just because the verdict is Failed --
    # a2 is still unverified and the report has to say so.
    assert "a2" in v.note
    assert "cache policy not published" in v.note


def test_a_case_with_no_assertions_is_an_error_never_a_pass():
    with pytest.raises(GradingError, match="no assertions"):
        grade("9", [])


def test_an_unknown_outcome_is_rejected_rather_than_treated_as_a_pass():
    bogus = Assertion("a1", "x", "probably-fine")  # type: ignore[arg-type]
    with pytest.raises(GradingError, match="unknown outcome"):
        grade("9", [bogus])


def test_validate_rejects_failed_with_no_reason():
    v = Verdict(Status.FAILED, "", "", {"failed": 1, "unobservable": 0})
    problems = validate_record(v)
    assert len(problems) == 1
    assert "requires a non-empty reason" in problems[0]


def test_validate_rejects_blocked_with_no_note():
    v = Verdict(Status.BLOCKED, "", "", {"failed": 0, "unobservable": 1})
    assert "requires a note" in validate_record(v)[0]


def test_validate_rejects_passed_that_hides_unobservable_assertions():
    v = Verdict(Status.PASSED, "", "", {"failed": 0, "unobservable": 2})
    assert "cannot coexist with unobservable" in " ".join(validate_record(v))


def test_validate_rejects_passed_that_hides_failed_assertions():
    v = Verdict(Status.PASSED, "", "", {"failed": 1, "unobservable": 0})
    assert "cannot coexist with failed" in " ".join(validate_record(v))

"""Deterministic grading with a FIXED status precedence.

    FAILED  >  BLOCKED  >  PASSED

Why the order is pinned, and why it is the first thing in this file
-------------------------------------------------------------------
A test case usually carries several assertions. In a real run it is common for
one assertion to fail outright while another cannot be observed at all: no
endpoint, missing permission, a gap in the environment. Such a case is *both*
failing and blocked, and the order in which those two conditions are tested
decides the verdict.

Check "blocked" first and the case is reported as Blocked. The real defect is
then filed under "we could not measure this", nobody opens a bug, and the
finding disappears from the report with no warning and no error anywhere. The
suite still looks healthy. That is the worst failure mode a test system has:
it loses a true positive silently.

So the failure branch runs FIRST and wins absolutely. Blocked is only
considered once every assertion has been confirmed not to be failing.

This is a structural property of the control flow, not a style preference. No
amount of coverage elsewhere compensates for getting it backwards, which is
why it lives in one small pure function that is tested directly
(selftest/test_grading.py) instead of being spread across callers.

This module is a deliberate mirror of node/src/grading/grade.js. The rule is
identical; only the idioms differ.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class Status(str, Enum):
    """The verdict for a whole case."""

    PASSED = "Passed"
    FAILED = "Failed"
    BLOCKED = "Blocked"


class Outcome(str, Enum):
    """The result of one assertion."""

    #: Observed, and it matched the expectation.
    PASS = "pass"
    #: Observed, and it contradicted the expectation.
    FAIL = "fail"
    #: Could not be observed at all. Absence of evidence, not evidence of absence.
    UNOBSERVABLE = "unobservable"


@dataclass
class Assertion:
    id: str
    description: str
    outcome: Outcome
    #: Observed value, error text, or why it could not be observed.
    detail: str = ""

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "description": self.description,
            "outcome": self.outcome.value,
            "detail": self.detail,
        }


@dataclass
class Verdict:
    status: Status
    reason: str
    note: str
    counts: dict
    assertions: list[Assertion] = field(default_factory=list)


class GradingError(Exception):
    """Raised when a case cannot be graded at all.

    Distinct from a failing case on purpose: a harness bug and a product defect
    need different people looking at them.
    """


def grade(case_id: str, assertions: list[Assertion]) -> Verdict:
    """Grade one test case from its assertions.

    Pure: no I/O, no clock, no globals. Given the same assertions it always
    returns the same verdict, which is what makes it testable.
    """
    # An empty case is a harness bug, not a pass. Returning Passed here would
    # mean a test that asserted nothing reports as green.
    if not assertions:
        raise GradingError(
            f"case {case_id}: no assertions were recorded. "
            "A case that asserts nothing cannot be graded; "
            "it must not default to Passed."
        )

    for a in assertions:
        if not isinstance(a.outcome, Outcome):
            raise GradingError(
                f"case {case_id}, assertion {a.id}: unknown outcome {a.outcome!r}. "
                f"Expected one of: {', '.join(o.value for o in Outcome)}."
            )

    failed = [a for a in assertions if a.outcome is Outcome.FAIL]
    unobservable = [a for a in assertions if a.outcome is Outcome.UNOBSERVABLE]
    passed = [a for a in assertions if a.outcome is Outcome.PASS]

    counts = {
        "total": len(assertions),
        "passed": len(passed),
        "failed": len(failed),
        "unobservable": len(unobservable),
    }

    # ---- BRANCH 1: FAILED. Must stay first. See the module docstring. ----
    if failed:
        reason = " | ".join(
            f"{a.id}: expected {a.description}; "
            f"observed {a.detail or 'no detail recorded'}"
            for a in failed
        )

        # A case can be Failed AND have unobservable assertions. Say so
        # explicitly rather than letting the blocked part vanish into the verdict.
        note = ""
        if unobservable:
            listed = "; ".join(
                f"{a.id} ({a.detail or 'no reason recorded'})" for a in unobservable
            )
            note = (
                f"Graded Failed on {len(failed)} assertion(s). Separately, "
                f"{len(unobservable)} assertion(s) stayed unobservable and are "
                f"still unverified: {listed}"
            )

        return Verdict(Status.FAILED, reason, note, counts, assertions)

    # ---- BRANCH 2: BLOCKED. Only once nothing is failing. ----
    if unobservable:
        note = " | ".join(
            f"{a.id}: {a.description} -- not observable: "
            f"{a.detail or 'no reason recorded'}"
            for a in unobservable
        )
        return Verdict(Status.BLOCKED, "", note, counts, assertions)

    # ---- BRANCH 3: PASSED. Every assertion observed and matching. ----
    return Verdict(Status.PASSED, "", "", counts, assertions)


def validate_record(verdict: Verdict) -> list[str]:
    """Enforce which result fields each status requires.

    This exists because the three statuses were, in practice, filled in
    inconsistently: a Failed row with an empty reason is unactionable, and a
    Blocked row with no note tells nobody what would unblock it. Rather than
    trusting discipline, the shape is checked and a violation is loud.

    Returns the problems found; an empty list means the record is well formed.
    """
    problems: list[str] = []

    if verdict.status is Status.FAILED:
        if not verdict.reason.strip():
            problems.append(
                "Failed requires a non-empty reason naming expected vs observed."
            )

    elif verdict.status is Status.BLOCKED:
        if not verdict.note.strip():
            problems.append(
                "Blocked requires a note stating precisely what would unblock it."
            )
        if verdict.reason.strip():
            problems.append(
                "Blocked must not carry a failure reason; "
                "nothing was observed to fail."
            )

    elif verdict.status is Status.PASSED:
        if verdict.reason.strip():
            problems.append("Passed must not carry a failure reason.")
        if verdict.counts["unobservable"] > 0:
            problems.append(
                "Passed cannot coexist with unobservable assertions; that is Blocked."
            )
        if verdict.counts["failed"] > 0:
            problems.append(
                "Passed cannot coexist with failed assertions; that is Failed."
            )

    else:
        problems.append(f"Unknown status {verdict.status!r}.")

    return problems

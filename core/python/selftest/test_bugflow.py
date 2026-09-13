"""Tests for issue identity and idempotence.

Mirror of node/selftest/bugflow.test.js.
"""

from __future__ import annotations

import pytest

from qa_core.bugflow import normalise_detail, problems_from, signature_for
from qa_core.grading import Outcome
from qa_core.trackers import github, local


@pytest.fixture
def store(tmp_path):
    """A throwaway store per test, so nothing here touches real state.

    A test that mutates live state is a test people learn to skip.
    """
    return tmp_path / "issues.json"


def problem(**overrides) -> dict:
    base = {
        "signature": "aaaabbbbcccc",
        "title": "[02. Inventory] distinct images does not hold",
        "module": "02. Inventory",
        "severity": "High",
        "caseId": "8",
        "detail": "Expected 6 distinct images, observed 1",
    }
    return {**base, **overrides}


def test_a_new_problem_creates_an_issue(store):
    action, issue = local.upsert(problem(), store)

    assert action == "created"
    assert issue["id"] == "B1"
    assert issue["relatedCases"] == ["8"]


def test_running_twice_creates_nothing_the_second_time(store):
    """The property that makes it safe to run on every build.

    Without it, a nightly pipeline opens the same ticket every night.
    """
    local.upsert(problem(), store)
    action, _ = local.upsert(problem(), store)

    assert action == "unchanged"
    assert len(local.list_issues(store)) == 1


def test_a_second_case_hitting_the_same_problem_attaches(store):
    local.upsert(problem(caseId="8"), store)
    action, issue = local.upsert(problem(caseId="12"), store)

    assert action == "attached"
    assert len(local.list_issues(store)) == 1, (
        "one bug means one issue, however many cases it fails"
    )
    assert issue["relatedCases"] == ["8", "12"]


def test_one_case_failing_two_ways_produces_two_issues(store):
    local.upsert(problem(signature="sig-one", caseId="13"), store)
    local.upsert(problem(signature="sig-two", caseId="13"), store)

    assert len(local.list_issues(store)) == 2


def test_attaching_never_replaces_the_cases_already_listed(store):
    for case_id in ("8", "12", "14"):
        local.upsert(problem(caseId=case_id), store)

    assert local.list_issues(store)[0]["relatedCases"] == ["8", "12", "14"]


# ---- signature derivation ----


def test_same_defect_with_different_observed_values_hashes_the_same():
    a = signature_for("02. Inventory", "a1", "Expected 6 distinct images, observed 1")
    b = signature_for("02. Inventory", "a1", "Expected 6 distinct images, observed 2")

    assert a == b, "a changing observed count must not fork the issue"


def test_different_assertions_in_the_same_module_hash_differently():
    assert signature_for("02. Inventory", "a1", "mismatch") != signature_for(
        "02. Inventory", "a2", "mismatch"
    )


def test_volatile_fragments_are_stripped_before_hashing():
    assert normalise_detail("failed at 2026-09-12T01:30:00Z with 0xDEADBEEF") == normalise_detail(
        "failed at 2026-01-01T09:00:00Z with 0xCAFEBABE"
    )


def test_only_failing_assertions_become_problems():
    record = {
        "module": "02. Inventory",
        "caseId": "8",
        "title": "images",
        "priority": "High",
        "assertions": [
            {"id": "a1", "description": "distinct images",
             "outcome": Outcome.FAIL.value, "detail": "observed 1"},
            {"id": "a2", "description": "cache policy",
             "outcome": Outcome.UNOBSERVABLE.value, "detail": "not published"},
            {"id": "a3", "description": "six items", "outcome": Outcome.PASS.value, "detail": ""},
        ],
    }

    problems = problems_from(record)
    assert len(problems) == 1, "unobservable assertions are reported, never filed as defects"
    assert "observed 1" in problems[0]["detail"]


# ---- GitHub tracker: the signature survives human editing ----


def test_a_signature_embedded_in_an_issue_body_round_trips():
    body = github.embed_signature("Some description", "abc123def456")
    assert github.extract_signature(body) == "abc123def456"


def test_the_signature_survives_someone_editing_the_text_around_it():
    body = github.embed_signature("Original description", "abc123def456")
    body = "Retitled by triage.\n\n" + body + "\n\nAdded a repro note."

    assert github.extract_signature(body) == "abc123def456", (
        "the marker lives in the body precisely so edits do not orphan the issue"
    )


def test_a_body_with_no_marker_yields_no_signature():
    assert github.extract_signature("just a normal issue") is None

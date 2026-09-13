"""Turn failing assertions into tracked issues, without creating duplicates.

The identity rule
-----------------
An issue is keyed by the PROBLEM, not by the test case that surfaced it. Both
directions of the relationship happen constantly in practice:

  - one broken thing fails eight cases  -> one issue, eight related cases
  - one case fails for two reasons      -> two issues, one related case each

Keying on the case ID collapses the first into eight near-identical tickets, and
a developer who fixes one has no way to see the other seven are the same bug.
Keying on the problem keeps the ticket count equal to the bug count.

The signature is derived from module, assertion ID, and the failure detail with
volatile parts removed -- numbers, hex, quoted values, timestamps. Two runs of
the same defect produce messages that differ in the observed value while
describing the same fault, and those must land on the same signature.

Idempotence
-----------
Running this twice over the same queue creates nothing the second time. That
property is what makes it safe to run on every build. It is asserted directly in
selftest/test_bugflow.py rather than assumed.
"""

from __future__ import annotations

import hashlib
import importlib
import os
import re
import sys

from qa_core.grading import Outcome
from qa_core.result_queue import latest_by_case

TRACKERS = {"local": "qa_core.trackers.local", "github": "qa_core.trackers.github"}


def load_tracker():
    choice = os.environ.get("BUGTRACKER", "local").lower()
    if choice not in TRACKERS:
        raise SystemExit(
            f'unknown BUGTRACKER "{choice}". Known: {", ".join(TRACKERS)}.'
        )
    return importlib.import_module(TRACKERS[choice])


def normalise_detail(detail: str) -> str:
    """Strip the parts of a failure message that change between identical runs,
    so the same defect always hashes to the same signature."""
    text = str(detail or "").lower()
    text = re.sub(r"0x[0-9a-f]+", "<hex>", text)
    text = re.sub(r"\d{4}-\d{2}-\d{2}[t ][\d:.]+z?", "<timestamp>", text)
    text = re.sub(r"\d+(\.\d+)?", "<n>", text)
    text = re.sub(r"[\"'`][^\"'`]*[\"'`]", "<value>", text)
    return re.sub(r"\s+", " ", text).strip()


def signature_for(module: str, assertion_id: str, detail: str) -> str:
    basis = "::".join([module, assertion_id, normalise_detail(detail)])
    return hashlib.sha1(basis.encode("utf-8")).hexdigest()[:12]


def severity_for(priority: str) -> str:
    if priority == "High":
        return "High"
    if priority == "Low":
        return "Low"
    return "Medium"


def problems_from(record: dict) -> list[dict]:
    """Only failing assertions become problems.

    Unobservable assertions are reported, never filed: a blocked case says the
    measurement could not be made, and opening a product defect for it sends a
    developer to investigate something never observed to break.
    """
    out = []
    for a in record["assertions"]:
        if a["outcome"] != Outcome.FAIL.value:
            continue
        out.append(
            {
                "signature": signature_for(record["module"], a["id"], a.get("detail", "")),
                "title": f'[{record["module"]}] {a["description"]} does not hold',
                "module": record["module"],
                "severity": severity_for(record.get("priority", "Medium")),
                "caseId": record["caseId"],
                "detail": "\n".join(
                    [
                        f'Expected: {a["description"]}',
                        f'Observed: {a.get("detail") or "no detail recorded"}',
                        f'Surfaced by case {record["caseId"]} ({record["title"]})',
                        f'Assertion: {a["id"]}',
                    ]
                ),
            }
        )
    return out


def main() -> int:
    records = list(latest_by_case().values())
    if not records:
        print("queue is empty -- run the suite first.", file=sys.stderr)
        return 1

    tracker = load_tracker()
    failing = [r for r in records if r["status"] == "Failed"]
    tally = {"created": 0, "attached": 0, "unchanged": 0}

    for record in failing:
        for problem in problems_from(record):
            action, issue = tracker.upsert(problem)
            tally[action] += 1
            print(f'{action:<9} {issue["id"]}  case {problem["caseId"]}  {issue["title"]}')

    blocked = [r for r in records if r["status"] == "Blocked"]

    print()
    print(f"tracker: {tracker.NAME}")
    print(
        f"failing cases: {len(failing)}"
        f'  issues created: {tally["created"]}'
        f'  cases attached to existing: {tally["attached"]}'
        f'  already recorded: {tally["unchanged"]}'
    )

    if blocked:
        print()
        print(f"blocked, NOT filed as defects ({len(blocked)}):")
        for b in blocked:
            print(f'  case {b["caseId"]} -- {b["note"]}')

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

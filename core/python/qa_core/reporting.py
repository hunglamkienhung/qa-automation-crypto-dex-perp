"""Publish the queue to whichever reporter is configured.

The gate before publishing is the point of this module. Before any number is
written out, the comparison tooling is measured against inputs whose answer is
already known, in both directions. If a tool cannot get a known case right, its
verdict on unknown data is worth nothing -- and a wrong number in a report is
worse than no report, because people act on it.

Reporter selection is one environment variable. With none set the local file
reporter runs, so a fresh clone produces a report with no setup at all.
"""

from __future__ import annotations

import importlib
import os
import sys

from qa_core.diff import run_controls
from qa_core.result_queue import latest_by_case, summarise

REPORTERS = {"local": "qa_core.reporters.local", "sheets": "qa_core.reporters.sheets"}


def load_reporter():
    choice = os.environ.get("REPORTER", "local").lower()
    if choice not in REPORTERS:
        raise SystemExit(f'unknown REPORTER "{choice}". Known: {", ".join(REPORTERS)}.')
    return importlib.import_module(REPORTERS[choice])


def control_sample(records: list[dict]) -> dict:
    """Build the sample the controls run against: the records themselves,
    reduced to flat text fields.

    Controls on synthetic data prove less than controls on the shape of data
    actually being handled.
    """
    return {
        r["caseId"]: {
            "module": r["module"],
            "title": r["title"],
            "status": r["status"],
            "reason": r.get("reason") or "",
            "note": r.get("note") or "",
        }
        for r in records[:5]
    }


def main() -> int:
    records = list(latest_by_case().values())

    if not records:
        print("queue is empty -- run the suite first.", file=sys.stderr)
        return 1

    controls = run_controls(control_sample(records))

    print("measurement controls")
    print(
        "  negative (identical input -> 0 differences): "
        + ("pass" if controls["negative"]["ok"] else f'FAIL, got {controls["negative"]["actual"]}')
    )
    print(
        "  positive (planted difference -> detected):   "
        + ("pass" if controls["positive"]["ok"] else "FAIL, the planted difference was missed")
    )

    if not controls["ok"]:
        print(file=sys.stderr)
        print("Refusing to publish. The comparison tooling failed a control,", file=sys.stderr)
        print("so any figure it produces about real data is untrustworthy.", file=sys.stderr)
        print("Fix the tool, re-run the controls, then publish.", file=sys.stderr)
        return 2

    summary = summarise()
    reporter = load_reporter()
    out = reporter.publish(records, summary, controls)

    print()
    print(f"reporter: {reporter.NAME}")
    print(
        f'cases: {summary["total"]}'
        f'  passed: {summary["Passed"]}'
        f'  failed: {summary["Failed"]}'
        f'  blocked: {summary["Blocked"]}'
    )
    for key, value in (out or {}).items():
        print(f"{key}: {value}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

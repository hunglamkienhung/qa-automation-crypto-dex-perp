"""Compare the run against fixtures/expected-results.json and exit non-zero on
any divergence. This is the CI gate.

Why CI does not gate on pytest's exit code
------------------------------------------
The suite deliberately contains a failing case and a blocked case -- they are
the worked examples for the grading rule. So pytest always exits non-zero, and a
build gated on that would be permanently red. A permanently red build is worse
than no build: everyone stops reading it, and the first real regression arrives
looking exactly like the noise.

Gating on the SHAPE of the result is stronger than the usual gate, because it
fails in both directions:

    expected Passed, got Failed   a regression -- what normal CI catches
    expected Failed, got Passed   the check has stopped checking

The second is invisible to ordinary CI. A test that was asserting something real
and now asserts nothing still reports green, and nothing anywhere says the
coverage was lost. Here it is a build failure.

Mirror of node/src/verify-expectations.js.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from qa_core import paths


def main() -> int:
    EXPECTED_FILE = paths.expected_file()
    ACTUAL_FILE = paths.summary_file()
    if not ACTUAL_FILE.exists():
        print(
            f"no report at {ACTUAL_FILE} -- run the suite and the reporter first.",
            file=sys.stderr,
        )
        return 1

    expected = json.loads(EXPECTED_FILE.read_text(encoding="utf-8"))
    actual = json.loads(ACTUAL_FILE.read_text(encoding="utf-8"))

    actual_by_case = {str(c["caseId"]): c["status"] for c in actual["cases"]}
    problems: list[str] = []

    for case_id, declared in expected["cases"].items():
        # A declaration may be one status, or a list of acceptable ones. The list
        # exists for cases that read live external data: the invariant held, or
        # the source could not be reached and nothing was measured. What no list
        # ever includes is Failed, so an outage still cannot be reported as a
        # defect in the thing that went dark.
        acceptable = declared if isinstance(declared, list) else [declared]
        wanted = " or ".join(acceptable)
        got = actual_by_case.pop(case_id, None)

        if got is None:
            problems.append(f"case {case_id}: expected {wanted}, but the case did not run at all")
            continue
        if got not in acceptable:
            direction = (
                "a regression"
                if "Passed" in acceptable
                else "the check has stopped checking -- coverage was silently lost"
            )
            problems.append(f"case {case_id}: expected {wanted}, got {got}  ({direction})")

    for case_id, status in actual_by_case.items():
        problems.append(
            f"case {case_id} ran with status {status} but is not declared in "
            "fixtures/expected-results.json -- add it, so the baseline stays complete"
        )

    print("expected: " + json.dumps(expected["summary"]))
    print("actual:   " + json.dumps(actual["summary"]))

    if not problems:
        print()
        print("OK -- every case landed on its declared status.")
        return 0

    print(file=sys.stderr)
    print(f"{len(problems)} case(s) diverged from the baseline:", file=sys.stderr)
    for p in problems:
        print("  " + p, file=sys.stderr)
    print(file=sys.stderr)
    print(
        "If a change here is intended, update fixtures/expected-results.json",
        file=sys.stderr,
    )
    print("in the same commit, so the baseline always states what is expected.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

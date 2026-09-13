"""Comparing two datasets, plus the controls that decide whether the comparison
can be trusted at all.

Background
----------
A comparison tool once reported roughly six hundred differing cells between two
datasets that were, in fact, almost identical. The cause was not in the data:
the comparison pulled a wrapper object out of each side and compared the two
wrappers, so it was testing object identity rather than the text inside. Two
distinct objects are never equal, so every populated cell was flagged. The real
difference turned out to be four cells.

Nothing about that number looked wrong. It looked like a serious data problem,
which is precisely why it was nearly reported as one.

The fix is cheap and mechanical: before trusting any measurement, run the tool
against inputs whose answer is already known, in BOTH directions.

    negative control -- a known-CLEAN input must come back clean.
                        If it reports differences, the tool over-reports.

    positive control -- a known-DIRTY input must be flagged.
                        If it comes back clean, the tool under-reports, which is
                        the more dangerous direction because the failure is an
                        absence and nothing draws attention to it.

A negative control alone is not enough. It catches false alarms and is blind to
silent misses. Both controls run in run_controls() below, and the bridge refuses
to publish a report if either one fails.
"""

from __future__ import annotations

import copy
import json
from typing import Any

Record = dict[str, Any]
Dataset = dict[str, Record]


def resolve_value(v: Any) -> str:
    """Reduce a value to the text it actually represents.

    Comparison is by content and never by reference.

    Line endings are normalised because the same logical value routinely
    arrives as LF from a file and CRLF from an HTTP API. Comparing those raw
    produces a wall of differences in every multi-line field -- all of them
    false.
    """
    if v is None:
        return ""

    # Unwrap the common single-key text wrappers rather than comparing the
    # wrapper itself. This is the exact mistake described above.
    if isinstance(v, dict):
        if isinstance(v.get("text"), str):
            return resolve_value(v["text"])
        if isinstance(v.get("value"), str):
            return resolve_value(v["value"])
        return json.dumps(v, sort_keys=True)

    return (
        str(v)
        .lstrip("﻿")      # byte order mark
        .replace("\r\n", "\n")  # CRLF -> LF, on BOTH sides
        .strip()
    )


def compare_records(left: Record, right: Record) -> list[dict]:
    """Compare two flat records key by key. One entry per real difference."""
    keys = sorted(set(left or {}) | set(right or {}))
    diffs = []

    for key in keys:
        lv = resolve_value((left or {}).get(key))
        rv = resolve_value((right or {}).get(key))
        if lv != rv:
            diffs.append({"key": key, "left": lv, "right": rv})
    return diffs


def compare_datasets(left: Dataset, right: Dataset) -> list[dict]:
    """Compare two keyed collections of records."""
    ids = sorted(set(left or {}) | set(right or {}))
    diffs = []

    for rid in ids:
        if rid not in left:
            diffs.append({"id": rid, "key": "*", "left": "(missing)", "right": "(present)"})
            continue
        if rid not in right:
            diffs.append({"id": rid, "key": "*", "left": "(present)", "right": "(missing)"})
            continue
        for d in compare_records(left[rid], right[rid]):
            diffs.append({"id": rid, **d})
    return diffs


def run_controls(sample: Dataset) -> dict:
    """Run both controls against a sample whose answer is known in advance.

    Call this before trusting any diff output.
    """
    # --- negative control: the sample against a deep copy of itself ---
    negative_diffs = compare_datasets(sample, copy.deepcopy(sample))
    negative = {
        "name": "negative control -- identical input must produce zero differences",
        "expected": 0,
        "actual": len(negative_diffs),
        "ok": len(negative_diffs) == 0,
        # Showing the first few turns "the tool is broken" into a diagnosis.
        "examples": negative_diffs[:3],
    }

    # --- positive control: plant one known difference and require it be found ---
    dirty = copy.deepcopy(sample)
    first_id = next(iter(dirty), None)
    first_key = next(iter(dirty[first_id]), None) if first_id else None

    if not first_id or not first_key:
        positive = {
            "name": "positive control -- a planted difference must be flagged",
            "ok": False,
            "actual": "sample too small to plant a difference into",
        }
    else:
        dirty[first_id][first_key] = resolve_value(dirty[first_id][first_key]) + "__PLANTED__"
        found = compare_datasets(sample, dirty)
        hit = any(d.get("id") == first_id and d.get("key") == first_key for d in found)
        positive = {
            "name": "positive control -- a planted difference must be flagged",
            "planted": f"{first_id}.{first_key}",
            "expected": 1,
            "actual": len(found),
            "ok": len(found) == 1 and hit,
        }

    return {"ok": negative["ok"] and positive["ok"], "negative": negative, "positive": positive}

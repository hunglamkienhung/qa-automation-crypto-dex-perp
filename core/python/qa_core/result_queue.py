"""The append-only result log: the only way a test result enters the system.

Why a queue sits between the runner and the reporting side
----------------------------------------------------------
The obvious design is to have each test push its result straight to whatever
tracks results -- a spreadsheet, a database, an issue tracker. That couples the
test run to the availability and the rate limit of an external service. When the
service is slow the suite is slow; when it is down the run is lost; when its API
changes every test file has to be touched.

Here a test appends one line to a local log and moves on. Publishing happens
afterwards, in a separate process, against whichever adapter is configured. The
consequences are concrete:

  - A run completes even with no network at all.
  - Publishing can be retried without re-running a single test.
  - Swapping the reporting backend touches one adapter, not the test suite.
  - The log is the primary record. If a report and the log disagree, the log
    wins, because it was written at the moment of measurement.

The append opens, writes and closes immediately, so an interrupted run loses at
most the record in flight.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from qa_core import paths


def QUEUE_FILE() -> Path:
    """Resolved per call: the queue belongs to the domain that is running."""
    return paths.queue_file()


REQUIRED_FIELDS = ("caseId", "status", "assertions")

#: Stable for the process: groups every record from a single run.
RUN_ID = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def record(result: dict, queue_file: Path | None = None) -> dict:
    """Append one result. Returns the stamped entry."""
    target = Path(queue_file) if queue_file else QUEUE_FILE()

    for field in REQUIRED_FIELDS:
        if result.get(field) is None:
            raise ValueError(
                f"queue: refusing to write a record with no {field}. "
                "An incomplete record is worse than a missing one -- "
                "it looks like data."
            )

    entry = {"uuid": str(uuid.uuid4()), "ts": _now(), "runId": RUN_ID, **result}

    target.parent.mkdir(parents=True, exist_ok=True)
    # Open, write, close. Never a held handle.
    with open(target, "a", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")

    return entry


def read_all(queue_file: Path | None = None) -> list[dict]:
    """Read the log into records.

    A malformed line is reported with its line number rather than skipped.
    Silently dropping it would make a truncated file look merely shorter, and a
    shorter report is far harder to notice than a loud parse error.
    """
    target = Path(queue_file) if queue_file else QUEUE_FILE()
    if not target.exists():
        return []

    out = []
    with open(target, encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError as err:
                raise ValueError(f"{target}:{lineno} is not valid JSON -- {err}") from err
    return out


def latest_by_case(queue_file: Path | None = None) -> dict[str, dict]:
    """Collapse the log to one record per case: the most recent wins.

    A case gets re-run for all sorts of reasons -- a flake investigation, a fix
    verification, a rerun of one module. Every attempt stays in the log as
    history, but a report must show the current verdict, and "current" means
    latest by timestamp rather than last line in the file. Those differ as soon
    as two logs are concatenated or a run is resumed.
    """
    by_case: dict[str, dict] = {}
    for entry in read_all(queue_file):
        existing = by_case.get(entry["caseId"])
        if existing is None or entry["ts"] > existing["ts"]:
            by_case[entry["caseId"]] = entry
    return by_case


def history_for(case_id: str, queue_file: Path | None = None) -> list[dict]:
    """Every attempt at one case, oldest first. How flakiness becomes visible."""
    return sorted(
        (e for e in read_all(queue_file) if e["caseId"] == str(case_id)),
        key=lambda e: e["ts"],
    )


def summarise(queue_file: Path | None = None) -> dict:
    counts = {"Passed": 0, "Failed": 0, "Blocked": 0}
    for entry in latest_by_case(queue_file).values():
        counts[entry["status"]] = counts.get(entry["status"], 0) + 1
    return {"total": sum(counts.values()), **counts}


def write_json_atomic(path: Path, data) -> None:
    """Write a whole file atomically: temp file first, then replace.

    A report written in place leaves a half-written file if the process is
    interrupted, and the next reader sees corrupt data with nothing to warn it.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / (path.name + f".{os.getpid()}.tmp")
    text = data if isinstance(data, str) else json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    tmp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, path)

"""Default bug tracker: a JSON file under state/.

Small, but it holds the part that actually matters -- the identity rule for an
issue. See qa/bugflow.py for why an issue is keyed by the problem rather than by
the case that happened to surface it.

Every entry point takes the store path so a test can run against a temporary
file instead of the real one. A test that mutates live state is a test people
learn to skip.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from qa_core import paths
from qa_core.result_queue import write_json_atomic

NAME = "local"


def STORE() -> Path:
    """Resolved per call so the store follows the domain that is running."""
    return paths.issues_file()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def load(store: Path | None = None) -> dict:
    path = Path(store) if store else STORE()
    if not path.exists():
        return {"nextId": 1, "issues": []}
    return json.loads(path.read_text(encoding="utf-8"))


def save(db: dict, store: Path | None = None) -> None:
    write_json_atomic(Path(store) if store else STORE(), db)


def find_by_signature(db: dict, signature: str) -> dict | None:
    return next((i for i in db["issues"] if i["signature"] == signature), None)


def upsert(problem: dict, store: Path | None = None) -> tuple[str, dict]:
    """Create the issue, or attach this case to the one that already exists.

    Returns (action, issue) where action is 'created', 'attached' or 'unchanged'.
    """
    db = load(store)
    existing = find_by_signature(db, problem["signature"])

    if existing:
        if problem["caseId"] in existing["relatedCases"]:
            return "unchanged", existing
        # Add the case, never replace the list. An issue accumulates the cases
        # it affects; overwriting would erase the previous ones.
        existing["relatedCases"].append(problem["caseId"])
        existing["updatedAt"] = _now()
        save(db, store)
        return "attached", existing

    issue = {
        "id": f'B{db["nextId"]}',
        "signature": problem["signature"],
        "title": problem["title"],
        "module": problem["module"],
        "detail": problem["detail"],
        "severity": problem["severity"],
        "state": "Open",
        "relatedCases": [problem["caseId"]],
        "createdAt": _now(),
        "updatedAt": _now(),
    }

    db["nextId"] += 1
    db["issues"].append(issue)
    save(db, store)
    return "created", issue


def list_issues(store: Path | None = None) -> list[dict]:
    return load(store)["issues"]

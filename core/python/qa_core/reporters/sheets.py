"""Optional reporter: push the run to a Google Sheet.

Included to show the adapter seam rather than to be the default path.

Two rules this reporter follows, both learned from spreadsheets that people
actually maintain by hand:

  1. Columns are located by HEADER NAME, never by fixed letter. Someone will
     insert a column, and every hard-coded index silently starts writing into
     the wrong field -- silently, because a wrong value still looks like a value.

  2. Human-owned columns are never overwritten. Triage notes, assignees and
     review states belong to people; a sync that rewrites the whole row destroys
     work with no trace.
"""

from __future__ import annotations

import os

NAME = "sheets"

HUMAN_OWNED_COLUMNS = ("Assignee", "Triage note", "Review state", "Ticket")


def require_env(key: str) -> str:
    value = os.environ.get(key)
    if not value:
        raise RuntimeError(
            f"{key} is not set. Copy .env.example to .env and fill it in, "
            "or leave REPORTER unset to use the local file reporter."
        )
    return value


def index_columns(header_row: list[str]) -> dict[str, int]:
    """Map a header row to column indices, so writes address columns by name."""
    return {str(title).strip(): i for i, title in enumerate(header_row)}


def build_row(record: dict, column_index: dict[str, int], existing_row: list | None = None) -> list:
    """Build the cells this reporter owns, leaving every human column untouched."""
    row = list(existing_row) if existing_row else []

    owned = {
        "Case ID": record["caseId"],
        "Module": record["module"],
        "Title": record["title"],
        "Status": record["status"],
        "Assertions": f'{record["counts"]["passed"]}/{record["counts"]["total"]}',
        "Reason": record.get("reason", ""),
        "Note": record.get("note", ""),
        "Last run": record["ts"],
    }

    for header, value in owned.items():
        at = column_index.get(header)
        if at is None:                          # column absent; do not invent one
            continue
        if header in HUMAN_OWNED_COLUMNS:
            continue
        while len(row) <= at:
            row.append("")
        row[at] = value

    return row


def publish(records: list[dict], summary: dict, controls: dict) -> dict:
    spreadsheet_id = require_env("SHEETS_SPREADSHEET_ID")
    require_env("SHEETS_SERVICE_ACCOUNT_JSON")

    # Wiring the Google client is left out on purpose: it would add a heavy
    # dependency to a repository whose default path needs none, and the part
    # worth reading -- header lookup, ownership split, idempotent upsert -- is
    # already above. build_row and index_columns are exported and unit tested.
    raise RuntimeError(
        "The Google Sheets reporter is a documented seam, not a wired integration.\n"
        f"It would upsert {len(records)} rows into spreadsheet {spreadsheet_id} "
        f'({summary["Passed"]} passed, {summary["Failed"]} failed, '
        f'{summary["Blocked"]} blocked), matching rows by Case ID and writing '
        "only machine-owned columns.\n"
        "Run without REPORTER set to use the local file reporter."
    )

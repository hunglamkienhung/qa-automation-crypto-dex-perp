"""Optional bug tracker: GitHub Issues.

Same seam as the local tracker -- upsert(problem) -> (action, issue).

The signature is carried in a hidden HTML comment in the issue body rather than
in the title or a label:

    <!-- qa-signature: 7f3c1a20b9de -->

Titles get edited by people, and labels get renamed and bulk-removed. A marker
in the body survives both, and search can still find it. Losing the signature is
not a cosmetic problem: the next run stops recognising the issue and files a
duplicate, which is exactly the failure this design prevents.
"""

from __future__ import annotations

import os
import re

NAME = "github"

SIGNATURE_PREFIX = "qa-signature:"

_SIGNATURE_RE = re.compile(r"<!--\s*qa-signature:\s*([0-9a-f]+)\s*-->", re.IGNORECASE)


def require_env(key: str) -> str:
    value = os.environ.get(key)
    if not value:
        raise RuntimeError(
            f"{key} is not set. Copy .env.example to .env and fill it in, "
            "or leave BUGTRACKER unset to use the local file tracker."
        )
    return value


def embed_signature(body: str, signature: str) -> str:
    return f"{body}\n\n<!-- {SIGNATURE_PREFIX} {signature} -->"


def extract_signature(body: str) -> str | None:
    match = _SIGNATURE_RE.search(str(body or ""))
    return match.group(1) if match else None


def search_query(repo: str, signature: str) -> str:
    """The search query used to find an existing issue for a signature."""
    return f'repo:{repo} in:body "{SIGNATURE_PREFIX} {signature}"'


def render_body(problem: dict) -> str:
    body = "\n".join(
        [
            problem["detail"],
            "",
            f'**Module:** {problem["module"]}',
            f'**Severity:** {problem["severity"]}',
            f'**Related cases:** {problem["caseId"]}',
            "",
            "_Filed automatically from the test queue. The marker below is how",
            "re-runs recognise this issue instead of opening a duplicate; please keep it._",
        ]
    )
    return embed_signature(body, problem["signature"])


def upsert(problem: dict) -> tuple[str, dict]:
    repo = require_env("GITHUB_REPO")
    require_env("GITHUB_TOKEN")

    # Not wired, for the same reason as the Sheets reporter: the default path of
    # this repository must run with zero credentials. The parts worth reviewing
    # -- signature embedding, extraction, and the search that makes the upsert
    # idempotent -- are above and are unit tested.
    raise RuntimeError(
        "The GitHub tracker is a documented seam, not a wired integration.\n"
        f'It would search {repo} with: {search_query(repo, problem["signature"])}\n'
        f'then attach case {problem["caseId"]} to the match, '
        f'or open a new issue titled: {problem["title"]}\n'
        "Run without BUGTRACKER set to use the local file tracker."
    )

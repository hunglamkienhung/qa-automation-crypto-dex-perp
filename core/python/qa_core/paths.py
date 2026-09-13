"""Where a run reads and writes -- the one place the core learns about the filesystem.

The core is installed once (``pip install -e``) and imported from several
domains. Resolving against ``__file__`` would point every domain at the core's
own folder, and the queue of one domain would overwrite the queue of another.
So the root is the WORKING DIRECTORY of the process -- the domain's ``python/``
folder, where pytest runs -- with an override for callers that run elsewhere.

    workdir      the domain's python/ folder     queue/  reports/  state/
    domain_root  one level up                    fixtures/  features/
"""

from __future__ import annotations

import os
from pathlib import Path


def workdir() -> Path:
    return Path(os.environ.get("QA_WORKDIR") or os.getcwd()).resolve()


def domain_root() -> Path:
    override = os.environ.get("QA_DOMAIN_ROOT")
    return Path(override).resolve() if override else workdir().parent


def queue_file() -> Path:
    return workdir() / "queue" / "results.jsonl"


def reports_dir() -> Path:
    return workdir() / "reports"


def state_dir() -> Path:
    return workdir() / "state"


def issues_file() -> Path:
    return state_dir() / "issues.json"


def summary_file() -> Path:
    return reports_dir() / "summary.json"


def dashboard_file() -> Path:
    return reports_dir() / "dashboard.html"


def fixtures_dir() -> Path:
    return domain_root() / "fixtures"


def expected_file() -> Path:
    return fixtures_dir() / "expected-results.json"


def testcases_file() -> Path:
    return fixtures_dir() / "testcases.json"

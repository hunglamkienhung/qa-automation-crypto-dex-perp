"""The recorder that turns a test or scenario into one graded, filed case.

A step states what it observed; the recorder collects it; the grading function
decides the verdict. Steps never write a status themselves, which keeps the
precedence rule in exactly one place (``qa_core.grading``) instead of being
re-derived, slightly differently, per runner or per tier.

Mirror of ``core/node/harness/recorder.js``.

How the three verdicts map onto pytest's vocabulary
---------------------------------------------------
    Passed  -> passed
    Failed  -> failed
    Blocked -> skipped

pytest has no "blocked". Skipped is the closest thing it can say: the case ran,
but a core assertion could not be observed, so no claim is being made about it.
The queue and the report keep the real word, and they are the source of truth.

A domain's ``conftest.py`` needs three lines::

    from qa_core.recorder import qa, pytest_bdd_apply_tag, pytest_bdd_after_scenario  # noqa: F401
"""

from __future__ import annotations

import json
import time
from functools import lru_cache

import pytest

from qa_core import paths
from qa_core.grading import Assertion, GradingError, Outcome, Status, grade, validate_record
from qa_core.result_queue import record


@lru_cache(maxsize=1)
def catalogue() -> dict:
    """The domain's case catalogue, loaded once per process from fixtures/."""
    file = paths.testcases_file()
    if not file.exists():
        raise GradingError(
            f"no case catalogue at {file} -- set QA_DOMAIN_ROOT or run from the domain's python/ folder."
        )
    return json.loads(file.read_text(encoding="utf-8"))


def pytest_bdd_apply_tag(tag, function):
    """Translate Gherkin tags into something pytest can carry.

    ``@case:8`` becomes a registered ``case_id`` marker. ``@module:`` and
    ``@priority:`` are consumed and produce no marker. Anything else is left to
    pytest-bdd's default, which registers the tag name as a marker -- so tier
    tags such as ``@be`` / ``@fe`` / ``@contract`` select the same set as the
    Cucumber ``--tags`` expression does, provided the domain registers them.
    """
    if tag.startswith("case:"):
        return pytest.mark.case_id(tag.split(":", 1)[1])(function)
    if tag.startswith(("module:", "priority:")):
        return function
    return None


class Recorder:
    """Collects assertions during a scenario, then grades and files them once."""

    def __init__(self, via: str = "pytest-bdd") -> None:
        self.via = via
        self.case_id: str | None = None
        self.meta: dict | None = None
        self.assertions: list[Assertion] = []
        self.evidence_data: dict = {}
        # Set when a tier cannot reach what it measures. Every later assertion
        # becomes unobservable rather than failing: a node being down is not a
        # protocol being broken.
        self.source_error: str | None = None
        self._started = time.monotonic()
        self._finished = False

    # ---- what a step may say ----

    def case(self, case_id) -> dict:
        """Bind this scenario to a catalogued case. Unknown IDs fail loudly."""
        meta = catalogue()["cases"].get(str(case_id))
        if meta is None:
            raise GradingError(
                f"case {case_id} is not in fixtures/testcases.json. "
                "IDs are immutable and allocated there, never invented in a step."
            )
        self.case_id = str(case_id)
        self.meta = meta
        return meta

    def _next_id(self) -> str:
        return f"a{len(self.assertions) + 1}"

    def check(self, description: str, passed: bool, detail: str = "", assertion_id: str | None = None) -> None:
        """Record one OBSERVED assertion. Never raises -- the verdict comes later."""
        self.assertions.append(
            Assertion(
                id=assertion_id or self._next_id(),
                description=description,
                outcome=Outcome.PASS if passed else Outcome.FAIL,
                detail="" if passed else (detail or "no detail recorded"),
            )
        )

    def unobservable(self, description: str, why: str, assertion_id: str | None = None) -> None:
        """Record an assertion the environment cannot show either way."""
        if not why:
            raise GradingError(f'unobservable({description!r}) needs a reason; "unknown" is not one.')
        self.assertions.append(
            Assertion(
                id=assertion_id or self._next_id(),
                description=description,
                outcome=Outcome.UNOBSERVABLE,
                detail=why,
            )
        )

    def observe(self, description: str, evaluate) -> None:
        """Record an assertion, unless the source never answered.

        The one rule every tier shares: a transport failure is unobservable,
        not a failure.
        """
        if self.source_error:
            self.unobservable(description, f"the source could not be reached -- {self.source_error}")
            return
        passed, detail = evaluate()
        self.check(description, passed, detail)

    def fetch_or_block(self, unreachable_types: tuple, fetch):
        """Run a fetch; route a named "unreachable" error into ``source_error``.

        Any other exception is a fault in this project and propagates --
        dressing it up as Blocked would hide it behind an environmental excuse.
        """
        try:
            return fetch()
        except unreachable_types as err:
            self.source_error = str(err)
            return None

    def evidence(self, key: str, value) -> None:
        self.evidence_data[key] = value

    # ---- grading, once ----

    def finish(self) -> None:
        """Grade, file, and make pytest's own view agree with the verdict. Idempotent."""
        if self._finished:
            return
        self._finished = True

        if self.case_id is None:
            raise GradingError("this scenario never bound a case ID, so its result cannot be filed.")

        verdict = grade(self.case_id, self.assertions)
        problems = validate_record(verdict)
        if problems:
            raise GradingError("grading produced a malformed record: " + " ".join(problems))

        record(
            {
                "caseId": self.case_id,
                "module": self.meta["module"],
                "layer": self.meta["layer"],
                "title": self.meta["title"],
                "priority": self.meta.get("priority", "Medium"),
                "status": verdict.status.value,
                "reason": verdict.reason,
                "note": verdict.note,
                "counts": verdict.counts,
                "assertions": [a.as_dict() for a in verdict.assertions],
                "evidence": self.evidence_data,
                "durationMs": int((time.monotonic() - self._started) * 1000),
                "via": self.via,
            }
        )

        # Keep the runner's own view honest: a case Failed in the queue must not
        # print as a green dot.
        if verdict.status is Status.FAILED:
            pytest.fail(f"case {self.case_id} graded Failed -- {verdict.reason}", pytrace=False)
        if verdict.status is Status.BLOCKED:
            pytest.skip(f"case {self.case_id} graded Blocked -- {verdict.note}")


@pytest.fixture
def qa():
    recorder = Recorder()
    yield recorder
    # Safety net for plain tests. For BDD scenarios pytest_bdd_after_scenario has
    # already run finish() inside the call phase, which is what makes a Failed
    # case report as a failure rather than as a teardown error.
    if not recorder._finished and recorder.case_id is not None:
        recorder.finish()


def pytest_bdd_after_scenario(request, feature, scenario):
    """Grade at the end of the scenario body, while still in the call phase."""
    if "qa" in request.fixturenames:
        request.getfixturevalue("qa").finish()


# ---- small numeric helpers shared by tiers ----

def is_multiple_of(value: float, step: float) -> bool:
    """Float-safe multiple test: compare in whole steps rather than in currency."""
    if not step:
        return False
    steps = value / step
    return abs(steps - round(steps)) < 1e-9


def relative_gap(observed: float, reference: float) -> float:
    """Relative difference between two numbers, as a fraction of the reference."""
    if not reference:
        return float("inf")
    return abs(observed - reference) / abs(reference)

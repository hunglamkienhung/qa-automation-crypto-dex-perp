"""Domain wiring for pytest: the shared recorder, plus the two things every
feature in this domain relies on -- binding @case:N, and the Gherkin phrasing
for "this cannot be observed".

Everything else lives in the tier folders under be/ and fe/.
"""

from __future__ import annotations

import pytest
from pytest_bdd import parsers, then

# The recorder fixture and the two pytest-bdd hooks come from the core. Importing
# them into this conftest is what registers them for the whole domain.
from qa_core.recorder import qa, pytest_bdd_apply_tag, pytest_bdd_after_scenario  # noqa: F401

# Givens that more than one feature uses. pytest-bdd binds a step to the module
# that defines it, so shared steps live in their own modules and are loaded
# here as plugins -- visible to every test module in the domain.
pytest_plugins = [
    "be.api.steps.givens",
    "be.contract.steps.givens",
    "be.contract.steps.perpdex_steps",
    "be.db.steps.store_steps",
    "be.api.steps.mini_steps",
    "be.api.steps.mini_security_steps",
    "be.bot.steps.bot_steps",
    "be.contract.steps.gmx_extra_steps",
    "be.api.steps.gmx_extra_steps",
]


def _case_id_of(node):
    """The @case:N tag, wherever pytest-bdd put it.

    A tag on the Scenario line goes through pytest_bdd_apply_tag and arrives as
    the registered ``case_id`` marker. A tag on an Examples block (one ID per
    row of a Scenario Outline -- how parameterised cases get their own IDs)
    bypasses that hook in pytest-bdd 8 and arrives as a raw mark literally
    named ``case:N``. Both are read here so a feature can use either.
    """
    marker = node.get_closest_marker("case_id")
    if marker is not None:
        return marker.args[0]
    for mark in node.iter_markers():
        if mark.name.startswith("case:"):
            return mark.name.split(":", 1)[1]
    return None


@pytest.fixture(autouse=True)
def bind_case(request, qa):
    """Bind the scenario to its catalogued case from the @case:N tag.

    Autouse so that no feature file has to remember a binding step. A scenario
    with no @case tag fails loudly rather than filing results against nothing.
    """
    case_id = _case_id_of(request.node)
    if case_id is None:
        # A plain unit test (a self-test next to its module) has no case and
        # files nothing. A BDD scenario missing its tag still fails loudly --
        # at finish(), with "never bound a case ID".
        return
    qa.case(case_id)
    # The slots this domain's Givens fill. Declared here, once, so a Then can
    # test `qa.chain_config is None` without a step having run first.
    for slot in ("chain", "chain_config", "funding", "book", "api", "db"):
        setattr(qa, slot, None)
    qa.screen = {}


@then(parsers.parse('"{claim}" cannot be verified because "{reason}"'))
def cannot_be_verified(qa, claim, reason):
    """How Gherkin says Blocked. Naming the gap keeps it in the report, and the
    reason says what would close it."""
    qa.unobservable(claim, reason)

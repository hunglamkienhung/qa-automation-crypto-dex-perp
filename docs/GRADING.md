# Grading

One rule decides every case, in one place (`core/*/grading`), shared by both
stacks and both domains.

## The order is the rule: Failed > Blocked > Passed

Each case is a list of recorded assertions. The verdict is decided by checking
the branches in this order, and the order is not cosmetic:

1. **Failed** — any observed proposition is wrong. A Failed case must carry a
   reason of the form "expected X, observed Y".
2. **Blocked** — nothing was Failed, but a proposition that decides the case
   could not be observed (a source was unreachable, a screen never rendered).
   A Blocked case must carry a note saying what would unblock it.
3. **Passed** — every proposition was observed and held.

Checking Failed **first** is the whole point. A case that has both a real defect
and an unobservable part must report the defect; letting the "couldn't observe"
branch win would delete a real bug from the report with no warning. The
self-tests assert this in both proposition orders.

Three things a case may never do: pass while a "if X then the system is wrong"
clause has X true; pass while its own title claims something unobserved; use a
note to launder a Passed that should have been Blocked.

## An outage is never a failure

Every adapter that reaches a live source throws a *named* unreachable error
(`ChainUnreachable`, `VenueUnreachable`, `ScreenNotReady`, `DbUnreachable`, …).
The step layer turns that one error class into an **unobservable** proposition —
Blocked — and rethrows anything else, because a bug in this project should not
hide behind an environmental excuse.

## The gate checks shape, not exit code

The suites deliberately contain a Blocked worked-example, and live tiers grade
Blocked whenever a source is down, so a plain "did every test pass?" gate would
be permanently red and quickly ignored. Instead `verify-expectations` compares
the run against `fixtures/expected-results.json`, where each case declares the
statuses it may legitimately land on:

- a deterministic case declares a single status;
- a live-source case declares `["Passed","Blocked"]` — and **no** list ever
  contains `Failed`, so an outage can never be reported as a defect.

It fails in both directions: `expected Passed, got Failed` is a regression;
`expected Failed, got Passed` means a check has stopped checking — invisible to
an ordinary green/red gate, a build failure here.

## Two stacks, one verdict

`node/` and `python/` read the same `.feature` files and write to their own
queues. A per-case disagreement is a finding in its own right — the grading is
being interpreted differently in two places — and is reconciled before anything
is called done.

## Idempotent bug flow

A Failed or Blocked case becomes an issue keyed by
`sha1(module::assertionId::normalised-detail)`. Running the flow twice over the
same queue produces zero new issues the second time; the self-tests hold that.

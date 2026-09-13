'use strict';

/**
 * Deterministic grading with a FIXED status precedence.
 *
 *      FAILED  >  BLOCKED  >  PASSED
 *
 * Why the order is pinned, and why it is the first thing in this file
 * -------------------------------------------------------------------
 * A test case usually carries several assertions. In a real run it is common
 * for one assertion to fail outright while another cannot be observed at all
 * (no endpoint, missing permission, environment gap). Such a case is BOTH
 * "failing" and "blocked", and the order in which you test those two
 * conditions decides the verdict.
 *
 * Check "blocked" first and the case is reported as Blocked. The real defect
 * is then filed under "we could not measure this", nobody opens a bug, and the
 * finding disappears from the report with no warning and no error anywhere.
 * The suite still looks healthy. That is the worst failure mode a test system
 * has: it loses a true positive silently.
 *
 * So the failure branch runs FIRST and wins absolutely. Blocked is only
 * considered once every assertion has been confirmed not to be failing.
 *
 * This is a structural property of the control flow, not a style preference.
 * No amount of test coverage elsewhere compensates for getting it backwards,
 * which is exactly why it lives in one small pure function that is unit tested
 * directly (selftest/grading.test.js) instead of being spread across callers.
 */

const STATUS = Object.freeze({
  PASSED: 'Passed',
  FAILED: 'Failed',
  BLOCKED: 'Blocked',
});

const OUTCOME = Object.freeze({
  /** Observed, and it matched the expectation. */
  PASS: 'pass',
  /** Observed, and it contradicted the expectation. */
  FAIL: 'fail',
  /** Could not be observed at all. Absence of evidence, not evidence of absence. */
  UNOBSERVABLE: 'unobservable',
});

const VALID_OUTCOMES = new Set(Object.values(OUTCOME));

/**
 * @typedef {object} Assertion
 * @property {string}  id           Stable within the case, e.g. "a1".
 * @property {string}  description  What was expected, in plain words.
 * @property {string}  outcome      One of OUTCOME.
 * @property {string} [detail]      Observed value, error text, or why it could not be observed.
 * @property {string} [evidence]    How to reproduce: a selector, a URL, a command.
 */

/**
 * Grade one test case from its assertions.
 *
 * Pure: no I/O, no clock, no globals. Given the same assertions it always
 * returns the same verdict, which is what makes it unit testable.
 *
 * @param {{ id: string, assertions: Assertion[] }} testCase
 * @returns {{ status: string, reason: string, note: string, counts: object, assertions: Assertion[] }}
 */
function grade(testCase) {
  const assertions = (testCase && testCase.assertions) || [];

  // An empty case is a harness bug, not a pass. Returning Passed here would
  // mean a test that asserted nothing reports as green.
  if (assertions.length === 0) {
    throw new Error(
      `case ${testCase && testCase.id}: no assertions were recorded. ` +
      `A case that asserts nothing cannot be graded; it must not default to Passed.`
    );
  }

  for (const a of assertions) {
    if (!VALID_OUTCOMES.has(a.outcome)) {
      throw new Error(
        `case ${testCase.id}, assertion ${a.id}: unknown outcome "${a.outcome}". ` +
        `Expected one of: ${[...VALID_OUTCOMES].join(', ')}.`
      );
    }
  }

  const failed = assertions.filter((a) => a.outcome === OUTCOME.FAIL);
  const unobservable = assertions.filter((a) => a.outcome === OUTCOME.UNOBSERVABLE);
  const passed = assertions.filter((a) => a.outcome === OUTCOME.PASS);

  const counts = {
    total: assertions.length,
    passed: passed.length,
    failed: failed.length,
    unobservable: unobservable.length,
  };

  // ---- BRANCH 1: FAILED. Must stay first. See the header comment. ----
  if (failed.length > 0) {
    const reason = failed
      .map((a) => `${a.id}: expected ${a.description}; observed ${a.detail || 'no detail recorded'}`)
      .join(' | ');

    // A case can be Failed AND have unobservable assertions. Say so explicitly
    // rather than letting the Blocked part vanish into the verdict.
    const note = unobservable.length
      ? `Graded Failed on ${failed.length} assertion(s). Separately, ${unobservable.length} ` +
        `assertion(s) stayed unobservable and are still unverified: ` +
        unobservable.map((a) => `${a.id} (${a.detail || 'no reason recorded'})`).join('; ')
      : '';

    return { status: STATUS.FAILED, reason, note, counts, assertions };
  }

  // ---- BRANCH 2: BLOCKED. Only once nothing is failing. ----
  if (unobservable.length > 0) {
    const note = unobservable
      .map((a) => `${a.id}: ${a.description} -- not observable: ${a.detail || 'no reason recorded'}`)
      .join(' | ');
    return { status: STATUS.BLOCKED, reason: '', note, counts, assertions };
  }

  // ---- BRANCH 3: PASSED. Every assertion observed and matching. ----
  return { status: STATUS.PASSED, reason: '', note: '', counts, assertions };
}

/**
 * Enforce which result fields each status requires.
 *
 * This exists because the three statuses were, in practice, filled in
 * inconsistently: a Failed row with an empty reason is unactionable, and a
 * Blocked row with no note tells nobody what would unblock it. Rather than
 * trusting discipline, the shape is checked and a violation is loud.
 *
 * @returns {string[]} Problems found. Empty means the record is well formed.
 */
function validateRecord(graded) {
  const problems = [];

  switch (graded.status) {
    case STATUS.FAILED:
      if (!graded.reason || !graded.reason.trim()) {
        problems.push('Failed requires a non-empty reason naming expected vs observed.');
      }
      break;

    case STATUS.BLOCKED:
      if (!graded.note || !graded.note.trim()) {
        problems.push('Blocked requires a note stating precisely what would unblock it.');
      }
      if (graded.reason && graded.reason.trim()) {
        problems.push('Blocked must not carry a failure reason; nothing was observed to fail.');
      }
      break;

    case STATUS.PASSED:
      if (graded.reason && graded.reason.trim()) {
        problems.push('Passed must not carry a failure reason.');
      }
      if (graded.counts.unobservable > 0) {
        problems.push('Passed cannot coexist with unobservable assertions; that is Blocked.');
      }
      if (graded.counts.failed > 0) {
        problems.push('Passed cannot coexist with failed assertions; that is Failed.');
      }
      break;

    default:
      problems.push(`Unknown status "${graded.status}".`);
  }

  return problems;
}

module.exports = { grade, validateRecord, STATUS, OUTCOME };

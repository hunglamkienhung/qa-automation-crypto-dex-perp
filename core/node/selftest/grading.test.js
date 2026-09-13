'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { grade, validateRecord, STATUS, OUTCOME } = require('../grading/grade');

/**
 * Tests for the grading rule itself.
 *
 * These matter more than any individual product test. A wrong product test
 * reports one case incorrectly; a wrong grading rule reports every case
 * incorrectly, and in the specific direction that hides real defects.
 */

const pass = (id) => ({ id, description: 'observed and matching', outcome: OUTCOME.PASS });
const fail = (id, detail) => ({ id, description: 'observed and contradicted', outcome: OUTCOME.FAIL, detail });
const unobs = (id, why) => ({ id, description: 'could not be observed', outcome: OUTCOME.UNOBSERVABLE, detail: why });

test('every assertion observed and matching gives Passed', () => {
  const r = grade({ id: '1', assertions: [pass('a1'), pass('a2')] });
  assert.equal(r.status, STATUS.PASSED);
  assert.equal(r.reason, '');
  assert.deepEqual(validateRecord(r), []);
});

test('a single contradicted assertion gives Failed with a reason', () => {
  const r = grade({ id: '2', assertions: [pass('a1'), fail('a2', 'got 2, wanted 6')] });
  assert.equal(r.status, STATUS.FAILED);
  assert.match(r.reason, /a2/);
  assert.match(r.reason, /got 2, wanted 6/);
  assert.deepEqual(validateRecord(r), []);
});

test('an unobservable assertion with nothing failing gives Blocked with a note', () => {
  const r = grade({ id: '3', assertions: [pass('a1'), unobs('a2', 'no endpoint exposes it')] });
  assert.equal(r.status, STATUS.BLOCKED);
  assert.equal(r.reason, '');
  assert.match(r.note, /no endpoint exposes it/);
  assert.deepEqual(validateRecord(r), []);
});

/**
 * The regression this whole module exists for.
 *
 * A case that is both failing and partly unmeasurable must be Failed. Getting
 * this backwards is not a cosmetic mistake: the real defect is filed under
 * "could not measure", no bug is opened, and nothing anywhere reports an error.
 * The suite stays green while a genuine failure disappears.
 */
test('Failed outranks Blocked when a case is both', () => {
  const r = grade({
    id: '8',
    assertions: [fail('a1', 'only 1 distinct image, expected 6'), unobs('a2', 'cache policy not published')],
  });

  assert.equal(r.status, STATUS.FAILED, 'a case with a real failure must never be graded Blocked');
  assert.match(r.reason, /a1/);
});

test('Failed outranks Blocked regardless of assertion order', () => {
  const unobservableFirst = grade({ id: '8', assertions: [unobs('a1', 'no endpoint'), fail('a2', 'mismatch')] });
  const failFirst = grade({ id: '8', assertions: [fail('a2', 'mismatch'), unobs('a1', 'no endpoint')] });

  assert.equal(unobservableFirst.status, STATUS.FAILED);
  assert.equal(failFirst.status, STATUS.FAILED);
});

test('a Failed case still reports its unobservable assertions in the note', () => {
  const r = grade({ id: '8', assertions: [fail('a1', 'mismatch'), unobs('a2', 'cache policy not published')] });

  // The blocked part must not vanish just because the verdict is Failed --
  // a2 is still unverified and the report has to say so.
  assert.match(r.note, /a2/);
  assert.match(r.note, /cache policy not published/);
});

test('a case with no assertions is an error, never a Passed', () => {
  assert.throws(() => grade({ id: '9', assertions: [] }), /no assertions/);
});

test('an unknown outcome is rejected rather than treated as a pass', () => {
  assert.throws(
    () => grade({ id: '9', assertions: [{ id: 'a1', description: 'x', outcome: 'probably-fine' }] }),
    /unknown outcome/
  );
});

test('validateRecord rejects a Failed record with no reason', () => {
  const problems = validateRecord({ status: STATUS.FAILED, reason: '', note: '', counts: { failed: 1, unobservable: 0 } });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /requires a non-empty reason/);
});

test('validateRecord rejects a Blocked record with no note', () => {
  const problems = validateRecord({ status: STATUS.BLOCKED, reason: '', note: '', counts: { failed: 0, unobservable: 1 } });
  assert.match(problems[0], /requires a note/);
});

test('validateRecord rejects a Passed record that hides unobservable assertions', () => {
  const problems = validateRecord({ status: STATUS.PASSED, reason: '', note: '', counts: { failed: 0, unobservable: 2 } });
  assert.match(problems.join(' '), /cannot coexist with unobservable/);
});

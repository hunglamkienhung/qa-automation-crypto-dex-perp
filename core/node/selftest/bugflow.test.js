'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const local = require('../bugflow/adapters/local');
const github = require('../bugflow/adapters/github');
const { normaliseDetail, signatureFor, problemsFrom } = require('../bugflow/run');
const { OUTCOME } = require('../grading/grade');

/** A throwaway store per test, so nothing here touches real state. */
function tempStore() {
  return path.join(os.tmpdir(), 'qa-bugflow-' + crypto.randomUUID() + '.json');
}

function problem(overrides = {}) {
  return {
    signature: 'aaaabbbbcccc',
    title: '[02. Inventory] distinct images does not hold',
    module: '02. Inventory',
    severity: 'High',
    caseId: '8',
    detail: 'Expected 6 distinct images, observed 1',
    ...overrides,
  };
}

test('a new problem creates an issue', () => {
  const store = tempStore();
  const { action, issue } = local.upsert(problem(), store);

  assert.equal(action, 'created');
  assert.equal(issue.id, 'B1');
  assert.deepEqual(issue.relatedCases, ['8']);
  fs.rmSync(store, { force: true });
});

/**
 * The property that makes it safe to run this on every build. Without it, a
 * nightly pipeline opens the same ticket every night.
 */
test('running twice over the same problem creates nothing the second time', () => {
  const store = tempStore();

  local.upsert(problem(), store);
  const second = local.upsert(problem(), store);

  assert.equal(second.action, 'unchanged');
  assert.equal(local.list(store).length, 1);
  fs.rmSync(store, { force: true });
});

test('a second case hitting the same problem attaches instead of duplicating', () => {
  const store = tempStore();

  local.upsert(problem({ caseId: '8' }), store);
  const second = local.upsert(problem({ caseId: '12' }), store);

  assert.equal(second.action, 'attached');
  assert.equal(local.list(store).length, 1, 'one bug means one issue, however many cases it fails');
  assert.deepEqual(second.issue.relatedCases, ['8', '12']);
  fs.rmSync(store, { force: true });
});

test('one case failing two different ways produces two issues', () => {
  const store = tempStore();

  local.upsert(problem({ signature: 'sig-one', caseId: '13' }), store);
  local.upsert(problem({ signature: 'sig-two', caseId: '13' }), store);

  assert.equal(local.list(store).length, 2);
  fs.rmSync(store, { force: true });
});

test('attaching a case never replaces the cases already listed', () => {
  const store = tempStore();

  local.upsert(problem({ caseId: '8' }), store);
  local.upsert(problem({ caseId: '12' }), store);
  local.upsert(problem({ caseId: '14' }), store);

  assert.deepEqual(local.list(store)[0].relatedCases, ['8', '12', '14']);
  fs.rmSync(store, { force: true });
});

// ---- signature derivation ----

test('the same defect reported with different observed values hashes the same', () => {
  const record = { module: '02. Inventory', caseId: '8', title: 'images', priority: 'High' };

  const a = signatureFor(record, { id: 'a1', detail: 'Expected 6 distinct images, observed 1' });
  const b = signatureFor(record, { id: 'a1', detail: 'Expected 6 distinct images, observed 2' });

  assert.equal(a, b, 'a changing observed count must not fork the issue');
});

test('different assertions in the same module hash differently', () => {
  const record = { module: '02. Inventory', caseId: '8', title: 'x', priority: 'High' };

  assert.notEqual(
    signatureFor(record, { id: 'a1', detail: 'mismatch' }),
    signatureFor(record, { id: 'a2', detail: 'mismatch' })
  );
});

test('volatile fragments are stripped before hashing', () => {
  assert.equal(normaliseDetail('failed at 2026-09-12T01:30:00Z with 0xDEADBEEF'),
               normaliseDetail('failed at 2026-01-01T09:00:00Z with 0xCAFEBABE'));
});

test('only failing assertions become problems', () => {
  const record = {
    module: '02. Inventory', caseId: '8', title: 'images', priority: 'High',
    assertions: [
      { id: 'a1', description: 'distinct images', outcome: OUTCOME.FAIL, detail: 'observed 1' },
      { id: 'a2', description: 'cache policy', outcome: OUTCOME.UNOBSERVABLE, detail: 'not published' },
      { id: 'a3', description: 'six items', outcome: OUTCOME.PASS },
    ],
  };

  const problems = problemsFrom(record);
  assert.equal(problems.length, 1, 'unobservable assertions are reported, never filed as defects');
  assert.match(problems[0].detail, /observed 1/);
});

// ---- GitHub adapter: signature survives human editing ----

test('a signature embedded in an issue body round-trips', () => {
  const body = github.embedSignature('Some description', 'abc123def456');
  assert.equal(github.extractSignature(body), 'abc123def456');
});

test('the signature survives someone editing the text around it', () => {
  let body = github.embedSignature('Original description', 'abc123def456');
  body = 'Retitled by triage.\n\n' + body + '\n\nAdded a repro note.';

  assert.equal(github.extractSignature(body), 'abc123def456',
    'the marker lives in the body precisely so edits do not orphan the issue');
});

test('a body with no marker yields no signature rather than a wrong one', () => {
  assert.equal(github.extractSignature('just a normal issue'), null);
});

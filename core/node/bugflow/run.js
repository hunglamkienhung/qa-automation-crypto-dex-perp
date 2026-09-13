#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const { latestByCase } = require('../queue/reader');
const { OUTCOME } = require('../grading/grade');

/**
 * Turn failing assertions into tracked issues, without creating duplicates.
 *
 * The identity rule
 * -----------------
 * An issue is keyed by the PROBLEM, not by the test case that surfaced it.
 * Both directions of the relationship happen constantly in practice:
 *
 *   - one broken thing fails eight cases  -> one issue, eight related cases
 *   - one case fails for two reasons      -> two issues, one related case each
 *
 * Keying on the case ID collapses the first into eight near-identical tickets,
 * and a developer who fixes one has no way to see the other seven are the same
 * bug. Keying on the problem keeps the ticket count equal to the bug count.
 *
 * The signature is derived from module, assertion ID, and the failure detail
 * with volatile parts removed -- numbers, hex, quoted values, timestamps. Two
 * runs of the same defect produce messages that differ in the observed value
 * while describing the same fault, and those must land on the same signature.
 *
 * Idempotence
 * -----------
 * Running this twice over the same queue creates nothing the second time.
 * That property is what makes it safe to run on every build. It is asserted
 * directly in selftest/bugflow.test.js rather than assumed.
 */

function loadAdapter() {
  const choice = (process.env.BUGTRACKER || 'local').toLowerCase();
  switch (choice) {
    case 'local': return require('./adapters/local');
    case 'github': return require('./adapters/github');
    default:
      throw new Error('unknown BUGTRACKER "' + choice + '". Known: local, github.');
  }
}

/**
 * Strip the parts of a failure message that change between identical runs,
 * so the same defect always hashes to the same signature.
 */
function normaliseDetail(detail) {
  return String(detail || '')
    .toLowerCase()
    .replace(/0x[0-9a-f]+/g, '<hex>')
    .replace(/\d{4}-\d{2}-\d{2}[t ][\d:.]+z?/g, '<timestamp>')
    .replace(/\d+(\.\d+)?/g, '<n>')
    .replace(/["'`][^"'`]*["'`]/g, '<value>')
    .replace(/\s+/g, ' ')
    .trim();
}

function signatureFor(record, assertion) {
  const basis = [record.module, assertion.id, normaliseDetail(assertion.detail)].join('::');
  return crypto.createHash('sha1').update(basis).digest('hex').slice(0, 12);
}

function severityFor(record) {
  if (record.priority === 'High') return 'High';
  if (record.priority === 'Low') return 'Low';
  return 'Medium';
}

function problemsFrom(record) {
  return record.assertions
    .filter((a) => a.outcome === OUTCOME.FAIL)
    .map((a) => ({
      signature: signatureFor(record, a),
      title: '[' + record.module + '] ' + a.description + ' does not hold',
      module: record.module,
      severity: severityFor(record),
      caseId: record.caseId,
      detail: [
        'Expected: ' + a.description,
        'Observed: ' + (a.detail || 'no detail recorded'),
        'Surfaced by case ' + record.caseId + ' (' + record.title + ')',
        'Assertion: ' + a.id,
      ].join('\n'),
    }));
}

async function main() {
  const records = [...latestByCase().values()];
  const failing = records.filter((r) => r.status === 'Failed');

  if (records.length === 0) {
    console.error('queue is empty -- run "npm test" first.');
    process.exit(1);
  }

  const adapter = loadAdapter();
  const tally = { created: 0, attached: 0, unchanged: 0 };

  for (const record of failing) {
    for (const problem of problemsFrom(record)) {
      const { action, issue } = await adapter.upsert(problem);
      tally[action] += 1;
      console.log(
        action.padEnd(9) + ' ' + issue.id +
        '  case ' + problem.caseId +
        '  ' + issue.title
      );
    }
  }

  // Blocked cases are reported, never filed as bugs. A blocked case says the
  // measurement could not be made; opening a defect against the product for it
  // sends a developer to investigate something that was never observed to break.
  const blocked = records.filter((r) => r.status === 'Blocked');

  console.log('');
  console.log('tracker: ' + adapter.name);
  console.log('failing cases: ' + failing.length +
    '  issues created: ' + tally.created +
    '  cases attached to existing: ' + tally.attached +
    '  already recorded: ' + tally.unchanged);

  if (blocked.length) {
    console.log('');
    console.log('blocked, NOT filed as defects (' + blocked.length + '):');
    for (const b of blocked) console.log('  case ' + b.caseId + ' -- ' + b.note);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = { normaliseDetail, signatureFor, problemsFrom };

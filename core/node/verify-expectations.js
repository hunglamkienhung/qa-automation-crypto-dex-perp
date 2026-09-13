#!/usr/bin/env node
'use strict';

const fs = require('fs');
const paths = require('./paths');

/**
 * Compare the run against fixtures/expected-results.json and exit non-zero on
 * any divergence. This is the CI gate.
 *
 * Why CI does not gate on the test command's exit code
 * ----------------------------------------------------
 * The suite deliberately contains a failing case and a blocked case -- they are
 * the worked examples for the grading rule. So `playwright test` always exits
 * non-zero, and a build gated on that would be permanently red. A permanently
 * red build is worse than no build: everyone stops reading it, and the first
 * real regression arrives looking exactly like the noise.
 *
 * Gating on the SHAPE of the result is stronger than the usual gate, because it
 * fails in both directions:
 *
 *   expected Passed, got Failed   a regression -- what normal CI catches
 *   expected Failed, got Passed   the check has stopped checking
 *
 * The second is invisible to ordinary CI. A test that was asserting something
 * real and now asserts nothing still reports green, and nothing anywhere says
 * the coverage was lost. Here it is a build failure.
 */

function main() {
  const EXPECTED_FILE = paths.expectedFile();
  const ACTUAL_FILE = paths.summaryFile();

  if (!fs.existsSync(ACTUAL_FILE)) {
    console.error('no report at ' + ACTUAL_FILE + ' -- run the suite and the reporter first.');
    return 1;
  }

  const expected = JSON.parse(fs.readFileSync(EXPECTED_FILE, 'utf8'));
  const actual = JSON.parse(fs.readFileSync(ACTUAL_FILE, 'utf8'));

  const actualByCase = new Map(actual.cases.map((c) => [String(c.caseId), c.status]));
  const problems = [];

  for (const [caseId, declared] of Object.entries(expected.cases)) {
    // A declaration may be one status, or a list of acceptable ones. The list
    // exists for cases that read live external data: the invariant held, or the
    // source could not be reached and nothing was measured. What no list ever
    // includes is Failed, so an outage still cannot be reported as a defect.
    const acceptable = Array.isArray(declared) ? declared : [declared];
    const wanted = acceptable.join(' or ');
    const got = actualByCase.get(caseId);

    if (got === undefined) {
      problems.push(`case ${caseId}: expected ${wanted}, but the case did not run at all`);
      continue;
    }
    if (!acceptable.includes(got)) {
      const direction = acceptable.includes('Passed')
        ? 'a regression'
        : 'the check has stopped checking -- coverage was silently lost';
      problems.push(`case ${caseId}: expected ${wanted}, got ${got}  (${direction})`);
    }
    actualByCase.delete(caseId);
  }

  for (const [caseId, status] of actualByCase) {
    problems.push(
      `case ${caseId} ran with status ${status} but is not declared in ` +
      'fixtures/expected-results.json -- add it, so the baseline stays complete'
    );
  }

  console.log('expected: ' + JSON.stringify(expected.summary));
  console.log('actual:   ' + JSON.stringify(actual.summary));

  if (problems.length === 0) {
    console.log('');
    console.log('OK -- every case landed on its declared status.');
    return 0;
  }

  console.error('');
  console.error(`${problems.length} case(s) diverged from the baseline:`);
  for (const p of problems) console.error('  ' + p);
  console.error('');
  console.error('If a change here is intended, update fixtures/expected-results.json');
  console.error('in the same commit, so the baseline always states what is expected.');
  return 1;
}

module.exports = { main };

if (require.main === module) process.exit(main());

'use strict';

const path = require('path');

/**
 * Where a run reads and writes. The single place the core learns about the
 * filesystem, so the same package can serve every domain without knowing any
 * of them.
 *
 * The core is installed once and required from several places. Resolving
 * against __dirname would point every domain at the core's own folder; the
 * queue of one domain would then overwrite the queue of another. So the root
 * is the WORKING DIRECTORY of the process -- the domain's node/ folder, which
 * is where every npm script runs -- with an override for callers that run from
 * somewhere else (CI steps, the pipeline, a test).
 *
 *   workdir      the domain's node/ folder      queue/  reports/  state/
 *   domainRoot   one level up                   fixtures/  features/
 */

function workdir() {
  return path.resolve(process.env.QA_WORKDIR || process.cwd());
}

function domainRoot() {
  return path.resolve(process.env.QA_DOMAIN_ROOT || path.join(workdir(), '..'));
}

function queueFile() { return path.join(workdir(), 'queue', 'results.jsonl'); }
function reportsDir() { return path.join(workdir(), 'reports'); }
function stateDir() { return path.join(workdir(), 'state'); }
function issuesFile() { return path.join(stateDir(), 'issues.json'); }
function summaryFile() { return path.join(reportsDir(), 'summary.json'); }
function dashboardFile() { return path.join(reportsDir(), 'dashboard.html'); }

function fixturesDir() { return path.join(domainRoot(), 'fixtures'); }
function expectedFile() { return path.join(fixturesDir(), 'expected-results.json'); }
function testcasesFile() { return path.join(fixturesDir(), 'testcases.json'); }

module.exports = {
  workdir, domainRoot,
  queueFile, reportsDir, stateDir, issuesFile, summaryFile, dashboardFile,
  fixturesDir, expectedFile, testcasesFile,
};

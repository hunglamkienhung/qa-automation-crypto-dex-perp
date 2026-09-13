'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const paths = require('./paths');

/**
 * Run a domain's whole chain: test steps, then report, then gate, then bug
 * flow -- and keep going past a non-zero test step.
 *
 * A shell chain would stop at the first failing runner and never publish the
 * report, which hides the very result the report exists to show. So each test
 * step's exit code is recorded and carried to the end; the build still fails
 * on a real problem, just after the evidence has been written.
 *
 * Runners are invoked as plain Node scripts, never through npx: npx resolves to
 * a .cmd wrapper on Windows, which spawn can only run with shell: true, and with
 * a shell arguments are concatenated rather than escaped.
 *
 * A domain declares its steps:
 *
 *   require('@portfolio/core/pipeline').run([
 *     { label: 'BE (no browser)', runner: 'cucumber',   args: ['--tags', '@be'] },
 *     { label: 'FE specs',        runner: 'playwright', args: ['test'] },
 *   ]);
 */

function runnerPath(name) {
  const root = paths.workdir();
  if (name === 'playwright') return require.resolve('@playwright/test/cli', { paths: [root] });
  if (name === 'cucumber') return path.join(root, 'node_modules', '@cucumber', 'cucumber', 'bin', 'cucumber.js');
  throw new Error('unknown runner "' + name + '". Known: playwright, cucumber.');
}

function exec(label, script, args) {
  console.log('\n=== ' + label + ' ===');
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: paths.workdir(),
    stdio: 'inherit',
    env: process.env,
  });
  return result.status === null ? 1 : result.status;
}

function run(steps) {
  const n = steps.length + 3;
  const exits = [];
  steps.forEach((s, i) => {
    exits.push(exec(`${i + 1}/${n}  ${s.label}`, runnerPath(s.runner), s.args || []));
  });

  const reportExit = exec(`${steps.length + 1}/${n}  report`, path.join(__dirname, 'bridge', 'run.js'), []);
  if (reportExit !== 0) {
    console.error('\nreporting failed; stopping before the gate.');
    process.exit(reportExit);
  }

  const gateExit = exec(`${steps.length + 2}/${n}  gate`, path.join(__dirname, 'verify-expectations.js'), []);
  const bugExit = exec(`${steps.length + 3}/${n}  bug flow`, path.join(__dirname, 'bugflow', 'run.js'), []);
  if (bugExit !== 0) process.exit(bugExit);

  console.log('');
  if (gateExit !== 0) {
    console.error('GATE FAILED -- a case landed somewhere the baseline does not allow.');
    process.exit(gateExit);
  }
  console.log('pipeline finished. Gate passed. Test steps exited ' + exits.join(', ') + '.');
}

module.exports = { run };

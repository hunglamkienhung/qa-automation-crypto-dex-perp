#!/usr/bin/env node
'use strict';

const { latestByCase, summarise } = require('../queue/reader');
const { runControls } = require('../lib/diff');

/**
 * Publish the queue to whichever reporter is configured.
 *
 * The gate before publishing is the point of this file. Before any number is
 * written out, the comparison tooling is measured against inputs whose answer
 * is already known, in both directions. If a tool cannot get a known case
 * right, its verdict on unknown data is worth nothing -- and a wrong number in
 * a report is worse than no report, because people act on it.
 *
 * Adapter selection is one environment variable. With none set the local file
 * adapter runs, so a fresh clone produces a report with no setup at all.
 */

function loadAdapter() {
  const choice = (process.env.REPORTER || 'local').toLowerCase();
  switch (choice) {
    case 'local': return require('./adapters/local');
    case 'sheets': return require('./adapters/sheets');
    default:
      throw new Error('unknown REPORTER "' + choice + '". Known: local, sheets.');
  }
}

/**
 * Build the sample the controls run against: the records themselves, reduced
 * to flat text fields. Controls on synthetic data prove less than controls on
 * the shape of data actually being handled.
 */
function controlSample(records) {
  const sample = {};
  for (const r of records.slice(0, 5)) {
    sample[r.caseId] = {
      module: r.module,
      title: r.title,
      status: r.status,
      reason: r.reason || '',
      note: r.note || '',
    };
  }
  return sample;
}

async function main() {
  const records = [...latestByCase().values()];

  if (records.length === 0) {
    console.error('queue is empty -- run "npm test" first.');
    process.exit(1);
  }

  const controls = runControls(controlSample(records));

  console.log('measurement controls');
  console.log('  negative (identical input -> 0 differences): ' +
    (controls.negative.ok ? 'pass' : 'FAIL, got ' + controls.negative.actual));
  console.log('  positive (planted difference -> detected):   ' +
    (controls.positive.ok ? 'pass' : 'FAIL, the planted difference was missed'));

  if (!controls.ok) {
    console.error('');
    console.error('Refusing to publish. The comparison tooling failed a control,');
    console.error('so any figure it produces about real data is untrustworthy.');
    console.error('Fix the tool, re-run the controls, then publish.');
    process.exit(2);
  }

  const summary = summarise();
  const adapter = loadAdapter();
  const out = await adapter.publish(records, summary, controls);

  console.log('');
  console.log('reporter: ' + adapter.name);
  console.log('cases: ' + summary.total +
    '  passed: ' + summary.Passed +
    '  failed: ' + summary.Failed +
    '  blocked: ' + summary.Blocked);
  for (const [k, v] of Object.entries(out || {})) console.log(k + ': ' + v);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = { main, controlSample };

'use strict';

const { readJsonl } = require('../lib/fsx');
const { queueFile } = require('./writer');

/**
 * Reading side of the queue. Kept separate from the writer so that nothing on
 * the publishing side can accidentally append, and so a reader can be pointed
 * at an archived log without touching the live one.
 */

function readAll(file = queueFile()) {
  return readJsonl(file);
}

/**
 * Collapse the log to one record per case: the most recent wins.
 *
 * A case gets re-run for all sorts of reasons -- a flake investigation, a fix
 * verification, a rerun of one module. Every attempt stays in the log as
 * history, but a report must show the current verdict, and "current" means
 * latest by timestamp rather than last line in the file. Those differ as soon
 * as two logs are concatenated or a run is resumed.
 */
function latestByCase(file = queueFile()) {
  const byCase = new Map();

  for (const entry of readAll(file)) {
    const existing = byCase.get(entry.caseId);
    if (!existing || entry.ts > existing.ts) byCase.set(entry.caseId, entry);
  }
  return byCase;
}

/** Every attempt at one case, oldest first. Useful for spotting flakiness. */
function historyFor(caseId, file = queueFile()) {
  return readAll(file)
    .filter((e) => e.caseId === String(caseId))
    .sort((a, b) => a.ts.localeCompare(b.ts));
}

function summarise(file = queueFile()) {
  const counts = { Passed: 0, Failed: 0, Blocked: 0 };
  for (const entry of latestByCase(file).values()) {
    if (counts[entry.status] === undefined) counts[entry.status] = 0;
    counts[entry.status]++;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { total, ...counts };
}

module.exports = { readAll, latestByCase, historyFor, summarise };

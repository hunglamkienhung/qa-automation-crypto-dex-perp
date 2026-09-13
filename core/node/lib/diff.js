'use strict';

/**
 * Comparing two datasets, plus the controls that decide whether the comparison
 * can be trusted at all.
 *
 * Background
 * ----------
 * A comparison tool once reported roughly six hundred differing cells between
 * two datasets that were, in fact, almost identical. The cause was not in the
 * data: the comparison pulled a wrapper object out of each side and compared
 * the two wrappers, so it was testing object identity rather than the text
 * inside. Two distinct objects are never equal, so every populated cell was
 * flagged. The real difference turned out to be four cells.
 *
 * Nothing about that number looked wrong. It looked like a serious data
 * problem, which is precisely why it was nearly reported as one.
 *
 * The fix is cheap and mechanical: before trusting any measurement, run the
 * tool against inputs whose answer is already known, in BOTH directions.
 *
 *   negative control -- a known-CLEAN input must come back clean.
 *                       If it reports differences, the tool over-reports.
 *
 *   positive control -- a known-DIRTY input must be flagged.
 *                       If it comes back clean, the tool under-reports, which
 *                       is the more dangerous direction because the failure is
 *                       an absence and nothing draws attention to it.
 *
 * A negative control alone is not enough. It catches false alarms and is blind
 * to silent misses. Both controls run in runControls() below, and the bridge
 * refuses to publish a report if either one fails.
 */

/**
 * Reduce a value to the text it actually represents, so comparison is by
 * content and never by reference.
 *
 * Line endings are normalised because the same logical value routinely arrives
 * as LF from a file and CRLF from an HTTP API. Comparing those raw produces a
 * wall of differences in every multi-line field -- all of them false.
 */
function resolveValue(v) {
  if (v === null || v === undefined) return '';

  // Unwrap the common single-property text wrappers rather than comparing the
  // wrapper itself. This is the exact mistake described above.
  if (typeof v === 'object') {
    if (typeof v.text === 'string') return resolveValue(v.text);
    if (typeof v.value === 'string') return resolveValue(v.value);
    return JSON.stringify(v);
  }

  return String(v)
    .replace(/^﻿/, '')   // byte order mark
    .replace(/\r\n/g, '\n')   // CRLF -> LF, on BOTH sides
    .trim();
}

/**
 * Compare two flat records key by key.
 * @returns one entry per real difference
 */
function compareRecords(left, right) {
  const keys = new Set([...Object.keys(left || {}), ...Object.keys(right || {})]);
  const diffs = [];

  for (const key of keys) {
    const l = resolveValue(left ? left[key] : '');
    const r = resolveValue(right ? right[key] : '');
    if (l !== r) diffs.push({ key, left: l, right: r });
  }
  return diffs;
}

/** Compare two keyed collections of records. */
function compareDatasets(left, right) {
  const ids = new Set([...Object.keys(left || {}), ...Object.keys(right || {})]);
  const diffs = [];

  for (const id of ids) {
    if (!left[id]) { diffs.push({ id, key: '*', left: '(missing)', right: '(present)' }); continue; }
    if (!right[id]) { diffs.push({ id, key: '*', left: '(present)', right: '(missing)' }); continue; }
    for (const d of compareRecords(left[id], right[id])) diffs.push({ id, ...d });
  }
  return diffs;
}

/**
 * Run both controls against a sample whose answer is known in advance.
 * Call this before trusting any diff output.
 *
 * @returns { ok, negative, positive }
 */
function runControls(sample) {
  // --- negative control: the sample against a deep copy of itself ---
  const copy = JSON.parse(JSON.stringify(sample));
  const negativeDiffs = compareDatasets(sample, copy);
  const negative = {
    name: 'negative control -- identical input must produce zero differences',
    expected: 0,
    actual: negativeDiffs.length,
    ok: negativeDiffs.length === 0,
    // Showing the first few is what turns "the tool is broken" into a diagnosis.
    examples: negativeDiffs.slice(0, 3),
  };

  // --- positive control: inject one known difference and require it be found ---
  const dirty = JSON.parse(JSON.stringify(sample));
  const firstId = Object.keys(dirty)[0];
  const firstKey = firstId ? Object.keys(dirty[firstId])[0] : null;

  let positive;
  if (!firstId || !firstKey) {
    positive = {
      name: 'positive control -- a planted difference must be flagged',
      ok: false,
      actual: 'sample too small to plant a difference into',
    };
  } else {
    dirty[firstId][firstKey] = resolveValue(dirty[firstId][firstKey]) + '__PLANTED__';
    const found = compareDatasets(sample, dirty);
    const hit = found.find((d) => d.id === firstId && d.key === firstKey);
    positive = {
      name: 'positive control -- a planted difference must be flagged',
      planted: firstId + '.' + firstKey,
      expected: 1,
      actual: found.length,
      ok: found.length === 1 && Boolean(hit),
    };
  }

  return { ok: negative.ok && positive.ok, negative, positive };
}

module.exports = { resolveValue, compareRecords, compareDatasets, runControls };

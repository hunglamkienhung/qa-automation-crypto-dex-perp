'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { resolveValue, compareRecords, compareDatasets, runControls } = require('../lib/diff');

/**
 * Tests for the measurement tooling, in both directions.
 *
 * A comparison tool can be wrong two ways, and they are not equally visible:
 *
 *   over-reporting  loud and obvious -- a scary number nobody can reproduce
 *   under-reporting silent -- the number is small, everyone relaxes, and a
 *                   real difference was never shown to anyone
 *
 * Testing only that clean data comes back clean catches the first and is
 * completely blind to the second, so both are asserted here.
 */

test('identical input produces zero differences', () => {
  const a = { r1: { x: 'one', y: 'two' }, r2: { x: 'three', y: 'four' } };
  assert.deepEqual(compareDatasets(a, JSON.parse(JSON.stringify(a))), []);
});

test('a planted difference is found, and only that one', () => {
  const a = { r1: { x: 'one', y: 'two' }, r2: { x: 'three', y: 'four' } };
  const b = JSON.parse(JSON.stringify(a));
  b.r2.y = 'FOUR';

  const diffs = compareDatasets(a, b);
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].id, 'r2');
  assert.equal(diffs[0].key, 'y');
});

/**
 * The regression behind resolveValue. Comparing wrapper objects rather than
 * the text inside them made every populated field differ, because two distinct
 * objects are never equal. Roughly six hundred cells were reported as changed
 * when four had actually changed.
 */
test('values wrapped in an object compare by their text, not by reference', () => {
  const left = { r1: { cell: { text: 'same content' } } };
  const right = { r1: { cell: { text: 'same content' } } };

  assert.deepEqual(compareDatasets(left, right), [],
    'two distinct wrapper objects holding equal text must compare equal');
});

test('CRLF and LF forms of the same value compare equal', () => {
  // One side comes from a file, the other from an HTTP API. Comparing raw
  // produces a false difference in every multi-line field.
  assert.equal(resolveValue('line1\r\nline2'), resolveValue('line1\nline2'));
});

test('a leading byte order mark does not create a difference', () => {
  assert.equal(resolveValue('﻿value'), resolveValue('value'));
});

test('a missing record is reported rather than skipped', () => {
  const diffs = compareDatasets({ r1: { x: '1' } }, {});
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].key, '*');
});

test('a key present on one side only is a difference', () => {
  const diffs = compareRecords({ a: '1' }, { a: '1', b: '2' });
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].key, 'b');
});

test('runControls passes both directions on a healthy tool', () => {
  const sample = { r1: { a: 'x', b: 'multi\r\nline' }, r2: { a: 'y', b: 'z' } };
  const controls = runControls(sample);

  assert.equal(controls.negative.ok, true, 'negative control: clean input must come back clean');
  assert.equal(controls.positive.ok, true, 'positive control: a planted difference must be detected');
  assert.equal(controls.ok, true);
});

test('runControls reports which direction failed, not just that it failed', () => {
  const controls = runControls({ r1: { a: 'x' } });
  assert.ok(controls.negative.name.includes('negative control'));
  assert.ok(controls.positive.name.includes('positive control'));
  assert.equal(controls.positive.planted, 'r1.a');
});

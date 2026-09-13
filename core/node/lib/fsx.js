'use strict';

const fs = require('fs');
const path = require('path');

/**
 * File helpers with two properties the rest of the project depends on:
 * appends are open-write-close (never a held handle), and whole-file writes
 * are atomic (write a temp file, then rename over the target).
 *
 * The reason is a real failure mode rather than theory: a process that keeps a
 * log file open and dies mid-run leaves a truncated last line, and a report
 * written in place leaves a half-written file if the process is interrupted.
 * Both are silent -- the next reader just sees corrupt or missing data.
 */

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Append one JSON object as a single line. Opens, writes, closes immediately,
 * so a crash can lose at most the record being written, never the file.
 */
function appendJsonl(file, obj) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(obj) + '\n', { encoding: 'utf8' });
}

/**
 * Read a JSONL file into objects.
 *
 * A malformed line is reported with its line number instead of being skipped.
 * Silently dropping it would make a truncated file look merely shorter, and a
 * shorter report is far harder to notice than a loud parse error.
 */
function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  const out = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch (err) {
      throw new Error(file + ':' + (i + 1) + ' is not valid JSON -- ' + err.message);
    }
  }
  return out;
}

/** Write a whole file atomically: temp file first, then rename over the target. */
function writeAtomic(file, text) {
  ensureDir(path.dirname(file));
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, text, { encoding: 'utf8' });
  fs.renameSync(tmp, file);
}

function readJsonOr(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, obj) {
  writeAtomic(file, JSON.stringify(obj, null, 2) + '\n');
}

module.exports = { ensureDir, appendJsonl, readJsonl, writeAtomic, readJsonOr, writeJson };

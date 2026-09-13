'use strict';

const { readJsonOr, writeJson } = require('../../lib/fsx');
const paths = require('../../paths');

/**
 * Default bug tracker: a JSON file under state/.
 *
 * Small, but it holds the part that actually matters -- the identity rule for
 * an issue. See src/bugflow/run.js for why an issue is keyed by the problem
 * rather than by the case that happened to surface it.
 */

/** Resolved per call so the store follows the domain that is running. */
function STORE() { return paths.issuesFile(); }

const name = 'local';

// Every entry point takes the store path so a test can run against a temporary
// file instead of the real one. A test that mutates live state is a test people
// learn to skip.
function load(store = STORE()) {
  return readJsonOr(store, { nextId: 1, issues: [] });
}

function save(db, store = STORE()) {
  writeJson(store, db);
}

/** Find an existing issue by its problem signature. */
function findBySignature(db, signature) {
  return db.issues.find((i) => i.signature === signature) || null;
}

/**
 * Create the issue, or attach this case to the one that already exists.
 * @returns {{action: 'created'|'attached'|'unchanged', issue: object}}
 */
function upsert(problem, store = STORE()) {
  const db = load(store);
  const existing = findBySignature(db, problem.signature);

  if (existing) {
    if (existing.relatedCases.includes(problem.caseId)) {
      return { action: 'unchanged', issue: existing };
    }
    // Add the case, never replace the list. An issue accumulates the cases it
    // affects; overwriting would erase the previous ones.
    existing.relatedCases.push(problem.caseId);
    existing.updatedAt = new Date().toISOString();
    save(db, store);
    return { action: 'attached', issue: existing };
  }

  const issue = {
    id: 'B' + db.nextId,
    signature: problem.signature,
    title: problem.title,
    module: problem.module,
    detail: problem.detail,
    severity: problem.severity,
    state: 'Open',
    relatedCases: [problem.caseId],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  db.nextId += 1;
  db.issues.push(issue);
  save(db, store);
  return { action: 'created', issue };
}

function list(store = STORE()) {
  return load(store).issues;
}

module.exports = { name, upsert, list, findBySignature, load, save, STORE };

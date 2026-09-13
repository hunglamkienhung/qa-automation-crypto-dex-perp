'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

/**
 * Open (or create) the store and apply the schema. The file is the contract
 * between the indexer, the REST layer and the test tiers: both test stacks
 * open this same file read-only and assert on its rows directly.
 */
function open(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  return db;
}

module.exports = { open };

'use strict';

/**
 * Optional reporter: push the run to a Google Sheet.
 *
 * Included to show the adapter seam rather than to be the default path. The
 * contract an adapter has to meet is the whole point:
 *
 *     name: string
 *     publish(records, summary, controls) -> object of things to print
 *
 * Nothing above this layer knows whether results end up in a file, a
 * spreadsheet, or a database, which is what makes the backend swappable
 * without touching a single test.
 *
 * Two rules this adapter follows, both learned from spreadsheets that people
 * actually maintain by hand:
 *
 *   1. Columns are located by HEADER NAME, never by fixed letter. Someone will
 *      insert a column, and every hard-coded index silently starts writing into
 *      the wrong field -- silently, because a wrong value still looks like a value.
 *
 *   2. Human-owned columns are never overwritten. Triage notes, assignees and
 *      review states belong to people; a sync that rewrites the whole row
 *      destroys work with no trace.
 */

const name = 'sheets';

const HUMAN_OWNED_COLUMNS = ['Assignee', 'Triage note', 'Review state', 'Ticket'];

function requireEnv(key) {
  const v = process.env[key];
  if (!v) {
    throw new Error(
      key + ' is not set. Copy .env.example to .env and fill it in, ' +
      'or leave REPORTER unset to use the local file reporter.'
    );
  }
  return v;
}

/**
 * Map a header row to column indices, so writes address columns by name.
 * @param {string[]} headerRow
 */
function indexColumns(headerRow) {
  const index = {};
  headerRow.forEach((title, i) => { index[String(title).trim()] = i; });
  return index;
}

/** Build the cells this adapter owns, leaving every human column untouched. */
function buildRow(record, columnIndex, existingRow) {
  const row = existingRow ? [...existingRow] : [];

  const owned = {
    'Case ID': record.caseId,
    'Module': record.module,
    'Title': record.title,
    'Status': record.status,
    'Assertions': record.counts.passed + '/' + record.counts.total,
    'Reason': record.reason || '',
    'Note': record.note || '',
    'Last run': record.ts,
  };

  for (const [header, value] of Object.entries(owned)) {
    const at = columnIndex[header];
    if (at === undefined) continue;              // column absent; do not invent one
    if (HUMAN_OWNED_COLUMNS.includes(header)) continue;
    row[at] = value;
  }
  return row;
}

async function publish(records, summary /* , controls */) {
  const spreadsheetId = requireEnv('SHEETS_SPREADSHEET_ID');
  requireEnv('SHEETS_SERVICE_ACCOUNT_JSON');

  // Wiring the Google client is left out on purpose: it would add a heavy
  // dependency to a repository whose default path needs none, and the part
  // worth reading -- header lookup, ownership split, idempotent upsert -- is
  // already above. buildRow and indexColumns are exported and unit tested.
  throw new Error(
    'The Google Sheets adapter is a documented seam, not a wired integration.\n' +
    'It would upsert ' + records.length + ' rows into spreadsheet ' + spreadsheetId + ' ' +
    '(' + summary.Passed + ' passed, ' + summary.Failed + ' failed, ' + summary.Blocked + ' blocked), ' +
    'matching rows by Case ID and writing only machine-owned columns.\n' +
    'Run without REPORTER set to use the local file reporter.'
  );
}

module.exports = { name, publish, indexColumns, buildRow, HUMAN_OWNED_COLUMNS };

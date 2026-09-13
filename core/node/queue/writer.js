'use strict';

const crypto = require('crypto');
const { appendJsonl } = require('../lib/fsx');
const paths = require('../paths');

/**
 * The only way a test result enters the system.
 *
 * Why a queue sits between the runner and the reporting side
 * ----------------------------------------------------------
 * The obvious design is to have each test push its result straight to whatever
 * tracks results -- a spreadsheet, a database, an issue tracker. That couples
 * the test run to the availability and the rate limit of an external service.
 * When the service is slow the suite is slow; when it is down the run is lost;
 * when its API changes every test file has to be touched.
 *
 * Here a test appends one line to a local log and moves on. Publishing happens
 * afterwards, in a separate process, against whichever adapter is configured.
 * The consequences are concrete:
 *
 *   - A run completes even with no network at all.
 *   - Publishing can be retried without re-running a single test.
 *   - Swapping the reporting backend touches one adapter, not the test suite.
 *   - The log is the primary record. If a report and the log disagree, the log
 *     wins, because it was written at the moment of measurement.
 *
 * The append is open-write-close, so an interrupted run loses at most the
 * record in flight.
 */

/** Resolved per call, not at load: the queue belongs to the domain that is running. */
function queueFile() { return paths.queueFile(); }

const REQUIRED_FIELDS = ['caseId', 'status', 'assertions'];

/** Stable per process: groups every record from a single run. */
const RUN_ID = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 13);

function record(result) {
  for (const field of REQUIRED_FIELDS) {
    if (result[field] === undefined || result[field] === null) {
      throw new Error(
        'queue: refusing to write a record with no ' + field + '. ' +
        'An incomplete record is worse than a missing one -- it looks like data.'
      );
    }
  }

  const entry = {
    uuid: crypto.randomUUID(),
    ts: new Date().toISOString(),
    runId: RUN_ID,
    ...result,
  };

  appendJsonl(queueFile(), entry);
  return entry;
}

module.exports = { record, queueFile, RUN_ID };

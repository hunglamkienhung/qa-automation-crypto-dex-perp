'use strict';

const { peer } = require('../peer');
const base = peer('@playwright/test');
const { Recorder } = require('./recorder');
const { STATUS } = require('../grading/grade');

/**
 * Playwright Test entry: a `qa` fixture that is a Recorder, graded and filed on
 * teardown.
 *
 *   qa.case('8')                         bind to a catalogued case
 *   await qa.assert(what, async () => …) an assertion that was observed
 *   qa.unobservable(what, why)           an assertion the environment cannot show
 *
 * The runner's own view is kept honest: a case graded Failed throws, so it
 * cannot print green; a Blocked case is annotated, because Playwright has no
 * such status and the queue keeps the real word.
 */
const test = base.test.extend({
  qa: async ({}, use, testInfo) => {
    const rec = new Recorder('playwright');
    rec.case = (id) => rec.bindCase(id);

    await use(rec);

    const graded = rec.file();
    if (graded.status === STATUS.FAILED) {
      throw new Error('case ' + rec.caseId + ' graded Failed -- ' + graded.reason);
    }
    if (graded.status === STATUS.BLOCKED) {
      testInfo.annotations.push({ type: 'blocked', description: graded.note });
    }
  },
});

module.exports = { test, expect: base.expect };

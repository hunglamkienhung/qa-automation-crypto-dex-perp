'use strict';

const { peer } = require('../peer');
const { setWorldConstructor, World, Before, After, AfterAll, Status } = peer('@cucumber/cucumber');
const { Recorder } = require('./recorder');
const { STATUS } = require('../grading/grade');

/**
 * Cucumber entry: the World IS a Recorder, and the hooks turn the scenario's
 * @case:N tag into a bound case and the scenario's end into one filed record.
 *
 * Browser lifecycle is opt-in per scenario through the @ui tag, and the browser
 * module is required lazily. The point is that a domain's BE branch can run on a
 * machine where Playwright's browser was never installed: `cucumber-js --tags
 * "@be"` must not even try to load it.
 *
 * `install(options)` is called once from the domain's cucumber support folder:
 *
 *   require('@portfolio/core/harness/cucumber').install({
 *     browserTag: '@ui',
 *     viewport: { width: 1600, height: 1000 },
 *     extendWorld(world) { world.book = null; … }    // per-domain slots
 *   });
 */

class QaWorld extends World {
  constructor(options) {
    super(options);
    this.rec = new Recorder('cucumber');
    this.page = null;
    this.context = null;
  }

  // Thin delegation, so steps read `this.check(...)` and never touch the queue.
  bindCase(id) { return this.rec.bindCase(id); }
  check(d, passed, detail) { return this.rec.check(d, passed, detail); }
  unobservable(d, why) { return this.rec.unobservable(d, why); }
  observe(d, fn) { return this.rec.observe(d, fn); }
  fetchOrBlock(classes, fn) { return this.rec.fetchOrBlock(classes, fn); }
  evidence(k, v) { return this.rec.evidence(k, v); }
  get caseId() { return this.rec.caseId; }
  get meta() { return this.rec.meta; }
  get assertions() { return this.rec.assertions; }
  get sourceError() { return this.rec.sourceError; }
  set sourceError(v) { this.rec.sourceError = v; }
}

let browser = null;

async function getBrowser() {
  if (!browser) {
    const { chromium } = peer('@playwright/test');
    browser = await chromium.launch();
  }
  return browser;
}

function install(options = {}) {
  const browserTag = options.browserTag || '@ui';
  const viewport = options.viewport || { width: 1600, height: 1000 };
  const extendWorld = options.extendWorld || (() => {});

  class DomainWorld extends QaWorld {
    constructor(o) {
      super(o);
      extendWorld(this);
    }
  }
  setWorldConstructor(DomainWorld);

  AfterAll(async function () {
    if (browser) await browser.close();
  });

  Before({ timeout: 90_000 }, async function ({ pickle }) {
    const tags = pickle.tags.map((t) => t.name);

    if (tags.includes(browserTag)) {
      this.context = await (await getBrowser()).newContext({ viewport });
      this.page = await this.context.newPage();
    }

    const tag = tags.find((n) => n.startsWith('@case:'));
    if (!tag) {
      throw new Error(
        'scenario "' + pickle.name + '" has no @case:N tag, so its result ' +
        'cannot be filed against a catalogued case.'
      );
    }
    this.bindCase(tag.slice('@case:'.length));
  });

  After({ timeout: 30_000 }, async function ({ result }) {
    try {
      // A scenario that blew up before asserting anything has no verdict to
      // file; the thrown error is the finding, and grading would mask it.
      if (result && result.status === Status.FAILED && this.assertions.length === 0) {
        return;
      }
      const graded = this.rec.file();

      if (graded.status === STATUS.FAILED) {
        throw new Error('case ' + this.caseId + ' graded Failed -- ' + graded.reason);
      }
      if (graded.status === STATUS.BLOCKED) {
        this.attach('BLOCKED -- ' + graded.note, 'text/plain');
      }
    } finally {
      if (this.context) await this.context.close();
    }
  });
}

module.exports = { install, QaWorld };

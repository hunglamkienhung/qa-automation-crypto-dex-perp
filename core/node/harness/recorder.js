'use strict';

const fs = require('fs');
const { grade, validateRecord, OUTCOME } = require('../grading/grade');
const { record } = require('../queue/writer');
const paths = require('../paths');

/**
 * One recorder per test case, shared by every runner and every tier.
 *
 * A test states what it observed; the recorder collects it; the grading
 * function decides the verdict. Tests never write a status themselves, which is
 * what keeps the precedence rule in one place instead of being re-derived,
 * slightly differently, per runner or per tier.
 *
 * `sourceError` is the slot that makes an outage different from a defect. When
 * a tier cannot reach what it measures -- an RPC endpoint, a venue API, a page,
 * a database file -- the step layer sets it, and every later assertion becomes
 * unobservable rather than failing. A node being down is not a protocol being
 * broken; it has said nothing about the protocol at all.
 */

let catalogueCache = null;

/** The domain's case catalogue, loaded once per process from fixtures/. */
function catalogue() {
  if (!catalogueCache) {
    const file = paths.testcasesFile();
    if (!fs.existsSync(file)) {
      throw new Error('no case catalogue at ' + file + ' -- set QA_DOMAIN_ROOT or run from the domain\'s node/ folder.');
    }
    catalogueCache = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return catalogueCache;
}

/**
 * Reduce an assertion error to the part a reader can act on. A raw matcher
 * message leads with its signature and buries the actual numbers; the
 * Expected/Received pair is what a report needs.
 */
function summariseError(message) {
  const clean = String(message || '').replace(/\x1b\[[0-9;]*m/g, '');
  const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean);
  const expected = lines.find((l) => /^Expected/i.test(l));
  const received = lines.find((l) => /^Received/i.test(l));
  if (expected && received) return expected + ', ' + received.toLowerCase();
  const useful = lines.filter((l) => !/^expect\(/.test(l));
  return (useful.length ? useful : lines).slice(0, 2).join(' ');
}

class Recorder {
  constructor(via) {
    this.via = via;
    this.caseId = null;
    this.meta = null;
    this.assertions = [];
    this.evidenceData = {};
    this.startedAt = Date.now();
    this.sourceError = null;
  }

  /** Bind to a catalogued case. Unknown IDs fail loudly: IDs are allocated in fixtures, never invented. */
  bindCase(id) {
    const meta = catalogue().cases[String(id)];
    if (!meta) {
      throw new Error(
        'case ' + id + ' is not in fixtures/testcases.json. ' +
        'IDs are immutable and allocated there, never invented in a test.'
      );
    }
    this.caseId = String(id);
    this.meta = meta;
    return meta;
  }

  nextId() {
    return 'a' + (this.assertions.length + 1);
  }

  /** Record one OBSERVED assertion. Never throws -- the verdict comes later. */
  check(description, passed, detail) {
    this.assertions.push({
      id: this.nextId(),
      description,
      outcome: passed ? OUTCOME.PASS : OUTCOME.FAIL,
      detail: passed ? '' : (detail || 'no detail recorded'),
    });
  }

  /** Run a throwing assertion (expect-style) and record its outcome. */
  async assert(description, fn) {
    try {
      await fn();
      this.check(description, true);
    } catch (err) {
      this.check(description, false, summariseError(err.message));
    }
  }

  /** Record an assertion the environment cannot show either way. */
  unobservable(description, why) {
    if (!why) throw new Error('unobservable(' + description + ') needs a reason; "unknown" is not one.');
    this.assertions.push({
      id: this.nextId(),
      description,
      outcome: OUTCOME.UNOBSERVABLE,
      detail: why,
    });
  }

  /**
   * Record an assertion, unless the source never answered. The one rule every
   * tier shares: a transport failure is unobservable, not a failure.
   */
  observe(description, evaluate) {
    if (this.sourceError) {
      this.unobservable(description, 'the source could not be reached -- ' + this.sourceError);
      return;
    }
    const { passed, detail } = evaluate();
    this.check(description, passed, detail);
  }

  /**
   * Run a fetch and route a named "unreachable" error into sourceError. Any
   * other error is a fault in this project and is rethrown -- dressing it up as
   * Blocked would hide it behind an environmental excuse.
   */
  async fetchOrBlock(unreachableClasses, fetchFn) {
    try {
      await fetchFn();
    } catch (err) {
      if (unreachableClasses.some((Cls) => err instanceof Cls)) {
        this.sourceError = err.message;
        return;
      }
      throw err;
    }
  }

  evidence(key, value) {
    this.evidenceData[key] = value;
  }

  verdict() {
    const graded = grade({ id: this.caseId, assertions: this.assertions });
    const problems = validateRecord(graded);
    if (problems.length) {
      throw new Error('grading produced a malformed record: ' + problems.join(' '));
    }
    return graded;
  }

  /** Grade once, write once. Returns the graded record so the runner can echo it. */
  file() {
    if (!this.caseId) {
      throw new Error('this test never bound a case ID, so its result cannot be filed.');
    }
    const graded = this.verdict();
    record({
      caseId: this.caseId,
      module: this.meta.module,
      layer: this.meta.layer,
      title: this.meta.title,
      priority: this.meta.priority,
      status: graded.status,
      reason: graded.reason,
      note: graded.note,
      counts: graded.counts,
      assertions: graded.assertions,
      evidence: this.evidenceData,
      durationMs: Date.now() - this.startedAt,
      via: this.via,
    });
    return graded;
  }
}

/** Float-safe multiple test: compare in whole steps rather than in currency. */
function isMultipleOf(value, step) {
  if (!step) return false;
  const steps = value / step;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}

/** Relative difference between two numbers, as a fraction of the reference. */
function relativeGap(observed, reference) {
  if (!reference) return Infinity;
  return Math.abs(observed - reference) / Math.abs(reference);
}

module.exports = { Recorder, catalogue, summariseError, isMultipleOf, relativeGap };

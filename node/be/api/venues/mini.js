'use strict';

/**
 * HTTP client for mini-api (services/mini-api), the REST layer over the
 * indexer's store. Node's built-in fetch; no library.
 *
 * A response is returned whole -- status, lower-cased headers, parsed body --
 * so a step can assert on any of them. Only a transport failure is
 * ApiUnreachable (grades Blocked); a 4xx/5xx is an answer, and often the
 * answer under test.
 *
 * The service rate-limits per client address (60 per 10 s by default). One
 * scenario measures that on purpose; every other scenario must not trip it by
 * accident, so the client watches X-RateLimit-Remaining and, when the budget
 * is nearly spent, waits for the window to pass before the next request.
 * That is a measurement control, not a retry: no response is ever discarded.
 */

const BASE = (process.env.MINI_API_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const ADMIN_TOKEN = process.env.MINI_API_ADMIN_TOKEN || 'local-admin-token';
const WINDOW_MS = Number(process.env.MINI_API_RATE_WINDOW_MS || 10_000);

class ApiUnreachable extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class MiniApi {
  constructor(base = BASE) {
    this.base = base;
    this.remaining = null; // last X-RateLimit-Remaining seen
  }

  /** @returns {Promise<{status:number, headers:Object, body:any, text:string}>} */
  async request(method, path, { token, origin, body, headers = {}, throttle = true } = {}) {
    if (throttle && this.remaining !== null && this.remaining <= 3) {
      await sleep(WINDOW_MS + 200);
      this.remaining = null;
    }
    const h = { ...headers };
    if (token) h.authorization = 'Bearer ' + token;
    if (origin !== undefined) h.origin = origin;
    let init = { method, headers: h };
    if (body !== undefined) { h['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    let res;
    try {
      res = await fetch(this.base + path, init);
    } catch (err) {
      throw new ApiUnreachable('mini-api at ' + this.base + ' did not answer ' + method + ' ' + path + ': ' + (err.cause && err.cause.message ? err.cause.message : err.message));
    }
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    const out = { status: res.status, headers: Object.fromEntries([...res.headers.entries()].map(([k, v]) => [k.toLowerCase(), v])), body: parsed, text };
    const rem = out.headers['x-ratelimit-remaining'];
    if (rem !== undefined) this.remaining = Number(rem);
    return out;
  }

  get(path, opts) { return this.request('GET', path, opts); }
  post(path, body, opts = {}) { return this.request('POST', path, { ...opts, body }); }

  /** Admin lever: freeze or resume the indexer. */
  async setIndexerPaused(paused) {
    const r = await this.post('/admin/indexer', { paused }, { token: ADMIN_TOKEN });
    if (r.status !== 200) throw new Error('could not set indexer paused=' + paused + ': HTTP ' + r.status + ' ' + r.text);
    return r;
  }

  /** Admin lever: forget everything after `block` so the next sync replays the range. */
  async rewindIndexer(block) {
    const r = await this.post('/admin/indexer', { rewind: block }, { token: ADMIN_TOKEN });
    if (r.status !== 200) throw new Error('could not rewind indexer to ' + block + ': HTTP ' + r.status + ' ' + r.text);
    return r;
  }

  /** Mint a scoped token with the admin token. */
  async mintToken(scope, subject = null, ttl = null) {
    const body = { scope };
    if (subject) body.subject = subject;
    if (ttl) body.ttl = ttl;
    const r = await this.post('/auth/token', body, { token: ADMIN_TOKEN });
    if (r.status !== 201) throw new Error('could not mint a ' + scope + ' token: HTTP ' + r.status + ' ' + r.text);
    return r.body.token;
  }
}

module.exports = { MiniApi, ApiUnreachable, BASE, ADMIN_TOKEN, WINDOW_MS, sleep };

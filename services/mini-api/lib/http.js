'use strict';

const crypto = require('crypto');

/**
 * The cross-cutting behaviours of the REST layer: auth, CORS, rate limiting,
 * pagination, and one error shape. Each is a small function that a route
 * calls explicitly, so what a route does is visible at the route.
 */

// ---------------------------------------------------------------- errors

class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** Every error body has the same shape: { error, code } plus route-specific extras. */
function errorBody(err) {
  return { error: err.message, code: err.code, ...err.extra };
}

// ---------------------------------------------------------------- CORS

/**
 * Exact-match allowlist. No wildcard, no suffix matching, no echo. A request
 * with no Origin header is not a cross-origin request and gets no CORS
 * headers at all -- that is the standard, and it is also the case people
 * misread as "CORS is not configured".
 */
function cors(allowed) {
  const set = new Set(allowed.map((o) => o.toLowerCase()));
  return (req, res) => {
    const origin = req.headers.origin;
    res.setHeader('Vary', 'Origin');
    if (!origin) return;
    if (!set.has(origin.toLowerCase())) return; // no header = browser blocks it
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  };
}

// ---------------------------------------------------------------- auth

/**
 * Bearer tokens looked up in api_keys. Scopes are ordered: admin > portfolio > read.
 * Missing or unknown token: 401. Known token below the required scope: 403.
 * A token bound to a subject may only read that subject's private data.
 */
const RANK = { read: 1, portfolio: 2, admin: 3 };

function authenticate(db, req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  if (!m) throw new ApiError(401, 'unauthenticated', 'a Bearer token is required');
  const row = db.prepare('SELECT token, scope, subject, expires_at FROM api_keys WHERE token = ?').get(m[1]);
  if (!row) throw new ApiError(401, 'unauthenticated', 'unknown token');
  if (row.expires_at !== null && row.expires_at < Math.floor(Date.now() / 1000)) throw new ApiError(401, 'token_expired', 'token has expired');
  return row;
}

function requireScope(key, scope) {
  if (RANK[key.scope] < RANK[scope]) throw new ApiError(403, 'forbidden', `this token has scope "${key.scope}", "${scope}" is required`);
}

function issueToken(db, scope, subject, ttlSeconds) {
  const token = 'k_' + crypto.randomBytes(18).toString('base64url');
  const exp = ttlSeconds ? Math.floor(Date.now() / 1000) + ttlSeconds : null;
  db.prepare('INSERT INTO api_keys (token, scope, subject, expires_at) VALUES (?, ?, ?, ?)').run(token, scope, subject ? subject.toLowerCase() : null, exp);
  return { token, scope, subject, expires_at: exp };
}

// ---------------------------------------------------------------- rate limit

/** Fixed window per client: `limit` requests per `windowMs`. Over the limit: 429 + Retry-After. */
function rateLimiter({ limit, windowMs }) {
  const buckets = new Map();
  return (clientKey) => {
    const now = Date.now();
    let b = buckets.get(clientKey);
    if (!b || now - b.start >= windowMs) { b = { start: now, count: 0 }; buckets.set(clientKey, b); }
    b.count += 1;
    const remaining = Math.max(0, limit - b.count);
    const resetIn = Math.ceil((b.start + windowMs - now) / 1000);
    if (b.count > limit) throw new ApiError(429, 'rate_limited', 'too many requests', { retry_after: resetIn });
    return { remaining, resetIn };
  };
}

// ---------------------------------------------------------------- pagination

/**
 * Keyset pagination over (block_number, log_index). `cursor` is opaque to the
 * client: base64 of "block:log". `total` is the count of the whole filtered
 * set, not of the page.
 */
function pageParams(query, { defaultLimit = 50, maxLimit = 100 } = {}) {
  let limit = query.limit === undefined ? defaultLimit : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1) throw new ApiError(400, 'bad_request', 'limit must be a positive integer');
  if (limit > maxLimit) limit = maxLimit;
  let after = null;
  if (query.cursor !== undefined) {
    const raw = Buffer.from(String(query.cursor), 'base64url').toString('utf8');
    const m = /^(\d+):(\d+)$/.exec(raw);
    if (!m) throw new ApiError(400, 'bad_request', 'cursor is malformed');
    after = { block: Number(m[1]), log: Number(m[2]) };
  }
  return { limit, after };
}

function cursorOf(row) {
  return Buffer.from(`${row.block_number}:${row.log_index}`, 'utf8').toString('base64url');
}

module.exports = { ApiError, errorBody, cors, authenticate, requireScope, issueToken, rateLimiter, pageParams, cursorOf, RANK };

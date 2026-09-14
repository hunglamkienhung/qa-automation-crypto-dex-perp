'use strict';

const { When, Then } = require('@cucumber/cucumber');
const { ApiUnreachable } = require('../venues/mini');
const { DbUnreachable } = require('../../db/store');
const { ChainUnreachable } = require('../../contract/chain/perpdex');

/**
 * Steps for features/be-mini-security.feature -- the authentication edges the
 * main mini-api feature does not cover: a non-Bearer Authorization header, and
 * the secret-hygiene invariant that no bearer token echoes back in a public
 * read. The store, the client (this.mini) and the Background are shared from
 * the @mini steps.
 */

const UNREACHABLE = [ApiUnreachable, DbUnreachable, ChainUnreachable];

async function send(world, method, path, opts = {}) {
  if (world.sourceError) return;
  try { world.api = await world.mini.request(method, path, opts); } catch (err) {
    if (err instanceof ApiUnreachable) { world.sourceError = err.message; return; }
    throw err;
  }
}
async function check(world, description, fn) {
  if (world.sourceError) { world.unobservable(description, 'the source could not be reached -- ' + world.sourceError); return; }
  let r;
  try { r = await fn(); } catch (err) { if (UNREACHABLE.some((C) => err instanceof C)) { world.unobservable(description, err.message); return; } throw err; }
  world.check(description, r.passed, r.detail);
}

When(/^GET \/portfolio\/summary with a non-Bearer authorization header$/, { timeout: 30_000 }, async function () {
  await send(this, 'GET', '/portfolio/summary', { headers: { authorization: 'Token k_whatever' } });
});
Then('the response body carries no bearer token', async function () {
  // A minted token is a JSON string value "k_<...>"; matching the quoted value
  // (not the bare substring "k_") avoids false positives on field names like
  // "last_block_hash".
  await check(this, 'no bearer token in body', () => { const text = JSON.stringify((this.api && this.api.body) || {}); const leaked = /"k_[A-Za-z0-9_-]{8,}"/.test(text); return { passed: !leaked, detail: leaked ? 'TOKEN LEAKED' : 'clean' }; });
});

'use strict';

/**
 * Optional bug tracker: GitHub Issues.
 *
 * Same seam as the local adapter -- upsert(problem) -> { action, issue }.
 *
 * The signature is carried in a hidden HTML comment in the issue body rather
 * than in the title or a label:
 *
 *     <!-- qa-signature: 7f3c1a20b9de -->
 *
 * Titles get edited by people, and labels get renamed and bulk-removed. A
 * marker in the body survives both, and search can still find it. Losing the
 * signature is not a cosmetic problem: the next run stops recognising the issue
 * and files a duplicate, which is exactly the failure this design prevents.
 */

const name = 'github';

const SIGNATURE_PREFIX = 'qa-signature:';

function requireEnv(key) {
  const v = process.env[key];
  if (!v) {
    throw new Error(
      key + ' is not set. Copy .env.example to .env and fill it in, ' +
      'or leave BUGTRACKER unset to use the local file tracker.'
    );
  }
  return v;
}

function embedSignature(body, signature) {
  return body + '\n\n<!-- ' + SIGNATURE_PREFIX + ' ' + signature + ' -->';
}

function extractSignature(body) {
  const m = String(body || '').match(/<!--\s*qa-signature:\s*([0-9a-f]+)\s*-->/i);
  return m ? m[1] : null;
}

/** The search query used to find an existing issue for a signature. */
function searchQuery(repo, signature) {
  return 'repo:' + repo + ' in:body "' + SIGNATURE_PREFIX + ' ' + signature + '"';
}

function renderBody(problem) {
  const body = [
    problem.detail,
    '',
    '**Module:** ' + problem.module,
    '**Severity:** ' + problem.severity,
    '**Related cases:** ' + problem.caseId,
    '',
    '_Filed automatically from the test queue. The marker below is how re-runs',
    'recognise this issue instead of opening a duplicate; please keep it._',
  ].join('\n');

  return embedSignature(body, problem.signature);
}

async function upsert(problem) {
  const repo = requireEnv('GITHUB_REPO');
  requireEnv('GITHUB_TOKEN');

  // Not wired, for the same reason as the Sheets adapter: the default path of
  // this repository must run with zero credentials. The parts worth reviewing
  // -- signature embedding, extraction, and the search that makes the upsert
  // idempotent -- are above and are unit tested.
  throw new Error(
    'The GitHub adapter is a documented seam, not a wired integration.\n' +
    'It would search ' + repo + ' with: ' + searchQuery(repo, problem.signature) + '\n' +
    'then attach case ' + problem.caseId + ' to the match, or open a new issue titled: ' +
    problem.title + '\n' +
    'Run without BUGTRACKER set to use the local file tracker.'
  );
}

module.exports = {
  name, upsert, embedSignature, extractSignature, searchQuery, renderBody, SIGNATURE_PREFIX,
};

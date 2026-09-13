'use strict';

// BE first: it needs no browser, so its failures are never masked by a missing
// Chromium. Then FE. Then report, gate, bug flow -- in the shared core.
require('@portfolio/core/pipeline').run([
  { label: 'BE -- contract, db, api, bot (no browser)', runner: 'cucumber', args: ['--tags', '@be'] },
  { label: 'FE -- trading screen (browser)', runner: 'cucumber', args: ['--tags', '@fe'] },
  { label: 'FE -- Playwright Test specs (browser)', runner: 'playwright', args: ['test'] },
]);

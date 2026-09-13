'use strict';

/**
 * Wire the shared Cucumber harness to this domain.
 *
 * The World is the core Recorder plus the slots this domain's Givens fill:
 * measured data from the chain, the venue API, the screen, the database.
 */
require('@portfolio/core/harness/cucumber').install({
  browserTag: '@fe',
  viewport: { width: 1600, height: 1000 },
  extendWorld(world) {
    world.chain = null;        // on-chain market state (GMX or PerpDEX)
    world.chainConfig = null;  // on-chain protocol parameters
    world.funding = null;      // on-chain funding state
    world.book = null;         // an order book, wherever it came from
    world.api = null;          // a venue / mini-api response
    world.db = null;           // rows read straight from SQLite
    world.screen = {};         // values read off the trading page
  },
});

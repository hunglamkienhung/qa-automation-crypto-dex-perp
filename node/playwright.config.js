'use strict';

const { defineConfig } = require('@playwright/test');

/**
 * Playwright Test is the SECOND entry into the FE branch: fe/ui/specs/ holds
 * plain specs for readers who look for the word "Playwright"; fe/ui/steps/
 * holds the Cucumber steps for the same feature files. Both feed one recorder,
 * one queue, one report.
 */
module.exports = defineConfig({
  testDir: './fe/ui/specs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    viewport: { width: 1600, height: 1000 },
    trace: 'retain-on-failure',
  },
});

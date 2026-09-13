'use strict';

const { Then } = require('@cucumber/cucumber');

/**
 * How Gherkin says Blocked, shared by all three tiers.
 *
 * Defined once, here, because Cucumber step definitions are global: declaring
 * the same phrasing in two step files is an ambiguous-step error, not an
 * override.
 *
 * Without this step an author facing something the environment cannot show has
 * two bad options -- assert it anyway, which is a false failure, or delete the
 * line, which is a false pass that nothing records. Naming the gap keeps it in
 * the report, and the reason says what would close it.
 */
Then('{string} cannot be verified because {string}', function (claim, reason) {
  this.unobservable(claim, reason);
});

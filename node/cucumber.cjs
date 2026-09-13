// The feature files live at the domain root and are shared with ../python.
// Only the step definitions are specific to this stack.
//
// Steps are split by branch: be/**/steps never require Playwright, so
// `cucumber-js --tags @be` runs on a machine with no browser installed.
module.exports = {
  default: {
    paths: ['../features/**/*.feature'],
    require: ['support/**/*.js', 'be/**/steps/**/*.js', 'fe/**/steps/**/*.js'],
    format: ['progress', 'summary'],
    formatOptions: { snippetInterface: 'async-await' },
    // A retry converts an intermittent defect into a green tick and hides it
    // from the bug flow. If a test is flaky that is a finding.
    retry: 0,
    parallel: 0,
  },
};

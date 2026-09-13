'use strict';

/**
 * @portfolio/core -- the part of the harness that knows nothing about any
 * domain. Domains depend on this; this depends on no domain.
 */
module.exports = {
  grading: require('./grading/grade'),
  queue: { ...require('./queue/writer'), ...require('./queue/reader') },
  diff: require('./lib/diff'),
  fsx: require('./lib/fsx'),
  paths: require('./paths'),
  recorder: require('./harness/recorder'),
};

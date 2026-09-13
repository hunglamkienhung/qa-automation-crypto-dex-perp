'use strict';

const paths = require('./paths');

/**
 * Load a runner package (Cucumber, Playwright) from the DOMAIN that is
 * running, not from the core's own folder.
 *
 * The core is linked into each domain with `file:`, which npm installs as a
 * symlink. Node resolves `require` from a module's real path, so a plain
 * `require('@cucumber/cucumber')` inside the core would look in core/node/
 * node_modules -- which does not exist, on purpose: runners are the domain's
 * dependency. Worse, even if it did exist it would be a SECOND copy of
 * Cucumber, and `setWorldConstructor` registered on one copy is invisible to
 * the CLI running the other.
 *
 * Resolving from the working directory returns the exact instance the
 * domain's CLI loaded.
 */
function peer(name) {
  const from = paths.workdir();
  let resolved;
  try {
    resolved = require.resolve(name, { paths: [from] });
  } catch (err) {
    throw new Error(
      'cannot find "' + name + '" from ' + from + '. It is a devDependency of the ' +
      'domain, not of the core -- run npm install in the domain\'s node/ folder.'
    );
  }
  return require(resolved);
}

module.exports = { peer };

'use strict';

// Plain-JS server entry: a local plugin without the Plugin SDK is not
// transpiled, so the server half is CommonJS JavaScript. It holds no business
// logic: every handler calls the compiled app code that src/index.ts exposes
// as `strapi.kanjo` at register time.
module.exports = require('./server');

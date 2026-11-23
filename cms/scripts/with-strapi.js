/**
 * Loads the compiled Strapi app WITHOUT its HTTP server, runs `fn(strapi)`,
 * and shuts down. Used by the seed scripts and the tests.
 *
 *   KANJO_SKIP_COMPILE=true   use the existing dist/ (faster; the tests compile once)
 */
const path = require('node:path');
const { createStrapi, compileStrapi } = require('@strapi/strapi');

async function withStrapi(fn, { quiet = true } = {}) {
  const appDir = path.resolve(__dirname, '..');
  const ctx =
    process.env.KANJO_SKIP_COMPILE === 'true'
      ? { appDir, distDir: path.join(appDir, 'dist') }
      : await compileStrapi({ appDir });
  const app = await createStrapi(ctx).load();
  if (quiet) app.log.level = 'error';
  try {
    return await fn(app);
  } finally {
    await app.destroy();
  }
}

module.exports = { withStrapi };

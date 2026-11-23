/**
 * Loads (or with --remove, deletes) the DEVELOPMENT SAMPLE catalogue.
 * See src/seed/samples.ts. Refuses to run with NODE_ENV=production.
 *
 *   npm run seed:samples
 *   npm run seed:samples -- --remove
 */
const { withStrapi } = require('./with-strapi');

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to load sample products into a production process.');
  process.exit(1);
}

withStrapi(async (strapi) => {
  const samples = require('../dist/src/seed/samples');
  if (process.argv.includes('--remove')) {
    console.log(`removed ${await samples.removeSamples(strapi)} sample product(s)`);
  } else {
    console.log(`created ${await samples.seedSamples(strapi)} sample product(s) (isSample=true)`);
    console.log('Serve them with KANJO_ALLOW_SAMPLE_CATALOG=true. They are never indexed or sellable.');
  }
})
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

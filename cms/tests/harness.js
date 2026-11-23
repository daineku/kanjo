/**
 * Test harness: a REAL Strapi instance, with its HTTP server, on a throwaway
 * SQLite database, with the MOCK payment provider.
 *
 * Everything below talks to the same code production runs — the Document
 * Service guards, the raw-SQL stock counters, the storefront routes and the
 * webhook signature check. The only substitution is the payment provider,
 * which is the mock (src/commerce/payments/mock.ts): these tests prove the
 * order/stock/refund logic, NOT that Stripe's API accepts our requests.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createStrapi } = require('@strapi/strapi');

const appDir = path.resolve(__dirname, '..');
const TOKEN = 'test-storefront-token-0123456789abcdef0123';
const WEBHOOK_SECRET = 'test-mock-webhook-secret';

async function startStrapi(name) {
  const db = path.join(appDir, '.tmp', `test-${name}-${process.pid}.db`);
  fs.mkdirSync(path.dirname(db), { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(db + suffix, { force: true });

  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_CLIENT: 'sqlite',
    DATABASE_FILENAME: path.relative(appDir, db),
    HOST: '127.0.0.1',
    PORT: '0',
    APP_KEYS: 'testKeyA,testKeyB',
    API_TOKEN_SALT: 'test-salt',
    ADMIN_JWT_SECRET: 'test-admin-secret',
    TRANSFER_TOKEN_SALT: 'test-transfer-salt',
    JWT_SECRET: 'test-jwt-secret',
    ENCRYPTION_KEY: 'test-encryption-key',
    PAYMENT_PROVIDER: 'mock',
    MOCK_PAYMENT_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STOREFRONT_API_TOKEN: TOKEN,
    STOREFRONT_ORIGIN: 'http://localhost:3000',
    CRON_ENABLED: 'false',
    KANJO_ALLOW_SAMPLE_CATALOG: 'false',
  });

  const strapi = await createStrapi({ appDir, distDir: path.join(appDir, 'dist') }).load();
  strapi.log.level = 'error';
  await strapi.listen();
  const { port } = strapi.server.httpServer.address();
  const base = `http://127.0.0.1:${port}/api/storefront`;

  const api = async (method, route, body, headers = {}) => {
    const response = await fetch(base + route, {
      method,
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', 'x-kanjo-client-ip': `10.0.0.${Math.floor(Math.random() * 250)}`, ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: response.status, body: json };
  };

  const stop = async () => {
    await strapi.destroy();
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(db + suffix, { force: true });
  };

  return { strapi, api, base, stop, TOKEN, WEBHOOK_SECRET };
}

const lib = (name) => require(path.join(appDir, 'dist', 'src', ...name.split('/')));

/** Runs `fn` as if it were a Content Manager request by `email` — i.e. through the admin guards. */
function asAdmin(strapi, fn, email = 'owner@example.test') {
  const ctx = { request: { url: '/content-manager/collection-types/x' }, state: { user: { email } } };
  return strapi.requestContext.run(ctx, fn);
}

module.exports = { startStrapi, lib, asAdmin };

'use strict';

/**
 * TikTok Shop module tests. Pure functions and the HTTP client against a
 * MOCKED fetch — no network, no seller account. Run after `npx tsc -p
 * tsconfig.json` (requires compiled output in dist/).
 *
 * These prove the code does what it claims; they do NOT prove TikTok accepts
 * it. That needs a sandbox shop (see the eligibility checklist).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac, randomBytes } = require('node:crypto');

const dist = (p) => require(`../dist/src/tiktok/${p}`);
const { buildSignBase, signRequest, verifyWebhookSignature, computeWebhookSignature } = dist('sign');
const { encryptSecret, decryptSecret } = dist('crypto');
const { readTikTokConfig, tikTokConfigProblems } = dist('config');
const { createAuthState, verifyAuthState, buildAuthorizeUrl } = dist('oauth');
const { TikTokClient, TikTokApiError } = dist('client');
const mapper = dist('mapper');
const { backoffDelayMs } = dist('jobs');
const { exportRowsFor } = dist('export');

const KEY = randomBytes(32);
const CONFIG = {
  appKey: 'test-app-key',
  appSecret: 'test-app-secret',
  encryptionKey: KEY,
  serviceId: '1234',
  apiBaseUrl: 'https://api.test',
  authBaseUrl: 'https://auth.test',
  authorizeBaseUrl: 'https://services.test',
};

// ── Signing ────────────────────────────────────────────────────────────────

test('sign base: path + sorted params, excluding sign and access_token, + body', () => {
  const base = buildSignBase({
    path: '/product/202309/products',
    query: { timestamp: 1700000000, app_key: 'k', sign: 'x', access_token: 'y', shop_cipher: 'C' },
    body: '{"a":1}',
  });
  assert.equal(base, '/product/202309/productsapp_keykshop_cipherCtimestamp1700000000{"a":1}');
});

test('signature is HMAC-SHA256(secret, secret + base + secret), lowercase hex', () => {
  // Independent computation of the expected vector.
  const secret = 'test-app-secret';
  const message = `${secret}/authorization/202309/shopsapp_keytest-app-keytimestamp1700000000${secret}`;
  const expected = createHmac('sha256', secret).update(message).digest('hex');
  const actual = signRequest({
    path: '/authorization/202309/shops',
    query: { app_key: 'test-app-key', timestamp: 1700000000 },
    appSecret: secret,
  });
  assert.equal(actual, expected);
  assert.match(actual, /^[0-9a-f]{64}$/);
});

test('undefined query values are not signed', () => {
  assert.equal(buildSignBase({ path: '/p', query: { a: '1', b: undefined } }), '/pa1');
});

test('webhook signature: HMAC(secret, app_key + raw body), constant-time compare', () => {
  const raw = '{"type":1,"tts_notification_id":"n1","data":{"order_id":"o1"}}';
  const header = createHmac('sha256', 's').update(`k${raw}`).digest('hex');
  assert.equal(computeWebhookSignature('k', 's', raw), header);
  assert.equal(verifyWebhookSignature('k', 's', raw, header), true);
  assert.equal(verifyWebhookSignature('k', 's', raw, header.toUpperCase()), true);
  assert.equal(verifyWebhookSignature('k', 's', `${raw} `, header), false, 'body tampering');
  assert.equal(verifyWebhookSignature('k', 'other', raw, header), false, 'wrong secret');
  assert.equal(verifyWebhookSignature('k', 's', raw, undefined), false);
  assert.equal(verifyWebhookSignature('k', 's', raw, 'short'), false);
});

// ── Token encryption ───────────────────────────────────────────────────────

test('tokens round-trip through AES-256-GCM and never appear in the ciphertext', () => {
  const token = 'ROW_access_token_value_123';
  const sealed = encryptSecret(token, KEY);
  assert.ok(sealed.startsWith('v1.'));
  assert.ok(!sealed.includes(token));
  assert.notEqual(encryptSecret(token, KEY), sealed, 'fresh IV each time');
  assert.equal(decryptSecret(sealed, KEY), token);
});

test('a tampered ciphertext or a different key fails to decrypt', () => {
  const sealed = encryptSecret('secret', KEY);
  const parts = sealed.split('.');
  const flipped = Buffer.from(parts[3], 'base64url');
  flipped[0] ^= 1;
  parts[3] = flipped.toString('base64url');
  assert.throws(() => decryptSecret(parts.join('.'), KEY));
  assert.throws(() => decryptSecret(sealed, randomBytes(32)));
  assert.throws(() => encryptSecret('x', randomBytes(16)));
});

// ── Configuration: inert without credentials ───────────────────────────────

test('config is null unless all three variables are present and the key is 32 bytes', () => {
  const key = randomBytes(32).toString('base64');
  assert.equal(readTikTokConfig({}), null);
  assert.equal(readTikTokConfig({ TIKTOK_SHOP_APP_KEY: 'a', TIKTOK_SHOP_APP_SECRET: 'b' }), null);
  assert.equal(
    readTikTokConfig({ TIKTOK_SHOP_APP_KEY: 'a', TIKTOK_SHOP_APP_SECRET: 'b', TIKTOK_TOKEN_ENCRYPTION_KEY: randomBytes(16).toString('base64') }),
    null,
  );
  const config = readTikTokConfig({ TIKTOK_SHOP_APP_KEY: 'a', TIKTOK_SHOP_APP_SECRET: 'b', TIKTOK_TOKEN_ENCRYPTION_KEY: key });
  assert.equal(config.appKey, 'a');
  assert.equal(config.apiBaseUrl, 'https://open-api.tiktokglobalshop.com');
  const problems = tikTokConfigProblems({ TIKTOK_TOKEN_ENCRYPTION_KEY: 'short' });
  assert.ok(problems.some((p) => p.includes('32 bytes')));
  assert.ok(problems.every((p) => !p.includes('short')), 'never echoes a value');
});

// ── OAuth state ────────────────────────────────────────────────────────────

test('auth state is signed, expires after 30 minutes and rejects forgeries', () => {
  const now = Date.UTC(2026, 10, 23, 12);
  const state = createAuthState(CONFIG, now);
  assert.equal(verifyAuthState(CONFIG, state, now + 60_000), true);
  assert.equal(verifyAuthState(CONFIG, state, now + 31 * 60_000), false, 'expired');
  assert.equal(verifyAuthState(CONFIG, state, now - 1000), false, 'from the future');
  assert.equal(verifyAuthState({ ...CONFIG, appSecret: 'other' }, state, now), false, 'other secret');
  const [issued, nonce] = state.split('.');
  assert.equal(verifyAuthState(CONFIG, `${issued}.${nonce}.forged`, now), false);
  assert.equal(verifyAuthState(CONFIG, undefined, now), false);
  const url = buildAuthorizeUrl(CONFIG, state);
  assert.ok(url.startsWith('https://services.test/open/authorize?service_id=1234&state='));
  assert.equal(buildAuthorizeUrl({ ...CONFIG, serviceId: undefined }, state), null);
});

// ── Client against a mocked fetch ──────────────────────────────────────────

function mockFetch(responses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    const { status = 200, body = {}, headers = {} } = next;
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (name) => headers[name.toLowerCase()] ?? null },
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  };
  return { fetch, calls };
}

test('client signs requests, sends the token header and shop_cipher, and unwraps data', async () => {
  const { fetch, calls } = mockFetch([{ body: { code: 0, data: { shops: [{ id: '7', name: 'Kanjo TH', region: 'TH', seller_type: 'LOCAL', cipher: 'CIPH' }] } } }]);
  const client = new TikTokClient({ config: CONFIG, fetch, accessToken: 'AT', shopCipher: 'CIPH', now: () => 1700000000000 });
  const shops = await client.getAuthorizedShops();
  assert.deepEqual(shops, [{ id: '7', name: 'Kanjo TH', region: 'TH', sellerType: 'LOCAL', cipher: 'CIPH' }]);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/authorization/202309/shops');
  assert.equal(url.searchParams.get('shop_cipher'), null, 'get shops is not shop-scoped');
  assert.equal(calls[0].init.headers['x-tts-access-token'], 'AT');
  const expected = signRequest({ path: url.pathname, query: { app_key: 'test-app-key', timestamp: 1700000000 }, appSecret: CONFIG.appSecret });
  assert.equal(url.searchParams.get('sign'), expected);
});

test('client signs the exact JSON body it sends', async () => {
  const { fetch, calls } = mockFetch([{ body: { code: 0, data: {} } }]);
  const client = new TikTokClient({ config: CONFIG, fetch, accessToken: 'AT', shopCipher: 'C', now: () => 1700000000000 });
  await client.setProductsActive(['p1'], false);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/product/202309/products/deactivate');
  const query = Object.fromEntries([...url.searchParams.entries()].filter(([k]) => k !== 'sign'));
  assert.equal(url.searchParams.get('sign'), signRequest({ path: url.pathname, query, body: calls[0].init.body, appSecret: CONFIG.appSecret }));
  assert.equal(calls[0].init.body, '{"product_ids":["p1"]}');
});

test('429 and business code 36009002 are rate-limit errors with Retry-After', async () => {
  const { fetch } = mockFetch([
    { status: 429, headers: { 'retry-after': '7' }, body: {} },
    { status: 200, body: { code: 36009002, message: 'too many requests' } },
  ]);
  const client = new TikTokClient({ config: CONFIG, fetch, accessToken: 'AT' });
  await assert.rejects(client.getWarehouses(), (e) => e instanceof TikTokApiError && e.rateLimited && e.retryAfterMs === 7000 && e.retryable);
  await assert.rejects(client.getWarehouses(), (e) => e.rateLimited && e.code === 36009002);
});

test('business errors are not retryable; 5xx and network errors are', async () => {
  const network = new Error('down');
  const { fetch } = mockFetch([{ body: { code: 12052048, message: 'invalid category' } }, { status: 503, body: 'gateway' }, network]);
  const client = new TikTokClient({ config: CONFIG, fetch, accessToken: 'AT' });
  await assert.rejects(client.getWarehouses(), (e) => !e.retryable && e.code === 12052048);
  await assert.rejects(client.getWarehouses(), (e) => e.retryable && e.status === 503);
  await assert.rejects(client.getWarehouses(), (e) => e.retryable && e.status === 0);
});

test('a hung request times out', async () => {
  const fetch = (_url, init) =>
    new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const client = new TikTokClient({ config: CONFIG, fetch, accessToken: 'AT', timeoutMs: 20 });
  await assert.rejects(client.getWarehouses(), /did not answer within 20ms/);
});

test('no access token means no request at all', async () => {
  const { fetch, calls } = mockFetch([]);
  await assert.rejects(new TikTokClient({ config: CONFIG, fetch }).getWarehouses(), /not authorized/);
  assert.equal(calls.length, 0);
});

test('token exchange uses grant_type=authorized_code and converts expiry timestamps', async () => {
  const { fetch, calls } = mockFetch([{ body: { code: 0, data: { access_token: 'A', refresh_token: 'R', access_token_expire_in: 1700600000, refresh_token_expire_in: 1731000000 } } }]);
  const tokens = await new TikTokClient({ config: CONFIG, fetch }).exchangeAuthCode('CODE');
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, 'https://auth.test/api/v2/token/get');
  assert.equal(url.searchParams.get('grant_type'), 'authorized_code');
  assert.equal(url.searchParams.get('auth_code'), 'CODE');
  assert.equal(tokens.accessToken, 'A');
  assert.equal(tokens.accessTokenExpiresAt, new Date(1700600000 * 1000).toISOString());
});

// ── Mapping ────────────────────────────────────────────────────────────────

const PRODUCT = {
  documentId: 'doc1',
  name: 'Civic EG carbon front lip',
  sku: 'KNJ-EG-LIP',
  description: 'Line one.\n\n**Bold** <script>x</script>',
  price: '4500',
  currency: 'THB',
  weightGrams: 2400,
  lengthMm: 1500,
  widthMm: 300,
  heightMm: 105,
  condition: 'new',
  authenticity: 'genuine_aftermarket',
  imageRights: 'own_photography',
  isSample: false,
  category: { tiktokCategoryId: '601234', name: 'Front Lips' },
  variants: [],
};
const CTX = { shopCurrency: 'THB', warehouseId: 'W1', imageUris: ['uri-1'], stockBySku: { 'KNJ-EG-LIP': 3 } };

test('a listable product maps to a create-product payload', () => {
  const result = mapper.toCreateProductPayload(PRODUCT, CTX);
  assert.equal(result.ok, true);
  const p = result.payload;
  assert.equal(p.category_id, '601234');
  assert.deepEqual(p.package_weight, { value: '2.400', unit: 'KILOGRAM' });
  assert.deepEqual(p.package_dimensions, { length: '150', width: '30', height: '11', unit: 'CENTIMETER' });
  assert.deepEqual(p.skus, [{ seller_sku: 'KNJ-EG-LIP', price: { amount: '4500.00', currency: 'THB' }, inventory: [{ warehouse_id: 'W1', quantity: 3 }] }]);
  assert.ok(!p.description.includes('<script>'), 'description is escaped');
});

test('variants become SKUs with sales attributes and their own prices', () => {
  const product = {
    ...PRODUCT,
    variants: [
      { sku: 'KNJ-EG-LIP-GL', label: 'Gloss', finish: 'Gloss', price: '4800' },
      { sku: 'KNJ-EG-LIP-MT', label: 'Matte', finish: 'Matte', price: null, discountPrice: null },
    ],
  };
  const result = mapper.toCreateProductPayload(product, { ...CTX, stockBySku: { 'KNJ-EG-LIP-GL': 1 } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.payload.skus.map((s) => [s.seller_sku, s.price.amount, s.inventory[0].quantity, s.sales_attributes[0].value_name]), [
    ['KNJ-EG-LIP-GL', '4800.00', 1, 'Gloss'],
    ['KNJ-EG-LIP-MT', '4500.00', 0, 'Matte'],
  ]);
});

test('prices are never converted: a USD product is refused for a THB shop unless an explicit TikTok price is set', () => {
  const usd = { ...PRODUCT, currency: 'USD', price: '129' };
  const refused = mapper.toCreateProductPayload(usd, CTX);
  assert.equal(refused.ok, false);
  assert.ok(refused.problems.some((p) => p.includes('never converted')));
  const overridden = mapper.toCreateProductPayload(usd, { ...CTX, overridesBySku: { 'KNJ-EG-LIP': { tiktokPrice: '4390', tiktokCurrency: 'THB' } } });
  assert.equal(overridden.ok, true);
  assert.equal(overridden.payload.skus[0].price.amount, '4390.00');
});

test('blockers: sample, missing category, uncleared images, unverified authenticity, used condition, no weight', () => {
  const blocked = mapper.listingBlockers({
    ...PRODUCT,
    isSample: true,
    category: { name: 'Front Lips' },
    imageRights: 'not_cleared',
    authenticity: 'unverified',
    condition: 'used_good',
    weightGrams: 0,
  });
  assert.equal(blocked.length, 6);
  assert.ok(blocked.some((b) => b.includes('prohibited on TikTok Shop US')));
});

test('a discount below the base price is listed; one above it is ignored', () => {
  assert.deepEqual(mapper.resolveListingPrice({ ...PRODUCT, discountPrice: '3900' }, undefined, CTX), { amount: 3900 });
  assert.deepEqual(mapper.resolveListingPrice({ ...PRODUCT, discountPrice: '9000' }, undefined, CTX), { amount: 4500 });
});

test('inventory pushes are floored at zero', () => {
  assert.deepEqual(mapper.toInventoryUpdatePayload([{ tiktokSkuId: 's', quantity: -2 }], 'W'), { skus: [{ id: 's', inventory: [{ warehouse_id: 'W', quantity: 0 }] }] });
});

test('order mapping folds per-unit lines by SKU, converts to minor units, maps status', () => {
  const raw = {
    id: '5760000001',
    status: 'AWAITING_SHIPMENT',
    paid_time: 1700000000,
    payment: { currency: 'THB', total_amount: '9050.00', shipping_fee: '50' },
    line_items: [
      { id: 'L1', seller_sku: 'KNJ-EG-LIP', sale_price: '4500', product_name: 'Lip' },
      { id: 'L2', seller_sku: 'KNJ-EG-LIP', sale_price: '4500', product_name: 'Lip' },
    ],
    recipient_address: {
      name: 'Somchai',
      address_line1: '1 Road',
      postal_code: '10110',
      region_code: 'th',
      district_info: [
        { address_level_name: 'Province', address_name: 'Bangkok' },
        { address_level_name: 'City', address_name: 'Khlong Toei' },
      ],
    },
  };
  const { input } = mapper.mapTikTokOrder(raw);
  assert.equal(input.channel, 'tiktok_shop');
  assert.equal(input.status, 'paid');
  assert.deepEqual(input.items, [{ sku: 'KNJ-EG-LIP', quantity: 2, unitPriceMinor: 450000, productName: 'Lip', externalLineId: 'L1' }]);
  assert.equal(input.totalMinor, 905000);
  assert.equal(input.shippingMinor, 5000);
  assert.equal(input.address.country, 'TH');
  assert.equal(input.address.city, 'Khlong Toei');
  assert.equal(input.address.region, 'Bangkok');
  assert.equal(input.paidAt, new Date(1700000000000).toISOString());
});

test('unpaid orders are not imported; cancelled ones are; a line without a seller SKU skips the order', () => {
  assert.equal(mapper.mapTikTokOrder({ id: '1', status: 'UNPAID', payment: { currency: 'THB' } }), null);
  assert.equal(mapper.mapTikTokOrder({ id: '1', status: 'ON_HOLD', payment: { currency: 'THB' } }), null);
  const cancelled = mapper.mapTikTokOrder({ id: '2', status: 'CANCELLED', payment: { currency: 'THB', total_amount: '0' }, line_items: [{ seller_sku: 'A', sale_price: '1' }] });
  assert.equal(cancelled.input.status, 'cancelled');
  const skipped = mapper.mapTikTokOrder({ id: '3', status: 'COMPLETED', payment: { currency: 'THB' }, line_items: [{ sale_price: '1' }] });
  assert.match(skipped.skipped, /no seller SKU/);
});

// ── Queue backoff ──────────────────────────────────────────────────────────

test('backoff grows exponentially with jitter, is capped, and honours Retry-After', () => {
  const low = () => 0;
  const high = () => 0.999;
  assert.equal(backoffDelayMs(1, undefined, low), 15_000);
  assert.ok(backoffDelayMs(1, undefined, high) < 30_000);
  assert.equal(backoffDelayMs(3, undefined, low), 60_000);
  assert.ok(backoffDelayMs(20, undefined, high) <= 60 * 60_000);
  assert.equal(backoffDelayMs(2, 7_000, low), 7_000);
});

// ── Manual export ──────────────────────────────────────────────────────────

test('manual export: one row per SKU with blockers stated', () => {
  const rows = exportRowsFor(
    { ...PRODUCT, brand: { name: 'Kanjo' }, mainImage: { url: '/uploads/a.jpg' }, variants: [{ sku: 'V1', label: 'Gloss', price: '1' }, { sku: 'V2', label: 'Matte' }] },
    { V1: 2 },
  );
  assert.deepEqual(rows.map((r) => [r.seller_sku, r.available_quantity, r.variant]), [['V1', '2', 'Gloss'], ['V2', '0', 'Matte']]);
  assert.equal(rows[0].blockers, '');
  const blocked = exportRowsFor({ ...PRODUCT, imageRights: 'not_cleared' }, {});
  assert.match(blocked[0].blockers, /Image rights/);
});

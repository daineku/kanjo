/**
 * The storefront API, under /api/storefront. See lib/store/types.ts in the
 * website for the contract. Every route except the payment webhook requires the
 * storefront token (src/policies/storefront-token.ts); the webhook is
 * authenticated by the processor's signature over the raw body instead.
 *
 * `auth: false` switches off Strapi's users-permissions role check, which is
 * the right thing here: access is decided by the policy, not by the public role.
 */

const guarded = { auth: false as const, policies: ['global::storefront-token'] };

const route = (method: 'GET' | 'POST', path: string, handler: string, config: Record<string, unknown> = guarded) => ({
  method,
  path: `/storefront${path}`,
  handler: `storefront.${handler}`,
  config,
});

export default {
  routes: [
    route('GET', '/catalog', 'catalog'),
    route('GET', '/products/:slug', 'product'),
    route('GET', '/products/:slug/reviews', 'reviews'),
    route('GET', '/pages', 'pages'),
    route('GET', '/redirects', 'redirects'),
    route('POST', '/cart/quote', 'quote'),
    route('POST', '/checkout', 'checkout'),
    route('POST', '/orders/lookup', 'lookup'),
    route('POST', '/reviews', 'submitReview'),
    route('POST', '/reviews/:id/report', 'reportReview'),
    route('POST', '/sourcing-requests', 'sourcing'),
    route('POST', '/build-inquiries', 'build'),
    route('POST', '/payments/webhook/:provider', 'webhook', { auth: false }),
  ],
};

/**
 * Commerce configuration, read from the environment in ONE place.
 *
 * The rules are pure functions of an environment object so the tests exercise
 * the real thing rather than a re-statement of it (the same split the website
 * uses in lib/runtime/policy.ts).
 *
 * No secret is ever logged, returned from an endpoint or stored in the
 * database by this module.
 */

export type Env = Record<string, string | undefined>;

export type PaymentMode =
  /** No usable credentials: the store is a browse-only catalogue. */
  | { kind: 'disabled'; reason: string }
  | { kind: 'stripe'; testMode: boolean; secretKey: string; webhookSecret: string }
  /** Development and automated tests only. Refused when NODE_ENV=production. */
  | { kind: 'mock'; testMode: true; webhookSecret: string };

const truthy = (value: string | undefined) => value === 'true' || value === '1';

export function isProduction(env: Env): boolean {
  return env.NODE_ENV === 'production';
}

/**
 * Which payment provider may take money, and why not when none may.
 *
 *   - A LIVE Stripe key needs a webhook secret too: without the webhook no
 *     order would ever be marked paid, so taking payment would be taking money
 *     for orders nobody is told about.
 *   - A TEST key on a production process is refused unless
 *     KANJO_ALLOW_TEST_PAYMENTS=true (a staging deployment). Otherwise a real
 *     customer could "complete" a checkout that moved no money.
 *   - The mock provider cannot be selected in production at all.
 */
export function paymentModeFromEnv(env: Env): PaymentMode {
  const provider = (env.PAYMENT_PROVIDER ?? '').trim().toLowerCase();

  if (provider === 'mock') {
    if (isProduction(env)) {
      return { kind: 'disabled', reason: 'The mock payment provider cannot run in production.' };
    }
    return { kind: 'mock', testMode: true, webhookSecret: env.MOCK_PAYMENT_WEBHOOK_SECRET || 'mock-webhook-secret' };
  }

  const secretKey = (env.STRIPE_SECRET_KEY ?? '').trim();
  const webhookSecret = (env.STRIPE_WEBHOOK_SECRET ?? '').trim();

  if (!secretKey) return { kind: 'disabled', reason: 'No payment credentials are configured.' };
  if (!/^(sk|rk)_(test|live)_/.test(secretKey)) {
    return { kind: 'disabled', reason: 'STRIPE_SECRET_KEY is not a Stripe secret or restricted key.' };
  }
  if (!webhookSecret) {
    return { kind: 'disabled', reason: 'STRIPE_WEBHOOK_SECRET is missing; payments cannot be confirmed without it.' };
  }

  const testMode = /^(sk|rk)_test_/.test(secretKey);
  if (testMode && isProduction(env) && !truthy(env.KANJO_ALLOW_TEST_PAYMENTS)) {
    return {
      kind: 'disabled',
      reason: 'A Stripe TEST key is configured on a production process. Set a live key, or KANJO_ALLOW_TEST_PAYMENTS=true on a staging deployment.',
    };
  }
  return { kind: 'stripe', testMode, secretKey, webhookSecret };
}

/**
 * Whether explicitly-marked sample products may be served to the storefront.
 * Off unless asked for, and the flag is named so that nobody sets it by
 * accident on the real store.
 */
export function allowSampleCatalog(env: Env): boolean {
  return truthy(env.KANJO_ALLOW_SAMPLE_CATALOG);
}

export function storefrontToken(env: Env): string | undefined {
  const token = (env.STOREFRONT_API_TOKEN ?? '').trim();
  // A short token is a guessable token. Refusing it is louder than accepting it.
  return token.length >= 32 ? token : undefined;
}

export type RevalidateTarget = { url: string; secret: string };

export function revalidateTarget(env: Env): RevalidateTarget | undefined {
  const url = (env.STOREFRONT_REVALIDATE_URL ?? '').trim();
  const secret = (env.STOREFRONT_REVALIDATE_SECRET ?? '').trim();
  if (!url || !secret) return undefined;
  if (!/^https?:\/\//.test(url)) return undefined;
  return { url, secret };
}

/** The CMS's own public origin, for turning `/uploads/x.jpg` into an absolute URL. */
export function publicOrigin(env: Env): string {
  const configured = (env.PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  return `http://localhost:${env.PORT || 1337}`;
}

export const env = (): Env => process.env as Env;

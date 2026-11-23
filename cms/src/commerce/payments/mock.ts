import { createHmac } from 'node:crypto';

import { safeEqual } from '../util';
import type { PaymentEvent, PaymentProvider } from './types';
import { WebhookSignatureError } from './types';

/**
 * The MOCK payment provider. Development and automated tests ONLY.
 *
 * It moves no money and contacts nothing. It cannot be selected when
 * NODE_ENV=production (../config.ts refuses), every order made through it is
 * flagged `isTest`, and the storefront shows a TEST MODE notice whenever it is
 * active. It exists so the checkout → webhook → fulfilment path can be
 * exercised end to end without a merchant account; it is not evidence that the
 * Stripe integration works against Stripe.
 *
 * "Paying" means posting a signed event to the same webhook endpoint Stripe
 * would call: `x-mock-signature: hex(HMAC-SHA256(secret, rawBody))`.
 */

export function signMockEvent(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function createMockProvider(options: { webhookSecret: string }): PaymentProvider {
  return {
    id: 'mock',
    testMode: true,

    async createCheckoutSession(input) {
      const sessionId = `mock_cs_${input.reference}`;
      // Straight to the site's own success page: there is no hosted page.
      const separator = input.successUrl.includes('?') ? '&' : '?';
      return { sessionId, url: `${input.successUrl}${separator}mock=1` };
    },

    async expireCheckoutSession() {},

    async refund(input) {
      return { refundId: `mock_re_${input.idempotencyKey}`, status: 'succeeded' };
    },

    async getFee() {
      // No processor, so no actual fee. Reporting an invented one would put a
      // made-up number in the "actual fees" column of the analytics.
      return null;
    },

    verifyWebhook(rawBody, headers): PaymentEvent {
      const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
      const signature = headers['x-mock-signature'];
      if (typeof signature !== 'string' || !safeEqual(signature, signMockEvent(options.webhookSecret, body))) {
        throw new WebhookSignatureError('Bad mock signature.');
      }
      const event = JSON.parse(body);
      return { ...event, livemode: false } as PaymentEvent;
    },
  };
}

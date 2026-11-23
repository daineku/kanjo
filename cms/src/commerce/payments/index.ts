import { env, paymentModeFromEnv } from '../config';
import { createMockProvider } from './mock';
import { createStripeProvider } from './stripe';
import type { PaymentProvider } from './types';

let cached: { key: string; provider: PaymentProvider | undefined } | undefined;

/**
 * The active payment provider, or undefined when the store is a catalogue.
 *
 * Rebuilt only when the relevant environment changes, so tests can switch
 * providers between cases without a process restart.
 */
export function paymentProvider(): PaymentProvider | undefined {
  const mode = paymentModeFromEnv(env());
  const key = JSON.stringify(mode);
  if (cached?.key === key) return cached.provider;

  let provider: PaymentProvider | undefined;
  if (mode.kind === 'stripe') provider = createStripeProvider(mode);
  else if (mode.kind === 'mock') provider = createMockProvider(mode);
  cached = { key, provider };
  return provider;
}

export * from './types';

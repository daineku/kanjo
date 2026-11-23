import 'server-only'

import { storeConfigFromEnv, type StoreConfig, type StoreEnv } from './config'

/**
 * The store policy, bound to this process's environment.
 *
 * Deliberately thin — every rule is in ./config, where the tests can reach it.
 */

const env = (): StoreEnv => process.env as StoreEnv

export function storeConfig(): StoreConfig {
  return storeConfigFromEnv(env())
}

export function storeEnabled(): boolean {
  return storeConfig().enabled
}

export function storeRevalidateSecret(): string | undefined {
  return env().STORE_REVALIDATE_SECRET?.trim() || undefined
}

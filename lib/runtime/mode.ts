import 'server-only'

import {
  adminWriteBlockedReasonFromEnv,
  adminWritesAllowedFromEnv,
  deploymentModeFromEnv,
  shouldNoIndexFromEnv,
  type DeploymentMode,
  type RuntimeEnv,
} from './policy'

/**
 * The deployment policy, bound to this process's environment.
 *
 * This file is deliberately thin. Every RULE lives in `./policy`, as a pure
 * function of an environment object, so the tests can import and exercise the
 * real thing — see lib/infra.test.ts. What is left here is the part that
 * actually reads `process.env`, which is what `server-only` is for.
 *
 * The split exists because the previous arrangement put both behind
 * `server-only`, which meant the tests re-stated the rules instead of importing
 * them. A test that re-implements its subject can pass while production is
 * broken.
 */

const env = (): RuntimeEnv => process.env as RuntimeEnv

export type { DeploymentMode }

export function deploymentMode(): DeploymentMode {
  return deploymentModeFromEnv(env())
}

export function adminWritesAllowed(): boolean {
  return adminWritesAllowedFromEnv(env())
}

export function adminWriteBlockedReason(): string | undefined {
  return adminWriteBlockedReasonFromEnv(env())
}

export function shouldNoIndex(): boolean {
  return shouldNoIndexFromEnv(env())
}

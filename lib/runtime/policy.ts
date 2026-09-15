/**
 * Deployment policy: which deployment this is, and what it is allowed to do.
 *
 * ── WHY THIS IS A PURE FUNCTION OF AN ENVIRONMENT OBJECT ────────────────────
 *
 * `lib/runtime/mode.ts` used to hold both this logic and its `process.env`
 * access behind `server-only`, which throws outside a React Server Component.
 * The consequence was that the tests could not import these rules — so they
 * RE-STATED them, and a test that re-implements the thing it is testing can
 * pass while production is broken.
 *
 * The rules therefore live here, taking their environment as an argument, and
 * `mode.ts` is the thin `server-only` wrapper that supplies `process.env`. The
 * tests import THESE functions. `server-only` belongs around credential access,
 * not around a boolean.
 *
 * ── THE RULES ───────────────────────────────────────────────────────────────
 *
 * A preview deployment is built from the same code, points at the same database
 * and holds the same credentials as production. Nothing about the code can tell
 * them apart, so without a deliberate answer a pull-request preview would be a
 * second, unlisted, fully-writable admin against the live content — and the
 * first sign of trouble would be production copy changing because somebody was
 * testing a form.
 *
 *   READS follow the configured source. A preview showing real content is
 *   useful and harmless.
 *   WRITES are production-only unless explicitly opted into.
 *
 * `VERCEL_ENV` is set by Vercel itself to 'production' | 'preview' |
 * 'development' and cannot be spoofed by a branch name or a build setting, so
 * it is the thing to trust. Outside Vercel it is absent and `NODE_ENV` is the
 * fallback.
 */

export type DeploymentMode = 'development' | 'preview' | 'production'

/** Only the variables these rules read. */
export type RuntimeEnv = {
  VERCEL_ENV?: string
  NODE_ENV?: string
  ADMIN_WRITE_ENABLED?: string
  NEXT_PUBLIC_NOINDEX?: string
}

export function deploymentModeFromEnv(env: RuntimeEnv): DeploymentMode {
  const vercel = env.VERCEL_ENV?.trim()
  if (vercel === 'production') return 'production'
  if (vercel === 'preview') return 'preview'
  if (vercel === 'development') return 'development'
  return env.NODE_ENV === 'production' ? 'production' : 'development'
}

/**
 * Whether the admin may MUTATE content or media on this deployment.
 *
 * Production: yes, for an authenticated and allowlisted account.
 * Preview: NO by default. `ADMIN_WRITE_ENABLED=true` opts one deployment in —
 *   deliberately awkward, because it has to be set per deployment rather than
 *   inherited from production's environment.
 * Development: yes, subject to the local admin's own gate.
 *
 * This is about the DEPLOYMENT, not the person. Authorisation is a separate
 * question, answered in lib/admin/policy.ts; both must pass.
 */
export function adminWritesAllowedFromEnv(env: RuntimeEnv): boolean {
  if (deploymentModeFromEnv(env) === 'preview') return env.ADMIN_WRITE_ENABLED === 'true'
  return true
}

/** The human-readable reason writes are refused, for the admin's own banner. */
export function adminWriteBlockedReasonFromEnv(env: RuntimeEnv): string | undefined {
  if (adminWritesAllowedFromEnv(env)) return undefined
  return (
    'This is a PREVIEW deployment. It reads production content but cannot change it, ' +
    'so a test cannot edit the live site. Set ADMIN_WRITE_ENABLED=true on this ' +
    'deployment only if you specifically intend otherwise.'
  )
}

/**
 * Whether this deployment should be kept out of search indexes.
 *
 * Any non-production deployment, plus an explicit override — because a
 * production build served from a staging domain is still a duplicate of the
 * real site as far as a crawler is concerned. Deriving it rather than requiring
 * a variable per preview is what stops a preview being indexed because somebody
 * forgot.
 */
export function shouldNoIndexFromEnv(env: RuntimeEnv): boolean {
  if (env.NEXT_PUBLIC_NOINDEX === 'true') return true
  return deploymentModeFromEnv(env) !== 'production'
}

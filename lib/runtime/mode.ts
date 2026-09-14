import 'server-only'

/**
 * Which deployment this is, and what it is allowed to do.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * A preview deployment is built from the same code, points at the same
 * database and holds the same credentials as production. Nothing about the
 * code can tell them apart, which means without a deliberate answer here a
 * pull-request preview would be a second, unlisted, fully-writable admin
 * against the live content — and the first sign of trouble would be production
 * copy changing because somebody was testing a form.
 *
 * So the rule is stated once, here, and every gate reads it:
 *
 *   READS follow the configured source. A preview showing real content is
 *   useful and harmless.
 *   WRITES are production-only unless explicitly opted into. A preview that
 *   can edit the live document is a foot-gun with no upside.
 *
 * `VERCEL_ENV` is set by Vercel itself to 'production' | 'preview' |
 * 'development' and cannot be spoofed by a branch name or a build setting, so
 * it is the thing to trust. Outside Vercel it is absent, and `NODE_ENV` is the
 * fallback.
 */

export type DeploymentMode = 'development' | 'preview' | 'production'

/** The matrix below is tested in lib/infra.test.ts. Keep the two in step. */
export function deploymentMode(): DeploymentMode {
  const vercel = process.env.VERCEL_ENV?.trim()
  if (vercel === 'production') return 'production'
  if (vercel === 'preview') return 'preview'
  if (vercel === 'development') return 'development'
  return process.env.NODE_ENV === 'production' ? 'production' : 'development'
}

/**
 * Whether the admin may MUTATE content or media.
 *
 * Production: yes, for an authenticated and allowlisted account.
 * Preview: NO by default. `ADMIN_WRITE_ENABLED=true` opts a specific preview in
 *   — deliberately awkward, because it has to be set per deployment rather than
 *   inherited from production's environment.
 * Development: yes, subject to the local admin's own gate.
 *
 * This is about the DEPLOYMENT, not the person. Authorisation is a separate
 * question and is answered in lib/admin/auth.ts; both must pass.
 */
export function adminWritesAllowed(): boolean {
  const mode = deploymentMode()
  if (mode === 'preview') return process.env.ADMIN_WRITE_ENABLED === 'true'
  return true
}

/** The human-readable reason writes are refused, for the admin's own banner. */
export function adminWriteBlockedReason(): string | undefined {
  if (adminWritesAllowed()) return undefined
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
 * real site as far as a crawler is concerned.
 */
export function shouldNoIndex(): boolean {
  if (process.env.NEXT_PUBLIC_NOINDEX === 'true') return true
  return deploymentMode() !== 'production'
}

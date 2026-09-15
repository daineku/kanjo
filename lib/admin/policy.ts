/**
 * Who may administer this site.
 *
 * ── WHY THIS IS A PURE FUNCTION, NOT A `server-only` ONE ────────────────────
 *
 * This is the most security-critical rule in the codebase, and it used to live
 * behind `server-only` alongside the Supabase client — which meant the tests
 * could not import it, so they RE-STATED it. A test that re-implements an
 * authorisation rule can pass while the real one is broken; that is close to
 * the worst shape a test can have.
 *
 * So the rule takes its inputs as arguments and lives here, and
 * `lib/admin/auth.ts` supplies `process.env` and the Supabase session. The
 * tests import THESE functions.
 *
 * ── AUTHENTICATION IS NOT AUTHORISATION ─────────────────────────────────────
 *
 * Anyone can complete a Supabase sign-in — it is a public project with email
 * sign-up. Whether that identity administers THIS site is a separate decision,
 * and this is where it is made.
 */

/**
 * The allowlist, normalised.
 *
 * Comma-separated, case-insensitive, whitespace-tolerant — because it is typed
 * into a Vercel environment-variable field by a human, and `A@b.com , c@d.com`
 * should work.
 */
export function parseAdminEmails(raw: string | undefined | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '')
}

/**
 * Whether an address administers this site.
 *
 * AN EMPTY ALLOWLIST AUTHORISES NOBODY. The tempting alternative — "no list
 * configured means allow anyone" — turns a forgotten environment variable into
 * an open admin on a public site, which is the exact failure this function
 * exists to prevent.
 *
 * Matching is exact after normalisation: no prefix, suffix or substring
 * matching, so `owner@example.com.evil.test` is not `owner@example.com`.
 */
export function isAllowlistedEmail(
  raw: string | undefined | null,
  email: string | undefined | null,
): boolean {
  if (!email) return false
  const allowed = parseAdminEmails(raw)
  if (allowed.length === 0) return false
  return allowed.includes(email.trim().toLowerCase())
}

/**
 * The origin a magic link must come back to.
 *
 * ── WHY THIS DOES NOT TRUST THE HOST HEADER ─────────────────────────────────
 *
 * The first version built the redirect from `x-forwarded-host` / `host`. Those
 * are request headers: on a deployment that answers to more than one hostname —
 * and a Vercel project answers to its `.vercel.app` domain as well as the
 * custom one — an attacker who can get a request through with a chosen Host can
 * make the sign-in email point somewhere else. The link is single-use and
 * addressed to the real owner, so it is not a trivial takeover, but it is an
 * auth-link poisoning primitive and there is no reason to accept it.
 *
 * Supabase's allowed-redirect list is a second layer that would catch most of
 * this. It is not a reason to send an untrusted origin in the first place.
 *
 * So: production uses the CONFIGURED site URL, which no request can influence.
 * Preview and development fall back to the deployment's own known origin —
 * `VERCEL_URL` is set by Vercel itself, not by a header — and finally to
 * localhost, which is right for `npm run dev` and never ships.
 *
 * Returns null only when nothing is configured AND nothing can be derived,
 * which the caller turns into a clear configuration error rather than a guess.
 */
export type OriginEnv = {
  NEXT_PUBLIC_SITE_URL?: string
  VERCEL_URL?: string
  VERCEL_ENV?: string
  PORT?: string
}

export function authRedirectOrigin(env: OriginEnv): string | null {
  const configured = env.NEXT_PUBLIC_SITE_URL?.trim()
  const isProduction = env.VERCEL_ENV?.trim() === 'production'

  // Production: the configured origin, always. A production deployment with no
  // NEXT_PUBLIC_SITE_URL is a misconfiguration worth failing on rather than
  // papering over with a `.vercel.app` address in the owner's inbox.
  if (isProduction) {
    return configured ? stripTrailingSlash(configured) : null
  }

  // Preview: the deployment's own origin, so a link opens the build that sent
  // it rather than signing the editor into production by mistake. VERCEL_URL
  // carries no scheme and is always https.
  const vercel = env.VERCEL_URL?.trim()
  if (vercel) return `https://${stripTrailingSlash(vercel)}`

  if (configured) return stripTrailingSlash(configured)

  // Development.
  const port = env.PORT?.trim() || '3000'
  return `http://localhost:${port}`
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

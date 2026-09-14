import 'server-only'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

import { adminWriteBlockedReason, adminWritesAllowed, deploymentMode } from '@/lib/runtime/mode'

/**
 * Who may administer this site, and what they may do.
 *
 * ── TWO INDEPENDENT QUESTIONS, BOTH OF WHICH MUST PASS ──────────────────────
 *
 *   1. IS THIS PERSON AN ADMIN? Supabase Auth establishes who they are; the
 *      `THEKANJO_ADMIN_EMAILS` allowlist decides whether that identity counts.
 *      Authentication alone is not enough — anyone can sign up for a Supabase
 *      project, so "has a session" would let any stranger edit the site.
 *
 *   2. MAY THIS DEPLOYMENT BE WRITTEN TO? A preview build points at the
 *      production database with production credentials; letting it write would
 *      mean a pull request could change the live site. See lib/runtime/mode.ts.
 *
 * ── AND IT IS CHECKED ON EVERY MUTATION, SERVER-SIDE ────────────────────────
 *
 * Not on the page that renders the form. A Server Action is an HTTP endpoint:
 * hiding the form removes the button, not the route behind it. Every action in
 * app/admin/actions.ts calls `requireAdminWrite()` before it touches anything.
 *
 * There is no secret path, no URL token, and no "the admin is at an address
 * nobody knows" — the Daineku pattern this project is explicitly not copying.
 * `/admin` is a normal, guessable URL that simply refuses everyone.
 */

export type AdminIdentity =
  | {
      kind: 'local-development'
      /** The local admin has no account; it is gated by ADMIN_ENABLED + dev. */
      email: null
    }
  | {
      kind: 'supabase'
      email: string
    }

export class AdminAuthError extends Error {
  /** 'anonymous' means "sign in"; 'forbidden' means "this account is not an admin". */
  readonly reason: 'anonymous' | 'forbidden' | 'readonly' | 'unconfigured'
  constructor(reason: AdminAuthError['reason'], message: string) {
    super(message)
    this.name = 'AdminAuthError'
    this.reason = reason
  }
}

/**
 * The allowlist, normalised.
 *
 * Comma-separated, case-insensitive, whitespace-tolerant — because it is typed
 * into a Vercel environment variable field by a human, and `A@b.com , c@d.com`
 * should work.
 */
export function adminEmails(): string[] {
  return (process.env.THEKANJO_ADMIN_EMAILS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '')
}

/**
 * Tested in lib/infra.test.ts, where this rule is re-stated rather than
 * imported — this module loads `server-only`, which throws outside a request.
 * If you change the rule here, change it there.
 */
export function isAllowlistedEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const allowed = adminEmails()
  // An EMPTY allowlist authorises NOBODY. The tempting alternative — "no list
  // configured means allow anyone" — turns a forgotten environment variable
  // into an open admin, which is the exact failure this function exists to
  // prevent.
  if (allowed.length === 0) return false
  return allowed.includes(email.trim().toLowerCase())
}

/**
 * Whether Supabase Auth is available to sign anybody in.
 *
 * The publishable key IS meant to be public — it is the browser-side key, and
 * its power is bounded by RLS, which this project enables. It is separate from
 * `SUPABASE_SECRET_KEY`, which is server-only and bypasses RLS.
 */
export function isAdminAuthConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim(),
  )
}

/**
 * The dev-only escape hatch: the file-backed admin, with no accounts at all.
 *
 * Both conditions, and the production half is not overridable by an
 * environment variable — `deploymentMode()` reads `VERCEL_ENV`, which Vercel
 * sets itself.
 */
export function isLocalAdminEnabled(): boolean {
  return deploymentMode() === 'development' && process.env.ADMIN_ENABLED === 'true'
}

/**
 * A Supabase client bound to the request's cookies.
 *
 * `@supabase/ssr` is what keeps the session in cookies rather than in
 * localStorage, which is the only arrangement a server component can read.
 */
export async function authClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url || !key) {
    throw new AdminAuthError(
      'unconfigured',
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set for admin sign-in.',
    )
  }

  const store = await cookies()

  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options)
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // session is refreshed by the route handler and the middleware-free
          // callback instead, so this is safe to ignore rather than fatal.
        }
      },
    },
  })
}

/**
 * The current admin, or null.
 *
 * Never throws for "not signed in" — that is a normal state that renders a
 * sign-in form. It throws only for misconfiguration.
 */
export async function currentAdmin(): Promise<AdminIdentity | null> {
  if (isLocalAdminEnabled()) return { kind: 'local-development', email: null }
  if (!isAdminAuthConfigured()) return null

  const supabase = await authClient()
  // `getUser()` and NOT `getSession()`: getSession reads the cookie and trusts
  // it, while getUser revalidates the token with the Supabase server. For an
  // authorisation decision, the difference is the whole point.
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null

  const email = data.user.email ?? null
  if (!isAllowlistedEmail(email)) return null

  return { kind: 'supabase', email: email as string }
}

/**
 * Asserts that the caller may MUTATE content. Call at the top of every action.
 *
 * Order matters: identity first, then deployment. A signed-out visitor on a
 * preview should be told to sign in rather than being told the deployment is
 * read-only, because the second message leaks which deployments are writable.
 */
export async function requireAdminWrite(): Promise<AdminIdentity> {
  const admin = await currentAdmin()

  if (!admin) {
    if (!isAdminAuthConfigured() && deploymentMode() === 'development') {
      throw new AdminAuthError(
        'unconfigured',
        'The admin is not enabled. Set ADMIN_ENABLED=true in .env.local for the local file-backed admin, ' +
          'or configure Supabase Auth — see docs/ADMIN.md.',
      )
    }
    throw new AdminAuthError(
      'anonymous',
      'Sign in with an authorised email address to make changes.',
    )
  }

  if (!adminWritesAllowed()) {
    throw new AdminAuthError('readonly', adminWriteBlockedReason() ?? 'Writes are disabled here.')
  }

  return admin
}

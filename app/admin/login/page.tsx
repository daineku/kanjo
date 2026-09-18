import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import {
  adminAuthConfigIssue,
  currentAdmin,
  isAdminAuthConfigured,
  isLocalAdminEnabled,
} from '@/lib/admin/auth'

import { sendMagicLink } from '../actions'

/**
 * Admin sign-in.
 *
 * ── EMAIL MAGIC LINK, NOT A PASSWORD ────────────────────────────────────────
 *
 * There is no password to choose badly, reuse, or store — and no password reset
 * flow, which is usually the weakest part of a small site's auth. Supabase
 * sends a one-time link; following it establishes a session in an httpOnly
 * cookie.
 *
 * ── THE FORM SAYS THE SAME THING WHATEVER HAPPENS ───────────────────────────
 *
 * Submitting an address that is not on the allowlist produces exactly the same
 * response as submitting one that is: "check your email". Anything else turns
 * this page into an oracle for which addresses administer the site. The
 * allowlist is enforced where it matters — on the session, server-side, on
 * every mutation (lib/admin/auth.ts).
 */

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>
}) {
  // Validate configuration before constructing a Supabase client. A malformed
  // public URL should render a useful setup message, not a server-side 500.
  const configIssue = adminAuthConfigIssue()

  // Already an admin — or running the local file-backed admin, which has no
  // accounts. Either way there is nothing to sign in to.
  if (!configIssue && (isLocalAdminEnabled() || (await currentAdmin()))) redirect('/admin')

  const params = await searchParams

  if (!isAdminAuthConfigured()) {
    return (
      <div className="a-shell">
        <header className="a-head">
          <h1>THE KANJO — CONTENT</h1>
          <p className="a-error">
            {configIssue ?? 'Admin sign-in is not configured on this deployment.'}
            {' '}THEKANJO_ADMIN_EMAILS must also contain the authorised address.
          </p>
          <p className="a-note">
            For local editing instead, run with ADMIN_ENABLED=true and no Supabase
            configuration — that is the file-backed development admin.
          </p>
        </header>
      </div>
    )
  }

  return (
    <div className="a-shell">
      <header className="a-head">
        <h1>THE KANJO — CONTENT</h1>
        <p className="a-note">Sign in to edit the site.</p>
        {params.sent && (
          <p className="a-ok">
            If that address administers this site, a sign-in link is on its way. The link
            is single-use and expires.
          </p>
        )}
        {params.error && <p className="a-error">{params.error}</p>}
      </header>

      <section className="a-panel">
        <h2>SIGN IN</h2>
        <form action={sendMagicLink}>
          <div className="a-grid">
            <label className="a-field a-field--wide">
              <span className="a-label">Email</span>
              <input
                type="email"
                name="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
              />
              <span className="a-hint">
                A one-time sign-in link is emailed to you. No password.
              </span>
            </label>
          </div>
          <div className="a-actions">
            <button type="submit">SEND LINK</button>
          </div>
        </form>
      </section>
    </div>
  )
}

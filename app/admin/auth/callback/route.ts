import { NextResponse, type NextRequest } from 'next/server'

import { authClient, currentAdmin } from '@/lib/admin/auth'

/**
 * The magic-link landing route.
 *
 * Supabase redirects here with a `code`; exchanging it establishes the session
 * in httpOnly cookies. This is the exact path that must be registered as a
 * Redirect URL in the Supabase dashboard — see docs/PRODUCTION_SETUP.md, step B.
 *
 * ── THE ALLOWLIST IS CHECKED AGAIN, HERE ────────────────────────────────────
 *
 * A valid session is not authorisation. Anyone who can receive mail at any
 * address can complete a Supabase sign-in; whether that identity administers
 * THIS site is a separate decision, and `currentAdmin()` makes it against
 * `THEKANJO_ADMIN_EMAILS`. A session that is not allowlisted is SIGNED OUT
 * immediately rather than left sitting in the browser: leaving it would mean a
 * stranger holding a valid session cookie for our project, which is a larger
 * surface than it needs to be even though every mutation re-checks.
 *
 * ── AND THE REDIRECT TARGET IS NEVER TAKEN FROM THE QUERY ───────────────────
 *
 * There is no `?next=` parameter. An auth callback that redirects wherever the
 * URL says is an open redirect, and it is the classic way a sign-in flow gets
 * used to launder a phishing link. Destinations here are two fixed literals.
 */

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  // Supabase reports its own failures — an expired or already-used link — in
  // the query rather than by omitting the code.
  const providerError = searchParams.get('error_description') ?? searchParams.get('error')
  if (providerError) {
    return NextResponse.redirect(
      `${origin}/admin/login?error=${encodeURIComponent(providerError.slice(0, 200))}`,
    )
  }

  if (!code) {
    return NextResponse.redirect(
      `${origin}/admin/login?error=${encodeURIComponent('That sign-in link was incomplete. Request a new one.')}`,
    )
  }

  const supabase = await authClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(
      `${origin}/admin/login?error=${encodeURIComponent('That sign-in link has expired or has already been used. Request a new one.')}`,
    )
  }

  const admin = await currentAdmin()
  if (!admin) {
    // Authenticated, but not an administrator of this site. Drop the session.
    await supabase.auth.signOut()
    return NextResponse.redirect(
      `${origin}/admin/login?error=${encodeURIComponent('That address does not administer this site.')}`,
    )
  }

  return NextResponse.redirect(`${origin}/admin`)
}

import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * The server-side Supabase client, created from the SECRET key.
 *
 * ── THIS KEY BYPASSES ROW LEVEL SECURITY ────────────────────────────────────
 *
 * That is what it is for, and it is why this module starts with `server-only`:
 * a build error is the only acceptable way to find out that a client component
 * tried to import it. `SUPABASE_SECRET_KEY` is never prefixed `NEXT_PUBLIC_`,
 * which would inline it into the browser bundle and hand every visitor
 * unrestricted read and write on the database.
 *
 * The security model this sits inside (see supabase/migrations):
 *
 *   anon          — no access to thekanjo_site at all
 *   authenticated — no access to thekanjo_site at all
 *   service role  — read and write, and it is the ONLY way in
 *
 * So the browser never talks to the table. The website reads it server-side,
 * the admin writes it server-side, and RLS is enabled with no permissive
 * policy rather than disabled — the Daineku pattern this project is explicitly
 * not copying.
 *
 * ── WHY THERE IS NO SESSION HANDLING HERE ───────────────────────────────────
 *
 * `persistSession: false` and `autoRefreshToken: false`: this client is not a
 * user. It is a process acting with a fixed credential, and a session store
 * would be state shared between requests on a warm serverless instance.
 * Visitor authentication is a different client entirely — lib/admin/auth.ts.
 */

export type ServerSupabase = SupabaseClient

let cached: ServerSupabase | null = null

export class SupabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SupabaseConfigurationError'
  }
}

/** True when both halves are present. Neither is useful without the other. */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SECRET_KEY?.trim())
}

export function serverSupabase(): ServerSupabase {
  if (cached) return cached

  const url = process.env.SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SECRET_KEY?.trim()

  if (!url || !key) {
    const missing = [!url && 'SUPABASE_URL', !key && 'SUPABASE_SECRET_KEY'].filter(Boolean)
    throw new SupabaseConfigurationError(
      `${missing.join(' and ')} must be set. See docs/PRODUCTION_SETUP.md.`,
    )
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'thekanjo-com' } },
  })
  return cached
}

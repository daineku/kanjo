/**
 * The narrow slice of the Supabase client this site actually uses.
 *
 * ── WHY A HAND-WRITTEN INTERFACE RATHER THAN `SupabaseClient` ───────────────
 *
 * Two reasons, and the second is the important one.
 *
 * 1. IT IS AN HONEST INVENTORY. The whole of the site's database surface is
 *    "read one row by id" and "update one row by id, conditionally". Stating
 *    that as a type means a future change reaching for `.delete()` or `.rpc()`
 *    is a compile error here, rather than a quiet widening of what the
 *    service-role credential is used for.
 *
 * 2. IT MAKES THE REAL CLASSES TESTABLE. `@supabase/supabase-js` is only
 *    constructible with a URL and a key, and the module that constructs it
 *    imports `server-only`, which throws outside a request. Depending on this
 *    interface instead means `RemoteContentSource` and `RemoteContentStore` can
 *    be exercised by `node` against an in-memory double — so the cache and
 *    concurrency tests run THE PRODUCTION CLASSES rather than a copy of their
 *    logic. See lib/content/remote/cache.test.ts.
 *
 * `server-only` stays where it belongs: around the module that reads the
 * credential and constructs the real client (lib/supabase/server.ts).
 */

export type SupabaseResult<T> = { data: T | null; error: { message: string } | null }

/** One row of `thekanjo_site`, as the two queries below select it. */
export type ContentRow = { content: unknown; updated_at?: unknown }

/**
 * The builder `update()` returns.
 *
 * `eq` is chainable because a conditional write needs two predicates — the row
 * id and the version it was read at. `select` is what makes Postgres RETURN the
 * rows it changed: without it supabase-js resolves `data: null` even on
 * success, and a precondition that matched nothing would be indistinguishable
 * from one that matched. That distinction is the entire lost-update guard.
 */
export type UpdateBuilder = {
  eq(column: string, value: string): UpdateBuilder
  select(columns: string): Promise<SupabaseResult<unknown[]>>
}

export type SupabaseLike = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): Promise<SupabaseResult<ContentRow>>
      }
    }
    update(values: Record<string, unknown>): UpdateBuilder
  }
}

/** Resolves the client lazily, so nothing is constructed until a read happens. */
export type SupabaseProvider = () => SupabaseLike

/** The table and row the whole site lives in. */
export const CONTENT_TABLE = 'thekanjo_site'
export const CONTENT_ROW_ID = 'main'

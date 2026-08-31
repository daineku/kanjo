# Backend decision: SEPARATE BACKEND RECOMMENDED

**Verdict: SEPARATE BACKEND RECOMMENDED.**

Not "possible after a small refactor". The blockers below are not shaped like
refactors — the first cannot be fixed by adding a column, and the second and
third cannot be fixed without changing Daineku's production behaviour, which
this task is explicitly forbidden from doing.

Inspected at `jdm-site` commit `e3e0bb2` ("1.0.1notes"), the newest local copy
of the Daineku site (`~/Downloads/jdm-site-docs-canonical/jdm-site`; the copy at
`~/Documents/Personal/Daineku/jdm-site-handoff/jdm-site` is the older `aae47f2`).
Nothing in Daineku was modified.

---

## 1. RLS is disabled on every table, so a shared project has no tenant boundary

`supabase/migration_v4_fix_rls.sql`, which its own `HANDOFF.md` lists as
**required** and instructs the operator to "run last":

```sql
alter table cars disable row level security;
alter table gallery_photos disable row level security;
alter table brands disable row level security;
...
alter table site_settings disable row level security;

-- This is a single-owner site with no user authentication.
-- RLS provides no benefit and causes 404s on published models when anon key is used.
```

`migration_v2_final.sql` does the same for all eleven tables.

The consequence is decisive. `lib/supabase.ts` builds the public client from
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, which by construction ships in the browser
bundle. With RLS off, that key is not a read-only key — it is full read **and
write** on every table in the project. Sharing the project would mean the
anon key published in thekanjo.com's JavaScript grants any visitor write access
to Daineku's production `cars`, `gallery_photos` and `site_settings`.

**A `site_id` column does not fix this.** Row-level tenancy is enforced by
row-level security; with RLS off, a `site_id` filter is a client-side
convention that any HTTP client can decline to honour. Making a shared project
safe would mean re-enabling RLS across all eleven tables and writing policies
for each — which is precisely the change `migration_v4` exists to undo, is a
broad migration against a live production database, and would risk the 404s on
published models that the migration's own comment records.

## 2. `site_settings` is a single-row table, read with `.single()`

`lib/data.ts`:

```ts
export async function getSiteSettings(): Promise<SiteSettings | null> {
  const { data } = await supabase.from('site_settings').select('*').single()
  return data
}
```

The same `.single()` appears in `app/api/site-settings/route.ts` and the admin's
settings route. `schema.sql` inserts exactly one row and there is no `site_id`,
no `slug` and no filter anywhere.

Inserting a second row for The Kanjo makes `.single()` fail — PostgREST returns
an error when the result is not exactly one row — so **Daineku's header and
admin settings tab would break the moment The Kanjo's settings row was
created.** That is a change to current Daineku production behaviour, which the
task forbids, and it would happen as a side effect of a single INSERT rather
than as a deliberate migration.

## 3. Admin authorisation is one shared secret with no scope

`lib/adminAuth.ts` in full:

```ts
export function isAuthed(req: NextRequest): boolean {
  const secret = req.headers.get('x-admin-secret')
  return !!secret && secret === process.env.ADMIN_SECRET_PATH
}
```

One environment variable is simultaneously the admin URL path
(`app/[adminPath]/page.tsx` compares the route segment against it) and the API
bearer token. There is no user, no role and no project scope. A shared backend
therefore means a shared admin credential: whoever can edit The Kanjo can edit
Daineku's cars, photos and homepage feed, and the same string is also the URL of
Daineku's admin panel.

## 4. The entity model does not overlap

Daineku's schema is car-model-centric: `cars`, `brands`, `builds`,
`build_parts`, `accessories`, `accessory_models`, `racing_games`,
`model_blocks`, `gallery_photos`, plus a `videos` table whose primary column is
`tiktok_url` and which is keyed `car_id NOT NULL`.

The Kanjo needs articles, landing sections, screenshots and game status. The
only genuinely shared shapes are "a site's settings" and "an image with a
caption" — and reusing `gallery_photos` would mean giving every Kanjo screenshot
a `car_id`, which is exactly the "do NOT force The Kanjo content into
Daineku-specific entities" instruction. There is no articles table to reuse at
all.

## 5. Storage and deployment are not blockers, and are worth reusing later

R2 (`lib/r2.ts`) is a clean, generic wrapper — `uploadToR2`, `deleteFromR2`,
`getKeyFromUrl` — with no Daineku semantics. A **separate bucket in the same
Cloudflare account** shares the infrastructure without sharing a namespace, and
that is worth doing when media lands. Same for Vercel: one account, separate
project. Neither requires a shared database.

---

## What was built instead

`lib/content/source.ts` defines one `ContentSource` interface. Every page and
section reads through it; nothing in `app/` or `components/` imports a storage
client, a filesystem path or a row type. Two implementations are wired:

- `lib/content/local` — reads `content/`. The default, so a fresh clone runs
  with no environment variables at all.
- `lib/content/remote` — the seam. It validates its required variables and then
  fails with an actionable message, because there is no backend to point it at
  yet. Implementing it is one file: create a client, map rows to
  `lib/content/types.ts`, filter and sort in the query.

The mapping lives inside the adapter deliberately. That is what makes the
frontend independent of any particular backend's implementation details, which
is the requirement whichever way the backend question is eventually answered.

## If a shared backend is wanted later anyway

It is reachable, but it is a Daineku project with its own approval, not a
Kanjo one, and it must be documented before it is run:

1. Re-enable RLS on all eleven tables and write per-table policies. Verify
   published model pages still load with the anon key — that is the exact
   failure `migration_v4` was written to fix.
2. Add a `site_id` (or `project_id`) column, backfill Daineku's rows, and make
   it `NOT NULL`.
3. Replace `getSiteSettings`'s `.single()` with a `site_id`-filtered query
   **before** any second settings row exists.
4. Replace the shared admin secret with per-site credentials or real auth.

Steps 1, 3 and 4 all change Daineku's production behaviour. That is the reason
for the verdict.

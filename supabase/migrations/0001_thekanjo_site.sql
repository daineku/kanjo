-- ============================================================================
-- The Kanjo — site content table
--
-- Applied to the EXISTING Daineku Supabase project. It creates one new table
-- and touches nothing else: no Daineku table is altered, dropped or granted
-- against, and the name is prefixed `thekanjo_` so the two sites' objects are
-- never ambiguous in a shared schema.
--
-- APPLY IT FROM THE SUPABASE SQL EDITOR. It is idempotent — running it twice is
-- safe — so a partial application can simply be re-run.
--
-- ── WHY ONE ROW WITH A jsonb COLUMN ─────────────────────────────────────────
--
-- The site has one of everything: one settings object, one loader, one ordered
-- list of sections. There is no query anybody wants to run across them and no
-- entity fetched independently, so a normalised schema would buy joins nobody
-- performs and cost a round trip per section. A landing render is ONE select.
-- The document's shape and its validation live in lib/content/document.ts.
-- ============================================================================

create table if not exists public.thekanjo_site (
  id         text        primary key,
  content    jsonb       not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.thekanjo_site is
  'thekanjo.com site configuration. One row, id = ''main''. Read and written '
  'server-side only via the service role; see lib/content/remote.';

comment on column public.thekanjo_site.content is
  'The whole site document: settings, loader, sections, videos, media, links. '
  'Validated by lib/content/document.ts on every read AND every write — a '
  'jsonb column is not a type.';

-- ============================================================================
-- ROW LEVEL SECURITY
--
-- ENABLED, WITH NO POLICY. That combination is not an oversight — it is the
-- configuration: RLS on with zero policies means every request that is subject
-- to RLS matches nothing and is denied. The service role BYPASSES RLS by
-- design, so the server can still read and write.
--
-- The result:
--
--   anon (the browser, signed out)  -> no rows, no writes
--   authenticated (a signed-in user) -> no rows, no writes
--   service_role (our server)        -> full access
--
-- The browser never talks to this table at all. The website reads it in a
-- server component; the admin writes it in a Server Action. Nothing ships a
-- Supabase client to the client.
--
-- This is deliberately NOT the Daineku pattern of leaving RLS disabled and
-- relying on nobody knowing the URL. The anon key is public by definition — it
-- is designed to be in a browser bundle — so a table with RLS off is a table
-- the whole internet can read the moment that key is seen.
-- ============================================================================

alter table public.thekanjo_site enable row level security;

-- Belt and braces alongside RLS, and they guard different things: RLS filters
-- ROWS, grants control whether the role may reach the TABLE at all. Revoking
-- means an accidental future `create policy ... using (true)` still does not
-- expose the table, because the role has no privilege to exercise.
--
-- `public` is revoked as well: it is the role every other role inherits from,
-- so a grant to it would quietly re-open everything below.
revoke all on table public.thekanjo_site from public;
revoke all on table public.thekanjo_site from anon;
revoke all on table public.thekanjo_site from authenticated;

-- Supabase grants the service role a broad default privilege set on tables.
-- Reset that default explicitly before granting the exact permissions this
-- site needs; otherwise DELETE / TRUNCATE / REFERENCES / TRIGGER can survive
-- even though the migration below appears to grant only three operations.
revoke all on table public.thekanjo_site from service_role;

-- The server's access, stated explicitly. No DELETE: the site never deletes
-- the canonical row, so the credential should not be able to either.
grant select, insert, update on table public.thekanjo_site to service_role;

-- ============================================================================
-- updated_at
--
-- Maintained by a trigger rather than by the application, so it is true even if
-- a row is ever edited by hand in the SQL editor. The store also sets it on
-- write; the trigger is what makes it reliable.
-- ============================================================================

create or replace function public.thekanjo_touch_updated_at()
returns trigger
language plpgsql
-- `search_path` is pinned: a function without it resolves unqualified names
-- through the caller's search_path, which is a privilege-escalation route in a
-- shared schema.
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists thekanjo_site_touch_updated_at on public.thekanjo_site;

create trigger thekanjo_site_touch_updated_at
  before update on public.thekanjo_site
  for each row
  execute function public.thekanjo_touch_updated_at();

-- ============================================================================
-- SEEDING
--
-- Deliberately NOT done here. The canonical row's content is generated from the
-- repository's own content/ files by `npm run content:export`, which produces a
-- validated document — writing a hand-typed JSON literal into a migration would
-- be a second source of truth for the site's copy, and it would be the one
-- nobody remembers to update.
--
-- See docs/PRODUCTION_SETUP.md, step B.
-- ============================================================================

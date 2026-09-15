# Production setup

Everything below is done in a **browser dashboard**. No further application
code is needed — the adapters, the migration, the admin and the fallbacks are
all in the repository. This is the runbook for turning them on.

Work through A → G in order. Each step says what to click, what to copy, and
how to tell it worked.

**Nothing here requires a code change.** When the credentials are in place the
Patreon feed and the latest YouTube video start appearing on their own.

---

## The shape of it

| Service | Account | What The Kanjo gets |
|---|---|---|
| GitHub | `daineku` | The repository `daineku/kanjo` |
| Vercel | the existing Daineku **team** | A **separate Project** |
| Supabase | the existing Daineku **project** | **Separate tables**, prefixed `thekanjo_` |
| Cloudflare | the existing account | A **separate R2 bucket**, `thekanjo-media` |
| Google Cloud | any | A YouTube Data API v3 key |
| Patreon | The Kanjo's creator account | A creator access token |
| TikTok | — | **Nothing.** No developer credentials are needed. |

**No existing Daineku table is read, written, altered or granted against.**

---

## A. GitHub

Repository: <https://github.com/daineku/kanjo>

The code is pushed to `main`. Nothing else to do here, except: keep the
repository's visibility in mind — **it is public**, and `.env.example` is the
only environment file in it. Never commit `.env.local`.

---

## B. Supabase

Use the **existing Daineku project**. The Kanjo adds one table.

### B1. Apply the migration

1. Supabase dashboard → the Daineku project → **SQL Editor** → **New query**.
2. Paste the whole of `supabase/migrations/0001_thekanjo_site.sql`.
3. **Run**.

It is idempotent — running it twice is safe, so a partial application can just
be re-run.

### B2. Seed the canonical row

The row's content is generated from the repository's own `content/` files, so
it is always exactly what a fresh clone renders.

The generated statement is committed at `supabase/seed/thekanjo_site.seed.sql`.
Paste it into the SQL Editor and **Run**.

**Seed exactly once, during initial provisioning.** After that the Supabase row
is authoritative: content is changed through `/admin`, and this file is not a
way to publish changes.

The statement ends in `on conflict (id) do nothing`, so re-running these setup
steps against a live database is a **no-op** — it cannot replace content edited
since launch. That is deliberate: the alternative is a command that looks like
setup and silently discards months of editing.

> A deliberate repository → database reset is a **different, destructive**
> operation: `npm run content:export -- --sql --force` writes
> `thekanjo_site.reset.sql`, which carries a warning banner and is gitignored so
> it can never be confused with the seed. It replaces the live document. There
> is no undo.

### B3. Verify RLS and grants

In **SQL Editor**, run:

```sql
-- Expect: rowsecurity = true
select relname, relrowsecurity as rowsecurity
from pg_class where relname = 'thekanjo_site';

-- Expect: ZERO rows. RLS enabled with no policy denies every
-- RLS-subject request; the service role bypasses RLS by design.
select policyname from pg_policies where tablename = 'thekanjo_site';

-- Expect: ZERO rows for anon and authenticated.
select grantee, privilege_type
from information_schema.role_table_grants
where table_name = 'thekanjo_site' and grantee in ('anon','authenticated','PUBLIC');

-- Expect: exactly one row, id = 'main'
select id, jsonb_array_length(content->'sections') as sections, updated_at
from public.thekanjo_site;
```

If `pg_policies` returns anything, or `anon`/`authenticated` hold any
privilege, **stop and fix it** before continuing. That combination is what
makes the site's content readable by anyone holding the anon key — which is
public by design.

### B4. Copy the keys

**Settings → API**:

- Project URL → `SUPABASE_URL` **and** `NEXT_PUBLIC_SUPABASE_URL`
- `anon` / publishable key → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `service_role` / secret key → `SUPABASE_SECRET_KEY` ← **never** `NEXT_PUBLIC_`

### B5. Configure Auth for the admin

**Authentication → URL Configuration**:

- **Site URL**: `https://thekanjo.com`
- **Redirect URLs** — add both:
  - `https://thekanjo.com/admin/auth/callback`
  - `http://localhost:3000/admin/auth/callback` *(only if you want to test the
    authenticated admin locally; the local file-backed admin needs none of this)*

**Authentication → Providers → Email**: enable it. Magic links are on by
default; a password is not used.

If you want the authenticated admin to work on **preview** deployments too, add
a wildcard entry: `https://*.vercel.app/admin/auth/callback`. A preview signs in
to itself rather than to production, so its links come back to its own
`.vercel.app` origin.

> A redirect URL that is not on this list is rejected by Supabase, which is what
> stops the sign-in flow being pointed at someone else's site.
>
> That is a second layer, not the only one. The origin a magic link is sent to
> comes from `NEXT_PUBLIC_SITE_URL` in production — **never** from the request's
> Host header, which an attacker can choose on a deployment answering to more
> than one hostname. See `lib/admin/policy.ts`.

**`NEXT_PUBLIC_SITE_URL` is therefore required on production.** Without it the
admin refuses to send a sign-in link and says so, rather than emailing a link
pointing at a `.vercel.app` address.

---

## C. Cloudflare R2

Same account, **new bucket**.

1. **R2 → Create bucket** → name it exactly `thekanjo-media`.
2. **Settings → Public access**: either
   - enable the **r2.dev** development subdomain (fine to start), or
   - connect a custom domain such as `media.thekanjo.com`.

   Whichever you choose, the resulting **public base URL** is
   `R2_PUBLIC_BASE_URL`. Uploading does not make an object readable — the
   bucket has to be published — which is why this is configured separately
   from the credentials.
3. **R2 → Manage API Tokens → Create API token**:
   - Permission: **Object Read & Write**
   - Scope: **this bucket only** (`thekanjo-media`)
   - Copy the **Access Key ID** and **Secret Access Key** — the secret is shown
     once.
4. **Account ID** is in the R2 sidebar.

Gives you:

```
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME=thekanjo-media
R2_PUBLIC_BASE_URL
```

**No source edit is needed for a custom domain.** `next.config.ts` derives the
`next/image` remote pattern from `R2_PUBLIC_BASE_URL` at build time, pinned to
that exact host — so pointing `media.thekanjo.com` at the bucket is an
environment variable and nothing else. A malformed value fails the build with a
message naming the variable rather than deploying something that serves broken
images.

---

## D. YouTube Data API

The homepage shows the channel's **latest public upload**, resolved as:

```
@thekanjo
  → channels.list(forHandle=@thekanjo, part=contentDetails)
  → contentDetails.relatedPlaylists.uploads
  → playlistItems.list(playlistId=<uploads>, part=snippet,contentDetails,status)
  → the newest item that is public and not deleted
```

`search.list` is deliberately not used: 100 quota units against 1, ordering
from the search index rather than from the channel, and eventually consistent
so a fresh upload can be missing from it for hours.

**Cost: 2 quota units per refresh**, once per revalidation window (15 minutes
by default) — about 192 units a day against a 10,000/day default quota.

1. <https://console.cloud.google.com> → create or pick a project.
2. **APIs & Services → Library** → enable **YouTube Data API v3**.
3. **APIs & Services → Credentials → Create credentials → API key**.
4. **Restrict it**: *API restrictions* → **YouTube Data API v3** only.
   *Application restrictions* → leave as **None**: the key is used from the
   server, so an HTTP-referrer restriction would break it and an IP restriction
   is not workable on serverless.
5. Set `YOUTUBE_API_KEY`. Server-side only — a Data API key is a quota, and a
   key in the browser bundle is a quota anyone can spend.

Optional: `YOUTUBE_REVALIDATE_SECONDS` (default `900`; below 60 ignored).

**Without the key** the block renders `WATCH ON YOUTUBE` pointing at the
channel. Nothing fake is ever shown, and adding the key later needs no deploy
of its own.

---

## E. Patreon

Creator page: <https://www.patreon.com/cw/TheKanjo>

1. <https://www.patreon.com/portal/registration/register-clients>, signed in as
   **the campaign owner**.
2. Create a client. Copy the **Creator's Access Token**.
3. Required scope: **`campaigns.posts`** — read access to the campaign's posts.
   It does not need, and should not be given, anything that can write.
4. Set `PATREON_ACCESS_TOKEN`.

Optional: `PATREON_CAMPAIGN_ID` (discovered automatically with one campaign;
**do not guess a value**), `PATREON_REVALIDATE_SECONDS` (default `3600`).

The creator page URL itself is **content**, already set in the admin — it is
not an environment variable.

Full security model, including why a creator token cannot leak paid posts:
[PATREON.md](PATREON.md).

---

## F. TikTok

Profile: <https://www.tiktok.com/@the_kanjo>

**No developer credentials are required.** The homepage uses TikTok's official
Creator Profile Embed, which needs no developer app, no Login Kit review and no
`video.list` authorisation for a public profile.

Nothing to configure in any dashboard. The profile URL is content, already set
in the admin. See [TIKTOK.md](TIKTOK.md) — including the upgrade path if custom
The Kanjo-styled cards are ever wanted.

---

## G. Vercel

Same Daineku **team**, **new Project**.

1. **Add New → Project** → import `daineku/kanjo`.
2. Framework preset: **Next.js**. The defaults are correct; there is no custom
   build command.
3. **Settings → Environment Variables.** Add the full set below.

### Production

| Variable | Value |
|---|---|
| `CONTENT_SOURCE` | `supabase` |
| `MEDIA_STORE` | `r2` |
| `NEXT_PUBLIC_SITE_URL` | `https://thekanjo.com` |
| `SUPABASE_URL` | from B4 |
| `SUPABASE_SECRET_KEY` | from B4 — **never** `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_SUPABASE_URL` | from B4 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | from B4 |
| `THEKANJO_ADMIN_EMAILS` | the owner's address(es), comma-separated |
| `R2_ACCOUNT_ID` | from C |
| `R2_ACCESS_KEY_ID` | from C |
| `R2_SECRET_ACCESS_KEY` | from C |
| `R2_BUCKET_NAME` | `thekanjo-media` |
| `R2_PUBLIC_BASE_URL` | from C2 |
| `PATREON_ACCESS_TOKEN` | from E |
| `YOUTUBE_API_KEY` | from D |

Optional: `PATREON_CAMPAIGN_ID`, `PATREON_REVALIDATE_SECONDS`,
`YOUTUBE_REVALIDATE_SECONDS`.

### Preview

Give Preview the **same** variables. Two things happen automatically and need
no setting:

- **Preview cannot write.** `adminWritesAllowed()` reads `VERCEL_ENV`, which
  Vercel sets itself, so a pull-request preview reads production content and
  refuses to change it. Set `ADMIN_WRITE_ENABLED=true` on one specific preview
  only if you genuinely intend otherwise.
- **Preview is noindexed.** Every non-production deployment is, without anyone
  remembering to set a variable.

### Deploy, then the domain

4. **Deploy.**
5. **Settings → Domains** → add `thekanjo.com` (and `www`, redirecting to the
   apex). Follow Vercel's DNS instructions at the registrar.
6. Re-check that `NEXT_PUBLIC_SITE_URL` matches the final domain — it is what
   canonical URLs, `robots.txt`, `sitemap.xml` and OpenGraph images are built
   from.

---

## Verifying it worked

| Check | Where | Expected |
|---|---|---|
| Content comes from Supabase | homepage | It renders. If the row is missing or malformed the build fails with a message naming the exact path — it does not render an empty site. |
| YouTube is live | homepage | The latest upload's title and thumbnail, not `WATCH ON YOUTUBE`. |
| Patreon is live | homepage | Post titles and dates, not just `VIEW ON PATREON`. |
| TikTok | homepage | The creator block. If it is blocked in your region you see `FOLLOW ON TIKTOK`, which is correct. |
| Admin | `/admin` | Redirects to `/admin/login`; a magic link to an allowlisted address signs you in; a link to any other address is refused and the session is dropped. |
| Media upload | `/admin` → any image field | The saved `src` is an `R2_PUBLIC_BASE_URL` URL, and the image loads. |
| Preview is read-only | a preview `/admin` | A `READ ONLY` banner, and saving is refused. |
| A content edit goes live | `/admin` → change the hero title → save | The homepage shows it immediately. The remote source memoises per REQUEST only, so no process restart is needed. |
| Two tabs cannot clobber each other | two `/admin` tabs, save in both | The second is refused with "Somebody else saved while this page was open". |
| Nothing is indexed but production | `/robots.txt` on a preview | `Disallow: /` |

### Cache behaviour

| Source | Window | How to refresh sooner |
|---|---|---|
| Supabase content | per request | An admin save calls `revalidatePath` — it is immediate. The document is memoised within one render (so twelve sections cost one query) and never across requests, so nothing can serve a stale row. |
| YouTube latest video | `YOUTUBE_REVALIDATE_SECONDS`, default 900s | Redeploy, or `revalidateTag('youtube')`. |
| Patreon posts | `PATREON_REVALIDATE_SECONDS`, default 3600s | Redeploy, or `revalidateTag('patreon')`. |
| TikTok | TikTok's own | Nothing to do — the embed always shows the current profile. |

Both external fetches are tagged, so a webhook that calls `revalidateTag` is a
small addition later if a shorter window is ever wanted. Neither needs a
deployment to pick up new content.

---

## If something is wrong

Every failure is designed to be a **legible message**, not a blank page.

| Symptom | Cause |
|---|---|
| Build fails: `thekanjo_site has no row with id='main'` | B2 was not run. |
| Build fails: `content.settings.… must be a string` | The stored document does not match the shape. The message names the path. |
| `CONTENT_SOURCE=supabase requires …` | A Supabase variable is missing. |
| Homepage renders but Patreon shows only the CTA | No token, a wrong scope, or Patreon is down. The reason is in the server log, never on the page. |
| Homepage shows `WATCH ON YOUTUBE` | No key, the API is not enabled, the key is restricted to the wrong API, or the quota is spent. Server log. |
| Upload fails: `R2 refused the upload (HTTP 403)` | The API token cannot write to the bucket. |
| Upload fails: `Could not read the pixel dimensions` | The file is not actually a PNG/JPEG/GIF/WebP/SVG. Rejected on purpose. |
| `/admin` bounces to login and back | The signed-in address is not in `THEKANJO_ADMIN_EMAILS`. An empty list authorises nobody. |
| Save fails: `Somebody else saved while this page was open` | Two admin tabs raced. Reload and redo the edit — the guard refused rather than overwriting the other save. |
| Build fails: `R2_PUBLIC_BASE_URL is not a URL` / `must be https` | The media origin is mistyped. It must be a full `https://` URL. |
| Magic link never arrives, or points at the wrong site | On production, `NEXT_PUBLIC_SITE_URL` is where the link comes back to, and it is deliberately not taken from the request. It must be set. |

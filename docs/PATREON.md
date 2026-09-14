# Patreon

The homepage's DEVELOPMENT LOG block reads the latest posts from The Kanjo's
Patreon campaign through the official **API v2**.

The site is complete without it. With no credentials the block renders its
configured copy and a `VIEW ON PATREON` button — that is the normal state of a
fresh clone, and nothing about it is an error state.

---

## What this integration is not

Three approaches were available and two are ruled out by the brief, for reasons
worth writing down:

- **Not an iframe of the creator page.** Embedding patreon.com wholesale puts
  another site's chrome, cookies and layout inside ours, breaks on every
  redesign they ship, and cannot be styled to look like The Kanjo.
- **Not HTML scraping.** It breaks silently whenever Patreon changes a class
  name, and it is against their terms.
- **Not API v1.** Deprecated. Nothing in `lib/patreon/` touches it; every path
  is under `/api/oauth2/v2/`.

---

## Setting it up

1. Register an API client as the campaign owner:
   <https://www.patreon.com/portal/registration/register-clients>

2. The client page issues a **Creator's Access Token**. The scope this site
   needs is **`campaigns.posts`** — read access to the campaign's posts. It does
   not need, and should not be given, anything that can write.

3. Put the token in `.env.local`:

   ```
   PATREON_ACCESS_TOKEN=...
   ```

   Optionally also:

   ```
   PATREON_CAMPAIGN_ID=...          # skips a lookup; only needed with 2+ campaigns
   PATREON_REVALIDATE_SECONDS=3600  # how long a fetched feed is reused
   ```

4. Set the creator page URL in the admin (PATREON → Creator page URL), or in
   `content/sections.json` → the `devlog` section → `config.campaignUrl`. That
   is the CTA's destination and is separate from the API entirely.

Restart the dev server — environment variables are read at startup.

---

## The security model

This is the one part of the site that holds a credential, so the reasoning is
explicit.

### The token never reaches the browser

`lib/patreon/config.ts` and `lib/patreon/client.ts` both start with
`import 'server-only'`. That makes it a **build error** for any client component
to import anything in that module graph — not a convention, a compile failure.
The variables are not prefixed `NEXT_PUBLIC_`, which would inline them into the
JavaScript bundle.

### Paid posts cannot be published by accident

This is the failure that matters, and it is subtle: **a creator-level token can
read the full body of members-only posts.** Patreon returns that body in
`content` for a paid post exactly as it does for a public one. Rendering the
API's `content` without asking whether the post is public would put paid writing
on a public web page.

Three things stop it:

1. **`PatreonPost` has no `content` field.** The type the UI can reach carries
   `title`, `url`, `publishedAt`, `excerpt`, `isPublic` and `isPaid` — and
   nothing else. There is no property a component could render even by mistake.

2. **The gate is one line, in one file.** `lib/patreon/posts.ts`:

   ```ts
   const isPublic = attributes.is_public === true
   const body = isPublic ? htmlToText(asString(attributes.content)) : ''
   ```

   `=== true`, not truthy. A missing field, a `null`, the string `"true"`, or a
   future API change all land on "not public". It **fails closed**.

3. **`teaser_text` is the one exception**, and only because Patreon's own
   product defines it as the public teaser shown on a locked post's page. It is
   public by construction.

`npm run test:patreon` covers all of this, including the paranoid shapes — a
missing `is_public`, a null one, `is_paid: false` with no `is_public`. Those
tests are the most important in the project.

### Everything else

- **Post bodies are reduced to plain text**, never rendered as markup. `<script>`
  and `<style>` bodies are dropped whole rather than having their tags stripped.
- **Post URLs are checked** before they are put in an `href`: https only, and
  only on `patreon.com`.
- **Errors never reach the page.** A failure becomes a feed `status` and a
  server-log line; the section renders its configured fallback. The message can
  name an endpoint or a missing scope, and neither is site copy.
- **The feed cannot fail the build.** The landing page is statically
  prerendered, so a throwing adapter would turn a Patreon outage into a failed
  deploy. `fetchPatreonFeed()` does not throw.

---

## How it behaves

| Situation | What the visitor sees |
| --- | --- |
| No token configured | The block's copy and `VIEW ON PATREON` (or nothing, with `fallback: "hide"`) |
| Token configured, request fails | Identical to the above. The reason goes to the server log. |
| Working, public post | Date, title, a ~180-character text excerpt, link out |
| Working, members-only post | Date, title, a `MEMBERS` marker, the public teaser **if Patreon supplies one**, link out |
| `showLockedPosts: false` | Members-only posts are dropped from the list entirely |

---

## Field-list resilience

API v2 returns nothing you did not ask for, and **400s** on a field name it does
not recognise. So an optimistic field list is a single point of failure the day
Patreon renames something.

`fetchCampaignPosts` asks once with the optional fields and, **only on a 400**,
retries with the conservative set that Patreon's own WordPress plugin has
shipped for years (`title, content, is_paid, is_public, published_at, url`). A
renamed optional field degrades the excerpt; it does not empty the section. A
401, a 403 or a network failure is not retried — those are real problems.

---

## What Patreon does not give us

**Post thumbnails.** The v2 Post resource exposes no image field, so the devlog
rows are typographic — date, title, excerpt — rather than cards with pictures.
That is a limitation of the API, not a design choice, and it is why the block
uses the game's menu-row language rather than a media grid.

---

## Webhooks

Patreon can push `posts:publish` / `posts:update` / `posts:delete`. They are
**not implemented**, deliberately: they would need a public endpoint, signature
verification and a cache-invalidation path, to replace a one-hour revalidation
window on content that appears a few times a month. If the feed ever needs to be
live within seconds, the hook is `revalidateTag('patreon')` — the fetch is
already tagged.

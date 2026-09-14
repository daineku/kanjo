# Admin

A small editor for this site's content, at `/admin`.

```
ADMIN_ENABLED=true npm run dev     # then open http://localhost:3000/admin
```

---

## Two admins, one interface

The forms, the validation and the routes are the same either way. What differs
is who may reach them and where the writes go.

| | Local | Production |
|---|---|---|
| Who | nobody — no accounts at all | an allowlisted Supabase session |
| Gate | `ADMIN_ENABLED=true` **and** a development deployment | `THEKANJO_ADMIN_EMAILS` |
| Content | `content/*.json` | one row in `public.thekanjo_site` |
| Media | `public/media/` | the `thekanjo-media` R2 bucket |

```bash
ADMIN_ENABLED=true npm run dev     # local, file-backed
```

### The local admin cannot escape development

`deploymentMode()` reads `VERCEL_ENV`, which Vercel sets itself — it is not a
build setting anyone can override. So `ADMIN_ENABLED=true` on a deployment does
nothing at all.

### The production admin

Email **magic link**, via Supabase Auth. No password to choose badly, reuse or
store, and no password-reset flow — usually the weakest part of a small site's
auth.

**Authentication is not authorisation.** Anyone can complete a Supabase
sign-in; whether that identity administers *this* site is a separate decision,
made against `THEKANJO_ADMIN_EMAILS`:

- **An empty or absent allowlist authorises nobody.** The tempting alternative —
  "no list means allow anyone" — turns a forgotten environment variable into an
  open admin on a public site.
- The check uses `getUser()`, not `getSession()`. `getSession` reads the cookie
  and trusts it; `getUser` revalidates the token with Supabase. For an
  authorisation decision that difference is the whole point.
- A session that is not allowlisted is **signed out immediately** at the
  callback rather than left sitting in the browser.
- The sign-in form says *"check your email"* whether or not the address is on
  the list. Saying anything else would turn it into an oracle for which
  addresses administer the site.

### There is no secret path

`/admin` is a normal, guessable URL that simply refuses everyone. Hiding a route
is not a control, and the Daineku URL-token pattern is explicitly not copied.

**Every mutation re-checks authorisation server-side**, because a Server Action
is an HTTP endpoint: hiding a form removes the button, not the route behind it.

### A preview cannot write

A preview deployment is built from the same code, points at the same database
and holds the same credentials as production. Without a deliberate answer, a
pull-request preview would be a second, unlisted, fully-writable admin against
the live content.

So **reads follow the configured source** — a preview showing real content is
useful — and **writes are production-only** unless `ADMIN_WRITE_ENABLED=true` is
set on one specific deployment. The admin renders a `READ ONLY` banner saying
so.

---

## What it edits

| Panel | Covers |
| --- | --- |
| **Site identity** | Title, subtitle, canonical origin, status line, SEO title/template/description, default social image, wordmark, which routes get a header, whether the channel cluster renders, **publisher name and URL**, footer holder and note |
| **Loader** | Enabled, minimum/maximum display, intensity, title reveal, **car A**, **car B**, optional road plate |
| **Channels** | Per channel: label, platform, URL, order, published, open-in-new-tab, optional icon |
| **Each section** | Published and order, plus type-specific fields for hero, intro, YouTube, TikTok and Patreon |

Every image field takes an **upload** or a typed path. Blocks the V1 page does
not use (features, status, screenshots, the local-video block, the links panel)
get a published/order panel, so they can be switched back on without editing
JSON.

---

## Architecture

The UI is written against **`ContentStore`** (`lib/content/store.ts`), not
against a filesystem or a database. `ContentSource` reads and this writes; they
are separate interfaces because every page in the site holds the reader, and
putting a mutation method on it would hand the whole rendering path a way to
write.

`resolveContentStore()` follows `CONTENT_SOURCE` rather than having a variable
of its own — an admin writing local files while the site reads Supabase would be
an editor whose saves appear to succeed and change nothing. One setting, one
backend, both directions.

Media is a **separate** interface (`MediaStore`), because the content document
holds a `src` and where those bytes live is an independent decision. Local and
R2 share one validation path, so a file that uploads locally uploads in
production and one rejected here is rejected there — a rule enforced in only one
of the two is a bug that appears after deployment.

Three properties of the local store worth knowing:

- **Comments survive.** `_comment` and `_README` keys are round-tripped, so
  saving the loader's minimum display time does not delete the paragraph
  explaining what it does — including the long hero-media `_README`.
- **Writes are atomic.** Write to a temporary file in the same directory, then
  rename over the target. A crash mid-save leaves the old file or the new one,
  never half of either. The dev server watches these files, and a partial one
  would take the site down.
- **A section save touches one section.** Everything else in the file passes
  through byte-identical.

### The Supabase store

Read-modify-write on one row: every save reads the current document, replaces
the part it owns, and writes the whole thing back. Same shape as the local
store — whole documents, no patches, no merge semantics to get wrong.

The document is **re-validated before it is written**, not only when it is read.
The actions already bound and check what they read from a form, but this store
is also what a seed script or a future migration goes through, and a row that
fails to parse takes the whole site down on the next render. Catching it here
means a failed save naming the field, instead of a broken site.

**Concurrency, stated honestly:** two editors saving different panels within the
same second can lose one of the two changes — both read, both modify, the later
write wins whole. This is a single-owner site with one admin account, so that is
an acceptable V1 trade, but it is a real limitation rather than an oversight.
The fix when it is needed is an `updated_at` precondition on the write (the
column exists for it), turning the second save into a refusal.

### Uploads

Files land in `public/media/<folder>/` with a sanitised name and a short
timestamp suffix, so re-uploading a second `car.svg` is a new file rather than a
silent overwrite.

**Pixel dimensions are read from the file's own header**
(`lib/content/local/imageSize.ts` — PNG, JPEG, GIF, WebP, SVG). Every `ImageRef`
in this codebase requires `width` and `height` because they are what prevent
layout shift, and asking an editor to type them is asking for them to be wrong.
A file whose header cannot be parsed is **rejected**, which doubles as a
content-type check: a `.png` whose bytes are not a PNG does not get stored.

Limit: 12MB, images only. A browser form post is the wrong transport for a
200MB gameplay capture — that wants a resumable, presigned, direct-to-bucket
flow, which is a feature rather than a bigger number here. Video is added by
dropping the file into `public/media/video/` and referencing it.

In production the same call writes to R2 instead, with the `Content-Type`
derived from the **verified** bytes rather than from the filename — so a renamed
file cannot make R2 serve the wrong type.

### Validation

Enums are checked against their own const arrays and numbers are bounded, so a
bad value cannot reach a content file that the typed source will not re-validate
at runtime. Cross-field rules live in the actions — for instance, a loader
`maximumDisplayMs` below its `minimumDisplayMs` is refused with a message, and
**nothing is written**.

### No client JavaScript

A form posts to a Server Action; the action redirects back with `?saved=` or
`?error=`; the page re-renders. That is the entire interaction model. The one
client component in the admin is `SkipLoader`, which releases the site loader's
scroll lock and `inert` attribute so the editor is not waiting out a night
highway after every save.

---

API credentials are **never** admin content. The YouTube channel and the TikTok
and Patreon URLs are editable here; the API key and the access tokens live in
the server environment and have no field anywhere in this interface.

---

## What it is not

Not a CMS. There is no schema editor, no block builder and no generic entity
list — every panel knows what it is editing. Articles are still Markdown files
in `content/updates/`, which is the right tool for long-form writing and where
they should stay.

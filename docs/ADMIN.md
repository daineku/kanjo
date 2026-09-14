# Admin

A small editor for this site's content, at `/admin`.

```
ADMIN_ENABLED=true npm run dev     # then open http://localhost:3000/admin
```

---

## It is a development tool

Two conditions must both hold or the route does not exist — `notFound()`, not a
403:

- `NODE_ENV` is `development`
- `ADMIN_ENABLED=true`

**It has no authentication.** That is deliberate, and it is why the gate is
strict: the backend it will eventually talk to does not exist yet, and inventing
a password here would be worse than having none because the route would *look*
protected. The Server Actions re-check the same gate, because hiding a form does
not remove the endpoint behind it.

The `production` half of the gate is not overridable by an environment variable.

---

## What it edits

| Panel | Covers |
| --- | --- |
| **Site identity** | Title, subtitle, canonical origin, status line, SEO title/template/description, default social image, wordmark, which routes get a header, whether the channel cluster renders, footer holder and note |
| **Loader** | Enabled, minimum/maximum display, intensity, title reveal, **car A**, **car B**, optional road plate |
| **Channels** | Per channel: label, platform, URL, order, published, open-in-new-tab, optional icon |
| **Each section** | Published and order, plus type-specific fields for hero, intro, YouTube and Patreon |

Every image field takes an **upload** or a typed path. Blocks the V1 page does
not use (features, status, screenshots, the local-video block, the links panel)
get a published/order panel, so they can be switched back on without editing
JSON.

---

## Architecture

The UI is written against **`ContentStore`** (`lib/content/store.ts`), not
against the filesystem. `ContentSource` reads and this writes; they are separate
interfaces because every page in the site holds the reader, and putting a
mutation method on it would hand the whole rendering path a way to write.

The local implementation writes `content/*.json`. That is the right persistence
for one person on a laptop and the **wrong** one for a deployment — a serverless
filesystem is read-only and ephemeral, and two editors would overwrite each
other with no record. Keeping it behind the interface is what stops that
convenience becoming the architecture. Pointing the admin at a hosted backend is
one new implementation of five methods; the forms, the validation and the routes
do not change. See `docs/BACKEND_DECISION.md`.

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

Limit: 12MB.

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

## What it is not

Not a CMS. There is no schema editor, no block builder and no generic entity
list — every panel knows what it is editing. Articles are still Markdown files
in `content/updates/`, which is the right tool for long-form writing and where
they should stay.

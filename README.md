# thekanjo.com

The official website for **The Kanjo** — a night highway racing game by Daineku.

The site is a web extension of the game's own menu. Its design is not an
interpretation: every colour, type size, spacing value and transition duration
is transcribed from the game's UI canon and cited to its source file. See
[docs/DESIGN.md](docs/DESIGN.md).

**The homepage is a title screen, not a landing page.** A loader of two cars —
the EG6 and the EK9 — trading position on a night highway, the supplied logo
over the approved hero frame, one paragraph about the project, recent TikTok
clips, the Patreon development log, and a persistent channel rail at the
upper-left edge. The theme is near-black, graphite, white and **red**. That is the whole of it, deliberately — see [docs/MOTION.md](docs/MOTION.md)
for the motion architecture and `content/sections.json` for the composition.

## Run it

```bash
npm install
npm run dev
```

Then open <http://localhost:3000>.

**No environment variables are needed.** The content source defaults to the
local files in `content/`, so a fresh clone runs and renders the whole site.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build. Prerenders every route. |
| `npm start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `eslint .` |
| `npm test` | Every unit test plus the media-path check, on Node's own runner. No network, no credentials. |
| `npm run test:patreon` | The Patreon public/locked gate — the most important tests here. See [docs/PATREON.md](docs/PATREON.md). |
| `npm run test:youtube` | Handle parsing and latest-upload normalisation |
| `npm run test:tiktok` | Profile validation, including the injection attempts |
| `npm run test:document` | The stored-content-document validator |
| `npm run test:infra` | The admin allowlist, the preview-write matrix, upload validation |
| `npm run test:media` | Every published content entry points at a file that exists |
| `npm run content:export` | Regenerates the Supabase seed from `content/`. `-- --sql` also writes the insert. |
| `npm run check` | typecheck + lint + tests + build. **Run this before committing.** |

Three browser scripts are deliberately **not** in `npm run check`, because
Playwright is not a dependency of this project — see the header of each for how
to run them:

- `scripts/check-motion.mjs` — the loader, the reveals, reduced motion, the escape path
- `scripts/check-integrations.mjs` — YouTube, TikTok and Patreon states, including TikTok blocked
- `scripts/check-rendering.mjs` — overflow, keyboard, console errors

## Editing content in a browser

```bash
ADMIN_ENABLED=true npm run dev   # then /admin
```

A small editor for the loader, the hero, the channels, the video, the TikTok and
Patreon blocks, the publisher and every section's visibility — including image
uploads.

That command runs the **local, file-backed** admin, which has no accounts and
cannot be enabled on a deployment. In production the same interface is behind
Supabase Auth with a server-side email allowlist, and writes to Supabase and R2.
See [docs/ADMIN.md](docs/ADMIN.md).

## Environment variables

All optional. The site works with none of them.

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `site.json` → `primaryDomain` | Origin for canonical URLs, absolute OG images, robots and sitemap. Set this on a preview deployment so it describes itself honestly. |
| `NEXT_PUBLIC_NOINDEX` | unset | `true` makes robots.txt disallow everything and sets `noindex`. For preview deployments. |
| `CONTENT_SOURCE` | `local` | `local` reads `content/`; `supabase` reads one row in `public.thekanjo_site`. Governs the admin's writes too. |
| `MEDIA_STORE` | `local` | `local` writes `public/media/`; `r2` writes the `thekanjo-media` bucket. |
| `ADMIN_ENABLED` | unset | `true` enables the LOCAL file-backed admin in development. It cannot be enabled on a deployment. |
| `THEKANJO_ADMIN_EMAILS` | unset | Who may administer the site in production. An empty list authorises nobody. |
| `YOUTUBE_API_KEY` | unset | **Optional, not part of the launch configuration.** With no key and no pinned video the video block hides itself; a pinned video needs no key at all. **Never `NEXT_PUBLIC_`.** |
| `PATREON_ACCESS_TOKEN` | unset | Creator token, scope `campaigns.posts`. Without it the Patreon block shows its copy and a CTA. **Never `NEXT_PUBLIC_`.** See [docs/PATREON.md](docs/PATREON.md). |
| `PATREON_CAMPAIGN_ID` | discovered | Skips a lookup. Only needed with more than one campaign. |
| `PATREON_REVALIDATE_SECONDS` | `3600` | How long a fetched feed is reused. |

Copy `.env.example` to `.env.local` if you want to set any.

## Editing content

Everything the site shows lives in `content/` — settings, landing sections,
videos, media, links, and articles as Markdown. Nothing is hardcoded in a
component. See [docs/CONTENT.md](docs/CONTENT.md).

The real public channels are configured: TikTok
[@the_kanjo](https://www.tiktok.com/@the_kanjo), Patreon
[/cw/TheKanjo](https://www.patreon.com/cw/TheKanjo), YouTube
[@thekanjo](https://www.youtube.com/@thekanjo), publisher
[Daineku](https://daineku.com/).

The placeholder policy still holds for everything that has **not** been
supplied: no release date, platform, store page, Discord invite or screenshot
has been invented, and **there is no Steam URL** — that entry is configured with
an empty `url` and is dropped by the channel rail until a real store page
exists. Sections with no content say so and show the game's own pending-slot
treatment. Please keep it that way.

## Documentation

| Document | Contents |
|---|---|
| [docs/DESIGN.md](docs/DESIGN.md) | Every design value and the canon file it came from |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack, directory map, the content boundary, the media rules |
| [docs/BACKEND_DECISION.md](docs/BACKEND_DECISION.md) | Why the backend is separate from Daineku's, with the evidence |
| [docs/CONTENT.md](docs/CONTENT.md) | How to edit content and write an article |
| [docs/MEDIA_WORKFLOW.md](docs/MEDIA_WORKFLOW.md) | How to prepare media — resolutions, formats, and the night-image pitfalls |
| [docs/PRODUCTION_SETUP.md](docs/PRODUCTION_SETUP.md) | **The deployment runbook** — Supabase, Cloudflare R2, YouTube, Patreon, Vercel, the domain |
| [docs/TIKTOK.md](docs/TIKTOK.md) | The official creator embed, why not the Display API, and the upgrade path |
| [docs/MOTION.md](docs/MOTION.md) | The GSAP architecture, the responsive motion policy, and which reference effects were adopted or rejected |
| [docs/ADMIN.md](docs/ADMIN.md) | The content admin at `/admin` — the local one, the authenticated one, and why a preview cannot write |
| [docs/PATREON.md](docs/PATREON.md) | The Patreon API v2 integration and its security model |
| [docs/CONTENT_REQUIRED.md](docs/CONTENT_REQUIRED.md) | What real content the site still needs |

## Adding real media

A **content operation**, not a code change:

1. copy the export into `public/media/<hero|screenshots|video|articles|og>/`
2. edit one entry in `content/` — each file carries its own instructions
3. `npm run test:media` confirms the file is where the entry says it is

`npm run test:media` also prints what is still missing, so it doubles as the
asset checklist. Preparation specs — and the night-image pitfalls that matter for
this game — are in [docs/MEDIA_WORKFLOW.md](docs/MEDIA_WORKFLOW.md).

## Adding a landing section

1. Add the name to `SECTION_TYPES` and a config type in `lib/content/types.ts`
2. Write the component in `components/sections/`
3. Add one case to `renderSection` in `components/sections/registry.tsx`
4. Add an entry to `content/sections.json`

`app/page.tsx` does not change. Skipping step 3 is a compile error, not a block
that silently renders nothing.

## Before you change the media or content code

Read the "Media rules" section of [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
first. Those are not preferences — each one is a bug that was debugged on the
Daineku site and is recorded in its handoff. In particular: no masonry library,
no `imagesLoaded`, `prefetch={false}` on links, and nothing that loads media on
hover or on a scroll observer.

# thekanjo.com

The official website for **The Kanjo** — a night highway racing game by Daineku.

The site is a web extension of the game's own menu. Its design is not an
interpretation: every colour, type size, spacing value and transition duration
is transcribed from the game's UI canon and cited to its source file. See
[docs/DESIGN.md](docs/DESIGN.md).

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
| `npm test` | 64 tests, on Node's own runner |
| `npm run check` | typecheck + lint + tests + build. **Run this before committing.** |

## Environment variables

All optional. The site works with none of them.

| Variable | Default | Purpose |
|---|---|---|
| `CONTENT_SOURCE` | `local` | `local` reads `content/`. `remote` is a seam and is not implemented — see [docs/BACKEND_DECISION.md](docs/BACKEND_DECISION.md). |
| `NEXT_PUBLIC_SITE_URL` | `site.json` → `primaryDomain` | Origin for canonical URLs, absolute OG images, robots and sitemap. Set this on a preview deployment so it describes itself honestly. |
| `NEXT_PUBLIC_NOINDEX` | unset | `true` makes robots.txt disallow everything and sets `noindex`. For preview deployments. |

Copy `.env.example` to `.env.local` if you want to set any.

## Editing content

Everything the site shows lives in `content/` — settings, landing sections,
videos, media, links, and articles as Markdown. Nothing is hardcoded in a
component. See [docs/CONTENT.md](docs/CONTENT.md).

Note the placeholder policy: no release date, platform, store page, Discord
invite, Patreon URL, social account or screenshot has been invented. Sections
with no content say so and show the game's own pending-slot treatment. Please
keep it that way.

## Documentation

| Document | Contents |
|---|---|
| [docs/DESIGN.md](docs/DESIGN.md) | Every design value and the canon file it came from |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack, directory map, the content boundary, the media rules |
| [docs/BACKEND_DECISION.md](docs/BACKEND_DECISION.md) | Why the backend is separate from Daineku's, with the evidence |
| [docs/CONTENT.md](docs/CONTENT.md) | How to edit content and write an article |

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

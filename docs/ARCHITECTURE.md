# Architecture

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15.5 (App Router) | Same as Daineku, so its media and content lessons transfer directly |
| Language | TypeScript, `strict` + `noUncheckedIndexedAccess` | — |
| Styling | Tailwind v4 (`@import 'tailwindcss'`) + CSS custom properties | Same as Daineku. Tokens are variables; Tailwind supplies layout utilities |
| Content | Local files in `content/`, behind an adapter | No backend needed to run or evaluate the site |
| Rendering | Static prerender for every route | The landing page must be indexable text, not a JS shell |
| Tests | Node's own test runner, no framework | Same approach as Daineku's `renderDescription.test.ts` |
| Dependencies | `next`, `react`, `react-dom`. That is all. | — |

Three deliberate departures from Daineku's setup:

1. **The build is the gate.** Daineku's `next.config.ts` sets
   `eslint.ignoreDuringBuilds: true` and `typescript.ignoreBuildErrors: true`,
   so a type or lint regression there only surfaces to a human reading the
   console. Neither is set here.
2. **Self-hosted fonts.** Daineku loads Manrope from Google Fonts twice — a
   `<link>` in the root layout and an `@import` at the top of `globals.css`.
   The three canon faces here are served from `/public/fonts`, so the page makes
   no third-party font request.
3. **ESM project** (`"type": "module"`), so the test files run under Node's
   native TypeScript type stripping with no build step.

## Directory map

```
app/
  layout.tsx              Root layout. Header, footer and metadata from the
                          content source, on the server.
  page.tsx                The landing page: one fetch, then map the sections.
  globals.css             THE design system. Tokens, roles, components.
  updates/page.tsx        Article index.
  updates/[slug]/page.tsx One article. generateStaticParams -> prerendered.
  robots.ts sitemap.ts    Both built from the content source.
  not-found.tsx

components/
  kanjo/                  The design-system components. WedgeCard, MediaPlate,
                          Frame, Section, EmptyNotice, VideoEmbed.
  layout/                 SiteHeader, NavStrip, SiteFooter.
  sections/               Landing sections + the composition registry.

lib/
  content/
    types.ts              Every content entity. No storage detail.
    source.ts             The ContentSource interface. The one boundary.
    local/                Filesystem implementation + its pure parser.
    remote/               The seam for a hosted backend.
  seo/                    Metadata construction and JSON-LD.
  richText.tsx            Markdown subset -> React elements.
  richText.blocks.ts      Its parser, JSX-free so node can run its test.
  format.ts

content/                  The editable content. See CONTENT.md.
docs/
public/fonts/             The three canon faces + their OFL licences.
```

## The content boundary

`lib/content/source.ts` is the only place the site talks to storage.

```
page / section  ->  ContentSource  ->  LocalContentSource   (content/)
                                   ->  RemoteContentSource  (not implemented)
```

Two rules the interface states and every implementation must honour:

1. **Filtering and ordering happen in the source.** A source returns only
   published entries, already sorted. A component that has to remember to check
   `published` is a component that will eventually forget.
2. **A missing entity is `null`; a broken configuration throws.** `getArticle`
   on an unknown slug returns null so the route can 404. A thrown
   `ContentConfigurationError` means the source itself cannot operate, which is
   a different situation and should be loud.

`CONTENT_SOURCE` selects the implementation and defaults to `local`.

## Section composition

The landing page is:

```tsx
const content = await source.getLandingContent()
return content.sections.map((section) => renderSection(section, content))
```

`Section` in `lib/content/types.ts` is a union discriminated on `type`, and
`renderSection` switches over it with a `never` exhaustiveness check. So:

- **reorder the page** — change `order` in `content/sections.json`
- **turn a block off** — `published: false`
- **add a block type** — add it to `SECTION_TYPES` with a config type, write the
  component, add one case. Forgetting the case is a compile error, not a block
  that silently renders nothing.

`app/page.tsx` never changes for any of these.

## Media rules

These are Daineku's recorded failures, carried over as constraints. Its
`HANDOFF.md` lists them under "Critical Constraints" and "Failed Approaches";
each one below cost real debugging there.

- **No masonry library and no JS relayout.** Plain CSS grid.
- **Never call `imagesLoaded` on a container.** It creates proxy images for
  every lazy below-fold image, duplicating each request.
- **`prefetch={false}` on every `<Link>`.** Otherwise each hover issues an RSC
  fetch, which on a page of cards is a hover-driven request storm.
- **No auto-cycling, no hover-triggered loading, no scroll observers.**
- **Space is reserved from each image's own intrinsic dimensions.** `readImage`
  in `lib/content/local/parse.ts` *throws* if a `src` has no width and height,
  because reserving space is the whole of not shifting layout.
- **Videos are click-to-play facades.** The provider is contacted only when the
  visitor asks, so the landing page makes no third-party request by default.
  `Video.ref` is a bare id, not a URL, so a pasted watch URL cannot smuggle in a
  playlist or an autoplay parameter.

Verified: on the landing page at 1440px, every URL is requested at most once.

## Placeholder discipline

An unwritten field is **absent, not printed**. `lib/content/placeholder.ts`
suppresses any value containing the word `PLACEHOLDER`, and sections drop rows or
items whose copy is unwritten — so an incomplete site says less rather than
publishing notes addressed to its own owner. The first build rendered
"PLACEHOLDER" nine times on the homepage, twice above the fold, plus two
"add an entry to content/…json" developer instructions.

Empty states say what a **visitor** needs to know, never what an editor needs to
do. The inventory of what is missing lives in
[CONTENT_REQUIRED.md](CONTENT_REQUIRED.md).

## Media

Every media surface is a `MediaPlate` at a **required** aspect ratio, and the
ratio is identical whether the plate is filled or pending. That is what makes
real footage a content change rather than a layout change, and it is why a
pending section already shows how large the real asset will be.

The hero is the canon's own composition — world media, then
`background_treatment`, then UI — because `Screens/MainMenu/layout.json` states
`defaultTreatment.mode: "dim"` and labels its black `figma_placeholder_black`
with `mandatoryProductionBackground: false`. Its height is content-dependent: a
tall stage when there is media to fill it, compact when there is not, so an empty
hero is not a bigger empty field.

## Rich text

A Markdown subset rendered to React elements — no `dangerouslySetInnerHTML`, no
markdown dependency. This is Daineku's `renderDescription` rule extended from
(bold, italic, paragraphs) to what an article needs: headings, lists,
blockquotes, links, inline and fenced code, rules, images.

Unsafe hrefs (`javascript:`, `data:`, scheme-relative) keep their text and lose
the link, so content is never silently dropped. Raw HTML and tables render as
literal text.

The parser is `richText.blocks.ts`, deliberately free of JSX so `node` can
execute its test directly. It has a progress guard: a branch that consumes no
line advances the cursor anyway, because a parser that hangs the build is a far
worse failure than one that drops a line. That guard exists because the first
version *did* hang, on an image line with a refused `src`.

## Accessibility

- Semantic landmarks; one `h1` per page; `h2`/`h3` only below it.
- A skip link as the first tab stop.
- Focus is visible and keyboard-only, drawn in the canon's own
  `positiveBright` green so it reads as the game's focus treatment.
- No hover-only content. Selection state is conveyed by the band *and* the left
  rule, not by colour alone.
- Alt text is required by the type and defaults to `''` rather than to invented
  copy.
- An unavailable destination renders visible and disabled with its reason, which
  is also the canon's rule for a locked row.

## Glyph coverage

Iceland — the canon's `technical` family — has no `U+2026 …`, `U+2190 ←` or
`U+2192 →` in its cmap. Verified by reading the font, not assumed. Using one
would fall back to another typeface mid-sentence, so excerpts truncate with
three periods and the article back link uses a guillemet. **Check the cmap
before introducing a new symbol.**

## What is deliberately absent

- **No admin UI.** The content layer is shaped so one can manage settings, nav,
  social links, sections, media, videos, links and articles later, but building
  a CMS was out of scope for this pass.
- **No analytics, no cookie banner, no third-party scripts.**
- **No client-side data fetching anywhere.** Every page is server-rendered from
  the content source.

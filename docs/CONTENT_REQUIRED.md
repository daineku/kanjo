# Content required

> **Media specs, formats and the night-image pitfalls live in
> [MEDIA_WORKFLOW.md](MEDIA_WORKFLOW.md).** This file is the inventory of WHAT is
> missing; that one is HOW to prepare it. `npm run test:media` prints the same
> list from the actual content, so the two cannot drift apart.

Everything the site still needs before it can be published, and nothing else.

The site is built so that **an unwritten field is absent, not printed**
(`lib/content/placeholder.ts`): any value containing the word `PLACEHOLDER`
is suppressed, and a section with nothing to show either shrinks or disappears.
So the site is presentable today — it simply says less than it will.

**Nothing below has been invented.** No release date, platform, price, store
page, invite URL, social handle or screenshot exists in this repository.

Legend — **V1** = needed before the site goes public. **SEO** = affects search
results or link previews.

> ## The V1 homepage changed shape
>
> The homepage is now a **title screen**: loader → THE KANJO → one paragraph →
> one video → the Patreon development log → footer, with a persistent channel
> rail at the upper-left edge. The screenshot gallery, the features grid, the
> status table and the local-video block are still built and still configurable,
> but they are **switched off** in `content/sections.json`.
>
> So sections **§3 (screenshots)** and **§5 (follow destinations)** below are no
> longer V1 blockers — they are what you need if you turn those blocks back on.
> The new V1 list is **§0** immediately below, and §2 is superseded by §0.2.

---

## 0. The new V1 list

| # | Item | Where | Why it is V1 | V1 |
|---|---|---|---|---|
| 0.1 | **Loader vehicle art — car A and car B** | admin → LOADER, or `content/loader.json` | What ships today is a pair of **deliberately temporary, unbranded silhouettes**. They are the first thing every visitor sees. Nothing branded has been fabricated and nothing should be until you supply it. | **YES** |
| 0.2 | **YouTube video** | admin → YOUTUBE, or `sections.json` → `watch` | The block is **`published: false`** because no upload exists. No video id has been invented. Supply the id or URL and publish it. | **YES** |
| 0.3 | **TikTok URL** | admin → CHANNELS, or `site.json` → `social.tiktok.url` | The rail drops any channel with an empty URL, so today it renders nothing. | **YES** |
| 0.4 | **Patreon creator page URL** | admin → CHANNELS *and* admin → PATREON → Creator page URL | Two places: the rail entry, and the section's CTA. | **YES** |
| 0.5 | Patreon API access token | `.env.local` → `PATREON_ACCESS_TOKEN` | Turns the block from copy-plus-a-button into the live post feed. Scope `campaigns.posts`. See [PATREON.md](PATREON.md). | Recommended |
| 0.6 | **Steam page URL** | admin → CHANNELS, or `site.json` → `social.steam.url` | **No URL has been invented for this.** The entry exists, empty, and does not render. Fill it when the store page exists. | When it exists |
| 0.7 | Hero background media | §1.1 below | Unchanged, and still the asset that most changes what the site *is*. | **YES** |

### §0.1 Loader vehicle art — spec

Two images, side profile, **facing right**.

- **Car A** is the near lane: lower on screen, drawn larger (up to 230px wide at
  1920, 200px on a phone).
- **Car B** is the far lane: higher, smaller (up to 182px), and it is the one
  that closes and overtakes first.
- SVG is ideal — it is rendered as a plain `<img>`, scales to every width in the
  matrix, and costs one small request. PNG/WebP with transparency also work.
- They must be **distinguishable from each other at ~110px wide**, which is
  their size on a 360px phone. Silhouette and roofline do that work; colour and
  badges do not survive the scale or the darkness.
- Intrinsic dimensions are read from the file on upload, so there is nothing to
  type.

The road, lane markers and light accents are drawn in CSS and need no art. An
optional painted road plate can be supplied if you want one.

### §0.2 YouTube video — spec

The field takes a **bare id or any YouTube URL**; everything except the
eleven-character id is discarded on the server, so a pasted watch URL carrying a
playlist and a share token is safe.

A poster is **optional** — without one the still is YouTube's own thumbnail,
fetched by this server rather than by the visitor's browser, so the page still
makes no third-party request until somebody presses play. Supply one only if
YouTube's auto-thumbnail is a bad frame.

---

## 1. Hero

| # | Item | Where | Purpose | Length / spec | V1 | SEO |
|---|---|---|---|---|---|---|
| 1.1 | **Hero background media** | `content/sections.json` → `hero.config.background` | The single most important asset on the site. Until it exists a visitor cannot tell from the first screen that this is a game. | See §1.1 below | **YES** | Indirect (bounce) |
| 1.2 | Hero title | `hero.config.title` | Currently `THE KANJO`. Confirm the wordmark form. | 1–3 words | YES | Yes |
| 1.3 | Hero subtitle | `hero.config.subtitle` | Currently `NIGHT HIGHWAY RACING`. The genre line — the thing that answers "what kind of game". | 2–4 words, ≤ 28 chars | YES | Yes |
| 1.4 | Hero description | `hero.config.description` | One sentence of positioning under the title. | 120–200 chars, one sentence | YES | Yes |
| 1.5 | Status label | `content/site.json` → `status.label` | Currently `IN DEVELOPMENT`. Signals the project is active. | ≤ 20 chars | YES | No |
| 1.6 | Status detail | `site.json` → `status.detail` | Optional qualifier beside the status. Suppressed while unwritten. | ≤ 40 chars | No | No |
| 1.7 | Platform note | `hero.config.platformNote` | e.g. `PC — WINDOWS`. Suppressed while unwritten. Do not state until decided. | ≤ 40 chars | No | No |

### §1.1 Hero background media — exact spec

The hero already reserves the full media footprint and applies the canon's `dim`
treatment, so supplying this is a **content change with no layout change**.

Either form works. A still is the safer V1.

**Still image**
```json
"background": {
  "kind": "image",
  "image": { "src": "/media/hero.jpg", "alt": "", "width": 2560, "height": 1440 },
  "treatment": "dim"
}
```
- 2560 × 1440 (16:9), JPEG or WebP, ≤ 400 KB
- The composition must survive a **bottom-weighted crop**: the UI group sits over
  the lower third, so keep the subject in the upper two thirds
- `alt` stays `""` — it is decorative; the `<h1>` carries the meaning

**Looping video**
```json
"background": {
  "kind": "video",
  "videoSrc": "/media/hero.mp4",
  "poster": { "src": "/media/hero-poster.jpg", "alt": "", "width": 2560, "height": 1440 },
  "treatment": "dim"
}
```
- 1920 × 1080 minimum, H.264 MP4, **8–12 s seamless loop**, ≤ 3 MB
- **No audio track at all** — the element is muted, but shipping silence is smaller
- A poster is **mandatory**: it is what shows before the video loads, and what
  shows under `prefers-reduced-motion`, where the loop is paused

## 2. Featured video

| # | Item | Where | Purpose | Length / spec | V1 | SEO |
|---|---|---|---|---|---|---|
| 2.1 | **Featured video** | `content/videos.json` | The section immediately under the hero. Currently a 16:9 plate reading "NO FOOTAGE PUBLISHED YET". | See below | **YES** | Yes (video card) |
| 2.2 | Video title | same entry, `title` | Shown under the player. | 2–5 words | YES | Yes |
| 2.3 | Video description | same entry, `description` | Optional line under the title. | ≤ 160 chars | No | No |
| 2.4 | Video poster | same entry, `poster` | Required. The page contacts no third party until the visitor presses play. | 1920 × 1080, ≤ 250 KB | **YES** | No |

`ref` is the **bare provider id**, not a watch URL — the embed URL is composed by
the site, so a pasted `watch?v=…&list=…` cannot bring a playlist along.

## 3. Screenshots

| # | Item | Where | Purpose | Length / spec | V1 | SEO |
|---|---|---|---|---|---|---|
| 3.1 | **Screenshot set** | `content/media.json` | Currently three empty 16:9 plates. | **6 minimum**, 1920 × 1080 (16:9), ≤ 400 KB each | **YES** | Yes (alt text) |
| 3.2 | Alt text, per shot | each entry, `image.alt` | Describes what is actually in the frame. Required by the type. | 60–120 chars each | **YES** | **Yes** |
| 3.3 | Caption, per shot | each entry, `caption` | Optional. Suppressed while unwritten. | ≤ 80 chars | No | No |

All six at the **same aspect ratio**. The grid reserves space from each image's
declared dimensions, so mixed ratios produce a ragged grid rather than a
shifting one — but a consistent set is what makes it read as a press set.

Once ≥ 6 real screenshots exist, revisit the lightbox decision (§7).

## 4. Game introduction

| # | Item | Where | Purpose | Length / spec | V1 | SEO |
|---|---|---|---|---|---|---|
| 4.1 | Intro body | `sections.json` → `game.config.body` | Two paragraphs currently stand; the third is a placeholder and is suppressed. | 2–3 paragraphs, 60–110 words total | YES | Yes |
| 4.2 | Intro heading | `game.config.heading` | Currently `ONE LOOP, AFTER DARK`. | 3–5 words | YES | Yes |

Markdown subset. **Do not hard-wrap for effect** — a single newline is a space;
two trailing spaces force a break.

## 5. Follow / external destinations

Each lives in `content/links.json`. While `available: false` the block renders
**visible and disabled** with its `unavailableReason`, which is the canon's
treatment for a locked row. Set `href` and `available: true` to open one.

| # | Item | Purpose | V1 | SEO |
|---|---|---|---|---|
| 5.1 | Steam page URL | The wishlist CTA. Currently `NOT YET ANNOUNCED`. | If a page exists | Yes |
| 5.2 | Discord invite | Currently `NOT YET OPEN`. | No | No |
| 5.3 | Patreon URL | Currently `NOT YET OPEN`. See docs/CONTENT.md §Patreon — level 1 is a link, level 3 attributes a local article. | No | No |
| 5.4 | Press kit | Entry exists, unpublished. | No | No |

## 6. Social channels

`content/site.json` → `social`. Six platform slots exist (YouTube, Instagram,
TikTok, Discord, Patreon, Steam), all with an empty `url` and
`published: false`.

**A channel with no URL is dropped from the page**, and they render as an inline
row inside the follow section rather than as cards.

| # | Item | Purpose | V1 | SEO |
|---|---|---|---|---|
| 6.1 | Any live channel URL + `published: true` | Answers "where do I follow this". | At least one | Yes (`sameAs`) |
| 6.2 | `handle` per channel | Optional, e.g. `@thekanjo`. | No | No |

## 7. Development updates

| # | Item | Where | Purpose | Length / spec | V1 | SEO |
|---|---|---|---|---|---|---|
| 7.1 | **Articles 2 and 3** | `content/updates/*.md` | One exists. Three is what makes the devlog read as ongoing rather than as a single post. | 400–900 words each | YES | **Yes** |
| 7.2 | Cover image per article | frontmatter `cover` + `coverWidth`/`coverHeight`/`coverAlt` | Optional; drives the link preview when present. | 1920 × 1080 | No | Yes |
| 7.3 | `excerpt` per article | frontmatter | Derived from the first paragraph if omitted; a written one is better. | 120–200 chars | No | Yes |

Dimensions are **mandatory** with a cover `src` — the parser throws without them,
because that is what reserves the space before the image loads.

## 8. Site-wide SEO

| # | Item | Where | Purpose | Length / spec | V1 | SEO |
|---|---|---|---|---|---|---|
| 8.1 | **Default social image (OG)** | `site.json` → `seo.defaultSocialImage` | **Missing.** Every link to the site currently previews with no image, which is the difference between a shared link being clicked and ignored. | 1200 × 630, ≤ 300 KB, PNG or JPEG | **YES** | **Yes** |
| 8.2 | SEO description | `site.json` → `seo.description` | One stands and is accurate. Confirm it. | 140–160 chars | YES | **Yes** |
| 8.3 | Favicon / app icon | `app/icon.png` (not present) | **Missing.** Browsers currently show a default. | 512 × 512 PNG | **YES** | No |
| 8.3b | Apple touch icon | `app/apple-icon.png` (not present) | iOS home screen. Optional — `icon.png` covers everything else. | 180 × 180 PNG, no transparency | No | No |
| 8.4 | Twitter/X handle | `site.json` → `seo.twitterHandle` | Populates `twitter:site`. Omitted while unset. | — | No | Yes |
| 8.5 | Site subtitle | `site.json` → `subtitle` | Currently a placeholder and suppressed. | ≤ 60 chars | No | No |
| 8.6 | Footer note | `site.json` → `footer.note` | Currently a placeholder and suppressed. | ≤ 80 chars | No | No |

## 9. Optional — only if wanted

| # | Item | Notes |
|---|---|---|
| 9.1 | Wordmark image | `site.json` → `wordmark`. Falls back to the title set in Big Shoulders Display, which currently looks right. |
| 9.2 | Development status rows | The `status` section is disabled because every row but one was unknown. Re-enable with real figures. |
| 9.3 | Feature list | The `features` section is disabled for the same reason. |
| 9.4 | Terms / Privacy / Press | The footer link architecture exists; add entries to `footer.links`. |

---

## The shortest path to publishable

Rewritten for the title-screen homepage. In order, because each unblocks more
than the next:

1. **0.3 TikTok URL** and **0.4 Patreon URL** — two strings. They turn the
   upper-left rail from nothing into the site's only navigation, and the Patreon
   block from copy into copy with a way in.
2. **0.1 loader vehicle art** — the first thing anybody sees, and the only
   remaining placeholder that a visitor can actually perceive as one.
3. **0.2 YouTube video** — the homepage's centrepiece block does not render at
   all until this exists.
4. **0.7 / 1.1 hero media** — the one asset that changes what the site *is*.
5. **8.1 OG image** and **8.3 favicon** — cheap, and they affect every share.
6. **0.5 Patreon token** — turns the development log live.

Items 1–4 are what the five-to-fifteen-second test depends on. Everything below
§3 is only needed if you switch those blocks back on.

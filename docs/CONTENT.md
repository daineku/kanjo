# Editing the content

Everything the site displays lives in `content/`. No copy, URL, label or
ordering is hardcoded in a component.

```
content/
  site.json        Site settings: title, SEO, nav, social, status, footer
  sections.json    The landing page's blocks: type, order, visibility, copy
  videos.json      Videos
  media.json       Screenshots
  links.json       CTA / link blocks, addressed by id from a section
  updates/*.md     Articles
```

Restart `npm run dev` after editing a JSON file if a change does not appear.

## The placeholder policy

Entries marked `PLACEHOLDER` are structural stand-ins that need real copy.

**Nothing has been invented.** No release date, platform, price, Steam page,
Discord invite, Patreon URL, social handle or screenshot exists in this
repository, because none of those have been announced. Instead:

- a social link with an empty `url` is dropped from the page entirely
- a link block with `available: false` renders **visible and disabled** with its
  own `unavailableReason` — the canon's rule for a locked row, and the honest
  treatment for a destination that is not open yet
- a section with no content renders the game's own pending-slot treatment and
  says what is missing

Please keep that property. An empty section is better than a fabricated one, and
a fabricated fact in `seo.description` or in structured data is a claim a search
engine will repeat.

## Common edits

**Reorder the landing page** — change `order` in `sections.json`.

**Hide a section** — `"published": false`.

**Change the status chip** — `site.json` → `status`. The hero picks it up via
`"eyebrow": "status"`.

**Add a navigation item** — `site.json` → `nav`. `visible: false` hides it.
A fragment href (`/#media`) never takes the selected treatment; only a real page
does.

**Turn a social channel on** — set its `url` and `"published": true`.

**Open a CTA** — in `links.json`, set `href` and `"available": true`.

## Adding a video

```json
{
  "id": "first-look",
  "provider": "youtube",
  "ref": "dQw4w9WgXcQ",
  "title": "FIRST LOOK",
  "description": "",
  "poster": {
    "src": "/media/posters/first-look.jpg",
    "alt": "",
    "width": 1920,
    "height": 1080
  },
  "featured": true,
  "published": true,
  "order": 0
}
```

`ref` is the **bare id**, not a watch URL. The embed URL is composed by the
site, so a pasted `watch?v=…&list=…&t=…` cannot bring a playlist or an autoplay
parameter with it. A poster is required: the page shows the poster and contacts
the provider only when a visitor presses play.

## Adding a screenshot

Put the file in `public/media/screenshots/`, then:

```json
{
  "id": "osaka-night-01",
  "image": {
    "src": "/media/screenshots/osaka-night-01.jpg",
    "alt": "Describe what is actually in the frame",
    "width": 1920,
    "height": 1080
  },
  "caption": "",
  "group": "osaka",
  "featured": true,
  "published": true,
  "order": 0
}
```

`width` and `height` are the **real** pixel dimensions and are mandatory. The
parser throws without them, because that is what reserves the image's space
before it loads and therefore what stops the layout shifting.

## Writing an article

Create `content/updates/YYYY-MM-DD-slug.md`. The date prefix is stripped, so the
URL is `/updates/slug`. **The filename owns the slug** — a `slug:` in the
frontmatter is ignored, so a file and its URL cannot disagree.

```markdown
---
title: The title, in sentence case
publishedAt: 2026-08-31
author: Daineku
tags: [site, design]
featured: true
excerpt: One or two sentences. Derived from the first paragraph if omitted.
status: published
---

Body starts here.
```

| Field | Required | Notes |
|---|---|---|
| `title` | yes | |
| `publishedAt` | yes | `YYYY-MM-DD`, validated as a real calendar date |
| `updatedAt` | no | Only set it if the article really was revised |
| `author` `tags` `featured` `order` | no | |
| `excerpt` | no | Derived from the first real paragraph otherwise |
| `status` | no | `published` (default) or `draft`. A draft 404s. |
| `cover` + `coverWidth` + `coverHeight` + `coverAlt` | no | Dimensions mandatory with a src |
| `seoTitle` `seoDescription` | no | Override the defaults |
| `externalSourceLabel` + `externalSourceUrl` | no | Both or neither |

Bad frontmatter is an error, not a silent default — the build fails and names the
file. There is no admin form validating these, so the parser is the only gate.

### Markdown supported

```
## Heading            h2
### Heading           h3
- item                unordered list (wrapped lines continue the item)
1. item               ordered list
> quote               blockquote
```                   fenced code
---                   horizontal rule
![alt](/path.jpg)     image, alone on a line
**bold** *italic*     emphasis
`code`                inline code
[text](href)          link
blank line            new paragraph
single newline        just a space (prose reflows; hard-wrap freely)
two trailing spaces   a real line break
```

**Not supported, and rendered as literal text on purpose:** raw HTML, tables,
footnotes, nested lists, reference links, `#` h1 (the page title owns it), h4+.

`javascript:` and `data:` links keep their text and lose the link.

## Patreon

Progressive, as the brief asks. The site is at **level 1–3** and needs no API.

- **Level 1** — a CTA in `links.json`. Set `href` and `available: true`.
- **Level 2** — Patreon offers no supported public post embed, so this is not
  implemented. Nothing about the site depends on it.
- **Level 3** — write the post locally and attribute it with
  `externalSourceLabel: Patreon` and `externalSourceUrl: <post url>`. The
  article renders "ALSO POSTED ON PATREON" with a link. **This is the
  recommended flow.**
- **Level 4** — API sync is not built and is not recommended. It would need an
  OAuth app, refresh-token storage and a sync job to mirror content the local
  article system already handles, and Patreon's post API is not a stable public
  content feed. The local article system stays fully independent of Patreon.

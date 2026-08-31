# public/media

Drop exported assets here. Every path below is what a `content/*.json` entry or
an article's frontmatter refers to, so **the folder name is part of the config**.

| Folder | Holds | Referenced from |
|---|---|---|
| `hero/` | The hero still, its mobile crop, the hero loop and its poster | `content/sections.json` → `hero.config.background` |
| `screenshots/` | The screenshot set | `content/media.json` |
| `video/` | Local gameplay/cinematic clips and their posters | `content/videos.json` |
| `articles/` | Images used inside development updates, and article covers | `content/updates/*.md` |
| `og/` | The OpenGraph / share image | `content/site.json` → `seo.defaultSocialImage`, or `app/opengraph-image.*` |

A file here is served at `/media/<folder>/<file>` — that leading `/media/` is
what a content entry uses, **not** `public/`.

Preparation specs (resolution, format, quality, and the night-scene pitfalls
that matter for this game) are in `docs/MEDIA_WORKFLOW.md`.

`npm run test:media` checks that every published content entry points at a file
that actually exists, and lists the assets still missing.

## These files ARE committed

The content source is the local filesystem and the site is a static build, so
whatever ships is whatever is in the repository — gitignoring this tree would
deploy a site with no images. `.gitattributes` already marks these extensions
binary, so they are never line-ending converted.

Keep them small for that reason: follow the sizes in `docs/MEDIA_WORKFLOW.md`
and commit the **web-ready export**, never the original capture. If the set ever
grows past a few tens of megabytes, that is the signal to move media to object
storage behind the content adapter (`lib/content/remote/`) rather than to start
gitignoring it here.

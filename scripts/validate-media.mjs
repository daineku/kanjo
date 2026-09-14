/**
 * Checks that every media path the content references points at a file that
 * exists, and lists the assets still missing.
 *
 * Run by `npm run test:media`, which `npm run check` includes — so a content
 * entry that points at a file nobody exported fails the gate instead of shipping
 * a page with a broken image on it.
 *
 * WHY IT REUSES THE SITE'S PARSER. Frontmatter and image parsing come from
 * `lib/content/local/parse.ts` — the same module the pages use — so the
 * validator cannot disagree with the site about what an entry means. It does its
 * own trivial file walking, because `LocalContentSource` uses extensionless
 * imports that only a bundler resolves, and the walking is not where a
 * disagreement could hide.
 *
 * TWO SEVERITIES, because a repository mid-content-production has both:
 *
 *   ERROR   — a PUBLISHED entry points at a missing file. This ships a broken
 *             image to a visitor, so it fails the build.
 *   PENDING — an unpublished entry points at a missing file. That is a
 *             reservation waiting for its asset, which is exactly how
 *             content/media.json is meant to be used, so it is reported and
 *             does not fail.
 *
 * It is a SCRIPT, not a runtime check: the site must stay statically
 * generatable, and a filesystem probe inside a component would make rendering
 * depend on the disk at request time.
 */

import { access, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { parseDocument, slugFromFilename, toArticle } from '../lib/content/local/parse.ts'
import { isLocalAsset } from '../lib/media.ts'

const ROOT = process.cwd()
const PUBLIC_DIR = path.join(ROOT, 'public')

const errors = []
const pending = []
const checked = new Set()

/** Records one reference. `required` false means an unpublished reservation. */
function note(where, field, src, required) {
  if (!src || typeof src !== 'string' || src.trim() === '') return
  if (!isLocalAsset(src)) return // remote URLs are not this script's business
  refs.push({ where, field, path: src.trim(), required })
}

const refs = []

async function exists(publicPath) {
  try {
    await access(path.join(PUBLIC_DIR, publicPath.replace(/^\/+/, '')))
    return true
  } catch {
    return false
  }
}

// ── Collect ──────────────────────────────────────────────────────────────────

async function readJson(name) {
  const raw = await readFile(path.join(ROOT, 'content', name), 'utf8')
  return JSON.parse(raw.replace(/^﻿/, ''))
}

// Site settings: the default social image and an optional wordmark.
const settings = await readJson('site.json')
note('content/site.json → seo.defaultSocialImage', 'src', settings.seo?.defaultSocialImage?.src, true)
note('content/site.json → wordmark', 'src', settings.wordmark?.src, true)

// The landing bundle already filters unpublished entries, so raw JSON is read
// for the pending set. Both are needed: published entries must exist, and
// unpublished ones are the checklist.
async function readJsonArray(name) {
  const parsed = await readJson(name)
  return Array.isArray(parsed) ? parsed : []
}

const [mediaRaw, videosRaw, sectionsRaw] = await Promise.all([
  readJsonArray('media.json'),
  readJsonArray('videos.json'),
  readJsonArray('sections.json'),
])

for (const item of mediaRaw) {
  if (!item?.id) continue
  const where = `content/media.json → ${item.id}`
  note(where, 'image.src', item.image?.src, item.published === true)
}

for (const video of videosRaw) {
  if (!video?.id) continue
  const where = `content/videos.json → ${video.id}`
  const required = video.published === true
  note(where, 'poster.src', video.poster?.src, required)
  if (video.provider === 'file') {
    note(where, 'ref', video.ref, required)
    for (const [i, src] of (video.sources ?? []).entries()) {
      note(where, `sources[${i}]`, src, required)
    }
  }
}

// The loader's vehicles. REQUIRED when the loader is enabled, and they are the
// most load-bearing images on the site: a missing car is not a gap in a gallery,
// it is an empty overlay covering the whole page while the choreography moves
// nothing across it.
const loader = await readJson('loader.json')
note('content/loader.json → carA', 'src', loader.carA?.src, loader.enabled === true)
note('content/loader.json → carB', 'src', loader.carB?.src, loader.enabled === true)
note('content/loader.json → road', 'src', loader.road?.src, loader.enabled === true)

// The persistent channel cluster's optional marks.
for (const channel of settings.social ?? []) {
  note(
    `content/site.json → social.${channel.id}`,
    'icon.src',
    channel.icon?.src,
    channel.published === true && (channel.url ?? '').trim() !== '',
  )
}

for (const section of sectionsRaw) {
  // The YouTube block's poster override, when one is configured. Without one
  // the still comes from YouTube and is not this script's business.
  if (section?.type === 'youtube') {
    note(
      `content/sections.json → ${section.id}`,
      'poster.src',
      section.config?.poster?.src,
      section.published === true,
    )
    continue
  }
  if (section?.type !== 'hero') continue
  const bg = section.config?.background
  if (!bg) continue
  const where = `content/sections.json → ${section.id}.background`
  // Required only when the hero actually uses that kind of media.
  const usesImage = bg.kind === 'image' && section.published === true
  const usesVideo = bg.kind === 'video' && section.published === true
  note(where, 'image.src', bg.image?.src, usesImage)
  note(where, 'mobileImage.src', bg.mobileImage?.src, usesImage)
  note(where, 'poster.src', bg.poster?.src, usesVideo)
  note(where, 'videoSrc', bg.videoSrc, usesVideo)
  for (const [i, src] of (bg.videoSources ?? []).entries()) {
    note(where, `videoSources[${i}]`, src, usesVideo)
  }
}

// Articles: covers, social images, and every image inside a body. Parsed with
// the site's own parser, so a cover that the site would reject is rejected here
// too — including the missing-dimensions case, which throws.
const UPDATES_DIR = path.join(ROOT, 'content', 'updates')
let updateFiles = []
try {
  updateFiles = (await readdir(UPDATES_DIR)).filter((name) => name.toLowerCase().endsWith('.md'))
} catch {
  updateFiles = []
}

for (const filename of updateFiles.sort()) {
  const where = `content/updates/${filename}`
  const raw = await readFile(path.join(UPDATES_DIR, filename), 'utf8')
  const article = toArticle(parseDocument(raw, where), slugFromFilename(filename), where)
  // A draft is not reachable by URL, so its media is a reservation.
  const required = article.status === 'published'

  note(where, 'cover', article.cover?.src, required)
  note(where, 'seo.socialImage', article.seo?.socialImage?.src, required)
  // Body images: the same `![alt](src)` form the renderer accepts.
  for (const match of article.body.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
    note(where, 'body image', match[1], required)
  }
}

// ── Verify ───────────────────────────────────────────────────────────────────

for (const ref of refs) {
  const key = `${ref.where}|${ref.field}|${ref.path}`
  if (checked.has(key)) continue
  checked.add(key)

  if (await exists(ref.path)) continue
  ;(ref.required ? errors : pending).push(ref)
}

// ── Report ───────────────────────────────────────────────────────────────────

function table(rows) {
  const width = Math.max(...rows.map((row) => row.where.length))
  for (const row of rows) {
    console.log(`  ${row.where.padEnd(width)}  ${row.field.padEnd(18)}  ${row.path}`)
  }
}

const total = checked.size

if (errors.length > 0) {
  console.error(`\nMISSING MEDIA — ${errors.length} published reference(s) point at a file that does not exist:\n`)
  table(errors)
  console.error(
    `\nEither export the asset to public${errors[0].path}, correct the path, or set the entry\n` +
      `to "published": false until the file exists. See docs/MEDIA_WORKFLOW.md.\n`,
  )
}

if (pending.length > 0) {
  console.log(`\nAWAITING ASSETS — ${pending.length} unpublished reservation(s), which is expected:\n`)
  table(pending)
  console.log('\nDrop the file in, then set that entry to "published": true.')
}

// What is actually present, so the report is useful when nothing is wrong.
const presentDirs = await Promise.all(
  ['hero', 'screenshots', 'video', 'articles', 'og'].map(async (dir) => {
    try {
      const files = await readdir(path.join(PUBLIC_DIR, 'media', dir))
      return [dir, files.filter((f) => !f.startsWith('.') && f !== 'README.md')]
    } catch {
      return [dir, []]
    }
  }),
)

console.log('\npublic/media:')
for (const [dir, files] of presentDirs) {
  console.log(`  ${dir.padEnd(12)} ${files.length === 0 ? '(empty)' : `${files.length} file(s): ${files.join(', ')}`}`)
}

console.log(
  `\n${total} media reference(s) checked — ${errors.length} error(s), ${pending.length} awaiting.`,
)

process.exit(errors.length > 0 ? 1 : 0)

/**
 * Regression tests for local content parsing.
 *
 * Run with `npm run test:content`. Plain node + assert, executed straight from
 * TypeScript by type stripping.
 *
 * The point of most of these is that BAD CONTENT FAILS LOUDLY. A CMS-less site
 * has no admin form to validate an entry, so the parser is the only gate — and
 * a silently-defaulted field shows up later as a wrong sitemap or a shifting
 * layout rather than as an error anybody can act on.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ContentParseError,
  articlesNewestFirst,
  deriveExcerpt,
  parseDocument,
  publishedInOrder,
  readImage,
  readStringList,
  requireIsoDate,
  slugFromFilename,
  toArticle,
} from './parse.ts'

const HERE = 'test'

function doc(frontmatter: string, body = 'Body text.') {
  return parseDocument(`---\n${frontmatter}\n---\n${body}`, HERE)
}

// ── Frontmatter ──────────────────────────────────────────────────────────────

test('scalars, quoted scalars, booleans, numbers and inline lists all parse', () => {
  const { data } = doc(
    [
      'title: A Title',
      'quoted: "With: a colon"',
      'single: \'apostrophes\'',
      'featured: true',
      'draftish: false',
      'order: 12',
      'tags: [osaka, night, cars]',
      'empty:',
    ].join('\n'),
  )

  assert.equal(data.title, 'A Title')
  assert.equal(data.quoted, 'With: a colon')
  assert.equal(data.single, 'apostrophes')
  assert.equal(data.featured, true)
  assert.equal(data.draftish, false)
  assert.equal(data.order, 12)
  assert.deepEqual(data.tags, ['osaka', 'night', 'cars'])
  assert.equal(data.empty, '')
})

test('the body is everything after the closing delimiter, trimmed', () => {
  const { body } = parseDocument('---\ntitle: X\n---\n\nFirst.\n\nSecond.\n\n', HERE)
  assert.equal(body, 'First.\n\nSecond.')
})

test('a date is not mistaken for a number', () => {
  const { data } = doc('publishedAt: 2026-08-31')
  assert.equal(data.publishedAt, '2026-08-31')
  assert.equal(typeof data.publishedAt, 'string')
})

test('a value containing a colon survives without quotes', () => {
  const { data } = doc('externalSourceUrl: https://example.com/posts/1')
  assert.equal(data.externalSourceUrl, 'https://example.com/posts/1')
})

test('a BOM and CRLF line endings do not break the delimiter check', () => {
  const { data, body } = parseDocument('﻿---\r\ntitle: X\r\n---\r\nBody.\r\n', HERE)
  assert.equal(data.title, 'X')
  assert.equal(body, 'Body.')
})

test('a comment line and a blank line in the frontmatter are ignored', () => {
  const { data } = doc('# a comment\n\ntitle: X')
  assert.equal(data.title, 'X')
  assert.equal(Object.keys(data).length, 1)
})

test('missing frontmatter throws', () => {
  assert.throws(() => parseDocument('Just a body.', HERE), ContentParseError)
})

test('unterminated frontmatter throws', () => {
  assert.throws(() => parseDocument('---\ntitle: X\n', HERE), ContentParseError)
})

test('a frontmatter line with no colon throws rather than being skipped', () => {
  assert.throws(() => doc('title: X\nthis line is wrong'), ContentParseError)
})

// ── Dates ────────────────────────────────────────────────────────────────────

test('a valid ISO date is accepted', () => {
  assert.equal(requireIsoDate({ d: '2026-02-28' }, 'd', HERE), '2026-02-28')
})

test('a non-ISO date shape throws', () => {
  assert.throws(() => requireIsoDate({ d: '31/08/2026' }, 'd', HERE), ContentParseError)
  assert.throws(() => requireIsoDate({ d: '2026-8-1' }, 'd', HERE), ContentParseError)
})

test('a date that looks ISO but is not a real day throws', () => {
  // The whole reason not to trust `new Date(value)`: these roll over silently.
  assert.throws(() => requireIsoDate({ d: '2026-02-30' }, 'd', HERE), ContentParseError)
  assert.throws(() => requireIsoDate({ d: '2026-13-01' }, 'd', HERE), ContentParseError)
})

test('a leap day is accepted in a leap year and refused otherwise', () => {
  assert.equal(requireIsoDate({ d: '2028-02-29' }, 'd', HERE), '2028-02-29')
  assert.throws(() => requireIsoDate({ d: '2027-02-29' }, 'd', HERE), ContentParseError)
})

// ── Images ───────────────────────────────────────────────────────────────────

test('an image with intrinsic dimensions parses', () => {
  const image = readImage(
    { cover: '/media/a.jpg', coverAlt: 'A', coverWidth: 1920, coverHeight: 1080 },
    'cover',
    HERE,
  )
  assert.deepEqual(image, { src: '/media/a.jpg', alt: 'A', width: 1920, height: 1080 })
})

test('an image without width and height throws — that is what prevents layout shift', () => {
  assert.throws(() => readImage({ cover: '/media/a.jpg' }, 'cover', HERE), ContentParseError)
  assert.throws(
    () => readImage({ cover: '/media/a.jpg', coverWidth: 1920 }, 'cover', HERE),
    ContentParseError,
  )
  assert.throws(
    () => readImage({ cover: '/media/a.jpg', coverWidth: 0, coverHeight: 0 }, 'cover', HERE),
    ContentParseError,
  )
})

test('no image key at all is undefined, not an error', () => {
  assert.equal(readImage({}, 'cover', HERE), undefined)
})

test('a missing alt becomes an empty string rather than invented copy', () => {
  const image = readImage({ cover: '/a.jpg', coverWidth: 10, coverHeight: 10 }, 'cover', HERE)
  assert.equal(image?.alt, '')
})

// ── Lists ────────────────────────────────────────────────────────────────────

test('a string list reads from an inline list or a comma-separated string', () => {
  assert.deepEqual(readStringList({ tags: ['a', 'b'] }, 'tags'), ['a', 'b'])
  assert.deepEqual(readStringList({ tags: 'a, b , c' }, 'tags'), ['a', 'b', 'c'])
  assert.deepEqual(readStringList({}, 'tags'), [])
  assert.deepEqual(readStringList({ tags: '' }, 'tags'), [])
})

// ── Slugs ────────────────────────────────────────────────────────────────────

test('a date prefix is stripped from a filename slug', () => {
  assert.equal(slugFromFilename('2026-08-31-first-post.md'), 'first-post')
  assert.equal(slugFromFilename('first-post.md'), 'first-post')
  assert.equal(slugFromFilename('first-post.MD'), 'first-post')
})

// ── Excerpts ─────────────────────────────────────────────────────────────────

test('an excerpt is derived from the first real paragraph, skipping headings and images', () => {
  const body = '## Heading\n\n![shot](/a.jpg)\n\nThe actual opening sentence.'
  assert.equal(deriveExcerpt(body), 'The actual opening sentence.')
})

test('an excerpt strips inline markers and keeps link text', () => {
  assert.equal(
    deriveExcerpt('A **bold** and *italic* line with a [link](https://example.com).'),
    'A bold and italic line with a link.',
  )
})

test('a long excerpt is cut on a word boundary and ellipsised', () => {
  const excerpt = deriveExcerpt(`${'word '.repeat(80)}end.`, 50)
  assert.ok(excerpt.length <= 53, `expected <= 53 chars, got ${excerpt.length}`)
  assert.ok(excerpt.endsWith('...'))
  assert.ok(!excerpt.includes('  '))
})

test('the ellipsis is three periods, not U+2026', () => {
  // Iceland, the face every excerpt renders in, has no U+2026 in its cmap — a
  // real ellipsis falls back to another typeface mid-sentence.
  const excerpt = deriveExcerpt(`${'word '.repeat(80)}end.`, 50)
  assert.ok(!excerpt.includes('…'), 'excerpt must not contain U+2026')
})

test('a body with no prose yields an empty excerpt rather than a heading', () => {
  assert.equal(deriveExcerpt('## Only a heading'), '')
})

// ── Articles ─────────────────────────────────────────────────────────────────

const MINIMAL = 'title: First Post\npublishedAt: 2026-08-31'

test('a minimal article parses and defaults sensibly', () => {
  const article = toArticle(doc(MINIMAL), 'first-post', HERE)
  assert.equal(article.slug, 'first-post')
  assert.equal(article.title, 'First Post')
  assert.equal(article.publishedAt, '2026-08-31')
  assert.equal(article.status, 'published')
  assert.equal(article.featured, false)
  assert.equal(article.order, 0)
  assert.deepEqual(article.tags, [])
  assert.equal(article.excerpt, 'Body text.')
  assert.equal(article.cover, undefined)
  assert.equal(article.seo, undefined)
  assert.equal(article.externalSource, undefined)
})

test('the slug comes from the filename and frontmatter cannot override it', () => {
  const article = toArticle(doc(`${MINIMAL}\nslug: something-else`), 'first-post', HERE)
  assert.equal(article.slug, 'first-post')
})

test('a missing title throws', () => {
  assert.throws(() => toArticle(doc('publishedAt: 2026-08-31'), 's', HERE), ContentParseError)
})

test('a missing publishedAt throws', () => {
  assert.throws(() => toArticle(doc('title: X'), 's', HERE), ContentParseError)
})

test('an unknown status throws', () => {
  assert.throws(
    () => toArticle(doc(`${MINIMAL}\nstatus: scheduled`), 's', HERE),
    ContentParseError,
  )
})

test('a draft parses and keeps its status for the source to filter on', () => {
  const article = toArticle(doc(`${MINIMAL}\nstatus: draft`), 's', HERE)
  assert.equal(article.status, 'draft')
})

test('a half-declared external source throws', () => {
  assert.throws(
    () => toArticle(doc(`${MINIMAL}\nexternalSourceLabel: Patreon`), 's', HERE),
    ContentParseError,
  )
  assert.throws(
    () => toArticle(doc(`${MINIMAL}\nexternalSourceUrl: https://example.com`), 's', HERE),
    ContentParseError,
  )
})

test('a complete external source parses', () => {
  const article = toArticle(
    doc(
      `${MINIMAL}\nexternalSourceLabel: Patreon\nexternalSourceUrl: https://www.patreon.com/posts/1`,
    ),
    's',
    HERE,
  )
  assert.deepEqual(article.externalSource, {
    label: 'Patreon',
    url: 'https://www.patreon.com/posts/1',
  })
})

test('SEO overrides are only present when something states them', () => {
  const bare = toArticle(doc(MINIMAL), 's', HERE)
  assert.equal(bare.seo, undefined)

  const withSeo = toArticle(doc(`${MINIMAL}\nseoTitle: Custom`), 's', HERE)
  assert.equal(withSeo.seo?.title, 'Custom')
  assert.equal(withSeo.seo?.description, undefined)
})

// ── Ordering ─────────────────────────────────────────────────────────────────

test('publishedInOrder drops unpublished entries and sorts by order', () => {
  const result = publishedInOrder([
    { id: 'c', published: true, order: 2 },
    { id: 'a', published: true, order: 0 },
    { id: 'hidden', published: false, order: 1 },
    { id: 'b', published: true, order: 1 },
  ])
  assert.deepEqual(
    result.map((entry) => entry.id),
    ['a', 'b', 'c'],
  )
})

test('publishedInOrder is stable for equal order values', () => {
  const result = publishedInOrder([
    { id: 'first', published: true, order: 0 },
    { id: 'second', published: true, order: 0 },
    { id: 'third', published: true, order: 0 },
  ])
  assert.deepEqual(
    result.map((entry) => entry.id),
    ['first', 'second', 'third'],
  )
})

test('articlesNewestFirst sorts by date descending with a stable tie-break', () => {
  const result = articlesNewestFirst([
    { slug: 'old', publishedAt: '2026-01-01', order: 0 },
    { slug: 'b-same-day', publishedAt: '2026-08-31', order: 0 },
    { slug: 'a-same-day', publishedAt: '2026-08-31', order: 0 },
    { slug: 'mid', publishedAt: '2026-05-05', order: 0 },
  ])
  assert.deepEqual(
    result.map((entry) => entry.slug),
    ['a-same-day', 'b-same-day', 'mid', 'old'],
  )
})

test('articlesNewestFirst does not mutate its input', () => {
  const input = [
    { slug: 'a', publishedAt: '2026-01-01', order: 0 },
    { slug: 'b', publishedAt: '2026-02-01', order: 0 },
  ]
  articlesNewestFirst(input)
  assert.deepEqual(
    input.map((entry) => entry.slug),
    ['a', 'b'],
  )
})

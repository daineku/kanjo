/**
 * Regression tests for the stored-content-document validator.
 *
 * Run with `npm run test:document`. No database, no network, no credentials —
 * every case is a literal object, which is why the validator is a pure function
 * rather than a method on the Supabase source.
 *
 * WHAT THIS GUARDS. `content jsonb` is a column, not a type. A bad write, an
 * interrupted migration or a hand-edited row can put any shape in there, and
 * the rest of the codebase reads typed values without re-checking them. Without
 * this the symptom is `settings.social.map is not a function` inside a server
 * render — a 500 with no indication of which field was wrong.
 *
 * So the assertion every case below really makes is: IT FAILS, AND THE MESSAGE
 * NAMES THE PATH.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CONTENT_DOCUMENT_VERSION,
  buildSiteContentDocument,
  parseSiteContentDocument,
} from './document.ts'
import type { LinkBlock, LoaderConfig, MediaItem, Section, SiteSettings, Video } from './types.ts'

/**
 * A loose shape, on purpose.
 *
 * These tests construct documents that are INVALID by design — that is the
 * point of them — so the fixtures cannot be typed as `SiteContentDocument`
 * without fighting the compiler at every case. The cast happens once, at the
 * boundary, and `parseSiteContentDocument` takes `unknown` anyway.
 */
type Draft = Record<string, unknown> & {
  version?: unknown
  settings?: Record<string, unknown> & Record<string, never[] | unknown>
  loader?: Record<string, unknown>
  sections?: Record<string, unknown>[]
  videos?: unknown[]
  media?: unknown[]
  links?: unknown[]
}

/** A minimal document that passes. Cases below break one thing at a time. */
function valid(): Draft {
  return {
    version: CONTENT_DOCUMENT_VERSION,
    settings: {
      title: 'THE KANJO',
      primaryDomain: 'https://thekanjo.com',
      seo: { title: 'THE KANJO', titleTemplate: '%s — THE KANJO', description: 'A game.' },
      nav: [],
      social: [
        { id: 'tiktok', url: 'https://www.tiktok.com/@the_kanjo', label: 'TIKTOK', published: true, order: 0 },
      ],
      status: { key: 'in-development', label: 'IN DEVELOPMENT' },
      publisher: { name: 'Daineku', url: 'https://daineku.com/' },
      footer: { copyrightHolder: 'Daineku', links: [] },
      chrome: { headerOnReadingPages: true, headerOnHome: false, socialCluster: true },
      legal: {
        privacy: { title: 'Privacy', body: 'What is processed.' },
        terms: { title: 'Terms', body: 'How the site may be used.' },
      },
    },
    loader: {
      enabled: true,
      minimumDisplayMs: 2200,
      maximumDisplayMs: 7000,
      intensity: 'medium',
      titleRevealEnabled: true,
      carA: { src: '/media/loader/car-a.svg', alt: '', width: 200, height: 80 },
      carB: { src: '/media/loader/car-b.svg', alt: '', width: 200, height: 80 },
    },
    sections: [
      { id: 'hero', type: 'hero', published: true, order: 0, config: { title: 'THE KANJO' } },
    ],
    videos: [],
    media: [],
    links: [],
  }
}

/** Breaks one path in a copy of the valid document. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function broken(mutate: (doc: any) => void): Draft {
  const doc = valid()
  mutate(doc)
  return doc
}

function expectFailure(doc: unknown, expectedPath: string): void {
  assert.throws(
    () => parseSiteContentDocument(doc, 'test'),
    (thrown: unknown) => {
      const error = thrown as Error
      assert.equal(error.name, 'ContentParseError')
      assert.ok(
        error.message.includes(expectedPath),
        `message should name "${expectedPath}" — got: ${error.message}`,
      )
      return true
    },
  )
}

// ── The happy path ───────────────────────────────────────────────────────────

test('a well-formed document parses and round-trips', () => {
  const parsed = parseSiteContentDocument(valid(), 'test')
  assert.equal(parsed.version, CONTENT_DOCUMENT_VERSION)
  assert.equal(parsed.settings.title, 'THE KANJO')
  assert.equal(parsed.sections.length, 1)
})

test('buildSiteContentDocument stamps the current version', () => {
  const doc = buildSiteContentDocument({
    settings: valid().settings as unknown as SiteSettings,
    loader: valid().loader as unknown as LoaderConfig,
    sections: valid().sections as unknown as Section[],
    videos: [] as Video[],
    media: [] as MediaItem[],
    links: [] as LinkBlock[],
  })
  assert.equal(doc.version, CONTENT_DOCUMENT_VERSION)
  assert.doesNotThrow(() => parseSiteContentDocument(doc, 'test'))
})

// ── It fails LOUDLY, naming the path ─────────────────────────────────────────

test('a non-object document is refused', () => {
  for (const value of [null, undefined, 'a string', 42, []]) {
    expectFailure(value, 'content')
  }
})

test('missing top-level sections are named individually', () => {
  expectFailure(broken((d) => delete d.settings), 'content.settings')
  expectFailure(broken((d) => delete d.loader), 'content.loader')
  expectFailure(broken((d) => delete d.sections), 'content.sections')
  expectFailure(broken((d) => delete d.videos), 'content.videos')
})

test('a missing nested settings field names its full path', () => {
  expectFailure(broken((d) => delete d.settings.seo.description), 'content.settings.seo.description')
  expectFailure(broken((d) => delete d.settings.chrome.socialCluster), 'content.settings.chrome.socialCluster')
  expectFailure(broken((d) => delete d.settings.publisher.url), 'content.settings.publisher.url')
  expectFailure(broken((d) => delete d.settings.footer.copyrightHolder), 'content.settings.footer.copyrightHolder')
})

test('a legal page with no body is refused — it is a route', () => {
  // A missing body would be a 200 with nothing on it, on the two pages a
  // visitor reads before trusting the site with anything.
  expectFailure(broken((d) => delete d.settings.legal.privacy.body), 'content.settings.legal.privacy.body')
  expectFailure(broken((d) => delete d.settings.legal.terms), 'content.settings.legal.terms')
})

test('a bad social entry names its index', () => {
  expectFailure(broken((d) => delete d.settings.social[0].url), 'content.settings.social[0].url')
  expectFailure(
    broken((d) => (d.settings.social[0].published = 'yes')),
    'content.settings.social[0].published',
  )
})

test('an EMPTY social url is valid — that is how an unannounced channel is stored', () => {
  // Steam. The key must exist; the value may be empty, and the cluster drops it.
  assert.doesNotThrow(() =>
    parseSiteContentDocument(
      broken((d) => (d.settings.social[0].url = '')),
      'test',
    ),
  )
})

// ── The section union ────────────────────────────────────────────────────────

test('an unknown section type is REFUSED, not silently skipped', () => {
  // renderSection switches exhaustively, so an unknown type would fall through
  // to the `never` branch and render nothing at all — silently, which is worse
  // than failing.
  expectFailure(broken((d) => (d.sections[0].type = 'carousel')), 'content.sections[0].type')
})

test('every known section type is accepted', () => {
  for (const type of ['hero', 'intro', 'youtube', 'tiktok', 'patreon', 'video', 'media']) {
    assert.doesNotThrow(
      () => parseSiteContentDocument(broken((d) => (d.sections[0].type = type)), 'test'),
      `${type} should be accepted`,
    )
  }
})

test('duplicate section ids are refused — ids address content', () => {
  expectFailure(
    broken((d) => d.sections.push({ ...d.sections[0] })),
    'content.sections[1].id',
  )
})

test('a section missing published or order is refused', () => {
  expectFailure(broken((d) => delete d.sections[0].published), 'content.sections[0].published')
  expectFailure(broken((d) => delete d.sections[0].order), 'content.sections[0].order')
  expectFailure(broken((d) => delete d.sections[0].config), 'content.sections[0].config')
})

// ── The loader ───────────────────────────────────────────────────────────────

test('a loader missing either vehicle is refused', () => {
  // Not cosmetic: a missing car leaves an opaque overlay with nothing moving
  // across it, covering the page until the ceiling expires.
  expectFailure(broken((d) => delete d.loader.carA), 'content.loader.carA')
  expectFailure(broken((d) => delete d.loader.carB.width), 'content.loader.carB.width')
})

test('a loader maximum below its minimum is refused', () => {
  expectFailure(
    broken((d) => {
      d.loader.minimumDisplayMs = 5000
      d.loader.maximumDisplayMs = 1000
    }),
    'content.loader.maximumDisplayMs',
  )
})

// ── Versioning ───────────────────────────────────────────────────────────────

test('a document from a NEWER deployment is refused with an actionable message', () => {
  assert.throws(
    () => parseSiteContentDocument(broken((d) => (d.version = CONTENT_DOCUMENT_VERSION + 5)), 'test'),
    /content\.version[\s\S]*deploy the newer build/,
  )
})

test('a missing version is refused rather than assumed', () => {
  expectFailure(broken((d) => delete d.version), 'content.version')
})

// ── Nothing is invented ──────────────────────────────────────────────────────

test('the validator never fills a gap with a default', () => {
  // The whole content discipline is that nothing is invented. A validator that
  // patched a missing title with '' would put an empty <h1> on the homepage and
  // report success.
  assert.throws(() => parseSiteContentDocument(broken((d) => delete d.settings.title), 'test'))
  const parsed = parseSiteContentDocument(valid(), 'test')
  assert.equal(parsed.settings.title, 'THE KANJO')
})

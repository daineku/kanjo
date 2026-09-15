/**
 * Regression tests for the remote content cache and the lost-update guard.
 *
 * Run with `npm run test:remote`.
 *
 * ── WHAT THESE EXERCISE ─────────────────────────────────────────────────────
 *
 * The REAL `RemoteContentSource` and `RemoteContentStore` classes, imported
 * from the production modules — not copies of their logic. Both take a Supabase
 * PROVIDER rather than importing one, which is exactly why that is possible:
 * the credential access lives in lib/content/remote/index.ts behind
 * `server-only`, and the read-modify-write logic does not.
 *
 * The double below implements `SupabaseLike` — the same interface the real
 * client is adapted to — over an in-memory row, including the two behaviours
 * the guard depends on: `update().eq().eq().select()` returns the rows it
 * actually changed, and `updated_at` moves on every successful write.
 *
 * ── THE BUG THESE EXIST TO PREVENT ──────────────────────────────────────────
 *
 * The first implementation memoised the document on the SOURCE INSTANCE, and
 * `resolveContentSource()` keeps one instance per process. So the document was
 * read once per PROCESS: an admin save landed in Supabase, `revalidatePath`
 * rebuilt the page, and the rebuild was handed the same stale promise. The
 * public site would have served old content until the serverless instance
 * recycled.
 *
 * The first test below is the one that would have caught it. Note what it does
 * NOT do: it never re-imports a module, never clears a cache by hand, never
 * constructs a second source, and never restarts anything. One process, one
 * source instance, read → write → read.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { CONTENT_ROW_ID, CONTENT_TABLE, type SupabaseLike } from './client.ts'
import { RemoteContentSource, type ArticleReader, type FeedResolver } from './source.ts'
import { RemoteContentStore } from './store.ts'
import { CONTENT_DOCUMENT_VERSION } from '../document.ts'
import type { LoaderConfig, SiteSettings } from '../types.ts'

// ── A document, parameterised by the one field these tests look at ───────────

function documentWithTitle(title: string) {
  return {
    version: CONTENT_DOCUMENT_VERSION,
    settings: {
      title,
      primaryDomain: 'https://thekanjo.com',
      seo: { title, titleTemplate: '%s — X', description: 'A game.' },
      nav: [],
      social: [],
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
      carA: { src: '/media/loader/a.svg', alt: '', width: 200, height: 80 },
      carB: { src: '/media/loader/b.svg', alt: '', width: 200, height: 80 },
    },
    sections: [{ id: 'hero', type: 'hero', published: true, order: 0, config: { title } }],
    videos: [],
    media: [],
    links: [],
  }
}

/**
 * An in-memory stand-in for the one table this site uses.
 *
 * It is faithful about the two things the production code depends on:
 * `update` honours BOTH `eq` predicates and reports how many rows matched, and
 * a successful write advances `updated_at`.
 */
class FakeSupabase implements SupabaseLike {
  row: { content: unknown; updated_at: string } | null
  /** Every read, so a test can assert how many queries a render cost. */
  reads = 0
  writes = 0
  /**
   * Runs immediately AFTER a read resolves.
   *
   * This is how a test simulates the real race: the store reads the row and
   * gets version V, somebody else's save lands, and the store's conditional
   * write then finds V gone. Without a hook there is no way to interleave two
   * operations that are inside one `await`.
   */
  afterRead: (() => void) | null = null

  constructor(content: unknown, updatedAt = '2026-01-01T00:00:00.000Z') {
    this.row = { content, updated_at: updatedAt }
  }

  /**
   * Arrow properties throughout, so every nested closure resolves `this`
   * lexically to the instance. Object-literal methods would rebind it, which is
   * why the first version needed a `const db = this` alias.
   */
  from = (table: string) => {
    assert.equal(table, CONTENT_TABLE, 'the site must only touch its own table')

    return {
      select: (_columns: string) => ({
        eq: (column: string, value: string) => {
          assert.equal(column, 'id')
          return {
            maybeSingle: async () => {
              this.reads += 1
              if (value !== CONTENT_ROW_ID || !this.row) return { data: null, error: null }
              const snapshot = { ...this.row }
              this.afterRead?.()
              return { data: snapshot, error: null }
            },
          }
        },
      }),

      update: (values: Record<string, unknown>) => {
        const predicates: [string, string][] = []
        const builder = {
          eq: (column: string, value: string) => {
            predicates.push([column, value])
            return builder
          },
          select: async (_columns: string) => {
            this.writes += 1
            if (!this.row) return { data: [], error: null }

            const current: Record<string, unknown> = {
              id: CONTENT_ROW_ID,
              updated_at: this.row.updated_at,
            }
            // EVERY predicate must match, which is what makes the conditional
            // write conditional.
            const matches = predicates.every(([column, value]) => current[column] === value)
            if (!matches) return { data: [], error: null }

            this.row = {
              content: values.content,
              // A real trigger moves this on every write. So does this double —
              // without it a second save would still match the first version.
              updated_at: new Date(Date.parse(this.row.updated_at) + 1000).toISOString(),
            }
            return { data: [{ id: CONTENT_ROW_ID }], error: null }
          },
        }
        return builder
      },
    }
  }
}

const noMedia = {
  async save() {
    throw new Error('not used in these tests')
  },
}

/**
 * Stubs for the two server-only collaborators the source injects.
 *
 * `../externals` reaches Patreon and YouTube; `../local` reaches the
 * filesystem. Neither is what these tests are about, and both would pull
 * `server-only` into a `node` process. Injecting them is why the REAL source
 * class can be exercised here at all.
 */
const noFeeds: FeedResolver = async () => ({
  patreon: { status: 'unconfigured', posts: [] },
  youtube: { status: 'unconfigured' },
})

const noArticles: ArticleReader = {
  async listArticles() {
    return []
  },
  async getArticle() {
    return null
  },
  async listArticleSlugs() {
    return []
  },
}

function build(content: unknown) {
  const db = new FakeSupabase(content)
  const provider = () => db as SupabaseLike
  return {
    db,
    source: new RemoteContentSource(provider, { feeds: noFeeds, articles: noArticles }),
    store: new RemoteContentStore(provider, noMedia, { writable: true }),
  }
}

// ── THE CACHE-INVALIDATION PROOF ─────────────────────────────────────────────

test('a write is visible to the SAME source instance on the next read', async () => {
  const { source, store } = build(documentWithTitle('VERSION A'))

  // READ A
  const first = await source.getSiteSettings()
  assert.equal(first.title, 'VERSION A')

  // WRITE B — through the real store, against the same row.
  const draft = await store.loadDraft()
  await store.saveSiteSettings({ ...draft.settings, title: 'VERSION B' } as SiteSettings)

  // READ B — same process, same module registry, same source object. No
  // re-import, no manual cache clearing, no new instance.
  const second = await source.getSiteSettings()
  assert.equal(
    second.title,
    'VERSION B',
    'the source served a stale document — a process-lifetime cache has been reintroduced',
  )
})

test('the source holds no document between reads', async () => {
  const { db, source } = build(documentWithTitle('FIRST'))

  await source.getSiteSettings()
  const readsAfterFirst = db.reads

  // Change the row underneath the source, the way an admin on another instance
  // (or a psql session) would.
  db.row = { content: documentWithTitle('SECOND'), updated_at: '2026-02-02T00:00:00.000Z' }

  const second = await source.getSiteSettings()
  assert.equal(second.title, 'SECOND')
  assert.ok(
    db.reads > readsAfterFirst,
    'the second read did not reach the database, so something is caching the document',
  )
})

test('every reader on the source sees the same fresh write', async () => {
  const { source, store } = build(documentWithTitle('BEFORE'))

  await source.getLandingContent()

  const draft = await store.loadDraft()
  await store.saveLoaderConfig({ ...draft.loader, minimumDisplayMs: 999 } as LoaderConfig)

  // Three different entry points, all of which previously shared the cached
  // promise.
  assert.equal((await source.getLoaderConfig()).minimumDisplayMs, 999)
  assert.equal((await source.getLandingContent()).loader.minimumDisplayMs, 999)
  assert.equal((await source.getSiteSettings()).title, 'BEFORE')
})

// ── THE LOST-UPDATE GUARD ────────────────────────────────────────────────────

test('a stale save is REFUSED rather than silently overwriting', async () => {
  const { db, store } = build(documentWithTitle('ORIGINAL'))

  // THE REAL INTERLEAVE. The store reads the row and gets version V. Before its
  // conditional write lands, somebody else's save moves the row to V'. The
  // precondition `updated_at = V` now matches nothing.
  db.afterRead = () => {
    db.afterRead = null // once, so the retry below is not sabotaged too
    db.row = { content: db.row!.content, updated_at: '2099-01-01T00:00:00.000Z' }
  }

  await assert.rejects(
    () =>
      store.saveSiteSettings({
        ...documentWithTitle('TAB A WINS').settings,
      } as unknown as SiteSettings),
    (error: unknown) => {
      assert.match((error as Error).message, /somebody else saved|reload/i)
      return true
    },
  )

  const stored = db.row?.content as ReturnType<typeof documentWithTitle>
  assert.equal(
    stored.settings.title,
    'ORIGINAL',
    'the stale write must not have landed over the other save',
  )
})

test('after reloading, the same edit saves cleanly', async () => {
  // The other half of the guard: a conflict is recoverable, not a dead end.
  const { db, store } = build(documentWithTitle('ORIGINAL'))
  db.afterRead = () => {
    db.afterRead = null
    db.row = { content: db.row!.content, updated_at: '2099-01-01T00:00:00.000Z' }
  }

  await assert.rejects(() =>
    store.saveSiteSettings(documentWithTitle('FIRST TRY').settings as unknown as SiteSettings),
  )

  // Reload and redo — exactly what the error message tells the editor to do.
  const draft = await store.loadDraft()
  await store.saveSiteSettings({ ...draft.settings, title: 'SECOND TRY' } as SiteSettings)

  const stored = db.row?.content as ReturnType<typeof documentWithTitle>
  assert.equal(stored.settings.title, 'SECOND TRY')
})

test('a normal save succeeds and advances the version', async () => {
  const { db, store } = build(documentWithTitle('ONE'))

  const before = db.row?.updated_at
  const draft = await store.loadDraft()
  await store.saveSiteSettings({ ...draft.settings, title: 'TWO' } as SiteSettings)

  assert.notEqual(db.row?.updated_at, before, 'updated_at must move on a write')
  assert.equal(db.writes, 1)
  const stored = db.row?.content as ReturnType<typeof documentWithTitle>
  assert.equal(stored.settings.title, 'TWO')
})

test('a read-only store refuses to write at all', async () => {
  const db = new FakeSupabase(documentWithTitle('LOCKED'))
  const store = new RemoteContentStore(() => db as SupabaseLike, noMedia, {
    writable: false,
    readOnlyReason: 'This is a PREVIEW deployment.',
  })

  await assert.rejects(
    () => store.saveSiteSettings(documentWithTitle('X').settings as unknown as SiteSettings),
    /PREVIEW/,
  )
  assert.equal(db.writes, 0, 'a refused write must not reach the database')
})

// ── The document is still validated at both boundaries ───────────────────────

test('a malformed stored row fails loudly, naming the path', async () => {
  const broken = documentWithTitle('X') as Record<string, unknown>
  delete (broken.settings as Record<string, unknown>).publisher

  const { source } = build(broken)
  await assert.rejects(() => source.getSiteSettings(), /content\.settings\.publisher/)
})

test('a missing row is an actionable error, not an empty site', async () => {
  const db = new FakeSupabase(documentWithTitle('X'))
  db.row = null
  const source = new RemoteContentSource(() => db as SupabaseLike)

  await assert.rejects(() => source.getSiteSettings(), /has no row with id='main'/)
})

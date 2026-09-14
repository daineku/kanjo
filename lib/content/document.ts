// Explicit `.ts` extensions: this module is executed directly by `node` from
// scripts/export-content.mjs and from its own test, and Node's resolver needs
// the real filename. `allowImportingTsExtensions` in tsconfig.json is what lets
// the bundler accept the same specifiers — the convention the rest of this
// repository's node-executable modules already follow.
import { ContentParseError } from './local/parse.ts'
import { SECTION_TYPES } from './types.ts'
import type {
  LinkBlock,
  LoaderConfig,
  MediaItem,
  Section,
  SiteSettings,
  Video,
} from './types.ts'

/**
 * The whole of the site's configuration, as one document.
 *
 * ── WHY ONE DOCUMENT AND NOT A TABLE PER ENTITY ─────────────────────────────
 *
 * The site has ONE of everything: one settings object, one loader, one ordered
 * list of sections. There is no query anybody wants to run across them, no
 * entity that is fetched independently, and no page that needs a subset. A
 * normalised schema would buy joins nobody performs and cost a round trip per
 * section — the brief's own requirement is one query for `id='main'`, and this
 * is the shape that makes that possible.
 *
 * Articles are deliberately NOT in here. They are long-form Markdown, they live
 * in `content/updates/`, and they ship with the deployment — see
 * SupabaseContentSource for why that is the right split rather than an
 * omission.
 *
 * ── AND WHY IT IS VALIDATED ─────────────────────────────────────────────────
 *
 * `content jsonb` is a column, not a type. Nothing in Postgres stops a bad
 * write, an interrupted migration or a hand-edited row from putting a shape in
 * there that the UI cannot render — and because the rest of the codebase reads
 * typed values without re-checking them, the boundary where that has to be
 * caught is HERE. The alternative is a `settings.social.map is not a function`
 * inside a server render, which surfaces as a 500 with no indication of which
 * field was wrong.
 *
 * The validator's rule: FAIL LOUDLY, NAMING THE PATH. Never patch a missing
 * field with a default, because a default is an invented value and the site's
 * whole content discipline is that nothing is invented.
 */

/**
 * Bumped when a change to the document's shape is not backward-compatible.
 * Read on the way in so an old row produces a clear message rather than a
 * confusing partial render.
 */
export const CONTENT_DOCUMENT_VERSION = 1

export type SiteContentDocument = {
  version: number
  settings: SiteSettings
  loader: LoaderConfig
  sections: Section[]
  videos: Video[]
  media: MediaItem[]
  links: LinkBlock[]
}

// ── Assertions ───────────────────────────────────────────────────────────────

function fail(where: string, path: string, message: string): never {
  throw new ContentParseError(`${path} ${message}`, where)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown, where: string, path: string): Record<string, unknown> {
  if (!isRecord(value)) fail(where, path, `must be an object, got ${describe(value)}`)
  return value
}

function requireArray(value: unknown, where: string, path: string): unknown[] {
  if (!Array.isArray(value)) fail(where, path, `must be an array, got ${describe(value)}`)
  return value
}

function requireString(value: unknown, where: string, path: string): string {
  if (typeof value !== 'string') fail(where, path, `must be a string, got ${describe(value)}`)
  return value
}

function requireBoolean(value: unknown, where: string, path: string): boolean {
  if (typeof value !== 'boolean') fail(where, path, `must be a boolean, got ${describe(value)}`)
  return value
}

function requireNumber(value: unknown, where: string, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(where, path, `must be a finite number, got ${describe(value)}`)
  }
  return value
}

/** A short, safe description of a bad value. Never prints the value itself. */
function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `an array of ${value.length}`
  return typeof value
}

// ── The document ─────────────────────────────────────────────────────────────

/**
 * Validates and returns a stored content document.
 *
 * Structural rather than exhaustive: it checks the keys the UI dereferences
 * without guarding, the discriminated union that `renderSection` switches on,
 * and the `Publishable` fields the source sorts and filters by. Optional
 * display strings are not policed — a wrong one renders as a wrong string,
 * which is an editing mistake, not a crash.
 */
export function parseSiteContentDocument(
  value: unknown,
  where = 'the stored content document',
): SiteContentDocument {
  const doc = requireRecord(value, where, 'content')

  const version = requireNumber(doc.version, where, 'content.version')
  if (version > CONTENT_DOCUMENT_VERSION) {
    fail(
      where,
      'content.version',
      `is ${version}, but this deployment understands at most ${CONTENT_DOCUMENT_VERSION}. ` +
        `The database is ahead of the code — deploy the newer build rather than downgrading the row.`,
    )
  }

  return {
    version,
    settings: parseSettings(doc.settings, where),
    loader: parseLoader(doc.loader, where),
    sections: parseSections(doc.sections, where),
    videos: parsePublishableList<Video>(doc.videos, where, 'content.videos'),
    media: parsePublishableList<MediaItem>(doc.media, where, 'content.media'),
    links: parsePublishableList<LinkBlock>(doc.links, where, 'content.links'),
  }
}

function parseSettings(value: unknown, where: string): SiteSettings {
  const settings = requireRecord(value, where, 'content.settings')

  requireString(settings.title, where, 'content.settings.title')
  requireString(settings.primaryDomain, where, 'content.settings.primaryDomain')

  const seo = requireRecord(settings.seo, where, 'content.settings.seo')
  requireString(seo.title, where, 'content.settings.seo.title')
  requireString(seo.titleTemplate, where, 'content.settings.seo.titleTemplate')
  requireString(seo.description, where, 'content.settings.seo.description')

  // `nav`, `social` and `footer.links` are all mapped over without a guard.
  requireArray(settings.nav, where, 'content.settings.nav')

  const social = requireArray(settings.social, where, 'content.settings.social')
  social.forEach((entry, index) => {
    const path = `content.settings.social[${index}]`
    const link = requireRecord(entry, where, path)
    requireString(link.id, where, `${path}.id`)
    // The empty string is MEANINGFUL here — it is how an unannounced channel is
    // represented, and the cluster drops it. What must not be missing is the key.
    requireString(link.url, where, `${path}.url`)
    requireString(link.label, where, `${path}.label`)
    requireBoolean(link.published, where, `${path}.published`)
    requireNumber(link.order, where, `${path}.order`)
  })

  const status = requireRecord(settings.status, where, 'content.settings.status')
  requireString(status.label, where, 'content.settings.status.label')

  // The publisher feeds JSON-LD, where a missing field becomes a malformed
  // assertion rather than a visible gap.
  const publisher = requireRecord(settings.publisher, where, 'content.settings.publisher')
  requireString(publisher.name, where, 'content.settings.publisher.name')
  requireString(publisher.url, where, 'content.settings.publisher.url')

  const footer = requireRecord(settings.footer, where, 'content.settings.footer')
  requireString(footer.copyrightHolder, where, 'content.settings.footer.copyrightHolder')
  requireArray(footer.links, where, 'content.settings.footer.links')

  const chrome = requireRecord(settings.chrome, where, 'content.settings.chrome')
  requireBoolean(chrome.headerOnReadingPages, where, 'content.settings.chrome.headerOnReadingPages')
  requireBoolean(chrome.headerOnHome, where, 'content.settings.chrome.headerOnHome')
  requireBoolean(chrome.socialCluster, where, 'content.settings.chrome.socialCluster')

  return settings as unknown as SiteSettings
}

function parseLoader(value: unknown, where: string): LoaderConfig {
  const loader = requireRecord(value, where, 'content.loader')

  requireBoolean(loader.enabled, where, 'content.loader.enabled')
  const minimum = requireNumber(loader.minimumDisplayMs, where, 'content.loader.minimumDisplayMs')
  const maximum = requireNumber(loader.maximumDisplayMs, where, 'content.loader.maximumDisplayMs')
  if (maximum < minimum) {
    fail(
      where,
      'content.loader.maximumDisplayMs',
      `(${maximum}) is below minimumDisplayMs (${minimum}). The maximum is the escape path and must be the later of the two.`,
    )
  }

  // Both vehicles are required, and the reason is not cosmetic: a missing car
  // leaves an opaque overlay with nothing moving across it, covering the page
  // until the loader's own ceiling expires.
  for (const key of ['carA', 'carB'] as const) {
    const car = requireRecord(loader[key], where, `content.loader.${key}`)
    requireString(car.src, where, `content.loader.${key}.src`)
    requireNumber(car.width, where, `content.loader.${key}.width`)
    requireNumber(car.height, where, `content.loader.${key}.height`)
  }

  return loader as unknown as LoaderConfig
}

function parseSections(value: unknown, where: string): Section[] {
  const sections = requireArray(value, where, 'content.sections')
  const seen = new Set<string>()

  sections.forEach((entry, index) => {
    const path = `content.sections[${index}]`
    const section = requireRecord(entry, where, path)

    const id = requireString(section.id, where, `${path}.id`)
    if (seen.has(id)) {
      fail(where, `${path}.id`, `duplicates "${id}". Section ids address content and must be unique.`)
    }
    seen.add(id)

    // THE DISCRIMINANT. `renderSection` switches on this exhaustively, so a
    // type it does not know would fall through to the `never` branch and render
    // nothing at all — silently, which is the worst outcome.
    const type = requireString(section.type, where, `${path}.type`)
    if (!(SECTION_TYPES as readonly string[]).includes(type)) {
      fail(
        where,
        `${path}.type`,
        `is "${type}", which this deployment has no component for. Known types: ${SECTION_TYPES.join(', ')}.`,
      )
    }

    requireBoolean(section.published, where, `${path}.published`)
    requireNumber(section.order, where, `${path}.order`)
    requireRecord(section.config, where, `${path}.config`)
  })

  return sections as unknown as Section[]
}

/** Shared shape for the three `Publishable` lists: id, published, order. */
function parsePublishableList<T>(value: unknown, where: string, path: string): T[] {
  const entries = requireArray(value, where, path)
  entries.forEach((entry, index) => {
    const itemPath = `${path}[${index}]`
    const item = requireRecord(entry, where, itemPath)
    requireString(item.id, where, `${itemPath}.id`)
    requireBoolean(item.published, where, `${itemPath}.published`)
    requireNumber(item.order, where, `${itemPath}.order`)
  })
  return entries as unknown as T[]
}

/**
 * Builds the document from the pieces the local source reads.
 *
 * Used by the admin when publishing local content to the remote store, and by
 * the seed script. `version` is stamped here so there is exactly one place that
 * decides what a freshly written document claims to be.
 */
export function buildSiteContentDocument(parts: {
  settings: SiteSettings
  loader: LoaderConfig
  sections: Section[]
  videos: Video[]
  media: MediaItem[]
  links: LinkBlock[]
}): SiteContentDocument {
  return { version: CONTENT_DOCUMENT_VERSION, ...parts }
}

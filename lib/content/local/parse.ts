/**
 * Pure parsing and validation for the local content source.
 *
 * Nothing here touches the filesystem, so every branch is testable by calling a
 * function with a string (see parse.test.ts). The filesystem lives next door in
 * index.ts.
 */

import type { Article, ArticleStatus, ImageRef, Publishable } from '../types'

export class ContentParseError extends Error {
  /** The file the failure came from, so the message can name it. */
  readonly where: string

  // Written out rather than as a TypeScript parameter property: this module is
  // executed directly by `node` in parse.test.ts, and Node's type stripping
  // rejects parameter properties because erasing them changes runtime
  // behaviour rather than only removing types.
  constructor(message: string, where: string) {
    super(`${where}: ${message}`)
    this.name = 'ContentParseError'
    this.where = where
  }
}

// ── Frontmatter ──────────────────────────────────────────────────────────────

export type Frontmatter = Record<string, string | string[] | boolean | number>

export type ParsedDocument = {
  data: Frontmatter
  body: string
}

const FRONTMATTER_DELIMITER = '---'

/**
 * Splits a `---` delimited frontmatter block from a Markdown body.
 *
 * The value grammar is deliberately tiny — scalars, quoted scalars, `true` /
 * `false`, numbers, and `[a, b]` inline lists — rather than a YAML dependency.
 * Content this site authors is written by the site's own owner, so the parser
 * only has to handle what the authoring guide documents, and an unparseable
 * line is an error rather than a guess.
 */
export function parseDocument(raw: string, where: string): ParsedDocument {
  const text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n')

  if (!text.startsWith(`${FRONTMATTER_DELIMITER}\n`)) {
    throw new ContentParseError('missing frontmatter block', where)
  }

  const end = text.indexOf(`\n${FRONTMATTER_DELIMITER}`, FRONTMATTER_DELIMITER.length)
  if (end === -1) {
    throw new ContentParseError('unterminated frontmatter block', where)
  }

  const head = text.slice(FRONTMATTER_DELIMITER.length + 1, end)
  const bodyStart = text.indexOf('\n', end + 1 + FRONTMATTER_DELIMITER.length)
  const body = bodyStart === -1 ? '' : text.slice(bodyStart + 1)

  const data: Frontmatter = {}
  head.split('\n').forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return

    const colon = trimmed.indexOf(':')
    if (colon === -1) {
      throw new ContentParseError(
        `frontmatter line ${index + 1} has no "key: value" separator`,
        where,
      )
    }

    const key = trimmed.slice(0, colon).trim()
    const value = trimmed.slice(colon + 1).trim()
    if (!key) {
      throw new ContentParseError(`frontmatter line ${index + 1} has an empty key`, where)
    }
    data[key] = parseScalar(value)
  })

  return { data, body: body.trim() }
}

function parseScalar(value: string): string | string[] | boolean | number {
  if (value === '') return ''
  if (value === 'true') return true
  if (value === 'false') return false

  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(',').map((part) => unquote(part.trim()))
  }

  // A bare number, but not a date like 2026-08-31 and not a version like 1.0.0.
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)

  return unquote(value)
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
}

// ── Field readers ────────────────────────────────────────────────────────────

export function requireString(data: Frontmatter, key: string, where: string): string {
  const value = data[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ContentParseError(`"${key}" is required and must be a non-empty string`, where)
  }
  return value.trim()
}

export function optionalString(data: Frontmatter, key: string): string | undefined {
  const value = data[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

export function readBoolean(data: Frontmatter, key: string, fallback: boolean): boolean {
  const value = data[key]
  return typeof value === 'boolean' ? value : fallback
}

export function readNumber(data: Frontmatter, key: string, fallback: number): number {
  const value = data[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function readStringList(data: Frontmatter, key: string): string[] {
  const value = data[key]
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter((entry) => entry !== '')
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
  }
  return []
}

/**
 * Rejects anything that is not an ISO calendar date.
 *
 * A date is used for ordering, for `<time datetime>` and for structured data,
 * so a value the Date constructor merely tolerates ("last tuesday" is Invalid
 * Date, but "2026-13-45" silently rolls over in some engines) is a defect that
 * surfaces as a wrong sitemap rather than as an error.
 */
export function requireIsoDate(data: Frontmatter, key: string, where: string): string {
  const value = requireString(data, key, where)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ContentParseError(`"${key}" must be an ISO date (YYYY-MM-DD), got "${value}"`, where)
  }
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new ContentParseError(`"${key}" is not a real calendar date: "${value}"`, where)
  }
  return value
}

export function optionalIsoDate(
  data: Frontmatter,
  key: string,
  where: string,
): string | undefined {
  if (data[key] === undefined || data[key] === '') return undefined
  return requireIsoDate(data, key, where)
}

/**
 * Reads a cover image from `cover`, `coverAlt`, `coverWidth`, `coverHeight`.
 *
 * Width and height are mandatory whenever a src is given. An image without
 * intrinsic dimensions cannot reserve its own space, and reserving space is the
 * whole of not shifting layout.
 */
export function readImage(
  data: Frontmatter,
  prefix: string,
  where: string,
): ImageRef | undefined {
  const src = optionalString(data, prefix)
  if (!src) return undefined

  const width = readNumber(data, `${prefix}Width`, 0)
  const height = readNumber(data, `${prefix}Height`, 0)

  if (width <= 0 || height <= 0) {
    throw new ContentParseError(
      `"${prefix}" needs "${prefix}Width" and "${prefix}Height" (intrinsic pixel size) ` +
        `so the layout can reserve space before the image loads`,
      where,
    )
  }

  return {
    src,
    alt: optionalString(data, `${prefix}Alt`) ?? '',
    width,
    height,
  }
}

// ── Article ──────────────────────────────────────────────────────────────────

const ARTICLE_STATUSES: ArticleStatus[] = ['draft', 'published']

/** Derives an excerpt from the body when the frontmatter does not state one. */
export function deriveExcerpt(body: string, limit = 200): string {
  const firstParagraph = body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find((block) => block !== '' && !block.startsWith('#') && !block.startsWith('!['))

  if (!firstParagraph) return ''

  const flattened = firstParagraph
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (flattened.length <= limit) return flattened
  const cut = flattened.slice(0, limit)
  const lastSpace = cut.lastIndexOf(' ')
  // Three periods, not U+2026. Iceland — the canon's `technical` family and the
  // face every excerpt renders in — has no ellipsis glyph, so a real one falls
  // through to whatever the OS offers and renders in a different typeface
  // mid-sentence. Verified against the font's cmap, not assumed.
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}...`
}

/**
 * Turns one parsed `.md` document into an Article.
 *
 * `slug` comes from the filename rather than the frontmatter: a file and its URL
 * must not be able to disagree, and a duplicate slug then becomes impossible
 * rather than merely unlikely.
 */
export function toArticle(doc: ParsedDocument, slug: string, where: string): Article {
  const { data, body } = doc

  const statusRaw = optionalString(data, 'status') ?? 'published'
  if (!ARTICLE_STATUSES.includes(statusRaw as ArticleStatus)) {
    throw new ContentParseError(
      `"status" must be one of ${ARTICLE_STATUSES.join(', ')}, got "${statusRaw}"`,
      where,
    )
  }

  const externalLabel = optionalString(data, 'externalSourceLabel')
  const externalUrl = optionalString(data, 'externalSourceUrl')
  if ((externalLabel && !externalUrl) || (externalUrl && !externalLabel)) {
    throw new ContentParseError(
      '"externalSourceLabel" and "externalSourceUrl" must be set together',
      where,
    )
  }

  const seoTitle = optionalString(data, 'seoTitle')
  const seoDescription = optionalString(data, 'seoDescription')
  const socialImage = readImage(data, 'socialImage', where)

  return {
    slug,
    title: requireString(data, 'title', where),
    excerpt: optionalString(data, 'excerpt') ?? deriveExcerpt(body),
    cover: readImage(data, 'cover', where),
    author: optionalString(data, 'author'),
    publishedAt: requireIsoDate(data, 'publishedAt', where),
    updatedAt: optionalIsoDate(data, 'updatedAt', where),
    tags: readStringList(data, 'tags'),
    featured: readBoolean(data, 'featured', false),
    order: readNumber(data, 'order', 0),
    status: statusRaw as ArticleStatus,
    body,
    ...(externalLabel && externalUrl
      ? { externalSource: { label: externalLabel, url: externalUrl } }
      : {}),
    ...(seoTitle || seoDescription || socialImage
      ? {
          seo: {
            ...(seoTitle ? { title: seoTitle } : {}),
            ...(seoDescription ? { description: seoDescription } : {}),
            ...(socialImage ? { socialImage } : {}),
          },
        }
      : {}),
  }
}

/** `2026-08-31-my-post.md` and `my-post.md` both yield a usable slug. */
export function slugFromFilename(filename: string): string {
  return filename
    .replace(/\.md$/i, '')
    .replace(/^\d{4}-\d{2}-\d{2}-/, '')
    .trim()
}

// ── Ordering ─────────────────────────────────────────────────────────────────

/**
 * Drops unpublished entries and sorts by `order`, then by source position.
 *
 * This is the single place the "filtering and ordering happen in the source"
 * rule from lib/content/source.ts is implemented for the local JSON files.
 */
export function publishedInOrder<T extends Publishable>(entries: readonly T[]): T[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.published)
    .sort((a, b) => a.entry.order - b.entry.order || a.index - b.index)
    .map(({ entry }) => entry)
}

type Datable = { slug: string; publishedAt: string; order: number }

/** Newest first; a tie is broken by `order` and then by slug so it is stable. */
export function articlesNewestFirst<T extends Datable>(articles: readonly T[]): T[] {
  return [...articles].sort(
    (a, b) =>
      b.publishedAt.localeCompare(a.publishedAt) ||
      a.order - b.order ||
      a.slug.localeCompare(b.slug),
  )
}

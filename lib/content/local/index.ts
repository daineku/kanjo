import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { ContentConfigurationError, type ContentSource } from '../source'
import type {
  Article,
  ArticleSummary,
  LandingContent,
  LinkBlock,
  MediaItem,
  Section,
  SiteSettings,
  Video,
} from '../types'
import {
  ContentParseError,
  articlesNewestFirst,
  parseDocument,
  publishedInOrder,
  slugFromFilename,
  toArticle,
} from './parse'

/**
 * Reads content from the `content/` directory.
 *
 * This is the default source, and the reason `npm run dev` works in a fresh
 * clone with no environment variables at all. It is also the reference
 * implementation of the ContentSource contract: filter and sort here, return
 * null for a missing entity, throw only for misconfiguration.
 *
 * Everything is read on the server. `content/` is never bundled into a client
 * component, so none of it reaches the browser except as rendered markup.
 */

const CONTENT_DIR = path.join(process.cwd(), 'content')
const UPDATES_DIR = path.join(CONTENT_DIR, 'updates')

/**
 * Reads are memoised for the life of the process.
 *
 * In production the whole site is prerendered, so this is read once per build.
 * In development Next.js reloads the module on change, which is what drops the
 * cache — so editing a JSON file still shows up, and a single request does not
 * read the same file five times because five sections wanted it.
 */
const fileCache = new Map<string, Promise<unknown>>()

async function readJson<T>(name: string): Promise<T> {
  const cached = fileCache.get(name)
  if (cached) return cached as Promise<T>

  const promise = (async () => {
    const file = path.join(CONTENT_DIR, name)
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch (cause) {
      throw new ContentConfigurationError(
        `Missing content file "content/${name}". The local content source needs it. ` +
          `See docs/CONTENT.md for the expected shape.`,
      )
    }
    try {
      return JSON.parse(raw.replace(/^﻿/, '')) as T
    } catch (cause) {
      throw new ContentParseError(
        `is not valid JSON (${(cause as Error).message})`,
        `content/${name}`,
      )
    }
  })()

  fileCache.set(name, promise)
  return promise as Promise<T>
}

export class LocalContentSource implements ContentSource {
  readonly kind = 'local'

  async getSiteSettings(): Promise<SiteSettings> {
    const settings = await readJson<SiteSettings>('site.json')

    // Visibility is a source-level concern (see the ContentSource contract), so
    // the header never has to filter its own items.
    return {
      ...settings,
      nav: settings.nav.filter((item) => item.visible),
      social: publishedInOrder(settings.social),
      footer: {
        ...settings.footer,
        links: settings.footer.links.filter((item) => item.visible),
      },
    }
  }

  async getLandingContent(): Promise<LandingContent> {
    const [settings, sections, videos, media, links, updates] = await Promise.all([
      this.getSiteSettings(),
      readJson<Section[]>('sections.json'),
      readJson<Video[]>('videos.json'),
      readJson<MediaItem[]>('media.json'),
      readJson<LinkBlock[]>('links.json'),
      this.listArticles(),
    ])

    return {
      settings,
      sections: publishedInOrder(sections),
      videos: publishedInOrder(videos),
      media: publishedInOrder(media),
      // Links are addressed by id from a section's config, so they are NOT
      // ordered here — a section states its own order. They are still filtered.
      links: links.filter((link) => link.published),
      updates,
    }
  }

  async listArticles(): Promise<ArticleSummary[]> {
    const articles = await this.readAllArticles()
    return articlesNewestFirst(
      articles.filter((article) => article.status === 'published'),
    ).map(toSummary)
  }

  async getArticle(slug: string): Promise<Article | null> {
    const articles = await this.readAllArticles()
    const found = articles.find((article) => article.slug === slug)
    if (!found) return null
    // A draft is not reachable by URL. Returning null lets the route 404 rather
    // than publishing something the author has not published.
    if (found.status !== 'published') return null
    return found
  }

  async listArticleSlugs(): Promise<string[]> {
    const articles = await this.listArticles()
    return articles.map((article) => article.slug)
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private allArticles: Promise<Article[]> | null = null

  private readAllArticles(): Promise<Article[]> {
    this.allArticles ??= (async () => {
      let filenames: string[]
      try {
        filenames = await readdir(UPDATES_DIR)
      } catch {
        // An empty updates directory is a valid state for a site that has not
        // posted yet, and the sections that read it render their empty state.
        return []
      }

      const markdown = filenames.filter((name) => name.toLowerCase().endsWith('.md')).sort()
      const seen = new Map<string, string>()

      const articles = await Promise.all(
        markdown.map(async (filename) => {
          const slug = slugFromFilename(filename)
          const where = `content/updates/${filename}`

          if (!slug) {
            throw new ContentParseError('filename yields an empty slug', where)
          }
          if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
            throw new ContentParseError(
              `slug "${slug}" must be lowercase kebab-case — it becomes the URL`,
              where,
            )
          }
          const clash = seen.get(slug)
          if (clash) {
            throw new ContentParseError(
              `slug "${slug}" is already used by ${clash}. Two files cannot own one URL.`,
              where,
            )
          }
          seen.set(slug, where)

          const raw = await readFile(path.join(UPDATES_DIR, filename), 'utf8')
          return toArticle(parseDocument(raw, where), slug, where)
        }),
      )

      return articles
    })()

    return this.allArticles
  }
}

function toSummary(article: Article): ArticleSummary {
  const { status: _status, body: _body, seo: _seo, ...summary } = article
  return summary
}

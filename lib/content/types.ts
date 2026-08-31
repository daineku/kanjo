/**
 * Content entities for thekanjo.com.
 *
 * These types are the contract between the UI and whatever is storing the
 * content. They are deliberately free of any storage detail — no Supabase row
 * shapes, no snake_case column names leaking upward, no Daineku entity names.
 * A backend adapter's job is to produce these; see lib/content/source.ts.
 */

// ── Shared ───────────────────────────────────────────────────────────────────

/** Anything that can be turned off and ordered by an editor. */
export type Publishable = {
  /** Stable identifier. Never derived from display copy. */
  id: string
  /** Hidden entries are dropped by the content source, not by the UI. */
  published: boolean
  /** Ascending. Ties fall back to source order. */
  order: number
}

export type ImageRef = {
  /** Absolute URL, or a root-relative path under /public. */
  src: string
  /** Required. An image with nothing useful to say should have alt="". */
  alt: string
  /** Intrinsic pixel dimensions. Both required — they are what prevents layout shift. */
  width: number
  height: number
}

// ── Site settings ────────────────────────────────────────────────────────────

export type NavItem = {
  label: string
  href: string
  /** true renders target=_blank + rel=noopener and an external affordance. */
  external?: boolean
  visible: boolean
}

export const SOCIAL_PLATFORMS = [
  'steam',
  'discord',
  'patreon',
  'youtube',
  'instagram',
  'tiktok',
  'x',
  'bluesky',
  'reddit',
  'other',
] as const

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]

export type SocialLink = Publishable & {
  platform: SocialPlatform
  /** Shown when the platform is 'other', and as the accessible name otherwise. */
  label: string
  url: string
  /** Optional handle, e.g. "@thekanjo". Rendered as a subtitle where there is room. */
  handle?: string
}

/**
 * Development status. Configured, never hardcoded — the set of labels a game
 * moves through is a product decision and it changes.
 */
export type GameStatus = {
  /** Machine key, e.g. 'in-development'. Used for styling hooks only. */
  key: string
  /** Display copy, e.g. 'IN DEVELOPMENT'. */
  label: string
  /** One line under the label. Optional. */
  detail?: string
  /** Draws the label in the canon's positive green rather than secondary text. */
  emphasis?: boolean
}

export type SeoSettings = {
  /** Fallback <title>. Page-level titles are composed with titleTemplate. */
  title: string
  /** e.g. '%s — THE KANJO' */
  titleTemplate: string
  description: string
  /** Root-relative or absolute. Used for og:image and twitter:image. */
  defaultSocialImage?: ImageRef
  /** Populates twitter:site / twitter:creator when present. */
  twitterHandle?: string
  /**
   * Emitted as a VideoGame structured-data node when present. Every field is
   * optional and only what is configured is emitted — this file must never
   * invent a platform, a release date or a genre.
   */
  game?: {
    name?: string
    genre?: string[]
    platforms?: string[]
    /** ISO 8601. Omit entirely unless a date is actually announced. */
    releaseDate?: string
  }
}

export type FooterSettings = {
  /** e.g. 'Daineku'. Rendered as "© {year} {copyrightHolder}". */
  copyrightHolder: string
  /** Optional line under the copyright. */
  note?: string
  links: NavItem[]
}

export type SiteSettings = {
  title: string
  subtitle?: string
  /** Optional wordmark image. Falls back to the title set in the display face. */
  wordmark?: ImageRef
  /** Canonical origin, no trailing slash. e.g. 'https://thekanjo.com' */
  primaryDomain: string
  seo: SeoSettings
  nav: NavItem[]
  social: SocialLink[]
  status: GameStatus
  footer: FooterSettings
}

// ── Media ────────────────────────────────────────────────────────────────────

export type VideoProvider = 'youtube' | 'vimeo' | 'file'

export type Video = Publishable & {
  provider: VideoProvider
  /**
   * For 'youtube'/'vimeo' this is the bare id, not a URL — the embed URL is
   * composed by the UI so a pasted tracking-laden watch URL cannot get through.
   * For 'file' it is the source path, e.g. `/media/video/first-look.mp4`.
   */
  ref: string
  /**
   * For 'file' only: additional sources in preference order, so a WebM can be
   * offered ahead of the MP4 in `ref`. MIME types are derived from extensions.
   *
   *   "ref": "/media/video/clip.mp4",
   *   "sources": ["/media/video/clip.webm"]
   *
   * The browser takes the first it supports; `ref` is always offered last, so a
   * single-source entry needs nothing here.
   */
  sources?: string[]
  title: string
  description?: string
  /**
   * Required for every provider. A video with no poster is a blank rectangle
   * plus a network request, and a facade cannot be built without one.
   */
  poster?: ImageRef
  /** Seconds. Emitted in structured data when known. */
  duration?: number
  featured: boolean
}

export type MediaItem = Publishable & {
  image: ImageRef
  title?: string
  caption?: string
  /** Free-form grouping key, e.g. 'osaka', 'cars'. Used for filtering later. */
  group?: string
  featured: boolean
}

// ── Links / CTA ──────────────────────────────────────────────────────────────

export type LinkBlock = Publishable & {
  label: string
  /** One line under the label, in the canon's navigationSubtitle role. */
  description?: string
  href: string
  external: boolean
  /**
   * 'primary' takes the canon's positive selection treatment; 'default' takes
   * the divider treatment. There is deliberately no third button style.
   */
  intent: 'primary' | 'default'
  /** An unavailable destination renders disabled with a reason, never hidden. */
  available: boolean
  unavailableReason?: string
}

// ── Articles ─────────────────────────────────────────────────────────────────

export type ArticleStatus = 'draft' | 'published'

export type ArticleSummary = {
  slug: string
  title: string
  excerpt: string
  cover?: ImageRef
  author?: string
  /** ISO 8601 date. */
  publishedAt: string
  updatedAt?: string
  tags: string[]
  featured: boolean
  order: number
  /**
   * Present when the article is a local companion to a post published
   * elsewhere (Patreon, for example). The body still lives here; this is only
   * an attribution link. See docs/ARCHITECTURE.md "Patreon".
   */
  externalSource?: {
    label: string
    url: string
  }
}

export type Article = ArticleSummary & {
  status: ArticleStatus
  /** Markdown subset. Rendered by lib/richText.tsx — never as raw HTML. */
  body: string
  seo?: {
    title?: string
    description?: string
    socialImage?: ImageRef
  }
}

// ── Landing sections ─────────────────────────────────────────────────────────

export const SECTION_TYPES = [
  'hero',
  'intro',
  'video',
  'media',
  'status',
  'features',
  'updates',
  'social',
  'links',
] as const

export type SectionType = (typeof SECTION_TYPES)[number]

/** Copy every section may carry. A missing heading renders no heading. */
export type SectionHeader = {
  /** Small uppercase label above the heading, in the canon's smallLabel role. */
  eyebrow?: string
  heading?: string
  /** One paragraph under the heading. */
  standfirst?: string
}

export type HeroConfig = {
  /** Status chip above the title. 'status' pulls from SiteSettings.status. */
  eyebrow?: string | 'status'
  title: string
  subtitle?: string
  description?: string
  /**
   * Background media. The canon's background model
   * (Responsive/background_layers.json) is: world media, then a treatment, then
   * the UI. `treatment` is that middle layer. 'none' leaves the canon
   * background colour, which is what every reference screenshot shows.
   */
  background?: {
    kind: 'none' | 'image' | 'video'
    /** The desktop still. For kind: 'image'. */
    image?: ImageRef
    /**
     * Optional narrow-viewport still, used below 768px.
     *
     * Worth supplying when the desktop frame does not survive a portrait crop —
     * a 16:9 capture cropped to a phone's aspect keeps about a third of its
     * width, so a car framed left can end up outside the crop entirely. Omit it
     * and `mobileObjectPosition` alone usually solves the framing.
     */
    mobileImage?: ImageRef

    /**
     * Local video sources, in preference order — the browser picks the first it
     * supports, so put WebM before MP4:
     *
     *   ["/media/hero/loop.webm", "/media/hero/loop.mp4"]
     *
     * The MIME type is derived from the extension, so no `type` field is
     * needed. `videoSrc` is the single-source shorthand and still works.
     */
    videoSources?: string[]
    videoSrc?: string
    /**
     * MANDATORY for kind: 'video'. It is the first paint, the fallback when the
     * loop cannot play, and what shows under prefers-reduced-motion — where the
     * video element is not rendered at all.
     */
    poster?: ImageRef

    treatment: 'transparent' | 'dim' | 'strong_dim' | 'blackout'

    /**
     * CSS `object-position` for the media inside the hero's crop, e.g.
     * `'center 40%'` or `'70% center'`. Defaults to `'center'`.
     *
     * This matters more here than anywhere else on the site: the hero is the one
     * surface that crops its media to an arbitrary box, and a gameplay capture
     * has a subject — the car, the road's vanishing point — that a centre crop
     * will not necessarily keep. Two strings, no crop-management system.
     */
    objectPosition?: string
    /** Framing below 768px, where the crop is tallest. Falls back to the above. */
    mobileObjectPosition?: string
  }
  /** Ids from links.json, in the order they should appear. */
  actionIds: string[]
  /** e.g. 'PC — WINDOWS'. Free-form, configured, never asserted by code. */
  platformNote?: string
}

export type IntroConfig = SectionHeader & {
  /** Markdown subset, same renderer as an article body. */
  body: string
}

export type VideoConfig = SectionHeader & {
  /** Empty means "every published video, in order". */
  videoIds: string[]
  layout: 'featured' | 'grid'
}

export type MediaConfig = SectionHeader & {
  mediaIds: string[]
  limit?: number
  group?: string
}

export type StatusConfig = SectionHeader & {
  /** Free-form rows, e.g. [{ label: 'BUILD', value: 'INTERNAL' }]. */
  rows: { label: string; value: string; emphasis?: boolean }[]
}

export type FeaturesConfig = SectionHeader & {
  items: { id: string; title: string; description: string }[]
}

export type UpdatesConfig = SectionHeader & {
  limit: number
  /** Where "all updates" points. */
  indexHref: string
}

export type SocialConfig = SectionHeader

export type LinksConfig = SectionHeader & {
  linkIds: string[]
}

export type SectionConfigMap = {
  hero: HeroConfig
  intro: IntroConfig
  video: VideoConfig
  media: MediaConfig
  status: StatusConfig
  features: FeaturesConfig
  updates: UpdatesConfig
  social: SocialConfig
  links: LinksConfig
}

/**
 * One landing-page block. Discriminated on `type` so adding a section type is a
 * compile error everywhere it must be handled, rather than a silent no-op.
 */
export type Section = {
  [K in SectionType]: Publishable & {
    type: K
    config: SectionConfigMap[K]
  }
}[SectionType]

// ── The bundle a page needs ──────────────────────────────────────────────────

/**
 * Everything the landing page renders, fetched once. One object rather than
 * nine calls, so a page composes from a single await and a section component
 * never fetches anything itself.
 */
export type LandingContent = {
  settings: SiteSettings
  sections: Section[]
  videos: Video[]
  media: MediaItem[]
  links: LinkBlock[]
  updates: ArticleSummary[]
}

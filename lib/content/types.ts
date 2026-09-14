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
  /**
   * The destination's kind. Drives the icon lookup and nothing else — a channel
   * with no matching mark still renders, as its label.
   */
  platform: SocialPlatform
  /** Shown when the platform is 'other', and as the accessible name otherwise. */
  label: string
  /**
   * Empty means "not announced". The UI DROPS the entry rather than linking
   * nowhere: Steam in particular has no page yet, and a dead link in the
   * persistent cluster is worse than an absent one. Nothing here is invented.
   */
  url: string
  /** Optional handle, e.g. "@thekanjo". Rendered as a subtitle where there is room. */
  handle?: string
  /**
   * An optional mark supplied by the owner. Absent it, the cluster draws the
   * label in the canon's display face, which is what the game's own menu does —
   * a row of third-party logos is the generic-social-widget look the brief rules
   * out. SVG is fine here; it is rendered as a plain <img>, never inlined.
   */
  icon?: ImageRef
  /** Defaults to true for an external destination. */
  openInNewTab?: boolean
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

/**
 * Who publishes the game.
 *
 * A name and a URL, and DELIBERATELY NOTHING ELSE. Structured data is a
 * machine-readable set of assertions, so a legal entity name, an address, a
 * registration number or a company description that nobody supplied would be a
 * false claim in a format built to be trusted — not a harmless placeholder.
 * Only what the owner stated is modelled here.
 *
 * This is separate from `footer.copyrightHolder`, which is a display string.
 * The publisher is an identity that appears both in the footer and as the
 * `publisher` node in JSON-LD, and those must not be able to drift apart.
 */
export type PublisherSettings = {
  name: string
  /** The publisher's own site, e.g. 'https://daineku.com/'. */
  url: string
}

/**
 * Site chrome.
 *
 * The homepage is a title screen, not a document, so it carries no header bar —
 * the nav belongs to the reading routes (/updates), where a visitor actually
 * needs to move between documents. That is configuration rather than a rule
 * hardcoded into a layout, so the decision can be revisited without an edit.
 */
export type ChromeSettings = {
  /** The header + nav strip on the reading routes. */
  headerOnReadingPages: boolean
  /** The header on the homepage. Off: the homepage is a title screen. */
  headerOnHome: boolean
  /** The persistent social cluster at the upper-left edge. */
  socialCluster: boolean
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
  publisher: PublisherSettings
  footer: FooterSettings
  chrome: ChromeSettings
}

// ── Loader ───────────────────────────────────────────────────────────────────

/**
 * How hard the loader's motion works. The responsive motion policy turns this
 * down on a coarse pointer; it is NOT a quality setting.
 *
 *   low    — one lane, no light accents, slowest road
 *   medium — both lanes, restrained accents (the default)
 *   high   — both lanes, accents, strongest parallax separation
 */
export const LOADER_INTENSITIES = ['low', 'medium', 'high'] as const
export type LoaderIntensity = (typeof LOADER_INTENSITIES)[number]

/**
 * The night-highway loader.
 *
 * TWO CARS TRADING POSITION IS THE WHOLE IDEA, so the two vehicle images are
 * first-class configuration rather than decoration baked into a component. What
 * ships today is a NEUTRAL, DELIBERATELY TEMPORARY silhouette — no badge, no
 * grille, no real car, nothing that claims to be a Honda or a Nissan.
 * Replacing it is a content change and nothing else.
 */
export type LoaderConfig = {
  enabled: boolean
  /**
   * The floor. The loader is a deliberate moment; one that vanishes in 200ms on
   * a warm cache reads as a flicker rather than as an entrance.
   */
  minimumDisplayMs: number
  /**
   * THE ESCAPE PATH, and the reason the loader can never strand a visitor. It
   * represents APP readiness — hydration and the display face — not every asset
   * on the page. Past this ceiling the site opens regardless of what is still
   * in flight.
   */
  maximumDisplayMs: number
  intensity: LoaderIntensity
  /**
   * Whether THE KANJO animates in as the highway masks away. Off, the title is
   * simply there when the loader lifts. Under prefers-reduced-motion this is
   * treated as off whatever it says.
   */
  titleRevealEnabled: boolean
  /** The near lane, closest to the camera. */
  carA: ImageRef
  /** The far lane. It is the one that closes and overtakes first. */
  carB: ImageRef
  /**
   * An optional painted road plate behind the generated surface. Absent, the
   * loader draws the highway from CSS alone, which costs no request at all.
   */
  road?: ImageRef
}

// ── Patreon ──────────────────────────────────────────────────────────────────

/**
 * One post, reduced to what may be shown in public.
 *
 * THERE IS DELIBERATELY NO `content` FIELD. A creator-level token can read the
 * full body of PAID posts, and a type the UI can reach that carries that body is
 * how it eventually reaches a public page. The adapter derives `excerpt` from
 * content Patreon itself marks public, and never for a locked post — see
 * lib/patreon/posts.ts.
 */
export type PatreonPost = {
  id: string
  title: string
  /** The post's own page on patreon.com. */
  url: string
  /** ISO 8601. */
  publishedAt: string
  /**
   * A short plain-text teaser. ALWAYS EMPTY for a locked post: it is only ever
   * derived from content Patreon has marked public.
   */
  excerpt: string
  /** Patreon's `is_public`. False means members-only. */
  isPublic: boolean
  /** Patreon's `is_paid`. Informational; `isPublic` is what gates rendering. */
  isPaid: boolean
}

export type PatreonFeedStatus =
  /** Credentials present, request succeeded. */
  | 'ok'
  /** No credentials configured. Not an error — the expected state of a clone. */
  | 'unconfigured'
  /** Credentials present, request failed. The section falls back. */
  | 'error'

export type PatreonFeed = {
  status: PatreonFeedStatus
  posts: PatreonPost[]
  /** Diagnostics for the server log. NEVER rendered. */
  detail?: string
}

// ── YouTube ──────────────────────────────────────────────────────────────────

/**
 * The channel's most recent public upload, resolved at build/revalidation time.
 *
 * Note what is NOT here: no embed URL and no player configuration. The id is
 * the whole of it, and the embed is composed by the facade against
 * youtube-nocookie — so nothing the API returns can carry a playlist, an
 * autoplay parameter or a tracking string into the page.
 */
export type YouTubeVideo = {
  /** The bare 11-character id. */
  id: string
  title: string
  description: string
  /** ISO 8601. */
  publishedAt: string
  /** YouTube's own thumbnail, at whatever size it offered. */
  poster?: ImageRef
}

export type YouTubeFeedStatus =
  /** Key present, request succeeded, a public upload exists. */
  | 'ok'
  /** No API key, or the handle is unreadable. The expected state of a clone. */
  | 'unconfigured'
  /** A real channel with nothing public on it yet. */
  | 'empty'
  /** Key present, request failed. The section falls back. */
  | 'error'

export type YouTubeFeed = {
  status: YouTubeFeedStatus
  video?: YouTubeVideo
  /** Diagnostics for the server log. NEVER rendered. */
  detail?: string
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
  'youtube',
  'tiktok',
  'patreon',
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

/**
 * The homepage's one video block.
 *
 * Separate from `video` (which renders configured `Video` entries) because it
 * has a different job: THE CHANNEL'S LATEST UPLOAD, framed as the centrepiece.
 * `video` stays for local gameplay clips that ship no third-party anything.
 *
 * ── `latest` IS THE POINT ───────────────────────────────────────────────────
 *
 * The first version of this config held one hardcoded video id, which meant
 * every new upload needed a content edit and a deploy. It now holds a CHANNEL,
 * and the newest public upload is resolved server-side through the YouTube Data
 * API v3 (see lib/youtube). `pinned` remains for the case where a specific
 * video should stay on the homepage regardless of what was uploaded since.
 */
export type YouTubeMode = 'latest' | 'pinned'

export type YouTubeConfig = SectionHeader & {
  /**
   * The canonical channel URL, e.g. 'https://www.youtube.com/@thekanjo'. A
   * bare handle also works. Reduced to a validated handle on the SERVER by
   * lib/youtube/channel.ts#youTubeHandle before it reaches an API query.
   */
  channelUrl: string
  mode: YouTubeMode
  /**
   * Used when `mode` is 'pinned', and as the fallback when 'latest' cannot be
   * resolved. A bare id OR any YouTube URL — everything except the eleven
   * characters is discarded on the server, so a pasted watch URL carrying a
   * playlist, a timestamp and a share token cannot reach the embed.
   */
  video?: string
  /**
   * Overrides the caption. Absent in 'latest' mode, the video's own title from
   * the API is used, which is what makes the block update itself.
   */
  title?: string
  description?: string
  /**
   * Overrides the still. Absent, the poster is YouTube's own thumbnail, fetched
   * SERVER-SIDE through next/image — so the browser contacts no Google host
   * until the visitor presses play.
   */
  poster?: ImageRef
  /** CSS aspect-ratio, e.g. '16 / 9'. Reserves the box, so nothing shifts. */
  aspectRatio: string
  /** Shown when there is no video to play. Links to the channel. */
  ctaLabel: string
  /**
   * What the block does with no API key, no public upload, or a failed
   * request. 'cta' keeps the section, its copy and a WATCH ON YOUTUBE button;
   * 'hide' renders nothing. Never a broken player.
   */
  fallback: 'cta' | 'hide'
}

/**
 * The TikTok block.
 *
 * ── WHY THE OFFICIAL CREATOR EMBED, AND NOT THE DISPLAY API ─────────────────
 *
 * The Creator Profile Embed shows a selection of a public profile's recent
 * videos with NO developer app, no Login Kit review and no `video.list`
 * authorisation — for our own public channel, that is the whole requirement.
 * The Display API would mean an app review cycle and a stored OAuth token, to
 * display videos that are already public.
 *
 * `mode` exists so the upgrade path is a config change rather than a rewrite:
 * if The Kanjo later wants its own card treatment instead of TikTok's block,
 * 'display-api' is the value that would select it. It is not implemented, and
 * the type does not pretend otherwise — see docs/TIKTOK.md.
 */
export type TikTokMode = 'creator-embed'

export type TikTokConfig = SectionHeader & {
  /**
   * The canonical profile URL, e.g. 'https://www.tiktok.com/@the_kanjo'. A bare
   * handle also works. Reduced to a validated handle on the SERVER by
   * lib/tiktok/profile.ts#tikTokHandle before ANY markup is built from it —
   * the embed is constructed from that handle, never accepted as HTML.
   */
  profileUrl: string
  mode: TikTokMode
  ctaLabel: string
  /**
   * What the block does when the profile is unreadable. 'cta' keeps the
   * section and a FOLLOW ON TIKTOK button; 'hide' renders nothing.
   *
   * Note that this does NOT cover TikTok being blocked or slow in the
   * visitor's browser — that is handled in the embed itself, which renders the
   * CTA as its own fallback content and lets TikTok replace it only if the
   * script actually loads. There is no state in which this block is an empty
   * black rectangle.
   */
  fallback: 'cta' | 'hide'
}

/**
 * The development-log block, fed by the Patreon API.
 *
 * Nothing here is a credential. The token lives in the server environment; this
 * says only how the block behaves and what it says when the feed is not
 * available, which is the normal state of a fresh clone.
 */
export type PatreonConfig = SectionHeader & {
  /** The public creator page: the CTA's destination, and the only URL needed. */
  campaignUrl: string
  limit: number
  ctaLabel: string
  /**
   * What the block does when the feed is unavailable — no credentials, or a
   * failed request. 'cta' keeps the section, its copy and the button; 'hide'
   * renders nothing at all. Never a broken feed, never an error on the page.
   */
  fallback: 'cta' | 'hide'
  fallbackDescription?: string
  /**
   * Whether members-only posts appear as metadata rows. Their bodies are NEVER
   * rendered either way — see PatreonPost.
   */
  showLockedPosts: boolean
}

export type SectionConfigMap = {
  hero: HeroConfig
  intro: IntroConfig
  youtube: YouTubeConfig
  tiktok: TikTokConfig
  patreon: PatreonConfig
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
  loader: LoaderConfig
  sections: Section[]
  videos: Video[]
  media: MediaItem[]
  links: LinkBlock[]
  updates: ArticleSummary[]
  /**
   * The Patreon feed, already reduced to what is publishable. Fetched alongside
   * everything else so the section component itself awaits nothing.
   */
  patreon: PatreonFeed
  /**
   * The channel's latest public upload, or a status saying why there isn't one.
   *
   * Like `patreon`, this is resolved BEFORE any component renders, and neither
   * can fail: both adapters return a status instead of throwing, so one
   * external provider being down cannot reject the promise that builds this
   * bundle and take the whole homepage with it.
   */
  youtube: YouTubeFeed
}

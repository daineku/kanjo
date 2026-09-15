'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import {
  authClient,
  isAdminAuthConfigured,
  isAllowlistedEmail,
  magicLinkOrigin,
  requireAdminWrite,
} from '@/lib/admin/auth'
import { resolveContentStore } from '@/lib/content/store'
import type {
  ImageRef,
  LoaderConfig,
  LoaderIntensity,
  Section,
  SiteSettings,
  SocialLink,
  SocialPlatform,
} from '@/lib/content/types'
import { LOADER_INTENSITIES, SOCIAL_PLATFORMS } from '@/lib/content/types'
import { tikTokHandle } from '@/lib/tiktok/profile'
import { youTubeHandle } from '@/lib/youtube/channel'

/**
 * The admin's write actions.
 *
 * ── EVERY ACTION RE-CHECKS THE GATE ─────────────────────────────────────────
 *
 * A Server Action is an HTTP endpoint. Rendering the page behind `notFound()`
 * hides the FORM; it does not remove the endpoint the form would have posted
 * to. So `isAdminEnabled()` is checked again at the top of every action here —
 * the page's gate is for the person, this one is for the request.
 *
 * ── NOTHING IS TRUSTED, EVEN THOUGH IT IS LOCAL ─────────────────────────────
 *
 * FormData arrives as strings. Enums are checked against their own const
 * arrays, numbers are bounded, and an unrecognised value falls back to the
 * current one rather than being written through. The content files are read by
 * a typed source that does not re-validate at runtime, so THIS is the place a
 * bad value has to be stopped — a `sections.json` with an invalid section type
 * would otherwise render a page that fails at build.
 */

/**
 * The gate every mutation passes through.
 *
 * `requireAdminWrite()` answers BOTH questions — is this person an allowlisted
 * admin, and may this deployment be written to at all — and throws with a
 * reason if either fails. See lib/admin/auth.ts.
 *
 * It is `await`ed at the top of every action below rather than being checked
 * once on the page that renders the forms, because a Server Action is an HTTP
 * endpoint: hiding a form removes the button, not the route behind it.
 */
async function requireAdmin(): Promise<void> {
  await requireAdminWrite()
}

// ── FormData readers ─────────────────────────────────────────────────────────

function str(form: FormData, key: string, fallback = ''): string {
  const value = form.get(key)
  return typeof value === 'string' ? value.trim() : fallback
}

/** Preserves internal newlines; only the ends are trimmed. */
function text(form: FormData, key: string): string {
  const value = form.get(key)
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : ''
}

/** An unchecked checkbox is simply absent from the FormData. */
function bool(form: FormData, key: string): boolean {
  return form.get(key) === 'on' || form.get(key) === 'true'
}

function num(form: FormData, key: string, fallback: number, min: number, max: number): number {
  const parsed = Number(str(form, key))
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

function oneOf<T extends string>(
  form: FormData,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = str(form, key)
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

/** `undefined` rather than `''`, so an empty optional field is absent from the JSON. */
function optional(form: FormData, key: string): string | undefined {
  const value = text(form, key)
  return value === '' ? undefined : value
}

/**
 * An image field: either an upload, or the typed src plus its dimensions.
 *
 * An upload always wins, and its dimensions come from the file's own header —
 * see lib/content/local/imageSize.ts for why they are never taken on trust from
 * a form field. With no upload and no src, the result is `undefined`, which is
 * how an optional image is removed.
 */
async function imageField(
  form: FormData,
  prefix: string,
  folder: string,
  current: ImageRef | undefined,
): Promise<ImageRef | undefined> {
  const upload = form.get(`${prefix}.file`)
  const alt = str(form, `${prefix}.alt`)

  if (upload instanceof File && upload.size > 0) {
    const store = await resolveContentStore()
    const saved = await store.saveImage({
      name: upload.name,
      bytes: new Uint8Array(await upload.arrayBuffer()),
      folder,
    })
    return { ...saved, alt }
  }

  const src = str(form, `${prefix}.src`)
  if (!src) return undefined

  return {
    src,
    alt,
    // A hand-typed src keeps whatever dimensions were entered, defaulting to
    // what is already stored. They are required by ImageRef because they are
    // what stops the page shifting as the image decodes.
    width: num(form, `${prefix}.width`, current?.width ?? 0, 0, 20000),
    height: num(form, `${prefix}.height`, current?.height ?? 0, 0, 20000),
  }
}

// ── Completion ───────────────────────────────────────────────────────────────

/**
 * Finishes a save: rebuild the affected routes, then bounce back with a status.
 *
 * `redirect` throws by design, so it must be the last thing an action does and
 * must sit OUTSIDE any try/catch that would swallow it.
 */
function done(message: string): never {
  revalidatePath('/', 'layout')
  redirect(`/admin?saved=${encodeURIComponent(message)}`)
}

function failed(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error)
  redirect(`/admin?error=${encodeURIComponent(message)}`)
}

// ── Sign in / sign out ───────────────────────────────────────────────────────

/**
 * Emails a one-time sign-in link.
 *
 * ── IT ALWAYS SAYS THE SAME THING ───────────────────────────────────────────
 *
 * An address on the allowlist and an address that is not produce the identical
 * redirect. Reporting the difference would turn this endpoint into an oracle
 * for which addresses administer the site, which is worth more to an attacker
 * than it is to the one person who already knows their own email.
 *
 * So the allowlist is checked HERE only to decide whether to spend an email —
 * and the real enforcement is on the session, in `requireAdminWrite()`. A link
 * sent to a non-admin would establish a session that can do nothing, and the
 * callback signs it straight out.
 */
export async function sendMagicLink(form: FormData): Promise<void> {
  const email = str(form, 'email').toLowerCase()

  if (!isAdminAuthConfigured()) {
    redirect(
      `/admin/login?error=${encodeURIComponent('Admin sign-in is not configured on this deployment.')}`,
    )
  }

  if (email && isAllowlistedEmail(email)) {
    try {
      const supabase = await authClient()
      // A TRUSTED origin: production's configured site URL, or the deployment's
      // own Vercel origin on a preview. Never the request's Host header — see
      // lib/admin/policy.ts#authRedirectOrigin.
      const origin = magicLinkOrigin()
      await supabase.auth.signInWithOtp({
        email,
        options: {
          // Must match a Redirect URL registered in the Supabase dashboard.
          emailRedirectTo: `${origin}/admin/auth/callback`,
          // No self-service account creation. An address that is allowlisted but
          // has never signed in still needs a user record, so this is left to
          // Supabase's default of creating one on first use ONLY for addresses
          // that already passed the allowlist above.
        },
      })
    } catch (cause) {
      // Logged, not surfaced: the message can distinguish a known address from
      // an unknown one, which is the thing this function is careful not to do.
      console.warn(`[admin] magic link failed — ${(cause as Error).message}`)
    }
  }

  redirect('/admin/login?sent=1')
}

export async function signOut(): Promise<void> {
  if (isAdminAuthConfigured()) {
    const supabase = await authClient()
    await supabase.auth.signOut()
  }
  redirect('/admin/login')
}

// ── Site identity, SEO, chrome, footer ───────────────────────────────────────

export async function saveIdentity(form: FormData): Promise<void> {
  let message: string
  try {
    await requireAdmin()
    const store = await resolveContentStore()
    const { settings } = await store.loadDraft()

    const next: SiteSettings = {
      ...settings,
      title: str(form, 'title', settings.title),
      subtitle: optional(form, 'subtitle'),
      primaryDomain: str(form, 'primaryDomain', settings.primaryDomain),
      wordmark: await imageField(form, 'wordmark', 'og', settings.wordmark),
      seo: {
        ...settings.seo,
        title: str(form, 'seo.title', settings.seo.title),
        titleTemplate: str(form, 'seo.titleTemplate', settings.seo.titleTemplate),
        description: text(form, 'seo.description') || settings.seo.description,
        defaultSocialImage: await imageField(
          form,
          'seo.defaultSocialImage',
          'og',
          settings.seo.defaultSocialImage,
        ),
      },
      status: {
        ...settings.status,
        label: str(form, 'status.label', settings.status.label),
        detail: optional(form, 'status.detail'),
      },
      chrome: {
        headerOnReadingPages: bool(form, 'chrome.headerOnReadingPages'),
        headerOnHome: bool(form, 'chrome.headerOnHome'),
        socialCluster: bool(form, 'chrome.socialCluster'),
      },
      // Both halves or neither. A publisher name with no URL is a claim with
      // nothing behind it, and it would be emitted into JSON-LD as one.
      publisher: {
        name: str(form, 'publisher.name', settings.publisher?.name ?? ''),
        url: str(form, 'publisher.url', settings.publisher?.url ?? ''),
      },
      footer: {
        ...settings.footer,
        copyrightHolder: str(form, 'footer.copyrightHolder', settings.footer.copyrightHolder),
        note: optional(form, 'footer.note'),
      },
    }

    await store.saveSiteSettings(next)
    message = 'Site identity saved.'
  } catch (error) {
    failed(error)
  }
  done(message)
}

// ── Loader ───────────────────────────────────────────────────────────────────

export async function saveLoader(form: FormData): Promise<void> {
  let message: string
  try {
    await requireAdmin()
    const store = await resolveContentStore()
    const { loader } = await store.loadDraft()

    const carA = await imageField(form, 'carA', 'loader', loader.carA)
    const carB = await imageField(form, 'carB', 'loader', loader.carB)
    if (!carA || !carB) {
      throw new Error(
        'The loader needs both vehicles. Clearing one would leave an overlay with nothing moving across it.',
      )
    }

    const minimum = num(form, 'minimumDisplayMs', loader.minimumDisplayMs, 0, 20000)
    const maximum = num(form, 'maximumDisplayMs', loader.maximumDisplayMs, 500, 30000)
    if (maximum < minimum) {
      throw new Error(
        `The maximum (${maximum}ms) is below the minimum (${minimum}ms). The maximum is the escape path and must be the later of the two.`,
      )
    }

    const next: LoaderConfig = {
      ...loader,
      enabled: bool(form, 'enabled'),
      minimumDisplayMs: minimum,
      maximumDisplayMs: maximum,
      intensity: oneOf<LoaderIntensity>(
        form,
        'intensity',
        LOADER_INTENSITIES,
        loader.intensity,
      ),
      titleRevealEnabled: bool(form, 'titleRevealEnabled'),
      carA,
      carB,
      road: await imageField(form, 'road', 'loader', loader.road),
    }

    await store.saveLoaderConfig(next)
    message = 'Loader saved.'
  } catch (error) {
    failed(error)
  }
  done(message)
}

// ── Channels ─────────────────────────────────────────────────────────────────

export async function saveSocial(form: FormData): Promise<void> {
  let message: string
  try {
    await requireAdmin()
    const store = await resolveContentStore()
    const { settings } = await store.loadDraft()

    const social: SocialLink[] = []
    for (const link of settings.social) {
      const key = `social.${link.id}`
      social.push({
        ...link,
        platform: oneOf<SocialPlatform>(
          form,
          `${key}.platform`,
          SOCIAL_PLATFORMS,
          link.platform,
        ),
        label: str(form, `${key}.label`, link.label),
        // An empty URL is meaningful and must survive: it is how a channel that
        // has not been announced is represented, and the cluster drops it.
        url: str(form, `${key}.url`),
        published: bool(form, `${key}.published`),
        order: num(form, `${key}.order`, link.order, 0, 999),
        openInNewTab: bool(form, `${key}.openInNewTab`),
        icon: await imageField(form, `${key}.icon`, 'social', link.icon),
      })
    }

    await store.saveSiteSettings({ ...settings, social })
    message = 'Channels saved.'
  } catch (error) {
    failed(error)
  }
  done(message)
}

// ── Sections ─────────────────────────────────────────────────────────────────

/**
 * Saves ONE section, by id.
 *
 * Only the fields the corresponding panel renders are read; everything else on
 * the section — and every `_comment` in the file — is carried through
 * untouched. That is what makes it safe to have a small form for the hero and
 * a two-field form for a block that is switched off.
 */
export async function saveSection(form: FormData): Promise<void> {
  let message: string
  try {
    await requireAdmin()
    const store = await resolveContentStore()
    const { sections } = await store.loadDraft()

    const id = str(form, 'id')
    const index = sections.findIndex((section) => section.id === id)
    const current = sections[index]
    if (index < 0 || !current) throw new Error(`No section with id "${id}".`)

    const base = {
      ...current,
      published: bool(form, 'published'),
      order: num(form, 'order', current.order, 0, 999),
    }

    let next: Section

    switch (current.type) {
      case 'hero': {
        const background = current.config.background
        next = {
          ...base,
          type: 'hero',
          config: {
            ...current.config,
            title: str(form, 'title', current.config.title),
            subtitle: optional(form, 'subtitle'),
            description: optional(form, 'description'),
            platformNote: optional(form, 'platformNote'),
            background: {
              ...background,
              kind: oneOf(form, 'background.kind', ['none', 'image', 'video'] as const, 'none'),
              treatment: oneOf(
                form,
                'background.treatment',
                ['transparent', 'dim', 'strong_dim', 'blackout'] as const,
                background?.treatment ?? 'dim',
              ),
              objectPosition: str(form, 'background.objectPosition', 'center') || 'center',
              mobileObjectPosition:
                str(form, 'background.mobileObjectPosition', 'center') || 'center',
              image: await imageField(form, 'background.image', 'hero', background?.image),
              mobileImage: await imageField(
                form,
                'background.mobileImage',
                'hero',
                background?.mobileImage,
              ),
              poster: await imageField(form, 'background.poster', 'hero', background?.poster),
            },
          },
        }
        break
      }

      case 'intro':
        next = {
          ...base,
          type: 'intro',
          config: {
            ...current.config,
            eyebrow: optional(form, 'eyebrow'),
            heading: optional(form, 'heading'),
            body: text(form, 'body'),
          },
        }
        break

      case 'youtube': {
        // The channel is validated HERE rather than at render time, so an
        // editor who pastes something that is not a channel URL finds out
        // immediately instead of the block quietly falling back to its CTA
        // forever. An empty value is allowed — that is how the block is
        // switched to pinned-only.
        const channelUrl = str(form, 'channelUrl')
        if (channelUrl && !youTubeHandle(channelUrl)) {
          throw new Error(
            `"${channelUrl}" is not a YouTube handle or channel URL. Expected something like https://www.youtube.com/@thekanjo — a /channel/UC… URL is a different identifier and will not resolve.`,
          )
        }

        next = {
          ...base,
          type: 'youtube',
          config: {
            ...current.config,
            eyebrow: optional(form, 'eyebrow'),
            heading: optional(form, 'heading'),
            channelUrl,
            mode: oneOf(form, 'mode', ['latest', 'pinned'] as const, current.config.mode),
            video: str(form, 'video'),
            title: optional(form, 'title'),
            description: optional(form, 'description'),
            aspectRatio: str(form, 'aspectRatio', '16 / 9') || '16 / 9',
            ctaLabel: str(form, 'ctaLabel', current.config.ctaLabel),
            fallback: oneOf(form, 'fallback', ['cta', 'hide'] as const, current.config.fallback),
            poster: await imageField(form, 'poster', 'video', current.config.poster),
          },
        }
        break
      }

      case 'tiktok': {
        // Same rule, and it matters more here: the handle is interpolated into
        // the embed's `data-unique-id`, so an invalid one must never be stored.
        const profileUrl = str(form, 'profileUrl')
        if (profileUrl && !tikTokHandle(profileUrl)) {
          throw new Error(
            `"${profileUrl}" is not a TikTok handle or profile URL. Expected something like https://www.tiktok.com/@the_kanjo — a vm.tiktok.com short link is a redirect and cannot be validated.`,
          )
        }

        next = {
          ...base,
          type: 'tiktok',
          config: {
            ...current.config,
            eyebrow: optional(form, 'eyebrow'),
            heading: optional(form, 'heading'),
            profileUrl,
            // One mode exists. Stated explicitly so adding 'display-api' later
            // is a compile error here rather than a silently ignored field.
            mode: 'creator-embed',
            ctaLabel: str(form, 'ctaLabel', current.config.ctaLabel),
            fallback: oneOf(form, 'fallback', ['cta', 'hide'] as const, current.config.fallback),
          },
        }
        break
      }

      case 'patreon':
        next = {
          ...base,
          type: 'patreon',
          config: {
            ...current.config,
            eyebrow: optional(form, 'eyebrow'),
            heading: optional(form, 'heading'),
            campaignUrl: str(form, 'campaignUrl'),
            limit: num(form, 'limit', current.config.limit, 1, 10),
            ctaLabel: str(form, 'ctaLabel', current.config.ctaLabel),
            fallback: oneOf(form, 'fallback', ['cta', 'hide'] as const, current.config.fallback),
            fallbackDescription: optional(form, 'fallbackDescription'),
            showLockedPosts: bool(form, 'showLockedPosts'),
          },
        }
        break

      default:
        // A block this admin has no panel for. Its visibility and order are
        // still editable, and its config passes through exactly as it was.
        next = base
    }

    const updated = [...sections]
    updated[index] = next
    await store.saveSections(updated)
    message = `Saved "${id}".`
  } catch (error) {
    failed(error)
  }
  done(message)
}

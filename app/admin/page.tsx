import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { currentAdmin, isAdminAuthConfigured } from '@/lib/admin/auth'
import { deploymentMode } from '@/lib/runtime/mode'
import { resolveContentStore, type ContentDraft } from '@/lib/content/store'
import {
  LOADER_INTENSITIES,
  SOCIAL_PLATFORMS,
  type Section,
} from '@/lib/content/types'

import { saveIdentity, saveLegal, saveLoader, saveSection, saveSocial, signOut } from './actions'
import { Field, ImageField, Panel, Select, TextArea, Toggle } from './fields'

/**
 * The admin.
 *
 * ── IT IS SPECIFIC TO THIS SITE, DELIBERATELY ───────────────────────────────
 *
 * There is no schema editor, no block builder and no generic entity list. Every
 * panel below knows what it is editing: the loader panel has a field for each
 * of the loader's five decisions and a slot for each of its two cars. That is
 * the brief's instruction — a small admin for one site, not a CMS — and it is
 * also why the whole thing is under 300 lines and ships no JavaScript.
 *
 * ── WHO CAN REACH IT ────────────────────────────────────────────────────────
 *
 * Two ways in and nothing else: local development with ADMIN_ENABLED=true (the
 * file-backed admin, no accounts), or an allowlisted Supabase session. See
 * lib/admin/auth.ts.
 *
 * There is NO secret path and no URL token — `/admin` is a normal, guessable
 * URL that simply refuses everyone. Hiding a route is not a control, and the
 * Daineku URL-token pattern is explicitly not copied here. Every mutation
 * re-checks authorisation server-side, because a Server Action is an HTTP
 * endpoint: hiding a form removes the button, not the route behind it.
 *
 * ── WHAT PERSISTS IT ────────────────────────────────────────────────────────
 *
 * `ContentStore`, not the filesystem. Locally that writes `content/*.json`; in
 * production it writes one row in Supabase and media to R2. The forms and the
 * actions are written against the interface, so which backend is behind them
 * changes nothing here. See lib/content/store.ts.
 */

export const metadata: Metadata = {
  title: 'Admin',
  // A development tool, but the header costs nothing and the day this is ever
  // served by accident is the day it matters.
  robots: { index: false, follow: false },
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>
}) {
  /**
   * THE GATE. Two paths in, and nothing else.
   *
   *   - local development with ADMIN_ENABLED=true: the file-backed admin, no
   *     accounts, and impossible to reach on a deployment because
   *     `deploymentMode()` reads VERCEL_ENV.
   *   - an allowlisted Supabase session: production.
   *
   * Anyone else is sent to sign in. Note that this is a REDIRECT rather than a
   * 404: hiding the route's existence buys nothing when every mutation is
   * checked server-side anyway, and a 404 on a page an admin is legitimately
   * trying to reach is a worse failure than a sign-in form. There is no secret
   * path and no URL token.
   */
  const admin = await currentAdmin()
  if (!admin) {
    if (!isAdminAuthConfigured() && deploymentMode() === 'development') {
      // Neither admin is configured. Say which switch is missing rather than
      // bouncing to a sign-in form that cannot work.
      return (
        <div className="a-shell">
          <header className="a-head">
            <h1>THE KANJO — CONTENT</h1>
            <p className="a-error">
              The admin is not enabled. Run with ADMIN_ENABLED=true for the local
              file-backed admin, or configure Supabase Auth for the authenticated one.
              See docs/ADMIN.md.
            </p>
          </header>
        </div>
      )
    }
    redirect('/admin/login')
  }

  const store = await resolveContentStore()
  const draft = await store.loadDraft()
  const params = await searchParams
  const readOnly = !store.writable
  const mode = deploymentMode()

  return (
    <div className="a-shell">
      <header className="a-head">
        <h1>THE KANJO — CONTENT</h1>
        <p className="a-note">
          {mode.toUpperCase()} — writing {store.kind}
          {admin.email ? ` as ${admin.email}` : ' (local development, no account)'}. Changes
          apply to the running site immediately.
        </p>
        {readOnly && <p className="a-error">READ ONLY — {store.readOnlyReason}</p>}
        {params.saved && <p className="a-ok">{params.saved}</p>}
        {params.error && <p className="a-error">{params.error}</p>}
        {admin.kind === 'supabase' && (
          <form action={signOut}>
            <button type="submit">SIGN OUT</button>
          </form>
        )}
      </header>

      <Panel
        title="SITE IDENTITY"
        action={saveIdentity}
        readOnly={readOnly}
        note="The name, the search-engine copy, and which chrome each route gets."
      >
        <Field label="Title" name="title" defaultValue={draft.settings.title} />
        <Field label="Canonical origin" name="primaryDomain" defaultValue={draft.settings.primaryDomain} />
        <Field label="Subtitle" name="subtitle" defaultValue={draft.settings.subtitle} wide />
        <Field label="Status label" name="status.label" defaultValue={draft.settings.status.label} />
        <Field label="Status detail" name="status.detail" defaultValue={draft.settings.status.detail} />

        <Field label="SEO title" name="seo.title" defaultValue={draft.settings.seo.title} />
        <Field
          label="SEO title template"
          name="seo.titleTemplate"
          defaultValue={draft.settings.seo.titleTemplate}
          hint="%s is the page's own title."
        />
        <TextArea
          label="SEO description"
          name="seo.description"
          defaultValue={draft.settings.seo.description}
          rows={3}
        />
        <ImageField
          label="Default social image"
          name="seo.defaultSocialImage"
          value={draft.settings.seo.defaultSocialImage}
          folder="og"
          hint="Used for og:image and twitter:image when a page has none of its own. 1200×630."
        />
        <ImageField
          label="Wordmark"
          name="wordmark"
          value={draft.settings.wordmark}
          folder="og"
          hint="Optional. Without one the header draws the title in the display face."
        />

        <Toggle
          label="Header on reading pages (/updates)"
          name="chrome.headerOnReadingPages"
          defaultChecked={draft.settings.chrome.headerOnReadingPages}
        />
        <Toggle
          label="Header on the homepage"
          name="chrome.headerOnHome"
          defaultChecked={draft.settings.chrome.headerOnHome}
          hint="Off by default: the homepage is a title screen."
        />
        <Toggle
          label="Persistent channel cluster"
          name="chrome.socialCluster"
          defaultChecked={draft.settings.chrome.socialCluster}
        />

        <Field
          label="Publisher name"
          name="publisher.name"
          defaultValue={draft.settings.publisher?.name}
          hint="Appears in the footer AND as the publisher in JSON-LD. Both are read from this one field."
        />
        <Field
          label="Publisher URL"
          name="publisher.url"
          defaultValue={draft.settings.publisher?.url}
          hint="The publisher's OWN site. Never becomes the canonical URL for The Kanjo."
        />

        <Field
          label="Copyright holder"
          name="footer.copyrightHolder"
          defaultValue={draft.settings.footer.copyrightHolder}
        />
        <Field label="Footer note" name="footer.note" defaultValue={draft.settings.footer.note} />
      </Panel>

      <Panel
        title="LOADER"
        action={saveLoader}
        readOnly={readOnly}
        note="The night highway. Both vehicles are required; the road plate is optional. Uploaded art replaces the temporary neutral silhouettes."
      >
        <Toggle label="Enabled" name="enabled" defaultChecked={draft.loader.enabled} />
        <Toggle
          label="Animate the title as the highway clears"
          name="titleRevealEnabled"
          defaultChecked={draft.loader.titleRevealEnabled}
          hint="Treated as off under prefers-reduced-motion whatever this says."
        />
        <Field
          label="Minimum display (ms)"
          name="minimumDisplayMs"
          type="number"
          defaultValue={draft.loader.minimumDisplayMs}
          hint="A floor, so a warm cache is not a flicker. One overtake takes ~3000ms."
        />
        <Field
          label="Maximum display (ms)"
          name="maximumDisplayMs"
          type="number"
          defaultValue={draft.loader.maximumDisplayMs}
          hint="The escape path. Past this the site opens whatever is still loading."
        />
        <Select
          label="Intensity"
          name="intensity"
          options={LOADER_INTENSITIES}
          defaultValue={draft.loader.intensity}
          hint="A phone automatically runs one step below this."
        />
        <ImageField
          label="Car A — near lane"
          name="carA"
          value={draft.loader.carA}
          folder="loader"
          hint="The lower, larger car. Side profile, facing right."
        />
        <ImageField
          label="Car B — far lane"
          name="carB"
          value={draft.loader.carB}
          folder="loader"
          hint="The upper, smaller car — the one that closes and overtakes first."
        />
        <ImageField
          label="Road plate (optional)"
          name="road"
          value={draft.loader.road}
          folder="loader"
          hint="Leave empty and the highway is drawn from CSS, costing no request."
        />
      </Panel>

      <Panel
        title="CHANNELS"
        action={saveSocial}
        readOnly={readOnly}
        note="The persistent cluster at the upper-left edge. A channel with an empty URL is not rendered — that is how an unannounced destination is represented."
      >
        {draft.settings.social.map((link) => (
          <fieldset key={link.id} className="a-field a-field--wide a-row">
            <legend className="a-label">{link.id}</legend>
            <div className="a-grid">
              <Field label="Label" name={`social.${link.id}.label`} defaultValue={link.label} />
              <Select
                label="Platform"
                name={`social.${link.id}.platform`}
                options={SOCIAL_PLATFORMS}
                defaultValue={link.platform}
              />
              <Field label="URL" name={`social.${link.id}.url`} defaultValue={link.url} wide />
              <Field
                label="Order"
                name={`social.${link.id}.order`}
                type="number"
                defaultValue={link.order}
              />
              <Toggle
                label="Published"
                name={`social.${link.id}.published`}
                defaultChecked={link.published}
              />
              <Toggle
                label="Open in a new tab"
                name={`social.${link.id}.openInNewTab`}
                defaultChecked={link.openInNewTab ?? true}
              />
              <ImageField
                label="Icon (optional)"
                name={`social.${link.id}.icon`}
                value={link.icon}
                folder="social"
                hint="Without one the cluster draws the label, which is the game's own menu treatment."
              />
            </div>
          </fieldset>
        ))}
      </Panel>

      <Panel
        title="LEGAL"
        action={saveLegal}
        readOnly={readOnly}
        note="The /privacy and /terms pages. Markdown subset — headings, paragraphs, lists, links — never HTML. Both must state only what the site actually does."
      >
        {(['privacy', 'terms'] as const).map((key) => (
          <fieldset key={key} className="a-field a-field--wide a-row">
            <legend className="a-label">/{key}</legend>
            <div className="a-grid">
              <Field label="Title" name={`${key}.title`} defaultValue={draft.settings.legal[key].title} />
              <Field
                label="Last updated"
                name={`${key}.updatedAt`}
                defaultValue={draft.settings.legal[key].updatedAt}
                hint="YYYY-MM-DD. Change it when the meaning changes, not for a typo."
              />
              <TextArea
                label="Body"
                name={`${key}.body`}
                defaultValue={draft.settings.legal[key].body}
                rows={18}
              />
            </div>
          </fieldset>
        ))}
      </Panel>

      {draft.sections.map((section) => (
        <SectionPanel key={section.id} section={section} readOnly={readOnly} draft={draft} />
      ))}
    </div>
  )
}

function SectionPanel({
  section,
  readOnly,
}: {
  section: Section
  readOnly: boolean
  draft: ContentDraft
}) {
  return (
    <Panel
      title={`${section.type.toUpperCase()} — ${section.id}`}
      action={saveSection}
      readOnly={readOnly}
      note={`Block "${section.id}". Turn it off with Published; move it with Order.`}
    >
      {/* The id travels with the form: the action edits one section by id and
          leaves every other entry in the file exactly as it was. */}
      <input type="hidden" name="id" value={section.id} />
      <Toggle label="Published" name="published" defaultChecked={section.published} />
      <Field label="Order" name="order" type="number" defaultValue={section.order} />

      {section.type === 'hero' && (
        <>
          <Field
            label="Title"
            name="title"
            defaultValue={section.config.title}
            hint="Always the page's H1. With the logo identity it is the logo's alt text."
          />
          <Select
            label="Visible identity"
            name="identity"
            options={['logo', 'text'] as const}
            defaultValue={section.config.identity ?? 'logo'}
            hint="'logo' shows the artwork below; 'text' sets the title in the display face."
          />
          <ImageField
            label="Logo"
            name="logo"
            value={section.config.logo}
            folder="og"
            hint="Transparent PNG or SVG. Shown at up to 560px wide over the hero."
          />
          <Field label="Subtitle" name="subtitle" defaultValue={section.config.subtitle} />
          <TextArea
            label="Description"
            name="description"
            defaultValue={section.config.description}
            rows={3}
          />
          <Field
            label="Platform note"
            name="platformNote"
            defaultValue={section.config.platformNote}
            wide
          />
          <Select
            label="Background kind"
            name="background.kind"
            options={['none', 'image', 'video'] as const}
            defaultValue={section.config.background?.kind ?? 'none'}
          />
          <Select
            label="Treatment"
            name="background.treatment"
            options={['transparent', 'dim', 'strong_dim', 'blackout'] as const}
            defaultValue={section.config.background?.treatment ?? 'dim'}
            hint="'dim' is the game's own default over live media."
          />
          <Field
            label="Crop — desktop"
            name="background.objectPosition"
            defaultValue={section.config.background?.objectPosition ?? 'center'}
            hint="CSS object-position. 'center 58%' sits the crop slightly low so the road carries the bottom third."
          />
          <Field
            label="Crop — mobile"
            name="background.mobileObjectPosition"
            defaultValue={section.config.background?.mobileObjectPosition ?? 'center'}
            hint="Below 768px the crop is tall and narrow; '72% 50%' keeps the red car in frame."
          />
          <ImageField
            label="Background still"
            name="background.image"
            value={section.config.background?.image}
            folder="hero"
          />
          <ImageField
            label="Background still — narrow viewports"
            name="background.mobileImage"
            value={section.config.background?.mobileImage}
            folder="hero"
            hint="Only needed when the desktop frame cannot survive a portrait crop."
          />
          <ImageField
            label="Video poster"
            name="background.poster"
            value={section.config.background?.poster}
            folder="hero"
            hint="MANDATORY for a video background: it is the first paint and the reduced-motion fallback."
          />
        </>
      )}

      {section.type === 'intro' && (
        <>
          <Field label="Eyebrow" name="eyebrow" defaultValue={section.config.eyebrow} />
          <Field label="Heading" name="heading" defaultValue={section.config.heading} />
          <TextArea
            label="Body"
            name="body"
            defaultValue={section.config.body}
            rows={8}
            hint="Markdown subset. Blank line between paragraphs. Keep it to three at most."
          />

          {/* Ordered blocks after the body. One row per existing block plus one
              empty row for a new one; order is a number, remove is a box. It
              saves without JavaScript, like every other panel. */}
          {[...(section.config.blocks ?? []).map((block, index) => ({ key: String(index), block })), { key: 'new', block: null }].map(
            ({ key, block }) => (
              <fieldset key={key} className="a-field a-field--wide a-row">
                <legend className="a-label">
                  {block ? `Block ${Number(key) + 1} — ${block.type}` : 'New block'}
                </legend>
                <div className="a-grid">
                  <Select
                    label="Type"
                    name={`blocks[${key}].type`}
                    options={block ? ([block.type] as const) : (['', 'text', 'youtube'] as const)}
                    defaultValue={block?.type ?? ''}
                    hint={block ? undefined : "Leave empty to add nothing."}
                  />
                  <Field
                    label="Order"
                    name={`blocks[${key}].order`}
                    type="number"
                    defaultValue={block ? Number(key) : (section.config.blocks?.length ?? 0)}
                  />
                  {block && <Toggle label="Remove this block" name={`blocks[${key}].remove`} />}
                  <TextArea
                    label="Text (for a text block)"
                    name={`blocks[${key}].body`}
                    defaultValue={block?.type === 'text' ? block.body : ''}
                    rows={4}
                    hint="Markdown subset."
                  />
                  <Field
                    label="YouTube video (for a video block)"
                    name={`blocks[${key}].video`}
                    defaultValue={block?.type === 'youtube' ? block.video : ''}
                    wide
                    hint="A bare id or any YouTube URL. Click-to-load, like the main video."
                  />
                  <Field
                    label="Video caption"
                    name={`blocks[${key}].title`}
                    defaultValue={block?.type === 'youtube' ? block.title : ''}
                  />
                  <Field
                    label="Aspect ratio"
                    name={`blocks[${key}].aspectRatio`}
                    defaultValue={block?.type === 'youtube' ? block.aspectRatio : ''}
                    hint="Defaults to 16 / 9."
                  />
                </div>
              </fieldset>
            ),
          )}
        </>
      )}

      {section.type === 'youtube' && (
        <>
          <Field label="Eyebrow" name="eyebrow" defaultValue={section.config.eyebrow} />
          <Field label="Heading" name="heading" defaultValue={section.config.heading} />
          <Field
            label="YouTube channel"
            name="channelUrl"
            defaultValue={section.config.channelUrl}
            wide
            hint="e.g. https://www.youtube.com/@thekanjo. A /channel/UC… URL is a different identifier and is rejected."
          />
          <Select
            label="Which video"
            name="mode"
            options={['latest', 'pinned'] as const}
            defaultValue={section.config.mode}
            hint="'latest' resolves the channel's newest public upload automatically. 'pinned' uses the video below."
          />
          <Field
            label="Pinned video"
            name="video"
            defaultValue={section.config.video}
            wide
            hint="A bare id or any YouTube URL. Required for 'pinned'; in 'latest' mode it is the fallback if the API is unreachable."
          />
          <Field
            label="Caption override"
            name="title"
            defaultValue={section.config.title}
            wide
            hint="Leave empty in 'latest' mode to use the video's own title — that is what makes the block update itself."
          />
          <TextArea
            label="Description override"
            name="description"
            defaultValue={section.config.description}
            rows={3}
          />
          <Field
            label="Aspect ratio"
            name="aspectRatio"
            defaultValue={section.config.aspectRatio}
            hint="CSS aspect-ratio, e.g. '16 / 9'. Reserves the box so nothing shifts."
          />
          <Field label="CTA label" name="ctaLabel" defaultValue={section.config.ctaLabel} />
          <Select
            label="With no video to play"
            name="fallback"
            options={['cta', 'hide'] as const}
            defaultValue={section.config.fallback}
            hint="'cta' keeps the block and a link to the channel; 'hide' removes the section."
          />
          <ImageField
            label="Poster override"
            name="poster"
            value={section.config.poster}
            folder="video"
            hint="Optional. Without one the still comes from the API, fetched by this server rather than by the visitor's browser."
          />
        </>
      )}

      {section.type === 'tiktok' && (
        <>
          <Field label="Eyebrow" name="eyebrow" defaultValue={section.config.eyebrow} />
          <Field label="Heading" name="heading" defaultValue={section.config.heading} />
          <Field
            label="TikTok profile"
            name="profileUrl"
            defaultValue={section.config.profileUrl}
            wide
            hint="e.g. https://www.tiktok.com/@the_kanjo. Validated before it is stored — the handle is interpolated into the official embed, so an invalid one is refused here."
          />
          <Field label="CTA label" name="ctaLabel" defaultValue={section.config.ctaLabel} />
          <Select
            label="With no profile configured"
            name="fallback"
            options={['cta', 'hide'] as const}
            defaultValue={section.config.fallback}
            hint="TikTok being blocked or slow is handled inside the embed — it shows the CTA as its own initial content."
          />
        </>
      )}

      {section.type === 'patreon' && (
        <>
          <Field label="Eyebrow" name="eyebrow" defaultValue={section.config.eyebrow} />
          <Field label="Heading" name="heading" defaultValue={section.config.heading} />
          <Field
            label="Creator page URL"
            name="campaignUrl"
            defaultValue={section.config.campaignUrl}
            wide
            hint="The CTA's destination. The API token is NOT set here — it is PATREON_ACCESS_TOKEN in the server environment."
          />
          <Field
            label="Posts to show"
            name="limit"
            type="number"
            defaultValue={section.config.limit}
          />
          <Field label="CTA label" name="ctaLabel" defaultValue={section.config.ctaLabel} />
          <Select
            label="When the feed is unavailable"
            name="fallback"
            options={['cta', 'hide'] as const}
            defaultValue={section.config.fallback}
            hint="'cta' keeps the block and its button; 'hide' removes the section."
          />
          <TextArea
            label="Fallback description"
            name="fallbackDescription"
            defaultValue={section.config.fallbackDescription}
            rows={3}
          />
          <Toggle
            label="List members-only posts"
            name="showLockedPosts"
            defaultChecked={section.config.showLockedPosts}
            hint="Title, date and a link only. Paid bodies are never rendered whatever this is set to."
          />
        </>
      )}
    </Panel>
  )
}

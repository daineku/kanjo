import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import {
  isAdminEnabled,
  resolveContentStore,
  type ContentDraft,
} from '@/lib/content/store'
import {
  LOADER_INTENSITIES,
  SOCIAL_PLATFORMS,
  type Section,
} from '@/lib/content/types'

import { saveIdentity, saveLoader, saveSection, saveSocial } from './actions'
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
 * ── IT IS NOT REACHABLE IN PRODUCTION ───────────────────────────────────────
 *
 * `notFound()` unless NODE_ENV is development AND ADMIN_ENABLED is true. It has
 * NO AUTHENTICATION, because the backend it will eventually talk to does not
 * exist yet and inventing a password here would be worse than having none: it
 * would make the route look protected. The Server Actions re-check the same
 * gate, because hiding a form does not remove the endpoint behind it.
 *
 * ── WHAT PERSISTS IT ────────────────────────────────────────────────────────
 *
 * `ContentStore`, not the filesystem. The local implementation writes
 * `content/*.json`; the forms and actions are written against the interface, so
 * pointing the admin at a hosted backend is one new implementation of five
 * methods and no change here. See lib/content/store.ts.
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
  if (!isAdminEnabled()) notFound()

  const store = await resolveContentStore()
  const draft = await store.loadDraft()
  const params = await searchParams
  const readOnly = !store.writable

  return (
    <div className="a-shell">
      <header className="a-head">
        <h1>THE KANJO — CONTENT</h1>
        <p className="a-note">
          Development tool. Writes {store.kind}. Changes apply to the running site immediately.
        </p>
        {readOnly && <p className="a-error">READ ONLY — {store.readOnlyReason}</p>}
        {params.saved && <p className="a-ok">{params.saved}</p>}
        {params.error && <p className="a-error">{params.error}</p>}
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
          <Field label="Title" name="title" defaultValue={section.config.title} />
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
            label="Object position"
            name="background.objectPosition"
            defaultValue={section.config.background?.objectPosition ?? 'center'}
            hint="CSS object-position, e.g. 'center 35%'."
          />
          <Field
            label="Object position (mobile)"
            name="background.mobileObjectPosition"
            defaultValue={section.config.background?.mobileObjectPosition ?? 'center'}
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

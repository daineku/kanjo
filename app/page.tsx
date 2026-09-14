import { SiteHeader } from '@/components/layout/SiteHeader'
import { renderSection } from '@/components/sections/registry'
import { resolveContentSource } from '@/lib/content/source'
import { SiteStructuredData } from '@/lib/seo/structuredData'

/**
 * The landing page.
 *
 * Still the whole of it: fetch the bundle once, map the configured sections.
 * Order, visibility and copy are content decisions, so a change to the page's
 * composition never touches this file.
 *
 * ── IT IS STILL A SERVER COMPONENT, AND THAT IS THE POINT ───────────────────
 *
 * The motion work added here did NOT turn the homepage into a client
 * component. Every section below is server-rendered; the animation lives in
 * four small client islands (the loader, the title reveal, the scroll reveal
 * and the clip reveal) that take server-rendered markup through `children`. So
 * the page is prerendered at build time and served as static HTML with all of
 * its copy in it, exactly as before — a crawler and a visitor with broken
 * JavaScript both get the finished page, just without the motion.
 *
 * ── THE V1 COMPOSITION ──────────────────────────────────────────────────────
 *
 * Loader, THE KANJO, what it is, watch it, read the devlog, follow it. Six
 * beats and a footer. Everything the previous long landing page carried —
 * features, development status, the screenshot gallery — still exists in the
 * registry and is switched OFF in content/sections.json, so none of it is lost
 * and none of it is on the page.
 */

export default async function HomePage() {
  const source = await resolveContentSource()
  const content = await source.getLandingContent()

  return (
    <>
      <SiteStructuredData settings={content.settings} />
      {/* Off by default: the homepage is a title screen. See ChromeSettings. */}
      {content.settings.chrome.headerOnHome && <SiteHeader settings={content.settings} />}
      {content.sections.map((section) => renderSection(section, content))}
    </>
  )
}

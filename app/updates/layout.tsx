import { SiteHeader } from '@/components/layout/SiteHeader'
import { resolveContentSource } from '@/lib/content/source'

/**
 * The reading routes' chrome.
 *
 * The header lives HERE rather than in the root layout because these are the
 * only pages on the site that are documents — a visitor reading an update needs
 * a way back and a way to the next one, which is what a nav is for. The
 * homepage is a title screen and carries no bar across the top of it.
 *
 * A server component with no client boundary: which route we are on is decided
 * by WHICH LAYOUT RENDERS, not by reading `usePathname()` in the browser. The
 * nav strip inside the header is still a client component so it can mark the
 * current item, and is still server-rendered into the HTML.
 */
export default async function UpdatesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const source = await resolveContentSource()
  const settings = await source.getSiteSettings()

  return (
    <>
      {settings.chrome.headerOnReadingPages && <SiteHeader settings={settings} />}
      {children}
    </>
  )
}

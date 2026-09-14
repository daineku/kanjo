import './admin.css'

import { SkipLoader } from './SkipLoader'

/**
 * The admin's shell.
 *
 * Two jobs, both about keeping the tool out of the site's way and the site out
 * of the tool's.
 *
 *  1. It imports admin.css HERE rather than in globals.css, so none of the
 *     tool's stylesheet is downloaded by a visitor to the actual site.
 *
 *  2. It opts the route out of the loader. The overlay is hidden by admin.css,
 *     and SkipLoader releases the scroll lock and the `inert` attribute that
 *     would otherwise make the form unclickable for the first two seconds after
 *     every save. See SkipLoader.tsx for why the loader cannot simply be
 *     skipped in the root layout.
 *
 * The root layout still wraps this, so the fonts, the tokens and `#app-root`
 * are all present.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SkipLoader />
      {children}
    </>
  )
}

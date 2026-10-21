import './admin.css'

/**
 * The admin's shell.
 *
 * It imports admin.css HERE rather than in globals.css, so none of the tool's
 * stylesheet is downloaded by a visitor to the actual site.
 *
 * The root layout still wraps this, so the fonts, the tokens and `#app-root`
 * are all present.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children
}

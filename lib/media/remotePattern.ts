/**
 * Turning `R2_PUBLIC_BASE_URL` into a `next/image` remote pattern, at build
 * time.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * `next/image` refuses to optimise a host it has not been told about, and the
 * host that serves The Kanjo's media is whatever domain the R2 bucket is
 * published on — a decision made in the Cloudflare dashboard, after this code
 * is written. The first version handled that by telling the deployment operator
 * to "add the hostname to next.config.ts", which is a SOURCE EDIT in the middle
 * of an otherwise browser-only setup, and therefore a code change that would
 * have to happen after infrastructure provisioning.
 *
 * So the config derives the pattern from the same environment variable the
 * media store already uses. Creating the bucket and pointing a domain at it is
 * now environment variables only. There is no hostname hardcoded anywhere.
 *
 * ── AND WHY IT IS A SEPARATE, PURE MODULE ───────────────────────────────────
 *
 * `next.config.ts` is loaded by the Next CLI before anything else exists, so it
 * cannot import from the app's module graph freely — but it CAN import a file
 * with no dependencies. Keeping the parsing here means the rule is testable by
 * `node` rather than only observable by running a build and squinting at the
 * output.
 */

export type RemoteImagePattern = {
  protocol: 'https'
  hostname: string
  port?: string
  pathname?: string
}

export class MediaOriginError extends Error {
  // Written out rather than as a parameter property: this module is reachable
  // from `node` tests, and Node's type stripping rejects those.
  constructor(message: string) {
    super(message)
    this.name = 'MediaOriginError'
  }
}

/**
 * The remote pattern for the configured media origin, or null when there is
 * none.
 *
 * ── THE THREE OUTCOMES, AND WHY EACH IS WHAT IT IS ──────────────────────────
 *
 *   ABSENT / EMPTY → null. Local development and any deployment that has not
 *     turned R2 on. A build must not require variables it does not use.
 *
 *   VALID https URL → a pattern pinned to that exact host, and to a path prefix
 *     when the URL has one. NOT a wildcard: `https://**` would let any host on
 *     the internet be proxied through this site's image optimizer, which is an
 *     open proxy and a bandwidth bill.
 *
 *   MALFORMED → throws, failing the build with an actionable message. The
 *     alternative — ignoring it — means a deployment that looks healthy and
 *     serves broken images, and the operator has no way to tell which of the
 *     five R2 variables they mistyped. A build failure names it.
 *
 * `http://` is refused as malformed rather than accepted: the value becomes the
 * `src` of every uploaded image on an https site, so it would be mixed content.
 */
export function mediaRemotePattern(rawBaseUrl: string | undefined | null): RemoteImagePattern | null {
  const raw = rawBaseUrl?.trim()
  if (!raw) return null

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new MediaOriginError(
      `R2_PUBLIC_BASE_URL is not a URL: "${raw}". Expected something like ` +
        `https://media.thekanjo.com or https://pub-xxxx.r2.dev.`,
    )
  }

  if (url.protocol !== 'https:') {
    throw new MediaOriginError(
      `R2_PUBLIC_BASE_URL must be https — got "${url.protocol}//". It becomes the src of ` +
        `every uploaded image, so anything else is mixed content on a secure page.`,
    )
  }

  if (!url.hostname || url.hostname.includes('*')) {
    throw new MediaOriginError(
      `R2_PUBLIC_BASE_URL must name a single host, not a pattern: "${raw}".`,
    )
  }

  // A bucket published under a path prefix (`https://cdn.example.com/kanjo`)
  // is pinned to that prefix, so the optimizer cannot be pointed at the rest of
  // the domain.
  const prefix = url.pathname.replace(/\/+$/, '')

  return {
    protocol: 'https',
    hostname: url.hostname,
    ...(url.port ? { port: url.port } : {}),
    ...(prefix ? { pathname: `${prefix}/**` } : {}),
  }
}

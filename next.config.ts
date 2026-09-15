import type { NextConfig } from 'next'

import { mediaRemotePattern } from './lib/media/remotePattern.ts'

/**
 * Deliberately does NOT set `eslint.ignoreDuringBuilds` or `typescript.ignoreBuildErrors`.
 *
 * The Daineku site carries both, which means a type or lint regression there can only be
 * caught by a human reading the console. Here the build is the gate. See docs/ARCHITECTURE.md.
 */

/**
 * The media origin, derived from the SAME variable the media store uses.
 *
 * `next/image` refuses to optimise a host it has not been told about, and the
 * host serving The Kanjo's media is whatever domain the R2 bucket is published
 * on — decided in the Cloudflare dashboard, after this file is written.
 *
 * Deriving it here is what makes creating the bucket an environment-variable
 * change and nothing more. No hostname is hardcoded; a malformed value fails
 * the build with a message naming the variable rather than producing a
 * healthy-looking deployment that serves broken images. See
 * lib/media/remotePattern.ts.
 */
const mediaPattern = mediaRemotePattern(process.env.R2_PUBLIC_BASE_URL)

const nextConfig: NextConfig = {
  // There is a stray package-lock.json in the user's home directory, which Next
  // otherwise infers as the workspace root — pulling the whole home tree into
  // build tracing. Pin the root to this project.
  outputFileTracingRoot: import.meta.dirname,

  images: {
    // Local content is served from /public and needs no remote pattern. Every
    // entry below is narrow on purpose: there is deliberately no `https://**`,
    // which would turn this site's image optimizer into an open proxy for the
    // whole internet.
    remotePatterns: [
      // R2's default development subdomain, so a bucket published on r2.dev
      // works before a custom domain exists.
      { protocol: 'https' as const, hostname: '**.r2.dev' },
      // Supabase storage, for the day content images are served from there.
      { protocol: 'https' as const, hostname: '**.supabase.co' },
      /**
       * YouTube's thumbnail host, and the reason it is here is privacy rather
       * than convenience: the homepage's video facade needs a still, and
       * routing it through the optimizer means OUR server fetches it. The
       * visitor's browser contacts no Google host until they press PLAY, which
       * is the whole point of not shipping the iframe up front. Narrow on
       * purpose — the path is pinned to the thumbnail directory.
       */
      { protocol: 'https' as const, hostname: 'i.ytimg.com', pathname: '/vi/**' },
      // The configured R2 public origin, when there is one. A custom domain
      // lands here; an r2.dev one is already covered above and duplicating it
      // is harmless.
      ...(mediaPattern ? [mediaPattern] : []),
    ],
    dangerouslyAllowSVG: false,

    /**
     * AVIF first, WebP second. Next's default is WebP only.
     *
     * This is a night game: near-black skies, shallow gradients in dark paint,
     * and small intense light sources. AVIF is materially better than WebP on
     * exactly that content — it carries smooth low-contrast gradients without the
     * banding WebP introduces at comparable sizes, and it rings less around a
     * bright light on black. Browsers that do not support it fall through to
     * WebP, then to the original, so this costs nothing but encode time on a
     * cache miss. See docs/MEDIA_WORKFLOW.md, "Night images".
     */
    formats: ['image/avif', 'image/webp'],
  },
  poweredByHeader: false,
}

export default nextConfig

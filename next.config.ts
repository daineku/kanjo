import type { NextConfig } from 'next'

/**
 * Deliberately does NOT set `eslint.ignoreDuringBuilds` or `typescript.ignoreBuildErrors`.
 *
 * The Daineku site carries both, which means a type or lint regression there can only be
 * caught by a human reading the console. Here the build is the gate. See docs/ARCHITECTURE.md.
 */
const nextConfig: NextConfig = {
  // There is a stray package-lock.json in the user's home directory, which Next
  // otherwise infers as the workspace root — pulling the whole home tree into
  // build tracing. Pin the root to this project.
  outputFileTracingRoot: import.meta.dirname,

  images: {
    // Local content is served from /public and needs no remote pattern. These exist for the
    // future remote content source (see lib/content/source.ts) and are narrow on purpose.
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
      { protocol: 'https', hostname: '**.r2.dev' },
      /**
       * YouTube's thumbnail host, and the reason it is here is privacy rather
       * than convenience: the homepage's video facade needs a still, and
       * routing it through the optimizer means OUR server fetches it. The
       * visitor's browser contacts no Google host until they press PLAY, which
       * is the whole point of not shipping the iframe up front. Narrow on
       * purpose — the path is pinned to the thumbnail directory.
       */
      { protocol: 'https', hostname: 'i.ytimg.com', pathname: '/vi/**' },
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

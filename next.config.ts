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
    ],
    dangerouslyAllowSVG: false,
  },
  poweredByHeader: false,
}

export default nextConfig

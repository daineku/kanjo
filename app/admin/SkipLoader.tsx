'use client'

import { useEffect } from 'react'

import { markStageReady } from '@/lib/motion/stage'

/**
 * Hands the stage over immediately on the admin route.
 *
 * The loader lives in the root layout — it is the site's entrance, and the root
 * layout is the only place that can put `data-loader="pending"` on <html> in
 * time for the first paint. That is right for the site and wrong for a tool:
 * without this, an editor would wait out a 2.2-second night highway on every
 * save, and for the first of those seconds the form would be `inert` and would
 * not accept a click.
 *
 * So the admin opts out. `admin.css` hides the overlay, and this releases the
 * two things the loader would otherwise hold: the scroll lock and the inert
 * attribute. The loader's own timeline runs to completion behind
 * `display: none` and disposes itself normally — it is a handful of transforms
 * on hidden elements for two seconds, which is cheaper than threading route
 * knowledge into the root layout for a development tool.
 */
export function SkipLoader() {
  useEffect(() => {
    document.documentElement.dataset.loader = 'done'
    document.getElementById('app-root')?.removeAttribute('inert')
    // Keeps the shared handshake consistent: anything awaiting the stage (the
    // hero's title reveal, were it ever rendered here) resolves rather than
    // waiting for its timeout.
    markStageReady()
  }, [])

  return null
}

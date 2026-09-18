'use client'

import { useEffect, useState } from 'react'
import type { SocialLink } from '@/lib/content/types'

/**
 * The persistent channel cluster at the upper-left edge.
 *
 * ── WHY IT LOOKS LIKE THE GAME'S MENU AND NOT LIKE A SOCIAL WIDGET ──────────
 *
 * The default rendering is a LABEL, not a logo: the canon's left rule plus the
 * channel name in the display face, which is exactly how the game marks a menu
 * entry (UI_Canon Components/navigation_button — a divider-width spine and an
 * uppercase navigationTitle). A vertical rail of three third-party glyphs is
 * the generic-social-widget look the brief rules out, and it would also put
 * three other companies' branding in the corner of a title screen.
 *
 * An `icon` ImageRef is still part of the model, because the owner may well
 * draw marks in the game's own language later. When one is configured it is
 * rendered beside the label as a plain <img> — never inlined, so an SVG from the
 * content layer cannot bring markup or script into the document.
 *
 * ── A CHANNEL WITH NO URL IS ABSENT ─────────────────────────────────────────
 *
 * Steam has no page yet. This component therefore drops any entry whose URL is
 * empty rather than rendering a dead item — the opposite of the site's rule for
 * a hero ACTION, where an unannounced destination stays visible with its reason
 * because the visitor is reading a list of what is coming. A persistent corner
 * rail is not that list; an inert item there is just clutter that never resolves.
 * Nothing is invented, and no placeholder Steam URL exists anywhere.
 *
 * ── MOTION ──────────────────────────────────────────────────────────────────
 *
 * The entrance stagger is pure CSS, keyed on `html[data-loader]` — so it costs
 * no JavaScript, no hydration and no GSAP instance, and it simply does not run
 * for a visitor who asked for reduced motion. Nothing here animates after that:
 * no bounce, no pulse, no permanent motion in the corner of the eye.
 */

export function SocialCluster({ links }: { links: SocialLink[] }) {
  const live = links.filter((link) => link.url.trim() !== '')
  const [heroVisible, setHeroVisible] = useState(true)

  useEffect(() => {
    const hero = document.querySelector('.k-hero')
    if (!hero || typeof IntersectionObserver !== 'function') return

    const observer = new IntersectionObserver(
      ([entry]) => {
        setHeroVisible(Boolean(entry?.isIntersecting))
      },
      { threshold: 0.02 },
    )

    observer.observe(hero)
    return () => observer.disconnect()
  }, [])

  if (live.length === 0) return null

  return (
    <nav
      className="k-social-cluster"
      aria-label="Channels"
      data-hero-visible={heroVisible ? 'true' : 'false'}
    >
      <ul>
        {live.map((link, index) => {
          const newTab = link.openInNewTab ?? true
          return (
            <li
              key={link.id}
              // Drives the CSS stagger. A custom property rather than an inline
              // animation-delay so the whole timing curve stays in one place.
              style={{ ['--k-social-index' as string]: index }}
            >
              <a
                className="k-social-link"
                href={link.url}
                data-platform={link.platform}
                target={newTab ? '_blank' : undefined}
                rel={newTab ? 'noopener noreferrer' : undefined}
              >
                {link.icon && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="k-social-icon"
                    src={link.icon.src}
                    alt=""
                    width={link.icon.width}
                    height={link.icon.height}
                    aria-hidden="true"
                  />
                )}
                <span className="k-social-label">{link.label}</span>
                {link.handle && <span className="k-visually-hidden"> {link.handle}</span>}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

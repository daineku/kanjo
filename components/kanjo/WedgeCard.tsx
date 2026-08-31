import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * The Kanjo's menu card, on the web.
 *
 * This is the game's `navigation_button` and its `service_item` — one component
 * for both, exactly as the runtime does it (KanjoUiWedgeCard.cs, whose header
 * comment explains why: same rect, same two labels, same band, same rule, and
 * the reference screenshots are pixel-alike but for the copy).
 *
 * The construction is the canon's:
 *   - a panel fill at Tokens/opacity.json panelFill (0.1)
 *   - a top band at navigation_wedge.svg's 37.1543 of a 95.308 card, at the
 *     0.7 opacity every canon panel SVG draws it with
 *   - a left rule at Tokens/borders.json divider.width (2.869)
 *   - the title INSIDE the band; the subtitle below it
 *
 * All of that lives in `.k-wedge` in app/globals.css, including the state
 * colours. This component only decides which element to render and what data
 * attributes to set — so hover, focus and selection are CSS, not React state,
 * and a card costs no JavaScript at all.
 *
 * A card renders as:
 *   - `<Link>` for an internal href
 *   - `<a>` for an external href
 *   - `<span>` when there is no href, or when it is unavailable
 *
 * An unavailable card is VISIBLE and carries its reason. That is the canon's
 * rule for a locked row (Components/navigation_button.json: "disabled opacity;
 * no submit", and the runtime's SetActionable: "visible and focusable because
 * hiding a locked rival is how a player never learns what to aim for"). It is
 * also the honest treatment for a destination that has not been announced.
 */

export type WedgeCardProps = {
  title: string
  subtitle?: string
  href?: string
  external?: boolean
  /** Draws the canon's positive selection treatment. */
  selected?: boolean
  /** Renders at disabled opacity and is not activatable. */
  disabled?: boolean
  /** Shown in place of the subtitle when disabled. */
  disabledReason?: string
  /** 'nav' is the slim header variant; 'card' is the canon's full card size. */
  variant?: 'default' | 'nav' | 'card'
  /** Extra content under the subtitle. */
  children?: ReactNode
  className?: string
  /** Marks the current page for assistive technology. */
  current?: boolean
}

const VARIANT_CLASS: Record<NonNullable<WedgeCardProps['variant']>, string> = {
  default: '',
  nav: 'k-wedge--nav',
  card: 'k-wedge--card',
}

export function WedgeCard({
  title,
  subtitle,
  href,
  external = false,
  selected = false,
  disabled = false,
  disabledReason,
  variant = 'default',
  children,
  className = '',
  current = false,
}: WedgeCardProps) {
  const classes = ['k-wedge', VARIANT_CLASS[variant], className].filter(Boolean).join(' ')
  const showSubtitle = disabled ? (disabledReason ?? subtitle) : subtitle

  const inner = (
    <>
      <span className="k-wedge-band">
        <span className="k-nav-title">{title}</span>
      </span>
      {(showSubtitle || children) && (
        <span className="k-wedge-body">
          {showSubtitle && <span className="k-nav-subtitle">{showSubtitle}</span>}
          {children}
        </span>
      )}
    </>
  )

  // No href, or an announced-but-unavailable destination: not a link at all, so
  // there is nothing to click and nothing to tab to that goes nowhere.
  if (!href || disabled) {
    return (
      <span className={classes} data-selected={selected} aria-disabled={disabled || undefined}>
        {inner}
      </span>
    )
  }

  if (external) {
    return (
      <a
        className={classes}
        data-selected={selected}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {inner}
      </a>
    )
  }

  return (
    <Link
      className={classes}
      data-selected={selected}
      href={href}
      aria-current={current ? 'page' : undefined}
      // prefetch={false} is a Daineku lesson, recorded in its handoff as a
      // critical constraint: leaving it on issues an RSC fetch on every hover,
      // which on a page full of cards is a hover-driven request storm.
      prefetch={false}
    >
      {inner}
    </Link>
  )
}

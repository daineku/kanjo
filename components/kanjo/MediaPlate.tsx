import Image from 'next/image'
import type { ReactNode } from 'react'

import type { ImageRef } from '@/lib/content/types'

/**
 * A media surface at a known aspect ratio — filled, or waiting to be.
 *
 * This replaces the first build's empty slot, which drew four 10px corner
 * brackets and nothing else. At the canon's own scale (a ~200px profile
 * portrait) four marks read as a frame; stretched to a 930x523 video plate they
 * sit 930px apart and read as four unrelated ticks in a void. The section
 * looked broken rather than pending, and it conveyed nothing about how large the
 * real footage would be.
 *
 * The rule this component exists to enforce: A PENDING PLATE OCCUPIES EXACTLY
 * THE FOOTPRINT THE REAL MEDIA WILL. `ratio` is required and is the same value
 * whether the plate is empty or full, so dropping in real footage moves nothing.
 *
 * It never fabricates media. An empty plate is a panel fill, an edge, the
 * canon's registration brackets and a label saying what is missing.
 */

export function MediaPlate({
  ratio,
  image,
  priority = false,
  sizes,
  label,
  detail,
  bare = false,
  children,
  className = '',
}: {
  /** CSS aspect-ratio, e.g. '16 / 9'. Required — it is what reserves space. */
  ratio: string
  /** When present the plate is filled and no label is drawn. */
  image?: ImageRef
  priority?: boolean
  sizes?: string
  /** Shown when there is no image and no children. */
  label?: string
  detail?: string
  /** Drops the panel fill and edge — for a plate that only frames real media. */
  bare?: boolean
  /** Arbitrary content laid over the plate (a video facade, for instance). */
  children?: ReactNode
  className?: string
}) {
  const filled = Boolean(image) || Boolean(children)

  return (
    <div
      className={`k-plate ${bare ? 'k-plate--bare' : ''} ${className}`.trim()}
      style={{ aspectRatio: ratio }}
    >
      {image && (
        <Image
          src={image.src}
          alt={image.alt}
          width={image.width}
          height={image.height}
          priority={priority}
          loading={priority ? undefined : 'lazy'}
          sizes={sizes ?? '100vw'}
        />
      )}

      {children}

      {!filled && (
        <>
          {/* Registration brackets, at the canon's 9x9 / 2px geometry. The <i>
              carries the second diagonal pair; it is decorative and empty. */}
          <span className="k-plate-corners" aria-hidden="true">
            <i />
          </span>
          {label && (
            <span className="k-plate-label">
              <span className="k-small" style={{ color: 'var(--k-accent)' }}>
                {label}
              </span>
              {detail && (
                <span className="k-small" style={{ color: 'var(--k-text-tertiary)' }}>
                  {detail}
                </span>
              )}
            </span>
          )}
        </>
      )}
    </div>
  )
}

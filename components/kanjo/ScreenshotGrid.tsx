'use client'

import Image from 'next/image'
import { useCallback, useEffect, useRef, useState } from 'react'

import { real } from '@/lib/content/placeholder'
import type { MediaItem } from '@/lib/content/types'

/**
 * The screenshot grid, and the viewer it opens.
 *
 * WHY A VIEWER EXISTS AT ALL. Measured with six 1920x1080 images in the real
 * grid: each renders at 442x249 CSS pixels at 1440, which is 23% of native. The
 * appeal of a night scene is the road lights, the halation and the fall-off in
 * dark paint, and none of that survives at a quarter size. Opening one to the
 * viewport is a material improvement, not a convention — that is the test the
 * brief set, and this is the measurement that answers it.
 *
 * EVERY DAINEKU MEDIA FAILURE IS DESIGNED AGAINST HERE:
 *
 *  - No hover handler exists anywhere in this file, so pointing at a thumbnail
 *    cannot trigger a request.
 *  - No `imagesLoaded`, no masonry, no carousel dependency, no scroll observer.
 *  - Nothing cycles. There is no timer in this component.
 *  - THE OLD IMAGE STAYS VISIBLE UNTIL THE NEW ONE HAS LOADED. Two indices are
 *    tracked — `shown` (last fully decoded) and `wanted` (what was asked for) —
 *    and the incoming layer is transparent until its own `onLoad` fires. A
 *    single-layer viewer unmounts the old image to mount the new one, which is
 *    the black flash the Daineku handoff records.
 *  - React keys are the item ids, never the array index, so navigating cannot
 *    remount an already-decoded image and re-request it.
 *  - Only the shown and wanted frames are mounted; the other four are not in the
 *    DOM, so opening the viewer does not pull the whole set.
 */

export function ScreenshotGrid({ items }: { items: MediaItem[] }) {
  /** null = closed. Otherwise the index being viewed. */
  const [wanted, setWanted] = useState<number | null>(null)
  /** The last index whose image has finished loading. Stays put while loading. */
  const [shown, setShown] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  /** The thumbnail that opened the viewer, so focus can go back to it. */
  const openerRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)

  const open = useCallback((index: number, opener: HTMLButtonElement) => {
    openerRef.current = opener
    setWanted(index)
    setShown(index)
    setLoading(true)
  }, [])

  const close = useCallback(() => {
    setWanted(null)
    setShown(null)
    setLoading(false)
    // Focus returns to the thumbnail that opened it, which is what a keyboard
    // user expects and what stops the tab position resetting to the top.
    openerRef.current?.focus()
  }, [])

  const step = useCallback(
    (delta: number) => {
      setWanted((current) => {
        if (current === null) return current
        const next = (current + delta + items.length) % items.length
        if (next !== current) setLoading(true)
        return next
      })
    },
    [items.length],
  )

  // Keyboard: Escape closes, arrows navigate. Bound to the document so it works
  // wherever focus sits inside the dialog.
  useEffect(() => {
    if (wanted === null) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        step(1)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        step(-1)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [wanted, close, step])

  /**
   * Body scroll lock.
   *
   * The cleanup restores the value that was there before, rather than assuming
   * it was empty — so an unmount while open, a fast open/close, or another
   * component that also locks cannot leave the page unscrollable.
   */
  useEffect(() => {
    if (wanted === null) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [wanted])

  // Focus moves into the dialog on open, so Escape and the arrows are live and a
  // screen reader announces the dialog rather than the page behind it. Keyed on
  // OPEN, not on `wanted` — otherwise stepping between images yanks focus back
  // to the close button on every step, away from the Next button being used.
  const isOpen = wanted !== null
  useEffect(() => {
    if (isOpen) closeRef.current?.focus()
  }, [isOpen])

  const shownItem = shown === null ? null : items[shown]
  const wantedItem = wanted === null ? null : items[wanted]

  return (
    <>
      <ul className="k-grid k-grid--media">
        {items.map((item, index) => (
          <li key={item.id}>
            <figure style={{ margin: 0 }}>
              <button
                type="button"
                className="k-shot"
                // No onMouseEnter, no onFocus preloading, nothing that turns
                // pointing at a thumbnail into a network request.
                onClick={(event) => open(index, event.currentTarget)}
                aria-label={`View screenshot ${index + 1} of ${items.length}${
                  item.image.alt ? `: ${item.image.alt}` : ''
                }`}
              >
                <span
                  className="k-plate k-plate--bare k-shot-plate"
                  style={{ aspectRatio: `${item.image.width} / ${item.image.height}` }}
                >
                  <Image
                    src={item.image.src}
                    alt={item.image.alt}
                    width={item.image.width}
                    height={item.image.height}
                    // Only the first is eager: it is the one most likely to be
                    // in view when the section is reached.
                    priority={index === 0}
                    loading={index === 0 ? undefined : 'lazy'}
                    sizes="(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw"
                  />
                </span>
              </button>
              {(real(item.title) || real(item.caption)) && (
                <figcaption style={{ marginTop: 'var(--k-space-sm)' }}>
                  {real(item.title) && <p className="k-small">{item.title}</p>}
                  {real(item.caption) && (
                    <p className="k-small" style={{ color: 'var(--k-text-tertiary)' }}>
                      {item.caption}
                    </p>
                  )}
                </figcaption>
              )}
            </figure>
          </li>
        ))}
      </ul>

      {wantedItem && wanted !== null && (
        <div
          className="k-viewer"
          role="dialog"
          aria-modal="true"
          aria-label={`Screenshot ${wanted + 1} of ${items.length}`}
          ref={dialogRef}
          // Clicking the backdrop closes; the frame below stops propagation, so
          // clicking the image itself does not.
          onClick={close}
        >
          <div className="k-viewer-bar">
            <p className="k-small" style={{ color: 'var(--k-text-secondary)' }}>
              {wanted + 1} / {items.length}
            </p>
            <button
              type="button"
              className="k-viewer-btn"
              ref={closeRef}
              onClick={close}
              aria-label="Close screenshot viewer"
            >
              CLOSE [ESC]
            </button>
          </div>

          <div
            className="k-viewer-stage"
            onClick={(event) => event.stopPropagation()}
            // A stable box at the image's own ratio: the frame does not resize
            // between images, so nothing jumps as one replaces another.
            style={{ aspectRatio: `${wantedItem.image.width} / ${wantedItem.image.height}` }}
          >
            {/*
             * Two layers, both keyed by item id.
             *
             * The shown image stays mounted and opaque until the wanted one has
             * loaded, so the viewer never shows an empty frame. When they are the
             * same item only one element is rendered.
             */}
            {shownItem && shown !== wanted && (
              <Image
                key={shownItem.id}
                className="k-viewer-img"
                src={shownItem.image.src}
                alt=""
                width={shownItem.image.width}
                height={shownItem.image.height}
                sizes="100vw"
                priority
              />
            )}
            <Image
              key={wantedItem.id}
              className="k-viewer-img"
              src={wantedItem.image.src}
              alt={wantedItem.image.alt}
              width={wantedItem.image.width}
              height={wantedItem.image.height}
              sizes="100vw"
              priority
              style={{ opacity: loading && shown !== wanted ? 0 : 1 }}
              onLoad={() => {
                setShown(wanted)
                setLoading(false)
              }}
            />
          </div>

          {items.length > 1 && (
            <div className="k-viewer-nav" onClick={(event) => event.stopPropagation()}>
              <button
                type="button"
                className="k-viewer-btn"
                onClick={() => step(-1)}
                aria-label="Previous screenshot"
              >
                &laquo; PREV
              </button>
              <button
                type="button"
                className="k-viewer-btn"
                onClick={() => step(1)}
                aria-label="Next screenshot"
              >
                NEXT &raquo;
              </button>
            </div>
          )}

          {real(wantedItem.caption) && (
            <p
              className="k-small k-viewer-caption"
              onClick={(event) => event.stopPropagation()}
            >
              {wantedItem.caption}
            </p>
          )}
        </div>
      )}
    </>
  )
}

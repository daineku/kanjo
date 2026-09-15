/**
 * Prepares the owner-supplied artwork in IMAGES/ for production.
 *
 *   npm run assets:prepare
 *
 * The files in IMAGES/ are the SOURCES and are never modified. This script
 * writes derived copies under public/media/ (and the two Next app icons), and
 * it is committed so the derivation is reproducible rather than a one-off done
 * by hand in an editor nobody can re-run.
 *
 * ── WHAT IS DONE TO EACH, AND WHY ───────────────────────────────────────────
 *
 * TRIM. Most sources carry large transparent margins (the loader cars sit in
 * the middle 70% of a 1983×793 canvas). Trimming to the opaque bounds means the
 * rendered box IS the artwork, so a CSS width of 200px is a 200px car and the
 * bottom edge of the car image is its wheel line. The loader's lane geometry
 * depends on that.
 *
 * GREEN → RED. SECTIONBADGE and DIVIDER were drawn with green accents. The
 * site's theme is red (see app/globals.css), so green-dominant pixels are
 * remapped by swapping the red and green channels — which turns a green stroke
 * red at the same luminance and leaves black, white and grey untouched. This
 * is a channel swap, not a hue rotation, so anti-aliased edges stay clean.
 *
 * DARK FLIP. MICRO-MARK and DIVIDER are ~95% black on transparent, i.e.
 * designed for a light page. On this site's near-black ground they vanish. Low-
 * saturation pixels have their luminance inverted (black → off-white); the red
 * accents, being saturated, are kept. The logo and brand icon already carry
 * white fills and are used as supplied.
 *
 * ICONS. Next reads app/icon.png and app/apple-icon.png by convention. The
 * brand icon is a wide wordmark, so it is centred on a square, near-black
 * ground rather than stretched.
 *
 * NOT DONE. The hero is copied byte-for-byte. It is the approved 6336×2688
 * source and the brief is explicit that it is cropped with object-position,
 * not regenerated. next/image resizes it per device on request.
 *
 * `sharp` is not a direct dependency of this project — it is Next's own image
 * optimizer, present transitively. That is enough for a maintenance script and
 * not worth a second copy in package.json.
 */

import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import sharp from 'sharp'

const ROOT = process.cwd()
const SRC = path.join(ROOT, 'IMAGES')
const MEDIA = path.join(ROOT, 'public', 'media')

/** Near-black ground, the canon's --k-background. */
const GROUND = { r: 0, g: 0, b: 3, alpha: 1 }

/** Trim transparent margins, leaving a small breathing space. */
async function trimmed(file) {
  return sharp(path.join(SRC, file)).trim({ threshold: 8 }).extend({
    top: 4,
    bottom: 4,
    left: 4,
    right: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
}

/**
 * Pixel-level recolour. `swapGreen` turns green-dominant pixels red;
 * `flipDark` inverts the luminance of low-saturation pixels.
 */
async function recolour(pipeline, { swapGreen = false, flipDark = false } = {}) {
  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    let r = data[i]
    let g = data[i + 1]
    let b = data[i + 2]

    if (swapGreen && g > r + 24 && g > b + 24) {
      ;[r, g] = [g, r]
      // The source greens are dark (the divider's dashes are ~rgb(20,90,40)),
      // and a dark red on a near-black page reads as maroon or as nothing.
      // Scale the swapped pixel so its strongest channel matches the site's
      // accent (#E84A4A → 232), keeping the hue.
      const peak = Math.max(r, g, b)
      if (peak > 0 && peak < 232) {
        const k = 232 / peak
        r = Math.min(255, Math.round(r * k))
        g = Math.min(255, Math.round(g * k))
        b = Math.min(255, Math.round(b * k))
      }
    }

    if (flipDark) {
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const saturation = max === 0 ? 0 : (max - min) / max
      if (saturation < 0.25) {
        r = 255 - r
        g = 255 - g
        b = 255 - b
        // Pull pure white down slightly: the site's text is white, and a
        // decorative rule should sit a step below it, not compete with it.
        r = Math.round(r * 0.9)
        g = Math.round(g * 0.9)
        b = Math.round(b * 0.9)
      }
    }

    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
}

async function write(pipeline, out) {
  await mkdir(path.dirname(out), { recursive: true })
  const info = await pipeline.png({ compressionLevel: 9 }).toFile(out)
  console.log(`${path.relative(ROOT, out).padEnd(40)} ${info.width}x${info.height}`)
  return info
}

const brand = (name) => path.join(MEDIA, 'brand', name)

// ── Logo and marks ───────────────────────────────────────────────────────────
await write(await trimmed('PRIMARY THE KANJO LOGO.png'), brand('logo.png'))
await write(await recolour(await trimmed('MICRO-MARK.png'), { flipDark: true }), brand('micro-mark.png'))
await write(await recolour(await trimmed('SECTIONBADGE.png'), { swapGreen: true }), brand('section-badge.png'))
await write(
  await recolour(await trimmed('DIVIDER.png'), { swapGreen: true, flipDark: true }),
  brand('divider.png'),
)

// ── Loader cars. EG6 is car A (near lane), EK9 is car B (far lane). ──────────
await write(await trimmed('EG6.png'), path.join(MEDIA, 'loader', 'car-a.png'))
await write(await trimmed('EK9.png'), path.join(MEDIA, 'loader', 'car-b.png'))

// ── Open Graph image, as supplied (RGB, 1730×909 ≈ 1.9:1). ──────────────────
await mkdir(path.join(MEDIA, 'og'), { recursive: true })
await copyFile(path.join(SRC, 'OG.png'), path.join(MEDIA, 'og', 'og.png'))
console.log('public/media/og/og.png'.padEnd(40), 'copied')

// ── Hero, byte for byte. ─────────────────────────────────────────────────────
await mkdir(path.join(MEDIA, 'hero'), { recursive: true })
await copyFile(path.join(SRC, 'hero.png'), path.join(MEDIA, 'hero', 'hero.png'))
console.log('public/media/hero/hero.png'.padEnd(40), 'copied (source, unaltered)')

// ── App icons: the brand icon centred on a square near-black ground. ─────────
async function icon(size, out) {
  const mark = await sharp(path.join(SRC, 'BRAND ICON.png'))
    .trim({ threshold: 8 })
    .resize({ width: Math.round(size * 0.82), height: Math.round(size * 0.82), fit: 'inside' })
    .png()
    .toBuffer()
  const info = await sharp({ create: { width: size, height: size, channels: 4, background: GROUND } })
    .composite([{ input: mark, gravity: 'centre' }])
    .png()
    .toFile(out)
  console.log(`${path.relative(ROOT, out).padEnd(40)} ${info.width}x${info.height}`)
}
await icon(512, path.join(ROOT, 'app', 'icon.png'))
await icon(180, path.join(ROOT, 'app', 'apple-icon.png'))

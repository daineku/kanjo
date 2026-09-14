/**
 * Intrinsic pixel dimensions, read from an image's own header.
 *
 * WHY THIS IS HAND-WRITTEN RATHER THAN A DEPENDENCY. Every `ImageRef` in this
 * codebase carries `width` and `height`, and the reason is stated in
 * lib/content/types.ts: they are what prevents layout shift. An admin upload
 * that cannot determine them would either have to ask the editor to type them
 * in — which they will get wrong — or store a guess. The alternative is a
 * dependency whose entire job is to read the first few dozen bytes of five file
 * formats, on the one path in this project that accepts an uploaded file.
 *
 * It parses headers ONLY. It never decodes an image, so a malformed or hostile
 * file costs a few bounds-checked reads and a null, not a decoder.
 *
 * Returns null for anything it does not recognise, and the caller REJECTS the
 * upload in that case rather than storing a file the site cannot lay out.
 */

export type Dimensions = { width: number; height: number }

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length))
}

/** PNG: an 8-byte signature, then an IHDR whose first two big-endian u32s are it. */
function png(bytes: Uint8Array): Dimensions | null {
  if (bytes.length < 24) return null
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (signature.some((byte, index) => bytes[index] !== byte)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/** GIF: 'GIF87a'/'GIF89a', then two little-endian u16s. */
function gif(bytes: Uint8Array): Dimensions | null {
  if (bytes.length < 10) return null
  const header = ascii(bytes, 0, 6)
  if (header !== 'GIF87a' && header !== 'GIF89a') return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
}

/**
 * JPEG: walk the marker segments to the SOFn that carries the frame size.
 *
 * SOF0/1/2/3, 5-7 and 9-15 all carry it in the same place; the exclusions are
 * DHT (C4), JPG (C8) and DAC (CC), which are not frame headers and would
 * otherwise be read as ones.
 */
function jpeg(bytes: Uint8Array): Dimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]
    if (marker === undefined) return null
    // Padding and standalone markers carry no length field.
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2
      continue
    }
    const isFrameHeader =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isFrameHeader) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) }
    }
    const length = view.getUint16(offset + 2)
    if (length < 2) return null
    offset += 2 + length
  }
  return null
}

/** WebP: a RIFF container with one of three chunk layouts. */
function webp(bytes: Uint8Array): Dimensions | null {
  if (bytes.length < 30) return null
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const chunk = ascii(bytes, 12, 4)

  if (chunk === 'VP8 ') {
    // Lossy: a 3-byte start code, then 14-bit width and height.
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    }
  }
  if (chunk === 'VP8L') {
    // Lossless: 14 bits each, packed across four bytes, both minus one.
    const bits = view.getUint32(21, true)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  if (chunk === 'VP8X') {
    // Extended: 24-bit canvas size, minus one.
    const w = bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)
    const h = bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)
    return { width: w + 1, height: h + 1 }
  }
  return null
}

/**
 * SVG: the viewBox, or explicit pixel width/height.
 *
 * The viewBox is preferred because an SVG's `width` is frequently a percentage
 * or absent, whereas the viewBox always describes the drawing's own coordinate
 * space — which is the ratio `next/image` and the CSS box actually need.
 */
function svg(bytes: Uint8Array): Dimensions | null {
  const head = ascii(bytes, 0, Math.min(bytes.length, 2048))
  if (!head.includes('<svg')) return null

  const viewBox = /viewBox\s*=\s*["']\s*[-\d.]+[,\s]+[-\d.]+[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(head)
  if (viewBox?.[1] && viewBox[2]) {
    const width = Math.round(Number(viewBox[1]))
    const height = Math.round(Number(viewBox[2]))
    if (width > 0 && height > 0) return { width, height }
  }

  const width = /\bwidth\s*=\s*["']\s*([\d.]+)(?:px)?\s*["']/i.exec(head)
  const height = /\bheight\s*=\s*["']\s*([\d.]+)(?:px)?\s*["']/i.exec(head)
  if (width?.[1] && height?.[1]) {
    const w = Math.round(Number(width[1]))
    const h = Math.round(Number(height[1]))
    if (w > 0 && h > 0) return { width: w, height: h }
  }
  return null
}

const PARSERS = [png, gif, jpeg, webp, svg]

export function readImageSize(bytes: Uint8Array): Dimensions | null {
  for (const parse of PARSERS) {
    const size = parse(bytes)
    if (size && size.width > 0 && size.height > 0) return size
  }
  return null
}

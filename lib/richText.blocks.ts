/**
 * The pure half of the Markdown-subset renderer: link safety and block parsing.
 *
 * Split out of richText.tsx so it contains no JSX and can therefore be executed
 * directly by `node --experimental-strip-types` in richText.test.ts. Type
 * stripping cannot compile JSX, so a parser that lives beside its React output
 * is a parser with no fast test.
 *
 * The grammar itself is documented in richText.tsx.
 */

/**
 * Only http(s), mailto and root-relative hrefs are emitted as links.
 *
 * `javascript:` is the obvious one, but `data:` is the one that gets forgotten,
 * and a scheme-relative `//host` in content authored for one site is almost
 * always a mistake. Anything rejected renders as its own link text, so the
 * content is never silently lost — it just is not clickable.
 */
export function isSafeHref(href: string): boolean {
  const value = href.trim()
  if (value === '') return false
  if (value.startsWith('//')) return false
  if (value.startsWith('/') || value.startsWith('#')) return true
  return /^(https?:|mailto:)/i.test(value)
}

export const INLINE_PATTERN =
  /(\*\*(?<bold>[^*]+)\*\*|\*(?<italic>[^*]+)\*|`(?<code>[^`]+)`|\[(?<text>[^\]]+)\]\((?<href>[^)\s]+)\))/g

// ── Blocks ───────────────────────────────────────────────────────────────────

export type Block =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'code'; lines: string[] }
  | { kind: 'image'; alt: string; src: string }
  | { kind: 'rule' }

const IMAGE_LINE = /^!\[(?<alt>[^\]]*)\]\((?<src>[^)\s]+)\)$/
const HEADING_LINE = /^(?<hashes>#{2,3})\s+(?<text>.+)$/
const UNORDERED_LINE = /^[-*]\s+(?<text>.+)$/
const ORDERED_LINE = /^\d+[.)]\s+(?<text>.+)$/

/** Splits source text into blocks. Exported so it can be tested directly. */
export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let index = 0

  while (index < lines.length) {
    // Progress guard. Every branch below is meant to consume at least one line;
    // one that does not would hang the build rather than mis-render a page,
    // which is a much worse failure. This makes that class of mistake produce a
    // dropped line instead of a hung process.
    const cursorAtStart = index

    const raw = lines[index] ?? ''
    const line = raw.trim()

    if (line === '') {
      index += 1
      continue
    }

    // Fenced code. Everything inside is literal, including markers.
    if (line.startsWith('```')) {
      const body: string[] = []
      index += 1
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        body.push(lines[index] ?? '')
        index += 1
      }
      index += 1 // the closing fence, or the end of input
      blocks.push({ kind: 'code', lines: body })
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      blocks.push({ kind: 'rule' })
      index += 1
      continue
    }

    const image = IMAGE_LINE.exec(line)
    if (image?.groups) {
      const src = image.groups.src ?? ''
      if (isSafeHref(src)) {
        blocks.push({ kind: 'image', alt: image.groups.alt ?? '', src })
      } else {
        // An image whose src is refused degrades to the literal line. It has to
        // be consumed HERE rather than falling through to the paragraph branch:
        // that branch's own guard breaks on any line matching IMAGE_LINE, so
        // falling through produced an empty paragraph, no progress, and an
        // infinite loop. Found by richText.test.ts, not by reading the code.
        blocks.push({ kind: 'paragraph', lines: [line] })
      }
      index += 1
      continue
    }

    const heading = HEADING_LINE.exec(line)
    if (heading?.groups) {
      blocks.push({
        kind: 'heading',
        level: (heading.groups.hashes ?? '##').length === 2 ? 2 : 3,
        text: heading.groups.text ?? '',
      })
      index += 1
      continue
    }

    if (line.startsWith('>')) {
      const body: string[] = []
      while (index < lines.length && (lines[index] ?? '').trim().startsWith('>')) {
        body.push(
          (lines[index] ?? '')
            .trim()
            .replace(/^>\s?/, ''),
        )
        index += 1
      }
      blocks.push({ kind: 'quote', lines: body })
      continue
    }

    const unordered = UNORDERED_LINE.exec(line)
    const ordered = ORDERED_LINE.exec(line)
    if (unordered?.groups || ordered?.groups) {
      const isOrdered = Boolean(ordered?.groups) && !unordered?.groups
      const items: string[] = []
      while (index < lines.length) {
        const current = (lines[index] ?? '').trim()
        const nextUnordered = UNORDERED_LINE.exec(current)
        const nextOrdered = ORDERED_LINE.exec(current)
        const matchesKind = isOrdered ? nextOrdered?.groups : nextUnordered?.groups
        if (!matchesKind) break
        items.push(matchesKind.text ?? '')
        index += 1
      }
      blocks.push({ kind: 'list', ordered: isOrdered, items })
      continue
    }

    // A paragraph runs to the next blank line. A single newline inside it is a
    // <br>, matching Daineku's parser so existing authoring habits transfer.
    const paragraph: string[] = []
    while (index < lines.length) {
      const current = (lines[index] ?? '').trim()
      if (
        current === '' ||
        current.startsWith('```') ||
        current.startsWith('>') ||
        HEADING_LINE.test(current) ||
        UNORDERED_LINE.test(current) ||
        ORDERED_LINE.test(current) ||
        IMAGE_LINE.test(current) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(current)
      ) {
        break
      }
      paragraph.push(current)
      index += 1
    }
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', lines: paragraph })

    if (index === cursorAtStart) index += 1
  }

  return blocks
}

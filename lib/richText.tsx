import React from 'react'

import { INLINE_PATTERN, isSafeHref, parseBlocks } from './richText.blocks'

/**
 * A small Markdown subset, rendered to React elements.
 *
 * WHY NOT A MARKDOWN LIBRARY. The Daineku site's `lib/renderDescription.tsx`
 * established the rule this file follows: no `dangerouslySetInnerHTML`, no
 * markdown dependency, output is React elements only. That rule is worth
 * keeping — it removes HTML injection from the threat model entirely rather
 * than sanitising after the fact, and the content is authored by the site's own
 * owner, so the grammar only has to cover what the authoring guide documents.
 *
 * WHAT THIS ADDS OVER DAINEKU'S. Daineku supports bold, italic and paragraphs,
 * which is right for a photo caption and not enough for a development update.
 * This adds headings, lists, blockquotes, links, inline code, fenced code, rules
 * and images — and stops there.
 *
 * SUPPORTED
 *   ## Heading            → <h2>          (h2/h3 only; h1 is the page title)
 *   - item / 1. item      → <ul> / <ol>
 *   > quote               → <blockquote>
 *   ```                   → <pre><code>   (fenced, no language highlighting)
 *   ---                   → <hr>
 *   ![alt](src)           → <img>         (alone on a line)
 *   blank line            → paragraph break
 *   single newline        → <br> within the paragraph
 *   **bold** *italic*     → <strong> <em>
 *   `code`                → <code>
 *   [text](href)          → <a>           (see isSafeHref)
 *
 * NOT SUPPORTED, and rendered as literal text on purpose: raw HTML, tables,
 * footnotes, nested lists, reference links, h1, h4+.
 *
 * The parser itself is in ./richText.blocks.ts, which carries no JSX so it can
 * be run directly under `node --experimental-strip-types` by its test.
 */

/** Parses inline markers within one line. */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let last = 0

  // A fresh RegExp per call: a shared module-level /g regex carries lastIndex
  // between calls, which drops formatting under concurrent renders.
  const pattern = new RegExp(INLINE_PATTERN.source, 'g')
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index))

    const groups = match.groups ?? {}
    const key = `${keyPrefix}-${match.index}`

    if (groups.bold !== undefined) {
      nodes.push(<strong key={key}>{groups.bold}</strong>)
    } else if (groups.italic !== undefined) {
      nodes.push(<em key={key}>{groups.italic}</em>)
    } else if (groups.code !== undefined) {
      nodes.push(<code key={key}>{groups.code}</code>)
    } else if (groups.text !== undefined && groups.href !== undefined) {
      const href = groups.href
      if (!isSafeHref(href)) {
        // Unsafe hrefs keep their text and lose the link, so content is never
        // silently dropped.
        nodes.push(groups.text)
      } else if (/^https?:/i.test(href)) {
        nodes.push(
          <a key={key} href={href} target="_blank" rel="noopener noreferrer">
            {groups.text}
          </a>,
        )
      } else {
        nodes.push(
          <a key={key} href={href}>
            {groups.text}
          </a>,
        )
      }
    }

    last = match.index + match[0].length
  }

  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

/**
 * Renders a Markdown-subset string.
 *
 * Returns null for empty input so a caller can drop the whole wrapper — the
 * "every block returns null when it has nothing" rule the Daineku handoff
 * states for content blocks.
 */
export function renderRichText(source: string | null | undefined): React.ReactNode | null {
  if (!source?.trim()) return null

  const blocks = parseBlocks(source)
  if (blocks.length === 0) return null

  return (
    <>
      {blocks.map((block, i) => {
        const key = `b${i}`
        switch (block.kind) {
          case 'heading':
            return block.level === 2 ? (
              <h2 key={key} className="k-section-title k-rt-h2">
                {renderInline(block.text, key)}
              </h2>
            ) : (
              <h3 key={key} className="k-item-title k-rt-h3">
                {renderInline(block.text, key)}
              </h3>
            )

          case 'list': {
            const items = block.items.map((item, j) => (
              <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
            ))
            return block.ordered ? (
              <ol key={key} className="k-rt-list">
                {items}
              </ol>
            ) : (
              <ul key={key} className="k-rt-list">
                {items}
              </ul>
            )
          }

          case 'quote':
            return (
              <blockquote key={key} className="k-rt-quote">
                {block.lines.map((line, j) => (
                  <p key={`${key}-${j}`}>{renderInline(line, `${key}-${j}`)}</p>
                ))}
              </blockquote>
            )

          case 'code':
            return (
              <pre key={key} className="k-rt-code">
                <code>{block.lines.join('\n')}</code>
              </pre>
            )

          case 'image':
            // A plain <img> with lazy loading and no fixed-ratio container.
            // next/image is not used inside an article body because the body has
            // no reliable intrinsic dimensions to declare, and a container whose
            // aspect-ratio does not match the real image produces exactly the
            // black bars the Daineku handoff records as a failed approach.
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={key}
                src={block.src}
                alt={block.alt}
                loading="lazy"
                decoding="async"
                className="k-rt-image"
              />
            )

          case 'rule':
            return <hr key={key} className="k-rule k-rt-rule" />

          case 'paragraph':
            return (
              <p key={key}>
                {block.lines.flatMap((line, j) => [
                  ...renderInline(line, `${key}-${j}`),
                  j < block.lines.length - 1 ? <br key={`${key}-br-${j}`} /> : null,
                ])}
              </p>
            )
        }
      })}
    </>
  )
}

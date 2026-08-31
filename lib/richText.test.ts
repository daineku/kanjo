/**
 * Regression tests for the Markdown-subset parser.
 *
 * Run with `npm run test:markdown`. Node's own test runner and assert module,
 * executed straight from TypeScript by type stripping — no test framework, in
 * the spirit of Daineku's `lib/renderDescription.test.ts`, which is a plain
 * node script for the same reason.
 *
 * The cases that matter most are the NEGATIVE ones: the things this grammar
 * must refuse to turn into markup.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { isSafeHref, parseBlocks, type Block } from './richText.blocks.ts'

function kinds(source: string): Block['kind'][] {
  return parseBlocks(source).map((block) => block.kind)
}

// ── Link safety ──────────────────────────────────────────────────────────────

test('isSafeHref accepts http, https, mailto, root-relative and fragments', () => {
  assert.equal(isSafeHref('https://example.com/x'), true)
  assert.equal(isSafeHref('http://example.com'), true)
  assert.equal(isSafeHref('mailto:hello@example.com'), true)
  assert.equal(isSafeHref('/updates/first-post'), true)
  assert.equal(isSafeHref('#section'), true)
})

test('isSafeHref rejects script, data and scheme-relative URLs', () => {
  assert.equal(isSafeHref('javascript:alert(1)'), false)
  assert.equal(isSafeHref('JavaScript:alert(1)'), false)
  assert.equal(isSafeHref('data:text/html;base64,PHNjcmlwdD4='), false)
  assert.equal(isSafeHref('vbscript:msgbox'), false)
  assert.equal(isSafeHref('//evil.example.com'), false)
  assert.equal(isSafeHref('   '), false)
  assert.equal(isSafeHref(''), false)
})

// ── Blocks ───────────────────────────────────────────────────────────────────

test('a blank line separates paragraphs', () => {
  assert.deepEqual(kinds('one\n\ntwo'), ['paragraph', 'paragraph'])
})

test('a single newline stays inside one paragraph', () => {
  const blocks = parseBlocks('one\ntwo')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0]?.kind, 'paragraph')
  assert.deepEqual(blocks[0]?.kind === 'paragraph' ? blocks[0].lines : null, ['one', 'two'])
})

test('h2 and h3 are recognised and h1 and h4 are not', () => {
  assert.deepEqual(kinds('## Two'), ['heading'])
  assert.deepEqual(kinds('### Three'), ['heading'])
  // h1 is the page title and h4+ has no style, so both stay literal text.
  assert.deepEqual(kinds('# One'), ['paragraph'])
  assert.deepEqual(kinds('#### Four'), ['paragraph'])
})

test('heading level is read from the hash count', () => {
  const two = parseBlocks('## Two')[0]
  const three = parseBlocks('### Three')[0]
  assert.equal(two?.kind === 'heading' ? two.level : null, 2)
  assert.equal(three?.kind === 'heading' ? three.level : null, 3)
})

test('consecutive dashes become one unordered list', () => {
  const block = parseBlocks('- a\n- b\n- c')[0]
  assert.equal(block?.kind, 'list')
  assert.equal(block?.kind === 'list' ? block.ordered : null, false)
  assert.deepEqual(block?.kind === 'list' ? block.items : null, ['a', 'b', 'c'])
})

test('numbered lines become an ordered list', () => {
  const block = parseBlocks('1. a\n2. b')[0]
  assert.equal(block?.kind === 'list' ? block.ordered : null, true)
  assert.deepEqual(block?.kind === 'list' ? block.items : null, ['a', 'b'])
})

test('an ordered and an unordered run do not merge into one list', () => {
  assert.deepEqual(kinds('- a\n1. b'), ['list', 'list'])
})

test('a quote run collapses into one blockquote with its markers stripped', () => {
  const block = parseBlocks('> first\n> second')[0]
  assert.equal(block?.kind, 'quote')
  assert.deepEqual(block?.kind === 'quote' ? block.lines : null, ['first', 'second'])
})

test('a fenced block keeps its content literal', () => {
  const block = parseBlocks('```\n## not a heading\n- not a list\n```')[0]
  assert.equal(block?.kind, 'code')
  assert.deepEqual(block?.kind === 'code' ? block.lines : null, [
    '## not a heading',
    '- not a list',
  ])
})

test('an unterminated fence consumes the rest of the input rather than throwing', () => {
  const blocks = parseBlocks('```\nstill code')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0]?.kind, 'code')
})

test('three or more dashes, asterisks or underscores are a rule', () => {
  assert.deepEqual(kinds('---'), ['rule'])
  assert.deepEqual(kinds('***'), ['rule'])
  assert.deepEqual(kinds('___'), ['rule'])
})

test('an image alone on a line is a block, and an unsafe one is not', () => {
  const good = parseBlocks('![a car](/media/car.jpg)')[0]
  assert.equal(good?.kind, 'image')
  assert.equal(good?.kind === 'image' ? good.src : null, '/media/car.jpg')
  assert.equal(good?.kind === 'image' ? good.alt : null, 'a car')

  // Refused as an image, so it degrades to text instead of emitting a data: src.
  assert.deepEqual(kinds('![x](data:image/svg+xml,<svg/>)'), ['paragraph'])
})

test('an empty alt is preserved rather than invented', () => {
  const block = parseBlocks('![](/media/x.jpg)')[0]
  assert.equal(block?.kind === 'image' ? block.alt : null, '')
})

test('raw HTML is never a block and stays as text', () => {
  assert.deepEqual(kinds('<script>alert(1)</script>'), ['paragraph'])
  assert.deepEqual(kinds('<img src=x onerror=alert(1)>'), ['paragraph'])
})

test('a table is not supported and degrades to paragraphs', () => {
  assert.deepEqual(kinds('| a | b |\n| - | - |'), ['paragraph'])
})

test('empty and whitespace-only input produce no blocks', () => {
  assert.deepEqual(parseBlocks(''), [])
  assert.deepEqual(parseBlocks('\n\n   \n'), [])
})

test('CRLF input parses the same as LF', () => {
  assert.deepEqual(kinds('## H\r\n\r\nbody\r\n'), kinds('## H\n\nbody\n'))
})

test('a mixed document keeps every block in source order', () => {
  const source = [
    '## Heading',
    '',
    'A paragraph.',
    '',
    '- one',
    '- two',
    '',
    '> a quote',
    '',
    '```',
    'code',
    '```',
    '',
    '---',
    '',
    '![shot](/media/shot.jpg)',
  ].join('\n')

  assert.deepEqual(kinds(source), [
    'heading',
    'paragraph',
    'list',
    'quote',
    'code',
    'rule',
    'image',
  ])
})

test('a heading immediately after a paragraph line ends the paragraph', () => {
  assert.deepEqual(kinds('text\n## Heading'), ['paragraph', 'heading'])
})

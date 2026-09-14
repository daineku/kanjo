/**
 * Regression tests for the Patreon public/locked gate.
 *
 * Run with `npm run test:patreon`. These are the most important tests in the
 * project, because the failure they guard against is not a broken layout — it
 * is publishing paid members-only writing on a public web page, using a token
 * that was given creator-level access precisely so it could read it.
 *
 * So the NEGATIVE cases lead, and they are deliberately paranoid about shapes
 * the API is not supposed to return: a missing `is_public`, a null one, the
 * string "true", `is_public` absent while `is_paid` is false. Every one of them
 * must land on "locked".
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { htmlToText, toFeed, toPublishablePost, truncate } from './posts.ts'

const VALID = {
  id: '123',
  type: 'post',
  attributes: {
    title: 'Suspension pass',
    url: 'https://www.patreon.com/posts/suspension-123',
    published_at: '2026-08-01T10:00:00.000+00:00',
  },
}

function post(attributes: Record<string, unknown>) {
  return { ...VALID, attributes: { ...VALID.attributes, ...attributes } }
}

// ── The gate ─────────────────────────────────────────────────────────────────

test('a public post may carry an excerpt derived from its content', () => {
  const result = toPublishablePost(
    post({ is_public: true, is_paid: false, content: '<p>Rear camber is done.</p>' }),
  )
  assert.equal(result?.isPublic, true)
  assert.equal(result?.excerpt, 'Rear camber is done.')
})

test('a LOCKED post never carries its content, however it is marked', () => {
  // The exact shape that matters: a creator token CAN read this body.
  const locked = toPublishablePost(
    post({ is_public: false, is_paid: true, content: '<p>PAID MEMBERS ONLY BODY</p>' }),
  )
  assert.equal(locked?.isPublic, false)
  assert.equal(locked?.excerpt, '')
})

test('a missing, null or non-boolean is_public fails CLOSED', () => {
  for (const value of [undefined, null, 'true', 1, {}, []]) {
    const result = toPublishablePost(
      post({ is_public: value, content: '<p>MEMBERS ONLY BODY</p>' }),
    )
    assert.equal(result?.isPublic, false, `is_public=${JSON.stringify(value)} must not be public`)
    assert.equal(result?.excerpt, '', `is_public=${JSON.stringify(value)} must not leak content`)
  }
})

test('is_paid: false does not make a post public', () => {
  // A draft, or a post whose visibility simply was not returned. Neither is a
  // licence to print the body.
  const result = toPublishablePost(post({ is_paid: false, content: '<p>UNPUBLISHED</p>' }))
  assert.equal(result?.excerpt, '')
})

test('teaser_text IS usable on a locked post — it is Patreon own public teaser', () => {
  const result = toPublishablePost(
    post({
      is_public: false,
      is_paid: true,
      teaser_text: 'A look at the new suspension model.',
      content: '<p>MEMBERS ONLY BODY</p>',
    }),
  )
  assert.equal(result?.isPublic, false)
  assert.equal(result?.excerpt, 'A look at the new suspension model.')
  assert.ok(!result?.excerpt.includes('MEMBERS'))
})

// ── URL safety ───────────────────────────────────────────────────────────────

test('only https patreon.com URLs are accepted', () => {
  assert.ok(toPublishablePost(post({ url: 'https://patreon.com/posts/x-1' })))
  assert.ok(toPublishablePost(post({ url: 'https://www.patreon.com/posts/x-1' })))
  for (const url of [
    'javascript:alert(1)',
    'http://www.patreon.com/posts/x-1',
    'https://patreon.com.evil.example/posts/x',
    'https://evil.example/posts/x',
    '',
    null,
  ]) {
    assert.equal(
      toPublishablePost(post({ url })),
      null,
      `${JSON.stringify(url)} must be rejected`,
    )
  }
})

// ── Dropping unrenderable rows ───────────────────────────────────────────────

test('a post with no title, no date or an unparseable date is dropped', () => {
  assert.equal(toPublishablePost(post({ title: '' })), null)
  assert.equal(toPublishablePost(post({ published_at: '' })), null)
  assert.equal(toPublishablePost(post({ published_at: 'soon' })), null)
  assert.equal(toPublishablePost({ ...VALID, id: '' }), null)
})

// ── HTML reduction ───────────────────────────────────────────────────────────

test('htmlToText removes markup rather than trusting it', () => {
  assert.equal(htmlToText('<p>one</p><p>two</p>'), 'one two')
  assert.equal(htmlToText('a<br>b'), 'a b')
  assert.equal(htmlToText('<a href="x" onclick="steal()">link</a>'), 'link')
  assert.equal(htmlToText('&amp; &lt; &gt; &quot; &#39; &nbsp;x'), '& < > " \' x')
})

test('htmlToText drops script and style BODIES, not just their tags', () => {
  assert.equal(htmlToText('<script>alert(1)</script>ok'), 'ok')
  assert.equal(htmlToText('<style>.a{color:red}</style>ok'), 'ok')
  assert.ok(!htmlToText('<script>alert(1)</script>').includes('alert'))
})

test('truncate cuts on a word boundary and marks the cut', () => {
  assert.equal(truncate('short', 20), 'short')
  const long = truncate('a'.repeat(30) + ' tail', 20)
  assert.ok(long.endsWith('…'))
  assert.ok(long.length <= 21)
  assert.equal(truncate('one two three four five', 12), 'one two…')
})

// ── Feed assembly ────────────────────────────────────────────────────────────

test('toFeed sorts newest first and applies the limit', () => {
  const feed = toFeed(
    [
      post({ published_at: '2026-01-01T00:00:00.000+00:00', title: 'old' }),
      post({ published_at: '2026-09-01T00:00:00.000+00:00', title: 'new' }),
      post({ published_at: '2026-05-01T00:00:00.000+00:00', title: 'mid' }),
      { attributes: {} },
    ],
    2,
  )
  assert.deepEqual(
    feed.map((entry) => entry.title),
    ['new', 'mid'],
  )
})

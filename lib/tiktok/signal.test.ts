/**
 * Regression tests for the TikTok render-signal reader.
 *
 * Run with `npm run test:tiktok`. The reader decides whether the official
 * embed is REVEALED instead of the profile link, so the negative cases lead:
 * anything that is not a height message from TikTok's own origin must be
 * refused, because revealing on a false positive is how a visitor ends up
 * looking at "overload-protect triggered".
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { readTikTokRenderSignal, TIKTOK_EMBED_ORIGIN } from './signal.ts'

const ORIGIN = TIKTOK_EMBED_ORIGIN

test('accepts the height message TikTok\'s own library sizes the iframe from', () => {
  assert.deepEqual(
    readTikTokRenderSignal(ORIGIN, JSON.stringify({ signalSource: '__tt_embed__v8857', height: 742 })),
    { id: 'v8857', height: 742 },
  )
  // A numeric string is what some transports deliver; it is still a height.
  assert.deepEqual(
    readTikTokRenderSignal(ORIGIN, JSON.stringify({ signalSource: '__tt_embed__v1', height: '600' })),
    { id: 'v1', height: 600 },
  )
  // Structured-clone objects are accepted as well as JSON strings.
  assert.deepEqual(
    readTikTokRenderSignal(ORIGIN, { signalSource: '__tt_embed__abc_1', height: 300 }),
    { id: 'abc_1', height: 300 },
  )
})

test('refuses any origin other than tiktok.com, including lookalikes', () => {
  const data = JSON.stringify({ signalSource: '__tt_embed__v1', height: 500 })
  for (const origin of [
    'https://tiktok.com',
    'https://www.tiktok.com.evil.example',
    'https://evil.example',
    'http://www.tiktok.com',
    'null',
    '',
  ]) {
    assert.equal(readTikTokRenderSignal(origin, data), null, `should refuse ${origin}`)
  }
})

test('refuses messages that are not a render signal', () => {
  for (const data of [
    'not json',
    '',
    null,
    undefined,
    42,
    JSON.stringify({ height: 500 }),
    JSON.stringify({ signalSource: 'something-else', height: 500 }),
    // The same channel carries link clicks; those must not count as rendered.
    JSON.stringify({ signalSource: '__tt_embed__v1', link: 'https://www.tiktok.com/@the_kanjo' }),
    JSON.stringify({ signalSource: '__tt_embed__v1', height: 0 }),
    JSON.stringify({ signalSource: '__tt_embed__v1', height: -10 }),
    JSON.stringify({ signalSource: '__tt_embed__v1', height: 'tall' }),
    JSON.stringify({ signalSource: '__tt_embed__', height: 500 }),
  ]) {
    assert.equal(readTikTokRenderSignal(ORIGIN, data), null, `should refuse ${String(data)}`)
  }
})

test('the id is a plain token, never something that could reach a selector', () => {
  for (const id of ['v1 > iframe', 'v1"', 'v1;', '../x', 'v1<script>']) {
    assert.equal(
      readTikTokRenderSignal(ORIGIN, JSON.stringify({ signalSource: `__tt_embed__${id}`, height: 10 })),
      null,
      `should refuse ${id}`,
    )
  }
})

/**
 * Regression tests for TikTok profile validation.
 *
 * Run with `npm run test:tiktok`. This function is a security boundary, not a
 * convenience: its output is interpolated into the official embed's
 * `data-unique-id` and `cite` attributes, and its input is admin-editable
 * content. So the negative cases lead.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { tikTokHandle, tikTokProfileUrl } from './profile.ts'

test('accepts the forms that actually end up on a clipboard', () => {
  for (const input of [
    '@the_kanjo',
    'the_kanjo',
    'https://www.tiktok.com/@the_kanjo',
    'https://tiktok.com/@the_kanjo',
    'https://m.tiktok.com/@the_kanjo',
    'https://www.tiktok.com/@the_kanjo?lang=en',
    'https://www.tiktok.com/@the_kanjo/video/1234567890',
    '  https://www.tiktok.com/@the_kanjo  ',
  ]) {
    assert.equal(tikTokHandle(input), 'the_kanjo', `failed for ${JSON.stringify(input)}`)
  }
})

test('the returned handle never carries the @, and the URL is rebuilt from it', () => {
  assert.equal(tikTokHandle('@the_kanjo'), 'the_kanjo')
  assert.equal(tikTokProfileUrl('the_kanjo'), 'https://www.tiktok.com/@the_kanjo')
})

test('rejects anything that could reach the embed as markup or script', () => {
  for (const input of [
    '',
    '   ',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '"><script>alert(1)</script>',
    '@a"onload="alert(1)',
    '@the kanjo',
    '@the-kanjo', // TikTok handles have no hyphen
    '@the/kanjo',
    'a', // under the 2-character minimum
    `@${'a'.repeat(25)}`, // over the 24-character maximum
  ]) {
    assert.equal(tikTokHandle(input), null, `should reject ${JSON.stringify(input)}`)
  }
})

test('rejects other hosts and other schemes', () => {
  for (const input of [
    'https://www.instagram.com/@the_kanjo',
    'https://tiktok.com.evil.example/@the_kanjo',
    'ftp://www.tiktok.com/@the_kanjo',
    'https://www.tiktok.com/tag/kanjo',
    'https://www.tiktok.com/',
  ]) {
    assert.equal(tikTokHandle(input), null, `should reject ${JSON.stringify(input)}`)
  }
})

test('a vm.tiktok.com short link is refused rather than resolved', () => {
  // It is a redirect to an unknown destination. Following it would mean a
  // network request whose answer we would then have to trust.
  assert.equal(tikTokHandle('https://vm.tiktok.com/ZMabcdefg/'), null)
})

test('accepts the punctuation TikTok actually allows', () => {
  assert.equal(tikTokHandle('@the.kanjo_01'), 'the.kanjo_01')
})

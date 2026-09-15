/**
 * Regression tests for the media origin → `next/image` remote pattern.
 *
 * Run with `npm run test:media-origin`. Imports the real function that
 * `next.config.ts` calls.
 *
 * WHAT THIS GUARDS. Two opposite failures, both bad:
 *
 *   - A pattern too NARROW, or absent, means `next/image` refuses the media
 *     host and every uploaded image 400s. The first version of this project
 *     handled that by telling the deployment operator to edit `next.config.ts`
 *     after creating the bucket — a source change in the middle of an otherwise
 *     browser-only setup.
 *   - A pattern too BROAD turns this site's image optimizer into an open proxy
 *     for any host on the internet, which is somebody else's bandwidth on our
 *     bill. That is why there is no `https://**` anywhere.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { mediaRemotePattern } from './remotePattern.ts'

test('an absent or empty value produces no pattern', () => {
  // Local development, and any deployment that has not turned R2 on. A build
  // must not require variables it does not use.
  for (const value of [undefined, null, '', '   ']) {
    assert.equal(mediaRemotePattern(value), null, `${JSON.stringify(value)} should be ignored`)
  }
})

test('a custom domain becomes a pattern pinned to that exact host', () => {
  assert.deepEqual(mediaRemotePattern('https://media.thekanjo.com'), {
    protocol: 'https',
    hostname: 'media.thekanjo.com',
  })
})

test('an r2.dev development subdomain works too', () => {
  assert.deepEqual(mediaRemotePattern('https://pub-abc123.r2.dev'), {
    protocol: 'https',
    hostname: 'pub-abc123.r2.dev',
  })
})

test('a trailing slash is tolerated — it is the commonest typo', () => {
  assert.deepEqual(mediaRemotePattern('https://media.thekanjo.com/'), {
    protocol: 'https',
    hostname: 'media.thekanjo.com',
  })
  assert.deepEqual(mediaRemotePattern('  https://media.thekanjo.com  '), {
    protocol: 'https',
    hostname: 'media.thekanjo.com',
  })
})

test('a path prefix is PINNED, so the rest of the domain is not proxyable', () => {
  assert.deepEqual(mediaRemotePattern('https://cdn.example.com/kanjo'), {
    protocol: 'https',
    hostname: 'cdn.example.com',
    pathname: '/kanjo/**',
  })
})

test('a non-default port is carried through', () => {
  assert.deepEqual(mediaRemotePattern('https://media.example.com:8443'), {
    protocol: 'https',
    hostname: 'media.example.com',
    port: '8443',
  })
})

test('the result is NEVER a broad wildcard host', () => {
  // The property that matters most: whatever is configured, the optimizer is
  // pinned to one host.
  for (const value of [
    'https://media.thekanjo.com',
    'https://pub-abc.r2.dev',
    'https://cdn.example.com/kanjo',
  ]) {
    const pattern = mediaRemotePattern(value)
    assert.ok(pattern)
    assert.ok(!pattern.hostname.startsWith('*'), `${pattern.hostname} must not be a wildcard`)
    assert.notEqual(pattern.hostname, '**')
  }
})

// ── Malformed values fail the BUILD, naming the variable ─────────────────────

test('a value that is not a URL is refused', () => {
  assert.throws(() => mediaRemotePattern('not-a-url'), /R2_PUBLIC_BASE_URL is not a URL/)
  assert.throws(() => mediaRemotePattern('media.thekanjo.com'), /is not a URL/)
})

test('http is refused — it would be mixed content on a secure page', () => {
  assert.throws(() => mediaRemotePattern('http://media.thekanjo.com'), /must be https/)
})

test('a wildcard host is refused rather than passed through', () => {
  // Accepting this would widen the optimizer to a whole domain by accident.
  assert.throws(() => mediaRemotePattern('https://*.example.com'), /single host, not a pattern/)
})

test('the error always names the variable, so an operator knows which one to fix', () => {
  for (const bad of ['not-a-url', 'http://x.example.com', 'https://*.example.com']) {
    assert.throws(
      () => mediaRemotePattern(bad),
      (error: unknown) => {
        assert.match((error as Error).message, /R2_PUBLIC_BASE_URL/)
        return true
      },
    )
  }
})

/**
 * Regression tests for the production infrastructure policy.
 *
 * Run with `npm run test:infra`. No network, no credentials, no database.
 *
 * ── THESE IMPORT THE REAL FUNCTIONS ─────────────────────────────────────────
 *
 * An earlier version of this file RE-STATED each rule, because the production
 * ones sat behind `server-only` and could not be loaded by `node`. That is a
 * bad shape for any test and a dangerous one for an authorisation rule: the
 * copy can pass while the real function is broken, and the two drift silently.
 *
 * So the rules were refactored out of the `server-only` modules into pure
 * functions of their inputs — `lib/admin/policy.ts`, `lib/runtime/policy.ts`,
 * `lib/media/validation.ts` — and the `server-only` wrappers now do nothing but
 * supply `process.env`. Everything below imports the same functions production
 * calls. There is no duplicated logic left in this file.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { authRedirectOrigin, isAllowlistedEmail, parseAdminEmails } from './admin/policy.ts'
import { readImageSize } from './content/local/imageSize.ts'
import { safeFilename, validateUpload, MAX_UPLOAD_BYTES } from './media/validation.ts'
import {
  adminWriteBlockedReasonFromEnv,
  adminWritesAllowedFromEnv,
  deploymentModeFromEnv,
  shouldNoIndexFromEnv,
} from './runtime/policy.ts'

// ── The admin allowlist ──────────────────────────────────────────────────────

test('AN EMPTY ALLOWLIST AUTHORISES NOBODY', () => {
  // The tempting alternative — "no list configured means allow anyone" — turns
  // a forgotten environment variable into an open admin on a public site. This
  // is the single most important assertion in this file.
  for (const raw of [undefined, null, '', '   ', ',,', ' , , ']) {
    assert.equal(
      isAllowlistedEmail(raw, 'someone@example.com'),
      false,
      `raw=${JSON.stringify(raw)}`,
    )
  }
})

test('an absent or empty email is never authorised', () => {
  for (const email of [undefined, null, '', '   ']) {
    assert.equal(isAllowlistedEmail('owner@example.com', email), false)
  }
})

test('an AUTHORISED email is allowed', () => {
  assert.equal(isAllowlistedEmail('owner@example.com', 'owner@example.com'), true)
})

test('matching is case-insensitive and whitespace-tolerant', () => {
  const raw = ' Owner@Example.com , second@example.com '
  assert.equal(isAllowlistedEmail(raw, 'owner@example.com'), true)
  assert.equal(isAllowlistedEmail(raw, 'OWNER@EXAMPLE.COM'), true)
  assert.equal(isAllowlistedEmail(raw, '  second@example.com  '), true)
})

test('an UNAUTHORISED email is refused even when the list is populated', () => {
  const raw = 'owner@example.com'
  assert.equal(isAllowlistedEmail(raw, 'attacker@example.com'), false)
  // No prefix, suffix or substring matching.
  assert.equal(isAllowlistedEmail(raw, 'owner@example.com.evil.test'), false)
  assert.equal(isAllowlistedEmail(raw, 'notowner@example.com'), false)
  assert.equal(isAllowlistedEmail(raw, 'owner@example.co'), false)
})

test('parseAdminEmails normalises what a human types into a Vercel field', () => {
  assert.deepEqual(parseAdminEmails(' A@b.com , C@D.com ,, '), ['a@b.com', 'c@d.com'])
  assert.deepEqual(parseAdminEmails(undefined), [])
})

// ── The deployment-mode matrix ───────────────────────────────────────────────

test('VERCEL_ENV decides the mode, and NODE_ENV is only the fallback', () => {
  assert.equal(deploymentModeFromEnv({ VERCEL_ENV: 'production' }), 'production')
  assert.equal(deploymentModeFromEnv({ VERCEL_ENV: 'preview' }), 'preview')
  assert.equal(deploymentModeFromEnv({ VERCEL_ENV: 'development' }), 'development')
  // A production NODE_ENV on a preview build must not read as production.
  assert.equal(
    deploymentModeFromEnv({ VERCEL_ENV: 'preview', NODE_ENV: 'production' }),
    'preview',
  )
  assert.equal(deploymentModeFromEnv({ NODE_ENV: 'production' }), 'production')
  assert.equal(deploymentModeFromEnv({}), 'development')
})

test('A PREVIEW CANNOT WRITE unless it is explicitly opted in', () => {
  // A preview points at the production database with production credentials.
  // Without this, a pull request could edit the live site.
  assert.equal(adminWritesAllowedFromEnv({ VERCEL_ENV: 'preview' }), false)
  assert.equal(
    adminWritesAllowedFromEnv({ VERCEL_ENV: 'preview', ADMIN_WRITE_ENABLED: 'false' }),
    false,
  )
  // Only the exact string 'true'. '1' and 'yes' are typos, not consent.
  assert.equal(
    adminWritesAllowedFromEnv({ VERCEL_ENV: 'preview', ADMIN_WRITE_ENABLED: '1' }),
    false,
  )
  assert.equal(
    adminWritesAllowedFromEnv({ VERCEL_ENV: 'preview', ADMIN_WRITE_ENABLED: 'true' }),
    true,
  )
})

test('production and development may write', () => {
  assert.equal(adminWritesAllowedFromEnv({ VERCEL_ENV: 'production' }), true)
  assert.equal(adminWritesAllowedFromEnv({}), true)
})

test('a blocked preview explains itself, and a writable deployment says nothing', () => {
  assert.match(
    adminWriteBlockedReasonFromEnv({ VERCEL_ENV: 'preview' }) ?? '',
    /PREVIEW deployment/,
  )
  assert.equal(adminWriteBlockedReasonFromEnv({ VERCEL_ENV: 'production' }), undefined)
})

test('every non-production deployment is noindexed automatically', () => {
  // Relying on someone remembering to set NEXT_PUBLIC_NOINDEX per preview is
  // how a preview ends up in a search index competing with the real site.
  assert.equal(shouldNoIndexFromEnv({ VERCEL_ENV: 'preview' }), true)
  assert.equal(shouldNoIndexFromEnv({ VERCEL_ENV: 'development' }), true)
  assert.equal(shouldNoIndexFromEnv({}), true)
  assert.equal(shouldNoIndexFromEnv({ VERCEL_ENV: 'production' }), false)
  // The override, for a production build on a staging domain.
  assert.equal(
    shouldNoIndexFromEnv({ VERCEL_ENV: 'production', NEXT_PUBLIC_NOINDEX: 'true' }),
    true,
  )
})

// ── The magic-link origin ────────────────────────────────────────────────────

test('production takes the CONFIGURED origin, never a request header', () => {
  assert.equal(
    authRedirectOrigin({ VERCEL_ENV: 'production', NEXT_PUBLIC_SITE_URL: 'https://thekanjo.com' }),
    'https://thekanjo.com',
  )
  // Trailing slashes are the commonest way this gets typed wrong.
  assert.equal(
    authRedirectOrigin({ VERCEL_ENV: 'production', NEXT_PUBLIC_SITE_URL: 'https://thekanjo.com/' }),
    'https://thekanjo.com',
  )
})

test('production with nothing configured returns null rather than guessing', () => {
  // The caller turns this into a clear configuration error. Falling back to a
  // .vercel.app address would put the wrong link in the owner's inbox.
  assert.equal(authRedirectOrigin({ VERCEL_ENV: 'production' }), null)
  assert.equal(
    authRedirectOrigin({ VERCEL_ENV: 'production', VERCEL_URL: 'kanjo-abc.vercel.app' }),
    null,
  )
})

test('a preview signs in to ITSELF, not to production', () => {
  assert.equal(
    authRedirectOrigin({
      VERCEL_ENV: 'preview',
      VERCEL_URL: 'kanjo-abc123.vercel.app',
      NEXT_PUBLIC_SITE_URL: 'https://thekanjo.com',
    }),
    'https://kanjo-abc123.vercel.app',
  )
})

test('development falls back to localhost', () => {
  assert.equal(authRedirectOrigin({}), 'http://localhost:3000')
  assert.equal(authRedirectOrigin({ PORT: '3517' }), 'http://localhost:3517')
})

// ── Upload validation ────────────────────────────────────────────────────────

/** The smallest valid PNG: signature + IHDR declaring the given size. */
function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 13)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

test('a filename cannot escape its folder', () => {
  // The name comes from a browser file picker, so it is attacker-influenced in
  // the same sense any form field is.
  for (const hostile of [
    '../../../etc/passwd.png',
    '..\\..\\windows\\system32\\evil.png',
    '/absolute/path.png',
    'C:\\Users\\me\\thing.png',
  ]) {
    const safe = safeFilename(hostile)
    assert.ok(!safe.includes('/'), `${safe} must not contain a separator`)
    assert.ok(!safe.includes('\\'), `${safe} must not contain a separator`)
    assert.ok(!safe.includes('..'), `${safe} must not contain ..`)
  }
})

test('a filename keeps only word characters and its extension', () => {
  assert.match(safeFilename('Car A (final)!.SVG'), /^car-a-final-[a-z0-9]+\.svg$/)
  assert.match(safeFilename('日本語.png'), /^image-[a-z0-9]+\.png$/)
  assert.match(safeFilename('no-extension'), /^no-extension-[a-z0-9]+$/)
})

test('two uploads of the same name do not collide', () => {
  const a = safeFilename('car.svg')
  assert.match(a, /^car-[a-z0-9]+\.svg$/)
  assert.ok(a !== 'car.svg')
})

test('a long name is bounded', () => {
  assert.ok(safeFilename(`${'a'.repeat(400)}.png`).length < 70)
})

test('a VALID image upload is accepted, with dimensions from the bytes', () => {
  const result = validateUpload({
    name: 'Car A.png',
    bytes: pngBytes(200, 80),
    folder: 'loader',
  })
  assert.equal(result.width, 200)
  assert.equal(result.height, 80)
  assert.equal(result.contentType, 'image/png')
  assert.match(result.filename, /^car-a-[a-z0-9]+\.png$/)
})

test('an UNSUPPORTED type is refused', () => {
  for (const name of ['payload.php', 'notes.txt', 'archive.zip', 'clip.mp4', 'noext']) {
    assert.throws(
      () => validateUpload({ name, bytes: pngBytes(10, 10), folder: 'hero' }),
      /is not an image this site can use/,
      `${name} should be refused`,
    )
  }
})

test('an OVERSIZED upload is refused', () => {
  assert.throws(
    () =>
      validateUpload({
        name: 'huge.png',
        bytes: new Uint8Array(MAX_UPLOAD_BYTES + 1),
        folder: 'hero',
      }),
    /The limit is 12MB/,
  )
})

test('an empty file and an unknown folder are refused', () => {
  assert.throws(
    () => validateUpload({ name: 'a.png', bytes: new Uint8Array(0), folder: 'hero' }),
    /empty/,
  )
  assert.throws(
    () => validateUpload({ name: 'a.png', bytes: pngBytes(4, 4), folder: '../secrets' }),
    /Unknown media folder/,
  )
})

test('bytes that are not an image are REJECTED even with an image extension', () => {
  // The content-type check: a .png whose bytes are not a PNG fails, so the
  // Content-Type set on an R2 object is derived from something verified rather
  // than from a filename anybody can rename.
  assert.throws(
    () =>
      validateUpload({
        name: 'shell.png',
        bytes: new TextEncoder().encode('<?php system($_GET["c"]); ?>'),
        folder: 'hero',
      }),
    /Could not read the pixel dimensions/,
  )
})

// ── Image headers ────────────────────────────────────────────────────────────

test('a PNG header yields its real dimensions', () => {
  assert.deepEqual(readImageSize(pngBytes(200, 80)), { width: 200, height: 80 })
  assert.deepEqual(readImageSize(pngBytes(2560, 1440)), { width: 2560, height: 1440 })
})

test('an SVG viewBox yields its dimensions', () => {
  const svg = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80" width="100%"><path d="M0 0"/></svg>',
  )
  // The viewBox is preferred over `width`, which here is a percentage — exactly
  // the case that would otherwise produce a nonsense ImageRef.
  assert.deepEqual(readImageSize(svg), { width: 200, height: 80 })
})

test('bytes that are not an image are null, not guessed at', () => {
  assert.equal(readImageSize(new TextEncoder().encode('not an image at all')), null)
  assert.equal(readImageSize(new Uint8Array(0)), null)
  assert.equal(readImageSize(new Uint8Array([0x00, 0x01, 0x02, 0x03])), null)
})

test('a truncated PNG header is rejected rather than read past its end', () => {
  assert.equal(readImageSize(pngBytes(200, 80).slice(0, 12)), null)
})

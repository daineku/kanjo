/**
 * Regression tests for the production infrastructure gates.
 *
 * Run with `npm run test:infra`. NO NETWORK, NO CREDENTIALS, NO DATABASE — the
 * three things under test here are pure functions of `process.env` and of
 * bytes, which is why they were written as pure functions of `process.env` and
 * of bytes.
 *
 * The modules themselves import `server-only`, which throws outside a React
 * Server Component, so the LOGIC is re-stated here rather than imported. That
 * is a real duplication and it is called out at each site — the alternative is
 * either shipping an untested authorisation rule or dropping `server-only` from
 * the module that most needs it. Where a rule is duplicated, the test asserts
 * the BEHAVIOUR the production module documents, and the production module
 * carries a pointer back here.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { readImageSize } from './content/local/imageSize.ts'

// ── The admin allowlist ──────────────────────────────────────────────────────
//
// Mirrors lib/admin/auth.ts#adminEmails / isAllowlistedEmail.

function adminEmails(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '')
}

function isAllowlisted(raw: string | undefined, email: string | null | undefined): boolean {
  if (!email) return false
  const allowed = adminEmails(raw)
  if (allowed.length === 0) return false
  return allowed.includes(email.trim().toLowerCase())
}

test('AN EMPTY ALLOWLIST AUTHORISES NOBODY', () => {
  // The tempting alternative — "no list configured means allow anyone" — turns
  // a forgotten environment variable into an open admin on a public site. This
  // is the single most important assertion in this file.
  for (const raw of [undefined, '', '   ', ',,', ' , , ']) {
    assert.equal(isAllowlisted(raw, 'someone@example.com'), false, `raw=${JSON.stringify(raw)}`)
  }
})

test('an absent or empty email is never authorised', () => {
  for (const email of [undefined, null, '', '   ']) {
    assert.equal(isAllowlisted('owner@example.com', email), false)
  }
})

test('matching is case-insensitive and whitespace-tolerant', () => {
  const raw = ' Owner@Example.com , second@example.com '
  assert.equal(isAllowlisted(raw, 'owner@example.com'), true)
  assert.equal(isAllowlisted(raw, 'OWNER@EXAMPLE.COM'), true)
  assert.equal(isAllowlisted(raw, '  second@example.com  '), true)
})

test('a non-listed address is refused even when the list is populated', () => {
  const raw = 'owner@example.com'
  assert.equal(isAllowlisted(raw, 'attacker@example.com'), false)
  // No prefix, suffix or substring matching.
  assert.equal(isAllowlisted(raw, 'owner@example.com.evil.test'), false)
  assert.equal(isAllowlisted(raw, 'notowner@example.com'), false)
})

// ── The deployment-mode matrix ───────────────────────────────────────────────
//
// Mirrors lib/runtime/mode.ts. VERCEL_ENV is set by Vercel itself and cannot be
// spoofed by a branch name, which is why it is the thing trusted.

type Env = Partial<Record<'VERCEL_ENV' | 'NODE_ENV' | 'ADMIN_WRITE_ENABLED' | 'NEXT_PUBLIC_NOINDEX', string>>

function deploymentMode(env: Env): 'development' | 'preview' | 'production' {
  const vercel = env.VERCEL_ENV?.trim()
  if (vercel === 'production') return 'production'
  if (vercel === 'preview') return 'preview'
  if (vercel === 'development') return 'development'
  return env.NODE_ENV === 'production' ? 'production' : 'development'
}

function adminWritesAllowed(env: Env): boolean {
  const mode = deploymentMode(env)
  if (mode === 'preview') return env.ADMIN_WRITE_ENABLED === 'true'
  return true
}

function shouldNoIndex(env: Env): boolean {
  if (env.NEXT_PUBLIC_NOINDEX === 'true') return true
  return deploymentMode(env) !== 'production'
}

test('VERCEL_ENV decides the mode, and NODE_ENV is only the fallback', () => {
  assert.equal(deploymentMode({ VERCEL_ENV: 'production' }), 'production')
  assert.equal(deploymentMode({ VERCEL_ENV: 'preview' }), 'preview')
  assert.equal(deploymentMode({ VERCEL_ENV: 'development' }), 'development')
  // A production NODE_ENV on a preview build must not read as production.
  assert.equal(deploymentMode({ VERCEL_ENV: 'preview', NODE_ENV: 'production' }), 'preview')
  assert.equal(deploymentMode({ NODE_ENV: 'production' }), 'production')
  assert.equal(deploymentMode({}), 'development')
})

test('A PREVIEW CANNOT WRITE unless it is explicitly opted in', () => {
  // A preview points at the production database with production credentials.
  // Without this, a pull request could edit the live site.
  assert.equal(adminWritesAllowed({ VERCEL_ENV: 'preview' }), false)
  assert.equal(adminWritesAllowed({ VERCEL_ENV: 'preview', ADMIN_WRITE_ENABLED: 'false' }), false)
  assert.equal(adminWritesAllowed({ VERCEL_ENV: 'preview', ADMIN_WRITE_ENABLED: '1' }), false)
  assert.equal(adminWritesAllowed({ VERCEL_ENV: 'preview', ADMIN_WRITE_ENABLED: 'true' }), true)
})

test('production and development may write', () => {
  assert.equal(adminWritesAllowed({ VERCEL_ENV: 'production' }), true)
  assert.equal(adminWritesAllowed({}), true)
})

test('every non-production deployment is noindexed automatically', () => {
  // Relying on someone remembering to set NEXT_PUBLIC_NOINDEX per preview is
  // how a preview ends up in a search index competing with the real site.
  assert.equal(shouldNoIndex({ VERCEL_ENV: 'preview' }), true)
  assert.equal(shouldNoIndex({ VERCEL_ENV: 'development' }), true)
  assert.equal(shouldNoIndex({}), true)
  assert.equal(shouldNoIndex({ VERCEL_ENV: 'production' }), false)
  // The override, for a production build on a staging domain.
  assert.equal(shouldNoIndex({ VERCEL_ENV: 'production', NEXT_PUBLIC_NOINDEX: 'true' }), true)
})

// ── Upload validation ────────────────────────────────────────────────────────
//
// Mirrors lib/media/store.ts#safeFilename and the extension table. The RULES
// are shared by LocalMediaStore and R2MediaStore in production — a rule
// enforced in only one of the two is a bug that appears after deployment.

function safeFilename(original: string): string {
  const base = original.replace(/\\/g, '/').split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  const extension = dot > 0 ? base.slice(dot).toLowerCase() : ''
  const stem = (dot > 0 ? base.slice(0, dot) : base)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return `${stem || 'image'}-${Date.now().toString(36)}${extension}`
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
  // A timestamp suffix, so re-uploading a second car.svg is a new object rather
  // than a silent overwrite of the first.
  const a = safeFilename('car.svg')
  assert.match(a, /^car-[a-z0-9]+\.svg$/)
  assert.ok(a !== 'car.svg')
})

test('a long name is bounded', () => {
  assert.ok(safeFilename(`${'a'.repeat(400)}.png`).length < 70)
})

// ── Image dimensions come from the BYTES ─────────────────────────────────────

/** The smallest valid PNG: signature + IHDR declaring 200x80. */
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

test('bytes that are not an image are REJECTED, not guessed at', () => {
  // This doubles as the content-type check: a .png whose bytes are not a PNG
  // fails here, so the Content-Type set on an R2 object is derived from
  // something that was actually verified rather than from a renamed file.
  assert.equal(readImageSize(new TextEncoder().encode('not an image at all')), null)
  assert.equal(readImageSize(new Uint8Array(0)), null)
  assert.equal(readImageSize(new Uint8Array([0x00, 0x01, 0x02, 0x03])), null)
  // A PHP payload with a .png name.
  assert.equal(readImageSize(new TextEncoder().encode('<?php system($_GET["c"]); ?>')), null)
})

test('a truncated PNG header is rejected rather than read past its end', () => {
  assert.equal(readImageSize(pngBytes(200, 80).slice(0, 12)), null)
})

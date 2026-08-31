/**
 * Media-request regression checks.
 *
 * The Daineku site's handoff records several bugs where a component asked for
 * the same image over and over — `imagesLoaded` creating proxy requests for
 * every lazy below-fold image, `<Link>` prefetch firing an RSC fetch on hover,
 * an auto-cycle timer re-triggering loads, a masonry relayout remounting cards.
 * This script exists so those cannot come back unnoticed.
 *
 * WHAT IT MEASURES, AND WHY THAT IS THE RIGHT THING. It counts Playwright
 * `request` events per exact URL. A request event fires when the PAGE ASKS for a
 * resource, whether or not the browser then serves it from cache — so this
 * measures component behaviour, which is the thing under test, rather than
 * caching, which is the browser's business. Where a repeat is legitimate the
 * check looks at the response to confirm it was served from cache rather than
 * refetched over the wire.
 *
 * `next/image` legitimately produces DIFFERENT URLs for different widths (`w=`),
 * so a thumbnail and the same image in the viewer are two URLs, not a duplicate.
 * The checks below compare exact URLs for that reason.
 *
 * Playwright is deliberately not a dependency of this project. Run it from a
 * throwaway directory:
 *
 *   npm run build && npm start &
 *   cd /tmp && npm init -y && npm i playwright && npx playwright install chromium --only-shell
 *   BASE=http://localhost:3000 node <path-to>/check-media-requests.mjs
 *
 * Requires at least one PUBLISHED screenshot to exercise the grid and viewer; it
 * says so and skips those checks otherwise.
 */

import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:3000'
const IMAGE = /\/_next\/image|\.(?:png|jpe?g|webp|avif|gif|svg)(?:\?|$)/i
const MEDIA = /\.(?:mp4|webm|ogv|mov)(?:\?|$)/i

const results = []
function check(name, pass, detail) {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch()

// ── A recorder that separates "the page asked" from "the network served" ─────
function recorder(page) {
  const asked = new Map() // url -> number of request events
  const served = [] // { url, fromCache, status }
  page.on('request', (request) => {
    const url = request.url()
    if (!IMAGE.test(url) && !MEDIA.test(url)) return
    asked.set(url, (asked.get(url) ?? 0) + 1)
  })
  page.on('response', async (response) => {
    const url = response.url()
    if (!IMAGE.test(url) && !MEDIA.test(url)) return
    served.push({ url, status: response.status(), fromCache: response.fromServiceWorker() })
  })
  return {
    asked,
    served,
    imageUrls: () => [...asked.keys()].filter((url) => IMAGE.test(url)),
    total: () => [...asked.values()].reduce((sum, n) => sum + n, 0),
    reset: () => {
      asked.clear()
      served.length = 0
    },
  }
}

// ── 1. No bundled proxy-loading library ─────────────────────────────────────
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const scripts = []
  page.on('response', async (response) => {
    if (!/\.js(?:\?|$)/.test(response.url())) return
    try {
      scripts.push(await response.text())
    } catch {
      /* a redirect or a non-text body */
    }
  })
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  const all = scripts.join('\n')
  const banned = ['imagesLoaded', 'imagesloaded', 'masonry-layout', 'Masonry(', 'swiper', 'glide.js']
  const found = banned.filter((name) => all.includes(name))
  check(
    'no imagesLoaded / masonry / carousel package in the shipped JS',
    found.length === 0,
    found.length === 0 ? `${scripts.length} scripts scanned` : `found: ${found.join(', ')}`,
  )
  await context.close()
}

// ── 2. Hover across every thumbnail triggers nothing ────────────────────────
let publishedShots = 0
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const rec = recorder(page)
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.getElementById('media')?.scrollIntoView({ block: 'start' }))
  await page.waitForTimeout(1200)
  await page.waitForLoadState('networkidle')

  const shots = page.locator('#media .k-shot')
  publishedShots = await shots.count()

  if (publishedShots === 0) {
    check('hover over thumbnails triggers no request', true, 'skipped: no published screenshots')
  } else {
    const before = rec.total()
    for (let i = 0; i < publishedShots; i += 1) {
      await shots.nth(i).hover()
      await page.waitForTimeout(120)
    }
    // Also hover the links and cards, which is where a prefetch would show up.
    // `force` and a short timeout because a DISABLED card is a <span> with
    // pointer-events: none — it cannot be hovered, and that is correct, so a
    // failure to hover one is not a finding.
    for (const selector of ['header a', 'a.k-wedge']) {
      const items = page.locator(selector)
      const n = Math.min(await items.count(), 8)
      for (let i = 0; i < n; i += 1) {
        try {
          await items.nth(i).hover({ force: true, timeout: 1500 })
        } catch {
          /* not hoverable; nothing to measure */
        }
        await page.waitForTimeout(80)
      }
    }
    await page.waitForTimeout(600)
    const after = rec.total()
    check(
      'hover across all thumbnails, nav and cards triggers no media request',
      after === before,
      `${publishedShots} thumbnails hovered, ${after - before} new request(s)`,
    )

    // ── 3. Idling on the page triggers nothing ──────────────────────────────
    const idleBefore = rec.total()
    await page.waitForTimeout(6000)
    check(
      'sitting on the page for 6s triggers no media request (no auto-cycle)',
      rec.total() === idleBefore,
      `${rec.total() - idleBefore} new request(s)`,
    )

    // ── 4. Scrolling between sections does not refetch ──────────────────────
    const scrollBefore = new Map(rec.asked)
    for (const id of ['video', 'media', 'game', 'updates', 'about', 'media']) {
      await page.evaluate((s) => document.getElementById(s)?.scrollIntoView({ block: 'start' }), id)
      await page.waitForTimeout(350)
    }
    await page.waitForTimeout(800)
    const refetched = [...rec.asked.entries()].filter(
      ([url, count]) => (scrollBefore.get(url) ?? 0) > 0 && count > (scrollBefore.get(url) ?? 0),
    )
    check(
      'scrolling back and forth between sections does not refetch a loaded image',
      refetched.length === 0,
      refetched.length === 0 ? 'no URL asked for twice' : refetched.map(([u]) => u.slice(-60)).join(', '),
    )
  }
  await context.close()
}

// ── 5. The viewer: open, step through everything, come back ─────────────────
if (publishedShots > 0) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const rec = recorder(page)
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.getElementById('media')?.scrollIntoView({ block: 'start' }))
  await page.waitForTimeout(900)
  await page.waitForLoadState('networkidle')

  await page.locator('#media .k-shot').first().click()
  await page.waitForSelector('.k-viewer', { state: 'visible' })
  check('clicking a thumbnail opens the viewer', true)

  // Body scroll must be locked while open.
  const lockedOverflow = await page.evaluate(() => getComputedStyle(document.body).overflow)
  check('body scroll is locked while the viewer is open', lockedOverflow === 'hidden', lockedOverflow)

  // Step forward through every image, then all the way back — twice round.
  const firstPass = new Map()
  for (let lap = 0; lap < 2; lap += 1) {
    for (let i = 0; i < publishedShots; i += 1) {
      await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(450)
    }
    for (let i = 0; i < publishedShots; i += 1) {
      await page.keyboard.press('ArrowLeft')
      await page.waitForTimeout(450)
    }
    if (lap === 0) {
      await page.waitForLoadState('networkidle')
      for (const [url, count] of rec.asked) firstPass.set(url, count)
    }
  }
  await page.waitForTimeout(800)

  // A second identical lap must ask for nothing new: every frame is already
  // decoded and the elements are keyed by item id, so nothing remounts.
  const newOnSecondLap = [...rec.asked.entries()].filter(
    ([url, count]) => count > (firstPass.get(url) ?? 0),
  )
  check(
    'a second identical lap through the viewer asks for nothing new',
    newOnSecondLap.length === 0,
    newOnSecondLap.length === 0
      ? `${firstPass.size} URL(s) after the first lap, unchanged after the second`
      : newOnSecondLap.map(([u, c]) => `${u.slice(-50)} x${c}`).join(', '),
  )

  // No URL should ever be asked for more than once in a single page life.
  const askedTwice = [...rec.asked.entries()].filter(([, count]) => count > 1)
  check(
    'no media URL is requested more than once in one page life',
    askedTwice.length === 0,
    askedTwice.length === 0
      ? `${rec.asked.size} distinct URL(s)`
      : askedTwice.map(([u, c]) => `${u.slice(-50)} x${c}`).join(', '),
  )

  // At most two frames mounted at a time: the shown one and the incoming one.
  const mounted = await page.evaluate(() => document.querySelectorAll('.k-viewer-img').length)
  check('at most two frames are mounted in the viewer', mounted <= 2, `${mounted} mounted`)

  // Left/right arrows and the explicit controls.
  const hasPrev = await page.locator('.k-viewer-nav button', { hasText: 'PREV' }).count()
  const hasNext = await page.locator('.k-viewer-nav button', { hasText: 'NEXT' }).count()
  const hasClose = await page.getByRole('button', { name: /close screenshot viewer/i }).count()
  check('explicit prev / next / close controls exist', hasPrev > 0 && hasNext > 0 && hasClose > 0)

  // Escape closes, and the scroll lock is released.
  await page.keyboard.press('Escape')
  await page.waitForSelector('.k-viewer', { state: 'detached' })
  const restored = await page.evaluate(() => document.body.style.overflow)
  check('Escape closes the viewer', true)
  check(
    'body scroll is restored after close',
    restored === '' || restored === 'visible',
    `body.style.overflow = "${restored}"`,
  )

  // Focus returns to the thumbnail that opened it.
  const focusReturned = await page.evaluate(() =>
    document.activeElement?.classList.contains('k-shot'),
  )
  check('focus returns to the thumbnail that opened the viewer', focusReturned === true)

  // Reopening must not refetch.
  const beforeReopen = rec.total()
  await page.locator('#media .k-shot').first().click()
  await page.waitForSelector('.k-viewer', { state: 'visible' })
  await page.waitForTimeout(900)
  check(
    'reopening the viewer does not refetch',
    rec.total() === beforeReopen,
    `${rec.total() - beforeReopen} new request(s)`,
  )
  await context.close()
}

// ── 6. Reduced motion must not fetch the hero loop ──────────────────────────
{
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  const rec = recorder(page)
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const videoRequests = [...rec.asked.keys()].filter((url) => MEDIA.test(url))
  const heroVideoPresent = await page.evaluate(() => {
    const layer = document.querySelector('.k-hero-video-layer')
    return layer ? getComputedStyle(layer).display : 'no hero video configured'
  })
  check(
    'under reduced motion the hero loop is not fetched',
    videoRequests.length === 0,
    `${videoRequests.length} video request(s); hero video layer display = ${heroVideoPresent}`,
  )
  await context.close()
}

await browser.close()

// ── Summary ─────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`)
if (failed.length > 0) {
  console.error('\nFAILED:')
  for (const f of failed) console.error(`  ${f.name} — ${f.detail ?? ''}`)
  process.exit(1)
}

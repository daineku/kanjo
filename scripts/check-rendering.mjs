/**
 * Rendering checks: horizontal overflow, console errors, duplicate requests,
 * keyboard order, focus visibility and reduced motion, across the width matrix.
 *
 * NOT wired into `npm run check`, and playwright is deliberately NOT a
 * dependency of this project — it would add ~100MB of browser download to every
 * install for a check that is run occasionally. Run it like this instead:
 *
 *   npm run build && npm start &                  # or: npm run dev
 *   cd /tmp && npm init -y && npm i playwright && npx playwright install chromium --only-shell
 *   BASE=http://localhost:3000 node <path-to>/check-rendering.mjs
 *
 * ONE TRAP, LEARNED THE HARD WAY: `next start` reads its manifests once, so a
 * rebuild while it is running leaves it serving HTML that points at a CSS hash
 * that no longer exists. The page then renders UNSTYLED, and an unstyled page
 * trivially passes an overflow check. Always restart the server after a build,
 * and sanity-check that the stylesheet URL in the HTML returns 200.
 *
 * The reduced-motion control sets `reducedMotion: 'no-preference'` explicitly.
 * A bare context inherits the host's setting, so it is not a control.
 */

import { chromium } from 'playwright'
import fs from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:3517'
const WIDTHS = [1920, 1440, 1024, 768, 430, 390, 360]
const ROUTES = ['/', '/updates', '/updates/site-foundation', '/nope-404']

const results = []
const consoleIssues = []
const failedRequests = []
const requestCounts = new Map()

const browser = await chromium.launch()

// ── 1. Overflow + console + request checks across every width and route ──────
for (const route of ROUTES) {
  for (const width of WIDTHS) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 1,
    })
    const page = await context.newPage()

    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        const text = msg.text()
        // React DevTools nag and favicon noise are not defects.
        if (/Download the React DevTools/i.test(text)) return
        consoleIssues.push({ route, width, type: msg.type(), text: text.slice(0, 300) })
      }
    })
    page.on('pageerror', (err) => {
      consoleIssues.push({ route, width, type: 'pageerror', text: String(err).slice(0, 300) })
    })
    page.on('requestfailed', (req) => {
      const url = req.url()
      if (url.includes('favicon')) return
      failedRequests.push({ route, width, url, reason: req.failure()?.errorText })
    })
    page.on('request', (req) => {
      if (route === '/' && width === 1440) {
        const key = req.url()
        requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1)
      }
    })

    const response = await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
    const status = response?.status() ?? 0

    const metrics = await page.evaluate(() => {
      const de = document.documentElement
      // Find any element whose box extends past the viewport.
      const offenders = []
      for (const el of document.querySelectorAll('*')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) continue
        if (r.right > window.innerWidth + 1 || r.left < -1) {
          const style = getComputedStyle(el)
          // An element inside its own scroll container is fine.
          let parent = el.parentElement
          let scrollable = false
          while (parent) {
            const ps = getComputedStyle(parent)
            if (ps.overflowX === 'auto' || ps.overflowX === 'scroll' || ps.overflowX === 'hidden') {
              scrollable = true
              break
            }
            parent = parent.parentElement
          }
          if (!scrollable) {
            offenders.push({
              tag: el.tagName.toLowerCase(),
              cls: (el.className || '').toString().slice(0, 60),
              right: Math.round(r.right),
              display: style.display,
            })
          }
        }
      }
      return {
        docScrollWidth: de.scrollWidth,
        innerWidth: window.innerWidth,
        bodyScrollWidth: document.body.scrollWidth,
        horizontalScroll: de.scrollWidth > window.innerWidth + 1,
        offenders: offenders.slice(0, 6),
        h1Count: document.querySelectorAll('h1').length,
        title: document.title,
        // Fonts actually applied to the display and body roles.
        heroFont: (() => {
          const el = document.querySelector('.k-hero-title, .k-section-title, h1')
          return el ? getComputedStyle(el).fontFamily : null
        })(),
        bodyFont: getComputedStyle(document.body).fontFamily,
        bg: getComputedStyle(document.body).backgroundColor,
      }
    })

    results.push({ route, width, status, ...metrics })
    await context.close()
  }
}

// ── 2. Keyboard navigation on the landing page ───────────────────────────────
const kbContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const kb = await kbContext.newPage()
await kb.goto(`${BASE}/`, { waitUntil: 'networkidle' })

const tabOrder = []
for (let i = 0; i < 14; i += 1) {
  await kb.keyboard.press('Tab')
  const info = await kb.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return null
    const style = getComputedStyle(el)
    return {
      tag: el.tagName.toLowerCase(),
      text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 44),
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      outlineStyle: style.outlineStyle,
      visible: el.getBoundingClientRect().width > 0,
    }
  })
  tabOrder.push(info)
}

// ── 3. Reduced motion ────────────────────────────────────────────────────────
const rmContext = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: 'reduce',
})
const rm = await rmContext.newPage()
await rm.goto(`${BASE}/`, { waitUntil: 'networkidle' })
const reducedMotion = await rm.evaluate(() => {
  const el = document.querySelector('.k-reveal')
  if (!el) return { found: false }
  const style = getComputedStyle(el)
  return {
    found: true,
    matches: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    animationName: style.animationName,
    opacity: style.opacity,
    transform: style.transform,
  }
})

// Same element without the preference, for the control.
const nmContext = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  // Explicit: the default is the host's setting, so a bare context is not a control.
  reducedMotion: 'no-preference',
})
const nm = await nmContext.newPage()
await nm.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await nm.waitForTimeout(400)
const normalMotion = await nm.evaluate(() => {
  const el = document.querySelector('.k-reveal')
  if (!el) return { found: false }
  const style = getComputedStyle(el)
  return { found: true, animationName: style.animationName, opacity: style.opacity }
})

// ── 4. Screenshots at three representative widths ────────────────────────────
for (const width of [1440, 768, 390]) {
  const ctx = await browser.newContext({ viewport: { width, height: 1200 } })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(500)
  await p.screenshot({ path: `shot-home-${width}.png`, fullPage: false })
  await p.goto(`${BASE}/updates/site-foundation`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(300)
  await p.screenshot({ path: `shot-article-${width}.png`, fullPage: false })
  await ctx.close()
}

await browser.close()

// ── Report ───────────────────────────────────────────────────────────────────
const duplicateRequests = [...requestCounts.entries()]
  .filter(([, n]) => n > 1)
  .map(([url, n]) => ({ url: url.slice(-70), n }))

const report = {
  overflow: results
    .filter((r) => r.horizontalScroll || r.offenders.length > 0)
    .map((r) => ({
      route: r.route,
      width: r.width,
      docScrollWidth: r.docScrollWidth,
      innerWidth: r.innerWidth,
      offenders: r.offenders,
    })),
  statuses: results
    .filter((r) => r.width === 1440)
    .map((r) => ({ route: r.route, status: r.status, title: r.title, h1: r.h1Count })),
  fonts: results.find((r) => r.width === 1440 && r.route === '/'),
  consoleIssues,
  failedRequests,
  duplicateRequests,
  tabOrder,
  reducedMotion,
  normalMotion,
  widthsChecked: WIDTHS,
  routesChecked: ROUTES,
}

fs.writeFileSync('report.json', JSON.stringify(report, null, 2))

console.log('=== HORIZONTAL OVERFLOW ===')
console.log(report.overflow.length === 0 ? 'none at any width/route' : JSON.stringify(report.overflow, null, 1))
console.log('\n=== ROUTE STATUSES (1440) ===')
for (const s of report.statuses) console.log(` ${String(s.status).padEnd(4)} ${s.route.padEnd(30)} h1=${s.h1} "${s.title}"`)
console.log('\n=== FONTS APPLIED ===')
console.log(' display role:', report.fonts?.heroFont)
console.log(' body:', report.fonts?.bodyFont)
console.log(' body background:', report.fonts?.bg)
console.log('\n=== CONSOLE ERRORS / WARNINGS ===')
console.log(consoleIssues.length === 0 ? 'none' : JSON.stringify(consoleIssues.slice(0, 12), null, 1))
console.log('\n=== FAILED REQUESTS ===')
console.log(failedRequests.length === 0 ? 'none' : JSON.stringify(failedRequests.slice(0, 12), null, 1))
console.log('\n=== DUPLICATE REQUESTS (landing, 1440) ===')
console.log(duplicateRequests.length === 0 ? 'none — every URL requested at most once' : JSON.stringify(duplicateRequests, null, 1))
console.log('\n=== KEYBOARD TAB ORDER ===')
tabOrder.forEach((t, i) => {
  if (!t) return
  console.log(` ${String(i + 1).padStart(2)}. <${t.tag}> "${t.text}" outline=${t.outlineStyle} ${t.outlineWidth} ${t.outlineColor}`)
})
console.log('\n=== REDUCED MOTION ===')
console.log(' with reduce:', JSON.stringify(reducedMotion))
console.log(' control    :', JSON.stringify(normalMotion))

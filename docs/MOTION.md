# Motion

The site runs **one** motion system: GSAP, with ScrollTrigger. There is no
Framer Motion alongside it, and there should not be — two animation runtimes
means two easing vocabularies, two cleanup models and two bundles to pay for.

Reference material for the techniques below came from
[`sanidhyy/game-website`](https://github.com/sanidhyy/game-website) and its
JavaScript sibling
[`abuzar-alvi/Zentry-Animated-Gaming-Landing-Page`](https://github.com/abuzar-alvi/Zentry-Animated-Gaming-Landing-Page).
**Techniques only.** No branding, layout, typeface, media, copy or colour from
either repository is used here; the visual identity is The Kanjo's own UI Canon.

---

## Architecture

```
lib/motion/gsap.ts      registration + defaults, once, guarded for SSR
lib/motion/policy.ts    the responsive motion policy, read synchronously
lib/motion/stage.ts     the loader → hero handshake

components/loader/KanjoLoader.tsx   the night-highway loader
components/motion/TitleReveal.tsx   THE KANJO arriving
components/motion/Reveal.tsx        the one scroll reveal
components/motion/ClipReveal.tsx    the media-frame clip reveal
```

Four client islands, and that is the whole of it. **The homepage is still a
server component**: every section renders on the server and passes through
`children`, so the page is prerendered as static HTML with all of its copy in
it. A crawler, a visitor with broken JavaScript, and a visitor who has asked for
reduced motion all get the finished page.

### The rule that everything else follows

> **Content starts visible. Nothing is hidden in a stylesheet.**

There is no `opacity: 0` in CSS for any JS-driven reveal. The start state is
applied by `gsap.set` inside a **layout effect** — by JavaScript, at the moment
something is definitely going to animate it back, and before the first paint so
nothing flashes. The consequences:

- reduced motion → the set never runs → the finished page
- failed hydration → the set never runs → the finished page
- a ScrollTrigger that never fires → the element was never hidden
- **there is no path to an element stuck at `opacity: 0`**

### `opacity`, never `autoAlpha`

GSAP's `autoAlpha` sets `visibility: hidden` at zero, which removes an element
from the **tab order** and from the accessibility tree.

Measured, with `autoAlpha`: a keyboard visitor tabbing down the homepage went
skip link → TikTok → Patreon → footer, **skipping the video's PLAY button
entirely** — the block was still un-revealed, so it was not focusable, so it
could never be scrolled to by tabbing, so it never revealed. Plain `opacity`
keeps it focusable; focusing it scrolls it into view, which fires the trigger.
The reveal components also listen for `focusin` and reveal immediately, so
nothing depends on that.

---

## The responsive motion policy

Three independent axes, in `lib/motion/policy.ts`:

| | Desktop / fine pointer | Mobile / coarse or narrow | `prefers-reduced-motion` |
| --- | --- | --- | --- |
| Loader | Full overtake loop, both lanes, light accents | Same choreography, one intensity step down, no accents | A still frame, held briefly, then a fade |
| Title | Masked word reveal with a perspective tilt | Same | Present, no animation |
| Scroll reveals | 24px travel | 13px travel (×0.55) | None — content is simply there |
| Clip reveal | Band opens + a 1.04 scale | Band opens, no scale | None |
| Pointer effects | **None anywhere on the site** | — | — |
| Parallax | Lane-speed difference in the loader only | Reduced | None |
| Pinning | **None anywhere on the site** | — | — |
| Scrubbed animation | **None anywhere on the site** | — | — |

Components that must survive a preference change mid-session use
`gsap.matchMedia()`, which re-runs and **reverts** on its own.
`readMotionPolicy()` is for one-shot decisions (the loader) where a change
cannot happen in practice — it is a plain function rather than a hook because it
is read in a layout effect, before paint, and a hook would return the
conservative value for one frame and cause a visible flash.

---

## Performance rules

- **Only `transform` and `opacity`** are animated continuously. No `width`,
  `height`, `top` or `left` in any running animation.
- **`will-change` is temporary.** Set in `onStart`, cleared in `onComplete`.
  Left on permanently it promotes a layer per revealed block and never releases
  it.
- **ScrollTriggers are `once: true` and there is no `scrub` anywhere.** A
  scrubbed trigger is work on every scroll frame for the life of the page; these
  fire once and dispose. The homepage creates four.
- **No raw scroll listeners.** The reference's navbar drives visibility from a
  `useWindowScroll` hook that re-renders React on every scroll event; that is
  what ScrollTrigger exists to avoid, and this site has no scroll-reactive nav
  anyway.
- **No perpetual `requestAnimationFrame`.** The loader's timelines are killed
  and the component unmounts; after the entrance there is no running animation
  on the page at all.
- **`getBoundingClientRect` is never read inside an animation loop.**
- **ScrollTrigger recalculates on settled events**, not on every resize — a
  mobile URL bar collapsing fires resize continuously, and each one would
  otherwise trigger a layout read of every trigger on the page.

Cost: GSAP + ScrollTrigger add **~47 kB** to the homepage's First Load JS
(115 kB → 162 kB). The reading routes are unaffected.

---

## What was adopted, and what was rejected

### Adopted

| Technique | What was taken, and what changed |
| --- | --- |
| **`clip-path` media transition** | The idea of a media frame entering through a clip. Changed to an `inset()` band instead of a `polygon()` (a parallelogram crops the footage), and it plays **once** instead of on a scrub. |
| **Animated title** | The masked per-word reveal with a stagger and a perspective tilt. Rewritten from scratch — see below. |
| **`gsap.context` / `useGSAP` cleanup** | Adopted wholesale, and extended: `gsap.matchMedia()` for anything that must revert when conditions change. |
| **ScrollTrigger reveal on entry** | Adopted, with `once: true` and no scrub. |
| **Layered media, subtle parallax** | Adopted in the loader, as a lane-speed difference. No pointer parallax anywhere. |
| **Cinematic timing** | Adopted, bounded by the canon's own ease-out curve so the entrance and the interface read as one hand. |

### Rejected

| Technique | Why |
| --- | --- |
| **`dangerouslySetInnerHTML` for animated titles** | It makes the title a markup channel, and on this site the title is admin-editable content. Ours splits a **string** on whitespace into text nodes. |
| **Four autoplaying hero videos** | The reference preloads four MP4s and gates its loader on three of them. That is megabytes before the first paint, and the loader hangs if one stalls. |
| **`BentoTilt` mouse-tracking** | It is `onMouseMove` only, so a touch visitor gets nothing, and it reads `getBoundingClientRect()` on every mouse event. Replaced by the canon's selection treatment, which works for hover, focus and touch alike. |
| **`VideoPreview` 3D hover parallax** | Same objection, plus it hides the affordance until hover. |
| **Hover-only reveals** | Nothing on this site is reachable only by hovering. |
| **Long pinned scroll sequences** | The reference pins a section for `+=800` and scrubs an image to full-screen. On a phone that is scroll hijacking, and the brief rules it out. |
| **Scroll-direction nav hide/show** | Adopted nowhere: the homepage has no nav bar at all. The reading routes have a static header, and the game's own menu does not follow the player around. |
| **Autoplaying background audio** | No. |
| **Zentry's typeface and per-character font swap** | The identity is The Kanjo's. |

---

## The loader

See `components/loader/KanjoLoader.tsx`. The choreography, the readiness
contract and the escape path are documented in the file. Two points worth
repeating here:

**It represents app readiness, not page assets.** Hydration plus
`document.fonts.ready`, raced against `maximumDisplayMs`. It does not wait for
the hero video, and it cannot be held open by a slow image.

**The title belongs to the hero, not to the loader.** A title inside the loader
followed by the hero's own title would make the visitor watch the same word
arrive twice. The loader calls `markStageReady()` as it begins to dissolve, and
the hero's `TitleReveal` is listening — so THE KANJO rises through the last of
the fade. `whenStageReady()` **always** resolves, on a 12-second backstop if the
loader never reports, so a crashed loader cannot leave the page mid-animation.

---

## Testing it

`scripts/check-motion.mjs`. Playwright is deliberately not a dependency; run it
against a production build from a throwaway directory:

```
npm run build && npm start &
cd /tmp && npm init -y && npm i playwright && npx playwright install chromium --only-shell
BASE=http://localhost:3000 node <path-to>/scripts/check-motion.mjs
```

It checks, at every width in the test matrix: that the loader is present at
first paint, that both cars move **independently** and actually trade position,
that the loader disposes and unlocks, that **nothing is left invisible** after
scrolling, that there is no horizontal overflow and no console error — then
reduced motion, the maximum-display escape path with readiness blocked,
client-side navigation round trips, and request duplication.

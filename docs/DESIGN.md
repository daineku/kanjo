# Design: where every value comes from

The Kanjo already has a design language. It lives in the game repository as a
canon — token files, component specs, layout rules, font sources and a
validator. So this site was **transcribed**, not designed.

Source of truth:
`~/Documents/Personal/TheKanjoProject/TheKanjo/UI_Canon/`, plus the runtime that
consumes it at `Assets/TheKanjo/Scripts/Runtime/UI/`, plus the Figma exports in
`TheKanjoProject/FIGMA/`.

Everything below is cited to its source file. `app/globals.css` carries the same
citations inline.

## Tokens

| Token | Value | Canon source |
|---|---|---|
| background | `#000003` | `Tokens/colors.json` |
| panel | `#242425` @ `0.1` | `colors.json` + `opacity.json` panelFill |
| panelSelected | `#333333` @ `0.1` | same |
| accent / warning | `#E84A4A` | `colors.json` |
| positive | `#34C759` | `colors.json` |
| positiveBright | `#7DFF68` | `colors.json` |
| divider | `#242425` | `colors.json` |
| text primary / secondary / disabled | `#FFFFFF` / 50% / 25% | `colors.json`, `opacity.json` |
| scrim | `0.72` | `opacity.json` |
| spacing xs…xl | 4 / 8 / 14 / 24 / 32 | `spacing.json` |
| screen safe | 48 | `spacing.json` |
| panel padding | 25 | `spacing.json` |
| nav card | 216.588 × 95.308 | `Components/navigation_button.json` |
| nav card gap | 21.515 | `spacing.json` |
| wedge band height | 37.1543 | `Assets/Panels/navigation_wedge.svg` |
| divider width | 2.869 | `Tokens/borders.json` |
| control radius | **0** | `borders.json` |
| touch target min | 44 | `borders.json` |
| focus / selection | 90ms ease-out | `Tokens/motion.json` |
| modal in / out | 120ms / 100ms | `motion.json` |

Reference resolution for every pixel figure is 1920×1080
(`spacing.json` `referenceResolution`).

## Typography

`Tokens/typography.json` names three families, all SIL OFL 1.1, pinned by the
canon to `google/fonts` commit `ec626514f79f831f1ab848a82114a0ce7e2d6372`:

- **display** — Big Shoulders Display, ExtraBold (800)
- **technical** — Iceland, Regular (400)
- **alternate** — Iceberg, Regular (400)

The same binaries are served from `/public/fonts`, with their unmodified licence
texts in `/public/fonts/licenses/`.

Each canon style maps to one class in `globals.css`:

| Canon style | Class | Spec |
|---|---|---|
| `navigationTitle` | `.k-nav-title` | display 800, 24px, tracking 1.8 |
| `navigationSubtitle` | `.k-nav-subtitle` | technical, 16px, tracking 1.2 |
| `body` / `aboutBody` | `.k-body` | technical, 18px |
| `smallLabel` | `.k-small` | technical, 14px, tracking 1.2 |
| `moneyValue` / `levelValue` | `.k-value` | display 800, 36px |
| `actionLabel` / `modalTitle` | `.k-action` | display 800, 18px |
| `serviceItemTitle` | `.k-item-title` | display 800, 18px, tracking 1.35 |

## The wedge card

The canon's `navigation_button` and its `service_item` are one component, which
is how the runtime implements it too (`KanjoUiWedgeCard.cs`, whose header
explains why: same rect, same two labels, same band, same rule, and the
reference screenshots are pixel-alike but for the copy).

Construction: a panel fill, a top band at 37.1543 of a 95.308 card, a left rule
at the divider width, the title **inside** the band, the subtitle below it.

State colours follow the **runtime**, not the canon's instance JSON:

| State | Edge colour |
|---|---|
| normal | `divider` #242425 |
| selected | `positive` #34C759 |
| hover / keyboard focus | `positiveBright` #7DFF68 + selected panel fill |
| pressed | `positiveBright` |
| disabled | composited toward the background at 0.25 |

`KanjoUiWedgeCard.cs` documents a three-way disagreement here — the instance
JSON tags the selected item `accent`, and `navigation_wedge_selected.svg` is
filled `#242425`, while all six reference screenshots draw it green. The runtime
resolved it in favour of the screenshots, on the grounds that rendering
selection in accent red "would contradict every reference image in the package".
This site follows that resolution. **Accent red is warning and settings-label
only; it is not the selection colour.**

Hover and focus are applied *on top of* selection, not instead of it, so an item
you have arrowed onto does not stop looking chosen — the runtime's `SetFocused`
says exactly this.

## Navigation

The game's navigation is a horizontally-scrolling strip
(`Components/bottom_navigation_strip.json`: `anchorIntent: bottom-center`,
`clip: true`, ~4 items visible at the reference width).

So the header nav is that strip at a header's band height, and **the narrow
layout is the same strip, scrolling** — no hamburger drawer, no toggle state, no
focus trap. That is both the game's answer and a better one for a phone.

## The framed slot

`Assets/Vectors/profile_frame_corner_*.svg` is a 9×9 L with a 2px accent stroke.
The reference screenshots place all four around an image slot, filled or empty.
It is the game's own way of saying "content goes here", which makes it the right
treatment for media this site does not have yet — `PendingSlot` in
`components/kanjo/Frame.tsx`.

## Layout

The canon's `about_panel` is 928px wide and its nav strip is 930.897px, both
centred on a 1920px stage. So **~930px is the game's own reading column**, and it
also lands on a 65–75 character measure. `--k-content: 930px`.

`--k-content-wide: 1440px` is for media grids only.

## Motion

`Tokens/motion.json` is the whole motion budget: 90ms for focus and selection,
120/100ms for a modal, ease-out. It declares
`reducedMotionSupported: true`, honoured by a `prefers-reduced-motion` block
that collapses every transition and reveal to its end state.

No parallax, no scroll hijacking, no reveal-on-every-element.

## Canonical extensions

Four values the canon does not state, marked as such in `globals.css`. The canon
uses the same classification for its own tunable defaults.

1. **`--k-text-tertiary` (34%)** — a third text step. The canon has two (opaque,
   50%); long-form web copy needs a rank between "label" and "body" for
   de-emphasised metadata without reaching for disabled.
2. **`.k-hero-title`** — the canon's largest style is 36px (`moneyValue`), which
   is a HUD figure, not a page heading. Same family and weight, tracking held at
   0 as every display value above 24px does.
3. **`.k-section-title`** — one rank below the hero.
4. **The `clamp()` floors.** The canon computes a single uniform scale from the
   protected design area (`Responsive/layout_rules.md`), which a document-flow
   page cannot do. Its own rule — "content viewports scroll before typography
   shrinks" — is why the floors stay legible rather than scaling to fit.

## Responsive

`Responsive/aspect_ratio_rules.md` says a viewport "narrower than supported"
takes a "product-approved alternate composition", and the mobile-wide rule is to
fit the safe height, reduce viewport capacity, and preserve touch targets.

Applied: the hero's height floor is dropped below 768px. Bottom-anchoring a 16:9
composition on a 9:19.5 phone left ~350px of empty field above the title at
390×844 — measured, not assumed. The type, the wedge cards and the scrolling
strip carry the identity at every width.

Verified with no horizontal overflow at 1920, 1440, 1024, 768, 430, 390 and 360
across all four routes.

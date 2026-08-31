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

**The narrow layout is the same strip, scrolling** — no hamburger drawer, no
toggle state, no focus trap. That is both the game's answer and a better one for
a phone.

The header ITEM, though, is not the card at a smaller size — see deviation D2.
It is the label and the rule, because a card whose band fills its whole height is
a solid chip with no band/body relationship left, and reads as a generic web
button. The rule carries all four states:

| State | Rule colour |
|---|---|
| normal | `divider` #242425 |
| selected (current page) | `positive` #34C759, plus `aria-current="page"` |
| hover | `positiveBright` #7DFF68 |
| keyboard focus | `positiveBright` #7DFF68, on top of selection |

A fragment href (`/#media`) never takes the selected treatment. Resolving one to
its path made GAME, MEDIA and ABOUT all "current" on the landing page — four
green items where the game shows exactly one.

## The framed slot

`Assets/Vectors/profile_frame_corner_*.svg` is a 9×9 L with a 2px accent stroke.
The reference screenshots place all four around an image slot, filled or empty.
It is the game's own way of saying "content goes here", which makes it the right
treatment for media this site does not have yet — `MediaPlate` in
`components/kanjo/MediaPlate.tsx`.

**The brackets keep their 9×9 geometry regardless of plate size, and they are
inset off the edge.** Scaling them with the plate was the first version's
mistake: at the canon's own ~200px portrait scale four marks read as a frame, but
on a 930×523 video plate they sit 930px apart and read as four unrelated ticks in
a void. A plate therefore also carries a panel fill and a divider edge, which is
what actually communicates the footprint, plus a label placed bottom-left like a
slate rather than floating dead-centre.

They are **not** used on a full-bleed layer such as the hero: there the four
marks land at the viewport corners and read as a HUD overlay on the whole page
rather than as a media slot.

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

## Deviations from the canon, and why

Every entry is a place where this site does **not** do what the canon literally
says. Each needs a web-specific reason; a deviation without one is drift.

| # | Canon says | Site does | Web-specific reason |
|---|---|---|---|
| D1 | `MainMenu` anchors its nav strip **bottom-centre** | Header nav at the top | A web page's navigation must be reachable before the content, and a bottom-fixed bar over a scrolling document is a mobile-app pattern. The strip's overflow behaviour is kept. |
| D2 | `navigation_button` is a **216.588 x 95.308 card** with a 37.1543 band | The header item is a **label plus a rule** — no band, no fill | A header row cannot host a 95px card, and a *collapsed* card is not a quieter card: with band height equal to card height it becomes a solid filled chip that reads as a generic web button (measured 82x30 with a 30px band). The label and the rule are the part of the vocabulary that survives at 44px. The full card is still used where a card belongs — hero actions, link blocks, article rows. |
| D3 | `bottom_navigation_strip` **clips** and scrolls horizontally | Hero actions **wrap** below 768px | Correct in the game, where the strip is a known input surface with a focus model. On a web page it hid half a CTA behind a viewport edge with no affordance — measured at 390px, "FOLLOW DEVE" was cut off — and a visitor has no reason to suspect a horizontal scroll. The header nav still scrolls, because those items are short and all four fit. |
| D4 | Groups are **centred** on the 1920 stage | One **left spine** for every section | A stage composes around a fixed centre; a document scrolls. Mixing centred and flush blocks put section headings on two left edges 207px apart, so the page visibly wandered as it scrolled. One spine is the document-flow equivalent of the canon's single composed axis. |
| D5 | `borders.json` `divider.width` is **2.869** | Section separators use the **1px** `thin` width | Both are canon values. 2.869 is reserved for the spine — a card's left rule, the hero status mark — so a full-width separator uses `thin`, keeping one meaning per weight. |
| D6 | Black background in every reference screenshot | Hero reserves a **media layer with a `dim` treatment** | **Not a deviation** — it is the canon read correctly. `layout.json` names the black `figma_placeholder_black`, sets `mandatoryProductionBackground: false`, and gives `defaultTreatment.mode: "dim"`. Reproducing the black *was* the deviation, and it is fixed. |
| D7 | Emphasis is unavailable (Iceland is single-weight) | `**bold**` renders in `positiveBright` | With body copy correctly opaque, neither weight nor opacity is available for emphasis. Green is already this design's "this one" signal, so it carries emphasis rather than introducing a new value. |
| D8 | `U+00A9` exists; `U+2026` / `U+2190` are conventional | Footer drops `(c)`; excerpts use three periods; back link uses a guillemet | Iceland has no `U+2026`/`U+2190` in its cmap and draws `U+00A9` as a hollow square. A missing glyph falls through to another typeface mid-string. Verified by reading the font, not assumed. |

### Corrected in this pass — these were drift, not deviations

- **Body opacity.** `typography.json` gives `body` and `aboutBody` colour
  `textPrimary` at opacity `opaque`, reserving `secondaryText` (0.5) for
  `smallLabel` and `navigationSubtitle`. Every paragraph and article body was
  rendering at 50%. Now opaque.
- **Nav label opacity.** Every nav card in the game shows a white title;
  selection is carried by the wedge and the rule. Unselected labels had been
  dimmed to 50%, inventing a hierarchy the canon does not have.

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

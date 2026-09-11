# Implementation Plan — Structural Light Mode (Path A) + Graphite Chrome & Shapes

Two independent deliverables. Part 1 (light mode) is the higher-value, higher-risk
refactor. Part 2 (Graphite) is additive and low-risk. They can ship separately;
build Part 2 first if you want a quick win, or Part 1 first for the bigger payoff.

---

## Guiding principle (why the current light mode reads as "reskinned dark")

`data-vle-mode='light'` is set on `<html>` in `applyTheme` (theme.ts) but **zero
CSS rules key off it** (confirmed: 0 matches in styles.ts). Light mode today is a
palette swap only. Meanwhile styles.ts hardcodes:

- **49 `rgba(0,0,0,…)`** shadows/scrims (drop shadows, overlay gradients, modal backdrop)
- **~55 accent glow shadows** (`box-shadow:0 0 Npx rgba(var(--vg-rgb),…)`)
- **gold-tinted borders everywhere** (`rgba(var(--vg-rgb),.26)`)

A black drop-shadow reads as depth on dark, as *dirt* on white. A glow reads as
elevation on dark, as *smudge* on white. Gold-at-low-alpha reads as a hairline on
near-black, as a *muddy tan smear* on paper. So the fix is **mode-aware elevation
tokens**, not more skins.

---

# PART 1 — Structural Light Layer

## A. Introduce mode-aware elevation tokens (styles.ts `:root`)

Add a token block to the existing `:root` theme-token rule. Define for **dark**
(current values), then override the same names under `html[data-vle-mode='light']`.

Tokens (names are proposals; keep the `--v-` prefix convention):

| token | dark value (current behaviour) | light value (new) |
|---|---|---|
| `--v-shadow-card` | `0 8px 26px rgba(0,0,0,.35)` | `0 1px 2px rgba(40,30,15,.10),0 6px 18px rgba(40,30,15,.07)` |
| `--v-shadow-pop` | `0 18px 50px rgba(0,0,0,.5)` | `0 4px 10px rgba(40,30,15,.10),0 18px 44px rgba(40,30,15,.12)` |
| `--v-shadow-hover` | `0 8px 26px rgba(0,0,0,.35)` | `0 3px 10px rgba(40,30,15,.14)` |
| `--v-glow` | `0 0 10px rgba(var(--vg-rgb),.4)` | `none` |
| `--v-glow-strong` | `0 0 22px rgba(var(--vg-rgb),.22)` | `none` |
| `--v-scrim` | `rgba(8,7,5,.6)` | `rgba(40,40,50,.28)` |
| `--v-border-color` | `rgba(var(--vg-rgb),.26)` | `rgba(var(--vi-rgb),.14)` |
| `--v-border-strong` | `rgba(var(--vg-rgb),.5)` | `rgba(var(--vi-rgb),.28)` |
| `--v-page-tint` | `transparent` | `rgba(0,0,0,.03)` (page a notch darker than cards) |

Two prerequisites:
- Add `--vi-rgb` (ink as `r,g,b`) in `applyTheme` alongside the existing
  `--vg-rgb`/`--vg2-rgb` (theme.ts `set()`), so light borders can be ink-tinted.
  Use the existing `hexToRgb` helper. Ink may be a hex in skins (it is), so this
  is a one-line add.
- The light override block is a single new rule:
  `html[data-vle-mode='light']{--v-shadow-card:…;--v-glow:none;…}`.

## B. Refactor hardcoded darks/glows to the tokens

Mechanical pass over styles.ts. Map the ~49 `rgba(0,0,0,…)` + ~55 glows:

1. **Drop shadows** (`0 Ypx Npx rgba(0,0,0,…)`) → `var(--v-shadow-card)` /
   `--v-shadow-pop` by magnitude. Card-level → card; frame/modal-level → pop.
2. **Accent glows** (`0 0 Npx rgba(var(--vg-rgb),…)`) → `var(--v-glow)` /
   `--v-glow-strong`. In dark these keep today's look; in light they resolve to
   `none`.
3. **Modal backdrop / scrims** (`rgba(8,7,5,.6)`, overlay gradients) → `--v-scrim`.
4. **Borders** `rgba(var(--vg-rgb),.26|.5)` on structural surfaces (frame, card,
   modal, inputs) → `--v-border-color` / `--v-border-strong`. **Do NOT** convert
   accent borders on *active/selected/on* states — those SHOULD stay gold in both
   modes (that's where the accent belongs).

Discipline: this is a large but low-logic diff. Do it per component region
(frame → cards → modal → tabs → graph/diary) and keep gold accents on
active/hover/selected states. A `git grep 'rgba(0,0,0'` sweep at the end must
return only intentional survivors (e.g. photo-overlay gradients in the diary hero
that are meant to darken an image in both modes — leave those).

## C. Chrome-specific frame shadows (styles.ts lines ~941–973, 1761–1953)

Each chrome's `.vlf-frame` / `.vlfm` has a bespoke glow+shadow. These are the
"floats in a dark room" look. Under light mode they must flatten. Two options:

- **Preferred:** wrap the *glow* portions in the tokens (`--v-glow-strong`) so
  they self-disable in light, and route the `rgba(0,0,0,…)` portion through
  `--v-shadow-pop`. Keeps each chrome's dark identity, flattens in light.
- Add per-chrome light overrides only where a chrome needs a distinct light frame
  (e.g. Gatsby's gilt double-border should stay; its `rgba(0,0,0,.7)` glow drops).

## D. Texture, translucency & blur gating (styles.ts + theme.ts)

Under `html[data-vle-mode='light']`:
- **Blur → ~0** and **surface opacity → opaque.** Light skins already use ~.9
  alpha; on light there's no glowing bg to reveal, so translucency just muddies
  contrast. Add `html[data-vle-mode='light'] .vlf-tex{opacity:1}` and neutralize
  `--vblur` influence on light (or set a `--v-blur-eff` token: `var(--vblur)` dark,
  `0px` light, used by the frame/modal backdrop-filter).
- **Textures:** the noise/parchment SVGs are tuned dark. Either (a) reduce their
  opacity under light via a `html[data-vle-mode='light'] .vlf-tex::after{opacity:…}`
  hook, or (b) accept slightly different texture weight in light for v1 and refine
  per-texture later. Recommend (a) as a single global dial for v1.

## E. Motion backgrounds (Ember/Faewild/starfall + petals)

Luminous-on-dark particles are invisible or smudgy on light. Gate the animated
layers on mode: `html[data-vle-mode='light'] [data-vle-chrome='ember'] .<particles>{opacity:…}`
or switch their color to an ink-tinted equivalent. For v1, the safe move is to
**fade particle layers down** under light (they're decorative). This composes with
the existing motion kill-switch (`data-vle-motion`), so respect both.

## F. Verification (Part 1)

- Build + typecheck clean.
- Visual: for EACH chrome, flip dark↔light and confirm: cards cast a soft grey
  shadow (not a glow), borders are crisp neutral hairlines (not tan), the page is
  a hair darker than the cards (elevation reads upward), no black smudges, modal
  backdrop is a light scrim.
- Regression: dark mode must be **byte-identical** to today. The tokens' dark
  values equal the literals they replace, so a dark screenshot diff should be
  empty. This is the key safety check — spot it early.
- `data-vle-motion='off'` still kills motion; light mode additionally fades
  particles.

**Risk:** the token refactor touches ~100 shadow/border sites. Risk is a missed
site (a stray black shadow in light) or an over-converted accent border (a gold
active-state going neutral). Mitigate by doing it per-region with a dark-diff
after each region, and a final `rgba(0,0,0` grep.

---

# PART 2 — Graphite Chrome + 6 Card Shapes

Additive, mirrors exactly how Gatsby/Sumi were added. No refactor.

## G. Six new shapes (theme.ts + styles.ts)

All follow the geometry-only model (radius/border/clip/mask/padding + one padding
-anchored pseudo). Add to `ShapeId` union, `SHAPE_IDS` array, `SHAPE_GEOM`, and a
`shapeDetail` pseudo where noted. Requested set: **rail-cap, gauge, screw-tab,
track, spec-frame, chamfer-bar.**

`SHAPE_GEOM` bodies (engineer's-desk vocabulary, distinct from all 24 existing):

- **rail-cap** — `border-radius:calc(${R} * .3);padding:15px 13px 11px` + `::before`
  thin top registration rail inset in the reserved top padding. Distinct from
  `slab`/`bracket`.
- **gauge** — `border-radius:0 ${R} ${R} 0;border-left-width:3px;padding-left:20px`
  + `::before` a segmented instrument tick-scale down the left edge (repeating
  linear-gradient in the left padding). Distinct from `binding` (round holes) and
  `left-spine` (plain rail).
- **screw-tab** — `border-radius:${R};padding:12px 14px` + `::before`/`::after`
  corner fastener screw-heads (slotted). Distinct from `studs` (plain dots). NOTE:
  needs both pseudos → **cannot be used on the `secrets` surface** (owns its own
  pseudos), same limitation as existing ornamented shapes; secrets isn't a
  customizable surface anyway.
- **track** — `border-radius:calc(${R} * .3);padding-bottom:14px` + `::after` a
  segmented progress/completion tick-track along the bottom edge (repeating grad
  in the reserved bottom padding). Distinct from `marquee` (dotted top+bottom) and
  `scallop-deco` (scalloped mask).
- **spec-frame** — `border-radius:calc(${R} * .3);padding:13px 15px;box-shadow:
  inset 0 0 0 1px var(--v-border-color),inset 0 0 0 4px transparent` — a technical
  double-keyline inset frame. Distinct from `inset` (single keyline) and
  `gilt-edge`. Uses the light-mode token from Part 1 so it reads in both modes
  (if Part 2 ships before Part 1, hardcode `rgba(var(--vg-rgb),.18)` and revisit).
- **chamfer-bar** — `clip-path:polygon(14px 0,100% 0,100% calc(100% - 14px),
  calc(100% - 14px) 100%,0 100%,0 14px)` — a single 45° machined chamfer on two
  diagonal corners. Distinct from `notched` (all four corners). **Add to
  `CLIP_SHAPES`** for the rounded-slab fallback on old UAs.

Fallbacks: only `chamfer-bar` needs `CLIP_SHAPES`. None use masks, so no
`MASK_SHAPES` change. The rest are radius/padding/pseudo only.

## H. Graphite chrome (theme.ts)

1. `Chrome` union: add `'graphite'`. Update the `CHROMES` runtime array (used by
   `sanitize`).
2. `CHROME_SHAPES`: add a `graphite` row mapping the 6 surfaces to the new shapes,
   e.g. `{ present:'rail-cap', bonds:'spec-frame', cast:'screw-tab', beats:'gauge',
   factions:'chamfer-bar', items:'track' }`.
3. `SKINS`: add two skins — `graphite` (dark: `#5b8fb0` steel-blue on
   `#30353a`/`#262a2f`, ink `#d4dce4`/`#8a9eb2`) and `graphite-light` (light twin:
   steel-blue accent, `#f2f4f6`/`#e6eaee` surfaces, `#20242a` ink). Use the mockup
   palette (masculine-chromes.html Graphite section).
4. `MODES`: add the `graphite` mode — `patch:{ chrome:'graphite', radius:4,
   border:1, texture:'', serif:F_SANS, accent:'#5b8fb0' }`, `form:'dashboard'`,
   `skinDark:'graphite'`, `skinLight:'graphite-light'`. Font: Graphite reads as
   grotesk; F_SANS (Inter) is the closest bundled stack — no Google font needed,
   unlike Gatsby/Sumi.
5. Chrome-specific frame CSS (styles.ts, alongside the other
   `[data-vle-chrome='…'] .vlf-frame` rules): a clean machined frame — 4px radius,
   neutral steel border, `var(--v-shadow-card)`, NO glow (Graphite is deliberately
   flat/instrument, not luminous). This also means it looks correct in light mode
   for free once Part 1 lands.

## I. Verification (Part 2)

- Build + typecheck clean; `ShapeId`/`SHAPE_IDS`/`SHAPE_GEOM`/`CHROME_SHAPES`
  stay in sync (tsc enforces the `Record<Chrome,…>`/`Record<Surface,…>` shape, so
  a missing key is a compile error — rely on that).
- Existing `theme.test.ts` will flag the new chrome/surface matrix; extend its
  assertions for `graphite` (mirror how gatsby/sumi are asserted).
- Customizer: the 6 new shapes appear in the per-surface shape dropdown
  automatically (it iterates `SHAPE_IDS`). Verify each renders on the actual card
  row without clipping content (they reserve padding by design).
- Pick the Graphite mode: cards reshape, steel-blue accent applies, flat frame,
  and (post-Part-1) a clean light twin.
- Old UA fallback: `chamfer-bar` degrades to rounded slab.

---

## Sequencing & scope

- **Part 2 alone** is safe and quick (additive, no refactor) — ship first for a
  visible win. Its `spec-frame` shape wants the Part-1 `--v-border-color` token;
  hardcode a dark value if shipping Part 2 first, then swap to the token in Part 1.
- **Part 1** is the real fix and the larger diff. Do it per-region with a
  dark-screenshot-diff safety check after each region to guarantee dark mode is
  unchanged.
- The two parts share one seam: the elevation tokens. Graphite's flat frame and
  `spec-frame` both benefit from them, so if both ship, land Part 1's token block
  first, then Graphite consumes it.

## Files touched

- `src/ui/theme.ts` — `Chrome` union, `CHROMES`, `CHROME_SHAPES`, `SKINS`,
  `MODES`, `ShapeId`, `SHAPE_IDS`; `applyTheme` add `--vi-rgb`.
- `src/ui/styles.ts` — elevation token block + light override; ~100-site shadow/
  border/glow refactor; blur/opacity/texture/motion light gating; 6 `SHAPE_GEOM`
  entries + `shapeDetail` pseudos + `CLIP_SHAPES` add; Graphite chrome frame CSS.
- `test/theme.test.ts` — extend chrome/skin/shape assertions for graphite + the
  6 shapes.
- No schema, no backend, no reducer. Presentation-only, consistent with the
  theme engine's stated "customization is presentation-only and safe" invariant.

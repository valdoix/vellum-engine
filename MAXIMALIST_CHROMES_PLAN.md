# Maximalist Chromes Implementation Plan — Arcade · Riot · Grimoire · Bestiary

Add **four** new maximalist chromes to the VELLUM theme system, each with its **own
unique card-shape family** and **heavy, chrome-scoped animation**. This follows the
exact seam set used to add Gatsby/Sumi/Graphite (see `NEW_CHROMES_SUMMARY.md`): all
additions are CSS + declarative data, no core/reducer/lifecycle changes.

Scope note: Carnival and Prism (from the mockup) are intentionally **out of scope**.
The visual language for all four is already prototyped and browser-verified in
`mockups/new-chromes.html` — that file is the visual source of truth; this plan ports
it into the real engine and adds motion + per-surface shapes it can't express.

---

## 1. Design summary (one block per chrome)

### ARCADE — 80s CRT / arcade cabinet
- **Palette** (from mockup): accent `#ff2ea6` (hot pink), accent2 `#2ef0ff` (cyan),
  pos `#2bff88`, neg `#ff2e5e`, warn `#ffe23a`, info `#2ef0ff`, ink `#f4eaff`,
  ink2 `#b79fd0`, dark surfaces `#17101f`/`#0e0916`.
- **Font**: `F_ARCADE` = `'Press Start 2P',ui-monospace,monospace` for display; body
  falls back to mono. Loaded on demand (Google), like Gatsby/Sumi.
- **Texture**: `scanline` (new) — horizontal CRT scanline SVG.
- **Radius/border**: radius 3, border 2. `opacity` 1, `blur` 6.
- **Shapes** (family: hard/beveled/pixel): present `arcade-btn`, bonds `crt-screen`,
  cast `pixel-step`, beats `coin-slot`, factions `scanline-inset`, items `cab-bracket`.
- **Motion**: CRT scanline sweep, neon flicker on titlebar + section heads, chromatic-
  aberration jitter on card keylines, attract-mode pulse on the active tab, animated
  neon gradient on the frame border, blinking coin-slot.

### RIOT — DIY punk zine collage
- **Palette**: accent `#e8ff2e` (acid yellow), accent2 `#c400ff` (violet), ink
  `#101014`, pos `#00c853`, neg `#ff1744`, warn `#ff9100`, info `#2979ff`, paper
  `#ececdf` (light field even in dark skin — zine is paper-on-ink).
- **Font**: `F_ZINE` = `'Anton','Oswald',Impact,sans-serif` display; `'Oswald'` for
  data. Google on demand.
- **Texture**: `halftone` (new) — offset halftone dot SVG.
- **Radius/border**: radius 0, border 3. `opacity` 1, `blur` 0.
- **Shapes** (family: torn/taped/xerox): present `taped`, bonds `torn-edge`, cast
  `sticker`, beats `staple`, factions `marker-box`, items `ransom-cut`.
- **Motion**: fast `steps()` xerox jitter on cards (glitch), halftone drift on the
  background, tape-corner flutter, strobe flicker on accent headers, marquee scroll on
  the titlebar, a small shake on card hover.

### GRIMOIRE — the living spellbook
- **Palette**: accent `#a24cff` (arcane violet), accent2 `#2fd48f` (emerald), ink
  `#ece2ff`, ink2 `#a98fd0`, pos `#2fd48f`, neg `#ff5c6a`, warn `#ffcf5a` (gilt), info
  `#6ab8ff`, surfaces `rgba(38,26,58,.72)`/`rgba(24,16,40,.72)`.
- **Font**: `F_ARCANE` = `'Cinzel Decorative','Cinzel',Georgia,serif` display. NOTE:
  `Cinzel` 700 is already **bundled** in `fonts.ts`; `Cinzel Decorative` is not, so it
  loads on demand (Google), matching the Gatsby/Sumi precedent.
- **Texture**: `constellation` (new) — sigil lines + scattered gold/violet stars.
- **Radius/border**: radius 12, border 1. `opacity` 0.92, `blur` 10.
- **Shapes** (family: illuminated/arcane): present `dropcap`, bonds `sigil-seal`, cast
  `reliquary`, beats `scroll-end`, factions `rune-spine`, items `grimoire-clasp`.
- **Motion**: drifting arcane motes (violet/emerald firefly layer, ported from the
  ember pattern), rune shimmer on section heads, gild shimmer on the drop-cap, slow
  rotation on sigil seals, flowing magic gradient in tension bars, pulsing arcane halo
  on avatars, page-turn fade-in on cards.

### BESTIARY — maximalist illuminated menagerie
- **Palette**: accent `#c8a24e` (gilt), accent2 `#a3243a` (crimson), plus royal
  `#2f4a9a`; ink `#2a1c0e`, ink2 `#6a5638`, vellum field `#f3e6c4`, pos `#3f7a3a`, neg
  `#a3243a`, warn `#5a3a8a`, info `#2f5a8a`. (Light-led; dark twin is "candlelit".)
- **Font**: `F_UNCIAL` = `'MedievalSharp','UnifrakturCook',Georgia,serif` display.
  Google on demand.
- **Texture**: `bestiary-vines` (new) — dense acanthus-vine + gold-dot marginalia
  (busier than the existing hairline `pressed-flowers`).
- **Radius/border**: radius 4, border 2. `opacity` 1, `blur` 4.
- **Shapes** (family: vine/heraldic): present `vine-frame`, bonds `beast-corner`, cast
  `illumination`, beats `banner`, factions `heraldic-shield`, items `manuscript-rule`.
- **Motion** (denser-static leaning, but still lively per the maximalist brief): gold-
  leaf shimmer on illuminated frames, vine "grow" (scaleY) on card entrance, subtle
  candlelight brightness flicker on the surface, marginalia beast bob, rubric drop-cap
  shimmer.

---

## 2. New card-shape vocabulary (24 shapes, 6 unique per chrome)

Every shape obeys the v4 discipline in `styles.ts` (lines 17–94): express the
silhouette as **EDGE / CORNER / FRAME / MASKED-EDGE**, never a full-bleed polygon that
clips content; keep the defining detail in **reserved padding** via a `::before`/
`::after` pseudo (emitted through `shapeDetail()`), so a wide row never clips text.

Each shape is added to **three** places, all in `styles.ts`/`theme.ts`:
1. `SHAPE_GEOM` (geometry-only body) in `styles.ts`.
2. `SHAPE_IDS` + the `ShapeId` union in `theme.ts` (compiler-enforced).
3. `shapeDetail(id, decl, pseudo)` calls in `styles.ts` for the pseudo ornament (for
   shapes that have one). `clip-path` shapes also join `CLIP_SHAPES`; `mask` shapes
   join `MASK_SHAPES` (so old-UA fallbacks are emitted).

### ARCADE shapes
| id | family | geometry approach | detail pseudo |
|----|--------|-------------------|---------------|
| `arcade-btn` | EDGE | `border-radius:4px` + hard offset shadow (`box-shadow:0 3px 0` accent, `inset 0 -3px 0` shade) → pressable button read | none |
| `crt-screen` | EDGE | big barrel radius `calc(R*2)` + `inset 0 0 24px` vignette | none |
| `pixel-step` | CORNER (clip) | stepped 8-bit corners via `clip-path:polygon(...)`; **add to `CLIP_SHAPES`** | none |
| `coin-slot` | CORNER | `padding-top:16px`; `::before` draws a horizontal coin-slot bar in the top pad | `::before` |
| `scanline-inset` | FRAME | `padding:11px 13px`; `::before` inset keyline with a repeating-linear-gradient scanline fill | `::before` |
| `cab-bracket` | END-BRACKET | `padding:10px 16px`; `::before`/`::after` chunky `[ ]` end brackets | `::before`+`::after` |

### RIOT shapes
| id | family | geometry approach | detail pseudo |
|----|--------|-------------------|---------------|
| `taped` | CORNER | `padding-top:14px`; `::before` a rotated tape strip in the top pad | `::before` |
| `torn-edge` | MASKED-EDGE | ragged bottom via `mask` (irregular radial steps); `padding-bottom`; **add to `MASK_SHAPES`** | none |
| `sticker` | EDGE | thick `border` + `border-radius:2px` + offset hard shadow (die-cut sticker) | none |
| `staple` | CORNER | `padding-top:13px`; `::before` two staple ticks top corners | `::before` |
| `marker-box` | FRAME | `padding:12px 14px`; `::before` a hand-drawn double offset marker rectangle | `::before` |
| `ransom-cut` | CORNER (clip) | irregular ransom-note notches via `clip-path`; **add to `CLIP_SHAPES`** | none |

### GRIMOIRE shapes
| id | family | geometry approach | detail pseudo |
|----|--------|-------------------|---------------|
| `dropcap` | CORNER | `padding-left:20px;padding-top:6px`; `::before` an illuminated initial block in the top-left pad (gild bg + glow) | `::before` |
| `sigil-seal` | CORNER | `padding-top:14px`; `::after` an arcane sigil wax seal in the top-right corner | `::after` |
| `reliquary` | FRAME | `padding:13px 15px`; `::before` a gilded double keyline (inset frame) | `::before` |
| `scroll-end` | MASKED-EDGE | curled scroll top+bottom via `mask` roll; V padding; **add to `MASK_SHAPES`** | none |
| `rune-spine` | LEFT-EDGE | `border-left-width:3px;padding-left:20px`; `::before` runic glyph ticks down the left | `::before` |
| `grimoire-clasp` | RIGHT-EDGE | `padding-right:18px`; `::after` a book-clasp bracket on the right edge | `::after` |

### BESTIARY shapes
| id | family | geometry approach | detail pseudo |
|----|--------|-------------------|---------------|
| `vine-frame` | CORNER | `padding:12px 14px`; `::before`+`::after` acanthus vine sprigs in two corners | `::before`+`::after` |
| `beast-corner` | CORNER | `padding-top:13px`; `::after` a marginalia beast glyph sprig | `::after` |
| `illumination` | FRAME | `padding:13px 15px`; `::before` a gold-leaf double keyline | `::before` |
| `banner` | MASKED-EDGE | pennant notched bottom via `mask` (V-cut); `padding-bottom`; **add to `MASK_SHAPES`** | none |
| `heraldic-shield` | MASKED-EDGE | shield point notch bottom-center via `mask`; `padding-bottom`; **add to `MASK_SHAPES`** | none |
| `manuscript-rule` | LEFT-EDGE | `border-left-width:3px;padding-left:20px`; `::before` a rubricated paragraph mark (¶) | `::before` |

> Decision point: 24 new shapes roughly triples the shape vocabulary (30 → 54). This is
> the literal reading of "make card shapes unique to each." If a smaller surface area is
> preferred, an alternative is **~3 signature shapes per chrome** (12 new) with the
> remaining surfaces reusing the closest existing survivor (e.g. Arcade beats → existing
> `bracket`). Flag which you want before implementing; the plan below assumes the full 24.

---

## 3. File-by-file changes

### `src/ui/theme.ts`
1. **Font stacks** (near `F_HUD`/`F_DECO`, ~line 59-62): add
   ```ts
   const F_ARCADE = "'Press Start 2P',ui-monospace,monospace";
   const F_ZINE   = "'Anton','Oswald',Impact,sans-serif";
   const F_ARCANE = "'Cinzel Decorative','Cinzel',Georgia,serif";
   const F_UNCIAL = "'MedievalSharp','UnifrakturCook',Georgia,serif";
   ```
2. **`Chrome` type** (line 64): append `| 'arcade' | 'riot' | 'grimoire' | 'bestiary'`.
3. **`ShapeId` type** (lines 85-90): append the 24 new ids.
4. **`SHAPE_IDS`** (line 95): append the same 24 (keep the two lists identical — a test
   iterates over `SHAPE_IDS`).
5. **`CHROME_SHAPES`** (line 104): add the four `Record<Surface, ShapeId>` entries from
   §1. `Record<Chrome, …>` makes this compiler-enforced.
6. **`MODES`** (line 176): add four `Mode` objects. Example (Arcade):
   ```ts
   { id: 'arcade', name: 'Arcade', blurb: 'Insert coin \u2014 hot pink &amp; cyan on black, CRT scanlines, arcade-button cards.',
     patch: { chrome: 'arcade', radius: 3, border: 2, texture: 'scanline', serif: F_ARCADE, accent: '#ff2ea6', accent2: '#2ef0ff', opacity: 1, blur: 6 },
     form: 'dashboard', skin: 'arcade-crt', skinDark: 'arcade-crt', skinLight: 'arcade-sun' },
   ```
   Riot → `form:'dashboard'`, skins `riot-black`/`riot-paper`, radius 0 border 3
   texture `halftone` serif `F_ZINE` accent `#e8ff2e` accent2 `#c400ff` blur 0.
   Grimoire → skins `grimoire-arcane`/`grimoire-parchment`, radius 12 border 1 texture
   `constellation` serif `F_ARCANE` accent `#a24cff` accent2 `#2fd48f` opacity .92 blur 10.
   Bestiary → skins `bestiary-candlelit`/`bestiary-vellum`, radius 4 border 2 texture
   `bestiary-vines` serif `F_UNCIAL` accent `#c8a24e` accent2 `#a3243a` blur 4.
7. **`SKINS`** (line 214): add 8 skins (dark+light per chrome) with the full `Skin.theme`
   key set (`accent, serif, mono, surf1, surf2, ink, ink2, glass, pos, posInk, neg,
   negInk, info, warn, press, pressInk`). Use `...SEM` then override clash-prone
   semantics, exactly like existing skins. Palettes from §1; the mockup's per-theme
   CSS vars are the reference values.
8. **`CHROMES`** const (line 373): append the four ids (drives `sanitize()`).
9. **`loadGoogleFontsForChrome`** (line 409): add to `fontMap`:
   ```ts
   arcade:   'https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap',
   riot:     'https://fonts.googleapis.com/css2?family=Anton&family=Oswald:wght@500;700&display=swap',
   grimoire: 'https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@700;900&display=swap',
   bestiary: 'https://fonts.googleapis.com/css2?family=MedievalSharp&family=UnifrakturCook:wght@700&display=swap',
   ```
   (Optionally also extend `loadGoogleFontByName`'s whitelist if these families are
   offered in the font picker — not required for the chromes themselves.)
10. **`customizePanel` sketch map** (lines 588-599): add `arcade/riot/grimoire/bestiary`
    entries (`Record<Chrome,string>` forces this). Reuse the `<span class="vle-mode-sk
    sk-<id>"><i></i>…</span>` pattern.

No changes needed to `applyTheme`, `sanitize` (already generic over `CHROMES`),
`setMode`, or persistence — they're all data-driven.

### `src/ui/styles.ts`
1. **`SHAPE_GEOM`** (line 26): add the 24 geometry bodies (geometry only, never color/
   type). Follow the padding-reserve rules noted per shape in §2.
2. **`CLIP_SHAPES`** (line 97): add `pixel-step`, `ransom-cut`.
3. **`MASK_SHAPES`** (line 105): add `torn-edge`, `scroll-end`, `banner`,
   `heraldic-shield`.
4. **`shapeDetail(...)`** block (near line 2072): add pseudo-ornament decls for every
   shape that has a `::before`/`::after` detail in §2. Colors reference the themed vars
   (`--vg`, `--vg2`, `--v-press`, etc.) so each skin recolors them for free.
5. **Four chrome CSS blocks** appended after the Sumi block (~line 2021), each modeled
   on the Ember/Faewild/Gatsby blocks. Per chrome, cover the standard selector set that
   the existing chromes style: `.vle-root`, `.vle-navpanel`, `.vle-head`(+`::before`),
   `.vle-stats`, `.vle-tabbtn`(+`.on`), `.vle-card/.vle-rel-card/.vld-sec/.vld-pc`,
   `.vld-h/.vle-sec-h`(+`::before`), `.vld-hero`, `.vle-av/.vld-pc-av`, tension
   (`.vld-dot`/`.vld-tension`), chips (`.v-chip`), modal (`.vlfm`/`.vlfm-head`), and the
   float shell (`.vlf-frame`/`.vlf-bar`/`.vlf-title`/`.vlf-x`/`.vlf-grip`/`.vlf-launch`).
   Both `.vle-body` (drawer) and `.vlf-body` (float) get the animated fx layers.
6. **Mode-sketch preview CSS** (near line 1463): add `.vle-mode-sk.sk-arcade`,
   `.sk-riot`, `.sk-grimoire`, `.sk-bestiary` mini-swatch rules (tiny gradient + bar
   treatment matching each identity), mirroring the existing `.sk-gatsby` etc.

### `src/ui/onboarding.ts` (optional copy)
Line 188 lists example chromes; optionally mention the new maximalist chromes. Non-functional.

### `mockups/new-chromes.html`
Already contains all four visual references — no change required, but it should be used
to eyeball parity while porting.

---

## 4. Animation specifications (all motion-gated)

**Gating rule (mandatory, per existing convention):** every animated selector needs a
paired kill in both forms:
```
"html[data-vle-chrome='<id>'][data-vle-motion='off'] <sel>{animation:none;<static fallback>}",
"@media (prefers-reduced-motion:reduce){html[data-vle-chrome='<id>'] <sel>{animation:none;<static fallback>}}",
```
Background fx layers pin to `.vle-body::after`/`::before` and `.vlf-body::after`/
`::before` with `pointer-events:none;z-index:0`, and the body's direct children are
lifted to `z-index:1` (copy the Ember/Faewild rule at styles.ts:1908-1911).

### Arcade keyframes
- `vle-arcade-scan` — a scanline bar sweeping top→bottom (`background-position` or
  `translateY` on a `::after` gradient), ~6s linear infinite.
- `vle-arcade-flicker` — neon flicker on `.vlf-title` + `.vld-h::before` via `steps()`
  opacity/text-shadow, ~3s.
- `vle-arcade-aberr` — 1px chromatic-aberration jitter (dual text-shadow / box-shadow
  offset in cyan+magenta) on card keylines, fast steps loop.
- `vle-arcade-attract` — active tab `.on` glow pulse (box-shadow), 1.4s.
- `vle-arcade-marquee` — animated neon gradient border on `.vlf-frame` (background-
  position), 4s.
- `vle-arcade-blink` — `coin-slot` detail blink, 1s steps(2).

### Riot keyframes
- `vle-riot-jitter` — xerox micro rotate/translate on cards, `steps(2)` ~0.25s (glitch);
  stagger with `:nth-child` delays.
- `vle-riot-halftone` — background dot drift (`background-position`), ~8s linear.
- `vle-riot-tape` — tape-corner flutter (small rotate), 3s ease-in-out.
- `vle-riot-strobe` — accent header strobe (opacity), fast; keep contrast legible.
- `vle-riot-marquee` — titlebar text marquee scroll (`translateX`), 10s linear.
- hover shake — `.vle-card:hover` short shake (transform), 0.3s.

### Grimoire keyframes
- `vle-grim-motes` + `vle-grim-rise` — two firefly/mote layers (violet+emerald), ported
  from `vle-ember-drift`/`vle-ember-rise` (styles.ts:1846-1847) with the grimoire hues.
- `vle-grim-rune` — rune shimmer on `.vld-h`/`.vle-sec-h` (glow pulse), 4s.
- `vle-grim-gild` — drop-cap gild shimmer, 5s.
- `vle-grim-sigil` — slow rotate on `sigil-seal` detail, 20s linear.
- `vle-grim-flow` — flowing magic gradient in `.vld-tension-f` (background-position), 3s.
- `vle-grim-halo` — pulsing arcane halo on present avatar, 2.4s.
- page-turn fade-in on cards (reuse the sumi `vle-sumi-ink-fade` pattern, violet-tuned).

### Bestiary keyframes
- `vle-best-leaf` — gold-leaf shimmer on `illumination`/`vine-frame` frames, 5s.
- `vle-best-grow` — vine "grow" (`transform:scaleY` from 0, `transform-origin:bottom`)
  on the vine pseudos on card entrance, 0.7s ease-out.
- `vle-best-candle` — surface brightness flicker (`filter:brightness()`), 7s with a
  short spike (steps), subtle.
- `vle-best-bob` — marginalia beast bob (translateY), 3s ease-in-out.
- `vle-best-rubric` — rubric drop-cap shimmer, 5s.

---

## 5. Tests (`test/theme.test.ts`)

1. **Update the hard-coded chrome list** (line 26-28): the assertion
   `MODES.map(m=>m.id).sort()` must include the four new ids →
   `['arcade','bestiary','bloom','default','ember','faewild','futuristic','gatsby','graphite','grimoire','illuminated','modern','riot','sumi']`.
2. **Add a per-chrome resolve test** for each new chrome, mirroring the graphite test
   (lines 37-51): assert `setMode('<id>')` sets `chrome`, the dark `skin`, the mode's
   `accent`, that both paired skins exist, that `CHROME_SHAPES.<id>` equals the intended
   6-surface map, and that each new `ShapeId` is in `SHAPE_IDS`.
3. The existing generic guards then cover the rest for free:
   - "every MODES patch sets only known Theme keys" (our patches use known keys).
   - "each mode's dark+light skins exist" (add skins first).
   - "CHROME_SHAPES covers every chrome × surface with a valid shape id".
   - "CHROME_SHAPES uses only content-safe v4 shapes" — this test also re-asserts the
     `default` map; our new shapes are additive and not in the `CUT` set, so it passes.
   - "every skin defines press/pressInk" (include those keys in the 8 new skins).
   - "the Cards tab renders a tile per `SHAPE_IDS` id" (line 202) — passes once shapes
     are registered and their `.v-shape--<id>` primitives are emitted.

**Verify** with the project's runner (Vitest): `npm test` (or `npx vitest run
test/theme.test.ts`). Also run the full suite once since `contrast.test.ts`/
`dashboard.test.ts` exercise theme output. There is no build/typecheck gate that will
let an unregistered `ShapeId` or `Chrome` through — the `Record<Chrome,…>` and
`ShapeId` union make omissions compile errors.

---

## 6. Manual verification

1. Extend `mockups/new-chromes.html` parity check (already browser-verified) — no code,
   just a visual reference while porting each chrome block.
2. In-app: `setMode('arcade'|'riot'|'grimoire'|'bestiary')`, then for each:
   - Toggle dark/light (`setColorMode`) → paired skin resolves, text stays legible.
   - Toggle **Motion off** in Customize → Window → all animations stop, static fallbacks
     look intact (this is the key maximalist-safety check).
   - Cards tab → each surface's Auto tile previews the new signature shape; every new
     shape tile renders without clipping its label.
   - Confirm float **and** drawer both re-skin (fx layers on `.vlf-body` + `.vle-body`).
3. Old-UA fallback: the `@supports not (clip-path…)` / `not (mask…)` blocks already
   auto-cover the new `CLIP_SHAPES`/`MASK_SHAPES` entries — confirm they're listed.

---

## 7. Risks & decisions

- **Shape-count decision (needs your call):** full 24 (unique per surface) vs. ~12
  (3 signature + reuse). Plan assumes 24. This is the single biggest scope lever.
- **Font network load:** Press Start 2P / Anton / Cinzel Decorative / MedievalSharp /
  UnifrakturCook load from Google on demand (Gatsby/Sumi precedent). They are **not**
  bundled in `fonts.ts` (which is self-hosted, zero-network). If offline-first parity is
  required, a follow-up can base64-embed them in `fonts.ts`; that's a separate, larger
  task and not needed for functional parity.
- **Motion intensity vs. legibility:** the brief asks for "a lot" of motion. All of it
  is strictly gated by `data-vle-motion` + `prefers-reduced-motion`, and text-bearing
  elements avoid transform/opacity churn (fx lives on pinned pseudo layers and accents),
  so readability holds even at full intensity. Riot's strobe/glitch is the one to keep
  tasteful — cap opacity swing and rotation to avoid an accessibility problem.
- **CSS size:** four chrome blocks + 24 shapes + ~24 keyframes materially grow `STYLES`.
  It's one concatenated string (no runtime cost beyond parse); acceptable and in line
  with the existing chrome blocks.
- **No core risk:** zero changes to parse/reduce/events/lifecycle; a broken theme value
  still sanitizes to `default` (existing `CHROME_REMAP`/`sanitize`).

---

## 8. Implementation order (suggested)

1. `theme.ts`: types + `SHAPE_IDS` + `CHROME_SHAPES` + `CHROMES` + `MODES` + `SKINS` +
   font map + sketch map. (Compiles green once all `Record<Chrome,…>` are filled.)
2. `styles.ts`: `SHAPE_GEOM` + `CLIP_SHAPES`/`MASK_SHAPES` + `shapeDetail` ornaments.
3. `styles.ts`: the four chrome CSS blocks (static look first).
4. `styles.ts`: animations + motion-off/reduced-motion kills; mode-sketch CSS.
5. `test/theme.test.ts`: update chrome-list assertion + add four per-chrome tests.
6. Run Vitest; fix; manual verify per §6.

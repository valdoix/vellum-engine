# Customize Panel Redesign — Concept II (Sidebar + Canvas)

Implementation plan for the "Sidebar + Canvas" customize panel redesign. This is a
**presentation-only** change (theme.ts UI generation + styles.ts + app.ts modal
width). No schema, backend, reducer, or persisted-state changes. All existing
`data-cz-*` control wiring is preserved verbatim so behavior is unchanged.

---

## Goals (from the four notes)

1. **Wider panel** — go from the current `min(440px,94vw)` modal to a wide two-pane
   layout (`min(880px,96vw)`), clamped so it never overflows a 42vw drawer.
2. **Shape preview tiles** — the Cards tab shows a CSS mini-card silhouette per
   shape, driven by the real `SHAPE_GEOM` geometry, instead of a `<select>`.
3. **Skins grouped Light / Dark** — the Skins tab splits `SKINS` into two labelled
   groups so users don't pick a dark skin while in light mode.
4. **Uncluttered** — replace the cramped 9-tab horizontal strip (which wraps to two
   rows in 440px) with a persistent left nav rail + a spacious right canvas.

---

## Current state (what exists today)

- `customizePanel(tab)` in `theme.ts:539` returns
  `<div class="vle-cz"><div class="vle-czt-bar">${tabs}</div><div class="vle-cz-body">${body}</div></div>`.
  Tabs are a horizontal `.vle-czt-bar` with a `look` front tab, an `advanced`
  separator, then `skin mode layout color type window cards sections`.
- The panel is mounted in `openCustomize` (app.ts:270) inside a `.vlfm` modal at
  `style="width:min(440px,94vw)"`.
- `wireCustomize(host, onChange, rerender)` delegates all clicks/inputs via
  `data-cz-*` attributes and calls `rerender(tab)` which does
  `host.innerHTML = customizePanel(tab)`.
- Skins render as `.vle-skins` grid of `.vle-skin` swatch buttons (flat, ungrouped).
- Cards render per-surface `<select>` dropdowns (`data-cz-cardshape`), no preview.
- `SHAPE_GEOM` (styles.ts) already defines every shape's geometry; `shapePrimitives()`
  emits `.v-shape--<id>` classes. Shape detail pseudos are emitted per surface via
  `shapeDetail()`.

---

## Design decisions

**D1 — Keep `CzTab` and all `data-cz-*` wiring unchanged.** The redesign is a
re-layout of the *container* (rail + canvas) and two *body* sections (skins, cards).
Every existing control keeps its attribute, so `wireCustomize` needs only additive
handlers (rail click = tab switch; shape tile click = same as the old select change).

**D2 — Derive light/dark per skin, do NOT add a schema field.** A skin is "light"
when its `ink` is dark on a light `surf1` (i.e. luminance(surf1) > luminance(ink)).
Add a pure helper `isLightSkin(s: Skin): boolean` computing relative luminance of the
skin's `surf1` vs `ink`. This avoids touching the `Skin` interface or the 38 skin
entries. (Sanity-checked against the data: parchment/daylit/graphite-light/etc.
resolve light; illuminated/moonlit/graphite/sumi-ink resolve dark.)

**D3 — Shape tiles reuse `SHAPE_GEOM`.** The preview tile is a small element with the
`.v-shape--<id>` class already emitted by `shapePrimitives()`, so tiles stay in sync
with the real geometry automatically. No duplicated shape CSS.

**D4 — Rail is CSS-driven, single source of tabs.** One ordered `CzTab[]` array
drives both the rail and the body switch. The `look`/`advanced` split is dropped in
favor of a flat rail (Look first, then the rest), since a rail doesn't get cramped.

**D5 — Responsive collapse.** Under a container/media width threshold (≈560px) the
rail collapses to a horizontal icon strip above the canvas, so narrow drawers still
work. Uses `@container` on the modal body (already `container-type` friendly) or a
media query as fallback.

---

## Part A — Panel container: rail + canvas (theme.ts)

**A1.** Replace the `customizePanel` return wrapper. New structure:

```
<div class="vle-cz vle-cz--sb">
  <nav class="vle-cz-rail">
    <div class="vle-cz-rail-h">VELLUM</div>
    {rail items: one per CzTab, with icon + label, .on for active}
  </nav>
  <div class="vle-cz-canvas" data-cz-tab-body data-tab="${tab}">
    <div class="vle-cz-canvas-h"><h3>${tabTitle}</h3>{optional header actions}</div>
    <div class="vle-cz-canvas-body">${body}</div>
  </div>
</div>
```

**A2.** Rail item markup:
`<button class="vle-cz-railitem${tab===id?' on':''}" data-cz-tab="${id}"><span class="vle-cz-ic">${icon[id]}</span><span class="vle-cz-raillbl">${label[id]}</span></button>`.
Add an `icon: Record<CzTab,string>` and `label: Record<CzTab,string>` map (glyphs
from the mockup: Look ◈, Skins ◑, Cards ■, Layout ⟳, Color ◆, Type T, Window ▢,
Sections ☰, Mode ◐).

**A3.** The `data-cz-tab-body`/`data-tab` attributes move onto `.vle-cz-canvas` so
`wireCustomize`'s `curTab()` (reads `[data-cz-tab-body]`) keeps working unchanged.

**A4.** Keep every `else if (tab === …)` body block exactly as-is EXCEPT the two
being redesigned (skin, cards). The `mode` tab can fold into `look` or stay; keep it
to avoid churn.

---

## Part B — Skins grouped Light / Dark (theme.ts + helper)

**B1.** Add pure helper (top of theme.ts, near sanitize):

```ts
function relLum(css: string): number { /* parse rgba()/#hex -> 0..1 luminance */ }
export function isLightSkin(s: Skin): boolean {
  return relLum(s.theme.surf1) > relLum(s.theme.ink);
}
```
Robust parse: handle `#rrggbb`, `rgba(r,g,b,a)`, and `linear-gradient(...)` (fall
back to first color found). Default to dark on parse failure.

**B2.** Rewrite the `tab === 'skin'` body:

```
<div class="vle-cz-h">Dark skins</div>
<div class="vle-skins">{SKINS.filter(s=>!isLightSkin(s)).map(skinCard)}</div>
<div class="vle-cz-h">Light skins</div>
<div class="vle-skins">{SKINS.filter(isLightSkin).map(skinCard)}</div>
{export/import/reset row unchanged}
```
`skinCard(s)` = the existing `.vle-skin` button markup (unchanged `data-skin`), so
wiring is untouched. Optionally enrich the swatch to show surf+accent (mockup shows a
gradient chip + accent bar) — additive CSS only.

**B3.** (Optional, recommended) A Dark/Light segmented toggle in the canvas header
that calls the existing `data-cz-colormode` handler, so the Skins tab also flips
color mode. Reuses `setColorMode` — no new wiring.

---

## Part C — Shape preview tiles (theme.ts + styles.ts)

**C1.** Rewrite the `tab === 'cards'` body. For each surface, render a labelled group
of clickable tiles instead of a `<select>`:

```
<div class="vle-cz-h">${SURFACE_LABELS[surface]} {reset ↺ if override}</div>
<div class="vle-shapes">
  <button class="vle-shape${!cur?' on':''}" data-cz-cardshape="${surface}" data-shape="">
     <span class="vle-shape-tile v-shape--${def}"></span><span class="vle-shape-l">Auto</span></button>
  {SHAPE_IDS.map(id => tile(surface,id,cur))}
</div>
```
`tile` = `<button class="vle-shape${cur===id?' on':''}" data-cz-cardshape="${surface}" data-shape="${id}"><span class="vle-shape-tile v-shape--${id}"></span><span class="vle-shape-l">${label}</span></button>`.

**C2.** Wiring change in `wireCustomize`: the current handler listens for `change` on
`select[data-cz-cardshape]`. Add a `click` handler for `button[data-cz-cardshape]`
reading `data-shape` (empty = clear override), doing the same
`patchTheme({cardShapes})` + `rerender('cards')` + `reapply()`. Keep the old select
handler too (harmless) or remove it since selects are gone.

**C3.** styles.ts — add tile CSS:
- `.vle-shapes{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:7px}`
- `.vle-shape{…flex column, border, .on = accent border}`
- `.vle-shape-tile{width:100%;height:40px;background:var(--vsurf-1);border:1px solid var(--vle-gold-soft);position:relative}`
  — the `.v-shape--<id>` class applies the real geometry (radius/clip/mask). Since
  the `.v-shape--<id>` class applies the real geometry (radius/clip/mask), and the
  paired `shapeDetailTile` emitter (see C3-ORNAMENT) adds the ornament pseudos too.
- Ensure `shapePrimitives()` output is present in the modal (it is — global styles).

**C3-ORNAMENT.** Ornament pseudos CAN appear on tiles with a minimal addition.
The problem: `shapeDetail(id, decl, pseudo)` generates selectors rooted at the
surface roots (`.vld-pc`, `.vle-rel-card`, etc.) that tiles don't have. Fix: add a
companion emitter `shapeDetailTile(id, decl, pseudo)` that targets
`.vle-shape-tile.v-shape--<id>::before/after` with the SAME declaration string.
Call it alongside every existing `shapeDetail(...)` call — no new CSS declarations,
just new selectors.

```ts
// In styles.ts, alongside shapeDetail():
const shapeDetailTile = (id: string, decl: string, pseudo: '::before' | '::after'): string[] =>
  [`${'.vle-shape-tile.v-shape--' + id + pseudo}{${decl}}`];
```

Then every existing `...shapeDetail('notched', decl, '::before')` call gets a
paired `...shapeDetailTile('notched', decl, '::before')` using the SAME `decl`
string — no duplication, and future shapes with ornaments automatically get their
tile preview too because the pattern is mechanical.

Tile tiles need `overflow:visible` or enough height for the ornament (some pseudos
use `position:absolute;inset:…` which clips if overflow is hidden). Set
`.vle-shape-tile{overflow:visible}` and ensure the tile height (40px) is enough for
the detail to be visible. For hanko (top-right pseudo, large) bump the tile height to
52px or let the pseudo overflow decoratively.

**C4.** Note the CSS-var dependency: tiles use `--vsurf-1`/`--vle-gold-soft`, which
resolve inside the modal (applyTheme sets them on `.vlfm`). Confirmed available.

---

## Part D — Rail + canvas CSS (styles.ts)

**D1.** Two-pane grid:
- `.vle-cz--sb{display:grid;grid-template-columns:172px 1fr;gap:0;min-height:420px}`
- `.vle-cz-rail{display:flex;flex-direction:column;gap:2px;padding:6px;border-right:1px solid rgba(var(--vg-rgb),.16)}`
- `.vle-cz-railitem{display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:8px;font:600 11px/1 var(--vmono);letter-spacing:.4px;text-transform:uppercase;color:var(--vi2);background:transparent;border:1px solid transparent;cursor:pointer;text-align:left}`
- `.vle-cz-railitem.on{background:rgba(var(--vg-rgb),.14);color:var(--vle-gold);border-color:rgba(var(--vg-rgb),.3)}`
- `.vle-cz-railitem:hover{background:rgba(var(--vg-rgb),.08)}`
- `.vle-cz-rail-h{font:600 9px/1 var(--vmono);letter-spacing:1.5px;text-transform:uppercase;color:var(--vg);opacity:.6;padding:6px 11px 8px}`
- `.vle-cz-canvas{padding:14px 16px;overflow-y:auto;min-width:0}`
- `.vle-cz-canvas-h{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;padding-bottom:9px;border-bottom:1px solid rgba(var(--vg-rgb),.18)}`
- `.vle-cz-canvas-h h3{font-family:var(--vserif);font-size:18px;letter-spacing:1px;color:var(--vi)}`

**D2.** Responsive collapse (`@container` on `.vlfm-body` or media query):
`@media (max-width:560px){.vle-cz--sb{grid-template-columns:1fr}.vle-cz-rail{flex-direction:row;flex-wrap:wrap;border-right:none;border-bottom:1px solid …}.vle-cz-raillbl{display:none}}`
so the rail becomes an icon strip on narrow drawers.

**D3.** Light-mode: the rail border/active states already use `--vg-rgb`/`--vi2`
tokens, which the existing light-override layer handles. Add a light override only if
the rail's active fill reads muddy: `html[data-vle-mode='light'] .vle-cz-railitem.on{…}`.

---

## Part E — Modal width (app.ts)

**E1.** In `openCustomize` (app.ts:273) change
`style="width:min(440px,94vw)"` → `style="width:min(880px,96vw)"`.

**E2.** Verify against 42vw drawer: the modal is centered in a fixed overlay
(`.vlfm-overlay` is `position:fixed;inset:0`), so it's viewport-relative, not
drawer-relative — 96vw clamp keeps it on-screen. No drawer-width coupling.

---

## Part F — Tests + verification

**F1.** `test/theme.test.ts` — add:
- `isLightSkin` classifies known skins correctly (parchment/daylit/graphite-light =
  light; illuminated/moonlit/graphite/sumi-ink/gatsby-noir = dark).
- every skin classifies without throwing (parse robustness across rgba/hex/gradient).
- `customizePanel('skin')` output contains both "Dark skins" and "Light skins" heads.
- `customizePanel('cards')` output contains `.vle-shape` tiles with `data-shape` and
  a `v-shape--` class for each surface (no `<select data-cz-cardshape>` remains).
- `customizePanel('look')` still renders the rail (`data-cz-tab` for each CzTab).

**F2.** Existing `customizePanel`/`wireCustomize` tests must still pass — the
`data-cz-*` attributes are unchanged, so the "Cards tab renders a shape control per
surface with an Auto option" test needs updating from `<select>` to tile assertions.

**F3.** `npm run build`, `npm run typecheck`, `npm test` all green.

**F4.** Manual (live Lumiverse, since layout is visual): open Customize — confirm the
rail switches sections, skins show under Light/Dark heads, card tiles preview the
silhouette and clicking one applies it, and the panel is wide but doesn't overflow a
42vw drawer.

---

## Files touched

- `src/ui/theme.ts` — `customizePanel` container (rail+canvas), `isLightSkin`/`relLum`
  helpers, grouped skins body, shape-tile cards body, rail icon/label maps; a click
  handler for tile buttons in `wireCustomize`.
- `src/ui/styles.ts` — rail/canvas/tile CSS + responsive collapse + optional light
  override.
- `src/ui/app.ts` — modal width one-liner.
- `test/theme.test.ts` — new + updated assertions.

## Out of scope (future)

- Wizard/first-run guidance (Concept I).
- Live full-card previews per theme (bigger; tiles are geometry+ornament only, not full prose layout).
- Per-surface ornament isolation (ornament pseudos are shape-scoped, not surface-scoped, so all surfaces show the same ornament for a given shape — correct for a picker).

## Honest risks

- **`isLightSkin` heuristic** could misclassify an edge skin (e.g. a mid-tone). The
  luminance test is robust for the current 38 skins, but if a future skin is
  ambiguous it lands in the wrong group. Mitigation: the classification is
  cosmetic-only (grouping), not behavior — a misgroup is a minor UX wart, not a bug.
  If it matters later, add an explicit optional `light?: boolean` to `Skin`.
- **Shape tiles show geometry AND ornament.** The `shapeDetailTile` companion emitter targets `.vle-shape-tile.v-shape--<id>::before/after` with the same declaration as the surface-keyed detail, so ornamented shapes (studs, binding, trellis, etc.) render on the tile correctly. The one caveat: ornament pseudos using `position:absolute;inset` assume the parent has established positioning — `.vle-shape-tile{position:relative;overflow:visible}` handles this. Large pseudos (hanko, washi-fold) may overflow the tile decoratively, which is fine.
- **Visual-only verification gap** — as with the other theme work, the payoff is
  visual and can't be fully confirmed outside a live Lumiverse. Build/typecheck/tests
  cover structure and wiring, not appearance.

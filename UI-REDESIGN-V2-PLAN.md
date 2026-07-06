# VELLUM — UI Redesign Implementation Plan (v2)

**Scope:** presentation layer only. No engine, schema, event-log, backend, or preset changes.
Mockup reference: `design-review/19-kilo-living-page-v2.svg` (Ember, Lumiverse-grounded).
Host chrome reference: Lumiverse `ViewportDrawer` — 56px purple icon rail, ~420px panel
(`min(420px, 100vw-64px)`) on `--lumiverse-bg-deep #0a0812`, 48px host header (host renders
title + close X). VELLUM mounts inside `.panelContent` (12px pad), effectively single-column.

---

## Decisions locked in

1. **Default theme stays as-is** — `chrome:'default'`, `skin:'illuminated'` (the gilt-vellum look,
   ~mockup 15). We do NOT ship Ember as default. Ember remains one selectable chrome.
2. **Six chromes only**, each with a **light + dark** variant:
   `default` · `fantasy` (rename of `illuminated`) · `modern` · `futuristic` · `bloom` · `ember`.
   Cut: `nocturne`, `atelier`, `glimmerwood`, `marginalia`.
3. **Weather lives in VELLUM's own illustrated header band**, not the Lumiverse host header
   (host `headerTitle` is registration-only; `setTitle` has bad side effects — confirmed in
   `placement-helper.ts` / `spindle-placement.ts`). The band's illustration **reacts to
   `scene.weather` + `scene.time`**.

---

## Phase 0 — Safety net (before any change)
- Snapshot current `theme.ts` DEFAULT + full MODES/SKINS lists into a comment block or a
  `THEME-CARDS` note, so removed skins can be restored.
- Confirm baseline: `bun run typecheck && bun run test && bun run build` all green.

---

## Phase 1 — Chrome cull (6 chromes)  [src/ui/theme.ts, styles.ts]
Lowest-risk structural change; do first so later CSS work targets the final set.

1. `theme.ts`:
   - `Chrome` union + `Theme.chrome` type → keep only the 6.
   - `MODES[]` → remove nocturne/atelier/glimmerwood/marginalia entries. Rename the
     `illuminated` mode's display name to **"Fantasy"** (keep `id:'illuminated'` internally to
     avoid migrating saved themes, OR add a migration — see Phase 6).
   - `sanitize()` chrome allow-list array → the 6.
   - `SKINS[]` → remove skins used only by the cut chromes (`nocturne`, `atelier`,
     `glimmerwood`, `marginalia`), keeping any a surviving chrome recommends.
2. `styles.ts`: delete the four cut `[data-vle-chrome='…']` blocks (~160 lines total:
   nocturne 26, atelier 51, glimmerwood 36, marginalia 47).
3. `theme.ts` `customizePanel` `sketch: Record<Chrome,string>` → drop the 4 keys.
4. Grep for any other reference to the cut ids (`sk-nocturne` etc. in styles.ts sketch CSS,
   layout `form` names like `salon`/`gallery`/`glade` — repoint or remove).

**Verify:** typecheck passes (union is now smaller — catches every stale reference), Customize
panel renders 6 theme cards, each still applies.

---

## Phase 2 — Light/Dark variant per chrome  [src/ui/theme.ts, styles.ts, format? no]
Turn the implicit "skins are light/dark" into an explicit per-chrome pair + a toggle.

1. Extend `Mode`: replace single `skin?` with `skinDark: string` + `skinLight: string`.
   Map each of the 6:
   - default → dark `illuminated`, light `parchment`
   - fantasy → dark `vellum-dark`, light `parchment`
   - modern → dark `moonlit`, light `moonlit-light` (NEW light skin)
   - futuristic → dark `noir`, light `noir-light` (NEW)
   - bloom → dark `blush-noir`, light `blush`
   - ember → dark `starfall`, light `starfall-dawn` (NEW: pale-lilac day sky)
2. Author the **3 missing light skins** in `SKINS[]` (moonlit-light, noir-light, starfall-dawn).
   Each is just a `Skin.theme` token set (surfaces light, ink dark, semantics preserved).
3. Add `Theme.mode: 'dark' | 'light'` (default `'dark'`). `setMode(chrome)` picks
   `skinDark`/`skinLight` by the current `mode`. Add `setColorMode('light'|'dark')` that
   re-resolves the current chrome's skin.
4. Customize "Look" tab: add a **Light / Dark segmented toggle** above the theme cards.
5. `applyTheme`: set `data-vle-mode` on the root for any mode-specific CSS nudges.

**Verify:** toggling light/dark on each of the 6 chromes swaps to a legible palette; contrast
holds (spot-check ink vs surface). Export/import round-trips the new `mode` field.

---

## Phase 3 — Uppercase section labels  [src/ui/styles.ts, dashboard.ts]
1. Prefer **CSS**, scoped, so it's reversible per chrome: add to base
   `.vld-h{ text-transform:uppercase; letter-spacing:2px; }` (and `.vle-sec-h`).
2. Ember's existing `.vld-h` rule (styles.ts:1255) sets `text-transform:none` + small-caps —
   change that block to real uppercase so Ember matches the mockup.
3. `dashboard.ts statusBar()`: uppercase the meta line tokens (`T147 · DAY 12 · …`); the
   `_calendar` epoch already gets its `✦` prefix — uppercase it too.
4. Sub-labels in `recentBlock` spines (`journal`/`knew`/`secret`/`shift`) → uppercase via the
   existing `.vld-rec-k` class (CSS), plus the `·NAME` suffix.

**Verify:** all section headers + date + record kind-labels render caps across chromes; check
non-Latin names in `·NAME` aren't broken by uppercasing (uppercase only the kind label, not the
character name — keep name in `nameHtml`).

---

## Phase 4 — Illustrated, weather-reactive scene band  [dashboard.ts, styles.ts, NEW classifier]
The header band behind the hero text becomes a live illustration keyed to weather + time.

1. **Classifier** (new small pure fn, e.g. in `format.ts` or a new `scene-visual.ts`):
   - `weatherClass(w: string): 'clear'|'cloud'|'rain'|'storm'|'snow'|'fog'` — keyword match on
     the free-text `scene.weather` (rain|drizzle|pour→rain; snow|sleet→snow; fog|mist→fog;
     storm|thunder|lightning→storm; cloud|overcast→cloud; else clear). Default `clear`.
   - `todClass(t: string): 'dawn'|'day'|'dusk'|'night'` from `scene.time` (dawn|morning→dawn;
     noon|day|afternoon→day; dusk|evening|sunset→dusk; night|midnight→night). Default `day`.
   - Unit-test the classifier (assert-based, per repo's "one runnable check" norm).
2. `dashboard.ts statusBar()`: wrap the hero in a band element carrying
   `data-weather="{class}" data-tod="{class}"`, with layered children:
   `.vld-band-sky` (gradient by tod), `.vld-band-fx` (rain/snow/fog particles by weather via
   CSS gradients/inline-SVG, no assets), `.vld-band-light` (torch/lantern/sun bloom by tod).
   Hero text + meta sit above (`z-index`, Ember already lifts `.vle-body>*`).
3. `styles.ts`: base band CSS + `[data-tod]`/`[data-weather]` variants. Chrome-specific
   flourishes optional (Ember = fireflies + water; fantasy = parchment wash; modern = flat
   photo-less gradient). **All particle animation gated by `--vmotion` / `prefers-reduced-motion`.**
4. Keep it cheap: CSS-only. No canvas, no network, no per-frame JS.

**Verify:** each (weather × tod) combo renders distinctly and legibly (text contrast over the
busiest one — storm/night); motion-off freezes particles; band scales down to the 280px float
min width without clipping the hero.

---

## Phase 5 — In-panel weather + tension rework  [dashboard.ts, styles.ts]
1. **Weather readout** already flows from Phase 4 (it's *in* the band). Also keep the existing
   header stat pill (`app.ts` stats, `weather` pill) as the compact/collapsed fallback.
2. **Tension section** (`dashboard.ts tensionBar()`): replace bar/dots with the **ember gauge** —
   10 mote spans; lit ones scale radius + shift hue amber→red by index; 3 cold unlit; a trend
   caret (`▲/▼/·`) + one voice line. Trend needs previous tension: memoize last value in the
   module (`let _lastTension`), compare on render. If prior is unavailable first paint, omit caret.
   - Reuse `--v-press`/`--v-neg` tokens; gauge glow gated by `--vmotion`.
   - This is the default tension style for ALL chromes now (not Ember-only); `tensionStyle`
     setting (`bar|num|both`) still respected as a downgrade for users who want plain.

**Verify:** tension 0 hides section (existing behavior), 1–10 render the gauge, trend caret
matches an up/down turn, `tensionStyle:'num'` still shows the plain number.

---

## Phase 6 — Migration, float parity, ship  [theme.ts, float.ts, app.ts]
1. **Saved-theme migration** in `theme.ts load()/sanitize()`: if a stored `chrome` is one of the
   4 cut ones, remap (nocturne→futuristic or modern; atelier→fantasy; glimmerwood→bloom;
   marginalia→bloom light) so existing users don't land on an invalid chrome. Backfill
   `mode:'dark'` when absent.
2. **Float parity:** `float.ts` + the float render in `app.ts` already share `dashboardHtml`, so
   Phases 3–5 flow through automatically. Confirm the illustrated band + gauge look right in the
   floating window and at min size; confirm the float title bar still reads on all 6 chromes.
3. Full pass: `bun run typecheck && bun run test && bun run build`; reload in Lumiverse; walk all
   6 chromes × light/dark; toggle motion off; resize float to min; play a turn to see wet-ink +
   tension trend update live.

---

## Risk / effort summary
| Phase | Risk | Effort | Notes |
|---|---|---|---|
| 0 baseline | none | XS | |
| 1 chrome cull | low | S | type union catches stale refs |
| 2 light/dark | med | M | 3 new light skins to author + toggle + migration |
| 3 caps labels | low | XS | mostly CSS |
| 4 weather band | med | M | new classifier (tested) + CSS layers |
| 5 tension gauge | low | S | prev-tension memo the only state |
| 6 migrate/ship | low | S | remap cut chromes, verify float |

**Order rationale:** 1 shrinks the surface so all later CSS targets the final 6; 2 establishes the
palette axis before band/gauge colors are tuned; 3 is a quick win; 4–5 are the visible payload;
6 protects existing users and verifies parity.

**No changes to:** event log, reducers, retrieval, backend, `<vellum>` schema, or the preset.

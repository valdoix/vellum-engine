# VELLUM II — Theme System Plan: "One base, three worlds"

Build a **refined default** that every surface inherits, then express the
**Fantasy / Modern / Futuristic** mockups as three first-class *themes* over the
floating window AND the drawer tabs.

The good news from the survey: **the spine already exists.** `theme.ts` has a
`chrome` axis (`'illuminated' | 'modern' | 'futuristic'`), a `MODES` preset
table, `applyTheme()` sets `data-vle-chrome` on `documentElement`, and
`styles.ts` already carries chrome-scoped overrides + form-factor layouts
(`codex` gutter, `phone` dock, `hud` footer). This plan **finishes and deepens**
that system — it does not invent a new one.

Guiding ethos: **deps are welcome where they make the UI genuinely more
beautiful or robust** (fonts, icons, motion, charting) — each one justified,
bundled, and offline-safe (no runtime CDN calls; the extension makes no outside
requests). Reuse the token + chrome + layout axes. Gate every phase on
`bun run typecheck && bun run test && bun run build`. Each phase is its own
commit so it can be reverted in isolation.

**Coverage rule (applies to every phase): each look ships for BOTH surfaces —
the floating window (`.vlf`) AND the drawer tabs (`.vle-root`).** They share the
dashboard section registry and the `.vle-root` shell, so most CSS is written
once against a shared chrome attribute; where a rule is float-only (frame
ornament, resize grip, form layouts) it's explicitly scoped `.vlf …`, and the
drawer equivalent is called out. No theme is "done" until both surfaces render.

---

## 0. Core model (read once)

Four orthogonal axes already in `Theme`:

| Axis | Owns | Today |
|---|---|---|
| `skin` | palette (surfaces, ink, accent, semantics) | 6 skins |
| `chrome` | **window ornamentation / the "world"** | 3 values, half-built |
| layout | structure (sections, order, columns, dock) | 10 layouts |
| scale/density/fonts/texture | size + texture knobs | sliders |

**Decision: a "theme" = chrome.** Fantasy = `illuminated`, Modern = `modern`,
Futuristic = `futuristic`. A theme is *not* a skin — "Crimson Court / Futuristic"
must still work. But each theme ships an **opinionated default bundle** (recommended
skin palette + layout + fonts + radius/texture) via the existing `MODES.patch`,
which the user can still override knob-by-knob.

The "refined default look" (mockups 01–06) becomes the **base layer** — the CSS
that renders before any chrome override kicks in, shared by all three themes and
both surfaces (float + drawer share `dashboardHtml()` and the `.vle-root` shell).

### Surface coverage (the deliverable for every theme)

| Surface | Selector | What each theme must restyle |
|---|---|---|
| **Floating window** | `.vlf` | frame/ornament, title bar, resize grip, launcher tab, the dashboard body, AND the float-only **form layouts** (Fantasy: Codex + Scroll; Modern: Phone; Futuristic: HUD-stack) |
| **Drawer tab** | `.vle-root` | head, **tab bar**, toolbar, sub-nav, and every tab body (Now/Cast/Bonds/Chronicle/Journal/Graph/Vault/Context) |
| **Shared** | `[data-vle-chrome]` on `documentElement` + mirrored on both roots | tokens, `.v-chip`, type scale, cards, bars, modals, toasts |

Both roots get `data-vle-chrome` mirrored in `applyTheme()` (the float already
does; Phase 1.3 adds the drawer). Modals/overlays (`.vlfm`, `.vle-toasts`) read
the document attribute, so they theme automatically.

### Dependencies we will add (bundled, offline-safe)

The host imports `dist/frontend.js` as one ESM bundle; tsup bundles everything,
so deps add zero runtime fetches. Candidates, each earning its place:

- **Webfonts, self-hosted** (not Google CDN — bundle the woff2 as base64 or ship
  in the extension): *Cinzel* + *Cormorant Garamond* (Fantasy display), *Inter*
  (Modern), *Orbitron* or *Chakra Petch* + *JetBrains Mono* (Futuristic). Embed as
  `@font-face` data-URIs in `styles.ts` so there is no network dependency. Gate by
  chrome so only the active theme's face loads heavy.
- **`@floating-ui/dom`** — replace the hand-rolled drag/clamp math in `float.ts`
  with robust positioning/collision handling (esp. for the new launcher menus and
  any tooltips). Optional; only if the bespoke geometry proves fragile.
- **`canvas-confetti`-class micro-libs: NO.** Motion is done with CSS +
  `Web Animations API` (built-in) to respect the existing `data-vle-motion` gate.
- **Charting: NO new dep.** The futuristic bond radar is bespoke inline SVG
  (reusing `graph.ts` conventions) — a chart lib would be heavier than the ~40
  lines of SVG and wouldn't match the aesthetic.

Rule: a dep ships only if it beats a small hand-rolled version on quality or
correctness, bundles cleanly to ESM, and makes no runtime network call. Pin exact
versions. Add to `dependencies`, run the build, confirm `dist/frontend.js` still
loads as a module.

---

## Phase 0 — The refined base ("default look") · low risk, biggest ROI

Everything here lands in `styles.ts` + `theme.ts` + small className swaps in
`dashboard.ts`/`tabs/`. This is mockups 01→06 (annotated → redesign). It is the
foundation all three themes inherit, so it ships first.

### 0.1 Token additions (`styles.ts :root` + `theme.ts`)
- Confirm/extend the spacing (`--v1..--v6`), radius (`--vr1/2/3`, `--rpill`) and
  semantic tokens already present. **Add an amber pressure token**
  `--v-press:#c8923e` (+ `-i` ink) so *tension* stops borrowing `--v-neg` (red).
  Add to `Skin`, every `SKINS` entry, `DEFAULT`, `sanitize` (hex-guarded), and the
  `applyTheme` `set()` block — same pattern the four existing semantics use.
- Add a **type-scale** token set the components read instead of literals:
  `--vt-display, --vt-title, --vt-body, --vt-meta, --vt-eyebrow` (≈24/18/14/11/10
  × `--vscale`). Floor the meta label at **11px** (kills the 7/7.5/8px labels —
  the a11y point).

### 0.2 Unify the chip zoo → `.v-chip` (mockup 03)
One base class + tone modifiers (`.v-chip--pos/neg/info/warn/press/gold/muted`),
one radius (`--vr1`), one padding, one label size. Migrate `vle-cat`, `vle-st`,
`vle-krel*`, `vle-mem-tier`, `vle-jr-tag`, `vle-inj-reason`, `vlv-entry-cat`,
`vld-cat/mood/cond`. Delete the bespoke rules. (~60% of the visible noise, per the
repo's own UI-PLAN.) Pure CSS + className swaps; no markup-structure change.

### 0.3 Redesigned "Now" dashboard sections (mockup 02)
In `dashboard.ts` (pure render fns — safe to restructure):
- **`statusBar`**: collapse the 4 gold pills into ONE quiet meta line
  (`Turn · Day · time · weather`) under a **hero scene line** (the biggest text on
  screen). New `--vt-display` serif size.
- **`tensionBar`**: render a **7-of-10 dot meter** in `--v-press` (amber), not a
  red fill. Keep the `tensionStyle` (bar/num/both) honoring; "bar" becomes "dots".
- **`relationsBlock`**: show the **twin affection/trust mini-meters** the engine
  already tracks (reuse `bar()` from `format.ts`, or a compact variant) so
  "infatuation vs respect" is finally visible at a glance.
- **`recentBlock`**: group by kind with a **colored left spine** per type
  (journal=sage, learned=blue, secret=red/neg, shift=amber). New `.vld-rec--{kind}`
  modifier; one extra class on existing rows.

### 0.4 Differentiated record rows (mockup 05C)
`chronicle.ts` Memory/Knowledge/Secrets/Scars/Codex all reuse `.vle-mem`. Add
**per-type row grammar** via a modifier class + a colored spine so you know the
view by its shape, not by reading the chip:
- knowledge → epistemic verb leads (`believes`/`wrong`), `--v-info` spine
- secret → "keeps from", `--v-neg` spine
- scar → struck-through belief (already has `.vle-scar-was`), `--v-warn` spine
- codex → "Canon" + no owner, `--vg` spine
CSS-only: each renderer already emits distinct content; we add `class="vle-mem vle-mem--know"` etc. and style the spine.

### 0.5 IA cleanup (mockups 04→05)
- **Group the tab bar**: keep `Now · Cast · Bonds(=Relations) · Chronicle` as the
  primary row; demote `Vault · Context` + the tools to a quieter secondary cluster
  (icon-weight, smaller). This is className/markup-only in `createShell` (`app.ts`).
- **Chronicle sub-nav grouping**: the 8 sub-views get two soft group labels
  ("The World" / "What's Known & Kept") in `chronicle.ts`'s `VIEWS` render — no
  routing change, just headers between groups.
- **Actions menu split by verb vs state** (`openActions`): a *Maintain* group
  (one-shot), a *Settings* group (toggles, showing live state — already do), Clear
  quarantined (already does). Promote **Summarize** + **Undo** to the toolbar
  (they're daily). Markup-only.

**Phase 0 exit:** float + drawer both look like mockup 02/05 on the default
(`illuminated`) chrome. No theme-switching yet. Gate + commit.

---

## Phase 1 — Theme infrastructure · low risk

Make the three worlds selectable and previewable. The plumbing mostly exists.

### 1.1 Extend the `MODES` bundle (`theme.ts`)
Each mode already patches `chrome + radius/border/texture/serif + form`. Extend
`Mode.patch` to also set a **recommended skin** (so picking a theme also sets a
fitting palette) and `mono`/`dataScale` where the look demands it. Keep it a
*patch* (overridable), not a lock. Add a `paletteHint` the gallery tile previews.

### 1.2 Customize → "Themes" gallery tab (`theme.ts customizePanel`)
The `mode` tab exists but renders bare skin-grid tiles. Replace with **big
preview cards** — a mini wireframe per theme (a tiny inline SVG/CSS sketch: codex
spread, phone stack, HUD brackets) + name + blurb, reusing `.vle-skins` grid
markup. Picking one calls existing `setMode(id)`. (3 tiles; trivial.)

### 1.3 Make the drawer respond to chrome
Today the chrome-scoped CSS targets `.vlf` (float) only. The drawer (`.vle-root`)
ignores chrome. **Broaden the selectors** so `html[data-vle-chrome='x'] .vle-root`
also themes — OR (cleaner) scope theme CSS to a shared ancestor attribute and add
`data-vle-chrome` mirroring onto the drawer root in `applyTheme`. Audit each
existing `.vlf`-scoped rule and decide float-only vs shared. This is the one
infra subtlety; do it carefully and verify both surfaces.

### 1.4 Reduced-motion + a11y guards
All three themes add motion/glow. Respect the existing
`html[data-vle-motion='off']` kill-switch for every new animation
(scanlines, blooms, dock transitions). One `prefers-reduced-motion` media query
as backstop. Keep the Phase-4 focus ring intact across all themes.

**Phase 1 exit:** switching theme in Customize re-skins float AND drawer; default
(illuminated) still equals Phase 0. Gate + commit.

---

## Phase 2 — Fantasy "The Codex" (deepen `illuminated`) · medium risk

Target = mockup `mode-1-fantasy-codex`. Most is CSS over the existing
illuminated chrome. **Two float layouts stay first-class and both get the full
treatment** (per request): **Codex** (cols=2, the open-book spread with the
center gutter at `styles.ts:509`) and **Scroll** (cols=1, the unfurled parchment
at `styles.ts:516`). The Mode tab defaults illuminated → `codex`, but the layout
picker still offers Scroll (and every other layout) freely.

### Fonts (new dep, bundled)
Self-host **Cinzel** (titles/rubrics) + keep **Cormorant Garamond** (body), both
embedded as `@font-face` data-URIs, loaded only under
`[data-vle-chrome='illuminated']`. Gives real Trajan-column majesty the system
serif can't.

### CSS-only — applies to BOTH float and drawer
- **Drop-cap** on the hero scene line via `::first-letter` (boxed, rubric-red,
  Cinzel). Works in the float dashboard AND the drawer Now tab (same element).
- **Rubric headers**: section eyebrows → small-caps red + hairline rule + `❦`
  fleurons on `.vle-sec-h`/`.vld-h` (shared, so Chronicle/Cast/etc. get it too).
- **Portrait medallions**: present-cast avatars → round, double-gilt-ringed,
  dashed-gold halo when `--present`. Extends `.vle-card--present .vle-av` (used in
  both the dashboard present-block and the Cast tab).
- **Heraldic bond card**: split-shield background + gilded affection/trust — a
  shared `[data-vle-chrome='illuminated'] .vle-rel-card` rule so it shows in the
  **Bonds drawer tab** and the float relations section alike.
- **Gilded vine tension** already exists (`styles.ts:514`); wire it to the new dot
  meter so dots become vine nodes — applies wherever `.vld-tension` renders.
- **Manuscript chrome (float-only)**: `.vlf-frame::before/::after` already do the
  double-rule + bloom; add corner-flourish content, a tooled-leather border
  gradient, and the **wax-seal close** restyle of `.vlf-x`. The **drawer** can't
  have a frame, so it instead gets a parchment `--vtexture` default + a gilt top
  rule on `.vle-head` — the drawer's equivalent of "binding".
- **Float form layouts** (keep both): Codex keeps its gutter seam + page-curl
  bottom corners + folio footer; Scroll keeps its deckle-edge mask + dotted
  section rules. Both already scaffolded — Phase 2 just enriches them (ornament,
  fonts, drop-cap) and verifies the ~360px container-query Codex→Scroll fallback.

### Drawer tab bar → ribbon bookmarks (both surfaces' nav)
Style `.vle-tabbtn` as hanging ribbon bookmarks (notched bottom via
pseudo-element, per-tab tint). Same rule themes the float's action buttons.
`ponytail:` true die-cut shapes need `clip-path` and may fight `overflow:hidden`;
the notch-pseudo version is the safe default — upgrade only if it reads flat.

Gate + commit. Verify Crimson/Verdant/Orchid skins still read under codex chrome,
and that BOTH the float (Codex + Scroll) and every drawer tab look illuminated.

---

## Phase 3 — Modern "The App" (deepen `modern`) · low–medium risk

Target = mockup `mode-2-modern-app`. The `modern` chrome + `phone` switch layout
+ bottom dock already exist (`styles.ts:520-533`). Most CSS-friendly theme; do it
first among the three to prove the chrome→drawer plumbing on easy mode.

### Fonts (new dep, bundled)
Self-host **Inter** (UI + display), loaded under `[data-vle-chrome='modern']`.
Tabular-nums for the meters/counters.

### Float surface
- **Phone form** (float): modern defaults its layout to `phone` (switch-mode,
  one section + bottom dock — already built). Polish the notch status strip, the
  home-bar grip, and dock active-state to the blue accent.
- **Hero scene card + soft blue top glow** (recolor the `::after` bloom).
- **Tension pill** (amber, rounded) replacing the bar; **twin gradient bond
  meters** (10px, fully rounded, aff=`--v-pos`→light, trust=`--v-info`→light).

### Drawer surface (equal effort)
- The drawer can't be a "phone", so it becomes a **clean card app**: flat tab bar
  with a sliding underline indicator (animated via WAAPI, motion-gated), generous
  rounded cards, the same hero scene + tension pill + twin meters in the Now tab,
  and the **activity-feed "Just now"** styling on `recentBlock` (colored timeline
  nodes + connector). Cast/Bonds/Chronicle tabs inherit the rounded-card + sans
  treatment automatically via shared chrome-scoped rules.
- Presence dots on avatars (base adds; modern rounds cards more).

Gate + commit. Verify BOTH: the float reads as a device, the drawer as a calm
card app. This phase doubles as the "ship-tomorrow safe" look.

---

## Phase 4 — Futuristic "The Oracle HUD" (deepen `futuristic`) · medium–high risk

Target = mockup `mode-3-futuristic-hud`. The `futuristic` chrome (sharp corners,
edge-glow, mono caps title, corner ticks, telemetry footer) already exists
(`styles.ts:248-255, 535-544`). The signature **radar plot** is the only real
new render.

### Fonts (new dep, bundled)
Self-host **Orbitron** or **Chakra Petch** (HUD titles/labels) + keep
**JetBrains Mono** (telemetry), under `[data-vle-chrome='futuristic']`.

### Shared (float + drawer)
- **Grid void + scanlines**: chrome-scoped background on both roots (reuse the
  `grid` texture) + a faint repeating scanline overlay (WAAPI shimmer, motion-gated).
- **Mono telemetry** `KEY :: VALUE` styling; **targeting-reticle avatars**
  (transparent center + crosshair pseudo-ticks + cyan ring) — affects the
  dashboard present-block AND the Cast tab.
- **Threat-level tension**: segmented notched bar, red→amber, `▲` trend glyph.
- **Epistemic threat flags**: the differentiated knowledge/scar rows (0.4) get a
  HUD skin (`⚠ IRONY` / `▣ SCAR` bordered modules) — visible in the Chronicle
  drawer tab and any recent-feed.

### Float-only
- **Corner brackets** (extend `.vlf-frame::after`) bracketing the body; the
  **command-rail footer** repurposes `.vld-sysfoot` (already futuristic-only) into
  `[F1]…[ESC]` styling.

### Drawer-only
- The drawer head becomes a **telemetry bar** (`◤ VELLUM // ORACLE` + live
  `recall=` / `inj=` readout pulled from the stats line); the tab bar becomes
  segmented HUD buttons with bracket corners.

### The one genuinely new render — dual-axis bond RADAR
A small inline-SVG radar (affection = vertical axis, trust = horizontal); each
character is a vector polygon. **Cannot be pure CSS.** Add `renderBondRadar(group)`
emitting SVG, called ONLY under futuristic chrome (branch in the bond card
renderer; default = the Phase-0 twin meters). Reuse `graph.ts` SVG conventions —
**no charting dep** (bespoke SVG is lighter and on-aesthetic). Shows in both the
Bonds drawer tab and the float relations section.
`ponytail:` ship futuristic with twin-meters first; add the radar as a follow-up
commit so the theme isn't blocked on it. The component error boundary already
guarantees the tab survives if the SVG throws → degrades to twin-meters.

Gate + commit. Verify BOTH surfaces read as a HUD.

---

## Sequencing, risk, and scope discipline

1. **Phase 0** — refined base. Biggest visible win, lowest risk, unblocks all
   themes. One commit (or split 0.2 chips / 0.3 dashboard / 0.5 IA if large).
2. **Phase 1** — infra + gallery. Additive. One commit.
3. **Phase 3 (Modern)** before Phase 2/4 — it's the lowest-risk, most CSS-only
   theme; proves the chrome→drawer plumbing end-to-end on easy mode.
4. **Phase 2 (Fantasy)** — mostly CSS, a couple of ponytail'd render fallbacks.
5. **Phase 4 (Futuristic)** — last; the radar is the only new render path and is
   itself deferred behind twin-meters.

### Files touched
- `src/ui/styles.ts` — the bulk (base tokens + chip family + bundled `@font-face`
  blocks + 3 chrome blocks covering `.vlf` AND `.vle-root`).
- `src/ui/theme.ts` — token wiring, `MODES` bundles (chrome + skin + layout +
  fonts), Themes gallery tab, **drawer `data-vle-chrome` mirroring**.
- `src/ui/dashboard.ts` — restructured sections (0.3) + the bond-render branch (4).
- `src/ui/tabs/chronicle.ts`, `relations.ts`, `cast.ts` — className swaps + the
  differentiated rows (0.4) + heraldic/radar branches (both surfaces).
- `src/ui/float.ts` — optional `@floating-ui/dom` swap; mirrors chrome already.
- `src/ui/format.ts` — compact `barTwin()`/`chip()` helpers (reused on both
  surfaces).
- `package.json` — new pinned deps (fonts as bundled assets; optional
  `@floating-ui/dom`).
- **New files**: `src/ui/theme-render.ts` for chrome-specific render branches
  (radar SVG, heraldic shield) once they exceed ~40 lines; `src/ui/fonts.ts` (or a
  `fonts/` asset) holding the base64 `@font-face` declarations so `styles.ts`
  stays readable.

### Hard guardrails (do not simplify away)
- HTML escaping stays on every model-authored string (`esc`/`escape`).
- Per-panel error boundaries stay — every new render branch must be boundary-safe.
- `data-vle-motion='off'` + `prefers-reduced-motion` honored by every animation
  (WAAPI included).
- The Phase-4 `:focus-visible` ring + graph node a11y survive all themes.
- Contrast: re-check name/ink on each skin × chrome combo (esp. Crimson/Noir);
  `lowContrast()` already exists for the advisory.
- **Bundled, offline**: every new dep/font is bundled into `dist/frontend.js`
  with no runtime network call. Confirm bundle still loads as ESM after each add.
- **Both surfaces**: no theme phase is complete until the float AND the drawer
  tabs are verified in that theme.

### Explicitly out of scope
- Backend / message shapes / event log — untouched.
- The graph tab interaction model — excellent as-is.
- New dependencies or a component framework — none.
- `clip-path` window notches (breaks `overflow:hidden` + `backdrop-filter`) unless
  a theme demands it and we drop blur on that chrome only.

### One runnable check per non-trivial phase
- Theme tokens: a tiny assert that `sanitize()` clamps an out-of-range chrome to
  `illuminated` and that every `MODES` patch only sets known `Theme` keys (extend
  the existing theme test).
- Radar: an assert that `renderBondRadar` returns a non-empty `<svg>` for a known
  bond and `''` for an empty group (so the boundary fallback is exercised).

---

## What the user gets

- **Default**: the calm, legible, hierarchy-first look from mockups 01–06 — on
  both the floating window and every drawer tab.
- **Three themes** selectable from Customize → Themes, each fully re-skinning the
  float AND the drawer:
  - **Fantasy "Codex"** (illuminated) — illuminated manuscript with bundled Cinzel,
    drop-caps, rubric headers, portrait medallions, heraldic bonds, a wax-seal
    close; the float keeps **both Codex (two-page) and Scroll (parchment) layouts**.
  - **Modern "App"** (modern) — calm Inter card-app; float reads as a device with a
    bottom dock, drawer as a clean card stack with an animated tab indicator.
  - **Futuristic "Oracle HUD"** (futuristic) — cyan grid telemetry, reticle avatars,
    a dual-axis bond radar, command-rail footer, telemetry header.
- Each theme composes with all 6 existing skins; every knob still overridable.
- Beautiful where it counts: bundled webfonts, WAAPI motion (reduced-motion safe),
  bespoke SVG radar — all bundled, zero runtime network calls, each phase
  independently revertable.

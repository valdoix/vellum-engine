# VELLUM II — Cards & Surfaces Plan ("six surfaces, one language")

Implements the redesign mockups (06 bonds, 05A shell, 10 Chronicle, 11 Journal,
09 present-cards, plus the Cast Unfold/Strip toggle) under two decisions that
shape everything:

1. **Journal folds into Chronicle** (the "Known & Kept" sub-nav); **Graph becomes
   a tool-icon**. Result: a clean **4 primary tabs — Now / Cast / Bonds /
   Chronicle** — exactly as mockup 05A shows. No more Journal/Graph vs "4 tabs"
   conflict.
2. **Shared structure, themed skin.** Each surface has ONE layout, re-skinned per
   chrome (default / fantasy / modern / futuristic) via palette, fonts, ornament,
   and a few structural accents — NOT four bespoke layouts. This is what makes
   "unique per theme" affordable and keeps default≠fantasy without rebuilding
   anything 4×.

Non-negotiables (carried from prior work): no schema changes — every surface
reuses existing state; per-panel error boundaries stay; HTML escaping stays;
`data-vle-motion='off'` + reduced-motion honored; gate every phase on
`bun run typecheck && bun run test && bun run build`; one commit per phase.

---

## 0. The theme language (the contract for "themed skin")

Every surface below is built ONCE, then skinned by these rules. A surface is not
"done" until it reads correctly in all four. The distinction is **structural
accent + material**, not just color, so default and fantasy never collapse:

| Chrome | Material / shape | Type | Signature accents |
|---|---|---|---|
| **default** | calm flat cards, soft radius, hairline borders | serif body, mono labels | colored left-spine, dot meters |
| **fantasy** (illuminated) | warm **parchment**, page edges, wax/seal motifs | Cormorant + Cinzel drop-caps | rubric-red headers, gilt rules, medallions |
| **modern** | rounded cards, soft shadow, generous padding | Inter sans, pills | accent underline, presence dots, gradient meters |
| **futuristic** | sharp/bracketed, grid void, edge-glow | JetBrains Mono caps, Orbitron display | reticles, `KEY :: VALUE` telemetry, scanlines |

Already shipped and reused as the per-theme accent for bonds: futuristic **radar**
(`theme-render.ts`), fantasy **heraldic shield** rule. These become the
theme-skin of the ONE bond layout, not separate layouts.

Each surface gets a small `[data-vle-chrome='x'] .<surface>` CSS block. Where a
theme needs a structural tweak too large for CSS (rare), it branches in the
render fn behind `getTheme().chrome`, default-safe and boundary-safe.

---

## Phase 1 — Shared primitives (small, unblock the most surfaces)

Two reusable pieces consumed by multiple surfaces. Build first.

### 1A. Diverging-zero bond meter (mockup 06 bonds)
- One helper `bondMeter(aff, trust, dir)` rendering BOTH directions of a pair
  **diverging from a visible center zero** (mockup 06's key idea), replacing/
  upgrading the current `barTwin` so affection & trust asymmetry reads at a glance.
- Reconcile with what exists: the dashboard `relationsBlock` twin-meters and the
  Bonds-tab card must share THIS one primitive (today they differ). The futuristic
  **radar** and fantasy **heraldic shield** stay as the *theme skins* of this same
  bond card (branch in the bond renderer, already present for radar).
- Theme skins: default = diverging bars + zero line; modern = thick rounded
  gradient bars; fantasy = gilded bars inside the shield; futuristic = radar.
- Check: assert `bondMeter` clamps ±100 and renders a zero marker.

### 1B. Present-character card component (mockup 09)
- Extract the dashboard present block into one `presentCard(d)` consumed by the
  drawer Now tab AND the float (container-query reflow, 09B). The inner **thought**
  becomes the focal point (its own quoted block); mood/condition = sentence-case
  sentiment text; portrait medallion + presence dot.
- Theme skins (09 already drew all four): default calm card; fantasy wax-seal on
  parchment; modern rounded + pill tags; futuristic reticle avatar + integrity bar.
- Reuses `scene.detail` (mood/condition/doing/thought). No schema change.

**Phase 1 exit:** bonds + present cards look right on both surfaces, all 4 themes.

---

## Phase 2 — Cast tab: Unfold + Strip toggle (item 6)

Over the existing cast card (already has spine + presence dot + sub-line):
- **Unfold**: collapsed row (name + status) ↔ expanded (appearance, aka, inline
  bond chips, last line) — mockup 08 #3. A per-card open state; one card at a time
  or multi, persisted in component state (no backend).
- **Strip**: a density toggle on the Cast tab header → one-line-per-character mode
  for big casts (mockup 08 #6), with inline bond dots.
- Theme skins: the toggle control + card chrome follow the theme language; the
  card body structure is shared.
- Guard: keep the always-visible (0.4) controls, the status spine, and theming
  intact. Watch combinatorial state (collapsed/expanded × strip × 4 themes) — keep
  it CSS-driven where possible.

**Phase 2 exit:** Cast tab toggles density + unfolds, themed. Self-contained commit.

---

## Phase 3 — Shell IA: 4 primary tabs (mockup 05A, item 2)

Now safe because the Journal/Graph destination is decided.
- **Primary tabs → Now / Cast / Bonds / Chronicle.**
- **Graph → tool-icon** (alongside Vault/Context icons, already demoted).
- **Journal → removed as a top tab**; it becomes a Chronicle sub-view (wired in
  Phase 4B). Until 4B lands, Journal temporarily routes to the Chronicle tab's
  Journal group so nothing is orphaned mid-phase.
- Tools cluster (Graph/Vault/Context) = quiet icons with the existing separator.
- Theme skins: tab bar already themed per chrome (ribbons/underline/segments);
  just ensure the 4-tab + icon layout reads in all four.
- Check: a tiny assert that the primary tab set is exactly the 4 ids.

**Phase 3 exit:** the shell matches 05A in every theme. Commit.

---

## Phase 4 — The big rewrites (drawer-only; float shows "Now")

Largest pieces; each its own multi-step sub-effort and commit.

### 4A. Chronicle "Spine" (mockup 10, A–E)
Re-architect `chronicle.ts` from 8 sibling views into **one story river**:
- **Central spine** with **day-nodes** (`beatDay`) and **Act divider bands**
  (`act`); **beats centered on the spine**, other records branch L/R as cards
  (10A, 10B).
- **Sub-views become FILTERS** over the one river (10D): the grouped sub-nav
  (The World / Known & Kept) now toggles which record types show; "Timeline" = all.
- **Preserve everything already shipped**: beat reordering (▴▾), knowledge irony
  `✗ false`, scar strikethrough, secret "keeps from", per-type color spines (10C).
- **No schema change** (10E): `turn` = spine position, `covers` = span, `beatDay`
  = nodes, `act` = dividers.
- Theme skins: default river; fantasy = manuscript timeline w/ rubric act-headers;
  modern = clean card stream w/ timeline nodes; futuristic = telemetry log w/
  bracketed nodes. Drawer-only (float stays "Now").
- Risk control: build the river as a NEW render path behind the existing view
  switch first, parity-check against current data, then flip sub-nav to filters.
  Keep the component error boundary; the river must degrade to a flat list if a
  row throws.

### 4B. Journal "Shelf + Diary" (mockup 11, A+B) — inside Chronicle
- Journal becomes a Chronicle sub-view (per Decision 1). **Shelf A**: character
  journals as **book spines** (height = entry count, bottom band = dominant
  sentiment, portrait on spine). **Diary B**: clicking a spine opens the
  **two-page diary**, entries as dated handwritten-italic leaves, sentiment-colored
  ink, kind-glyph + weight meta, `about → X` links.
- Reuses `who/about/kind/weight/sentiment/day`. The existing journal
  add/edit/delete + per-character filter logic is preserved, re-skinned.
- Theme skins (11 specifies): default/fantasy = cream diary; modern = clean white
  cards (no skeuomorph); futuristic = mono `MEMORY_LOG` w/ timestamps.
- Drawer-only.

**Phase 4 exit:** Chronicle is a themed story-river that subsumes Journal. Commit
4A and 4B separately.

---

## Sequencing & rationale

1. **Phase 1** (primitives) — smallest, unblocks bonds + present cards everywhere.
2. **Phase 2** (Cast toggle) — self-contained, low risk.
3. **Phase 3** (shell IA) — quick, but must come AFTER deciding Journal's home
   (done) and BEFORE 4B relocates Journal.
4. **Phase 4A then 4B** — the rewrites, last, each gated and reversible.

Theme variants are built WITHIN each phase (never a separate "theme pass"), per
Decision 2 — so nothing is rebuilt 4×.

### Files (no schema, minimal new)
- `format.ts` / `theme-render.ts` — `bondMeter`, `presentCard` helpers + theme
  branches.
- `dashboard.ts` — consume `presentCard` + `bondMeter`.
- `tabs/relations.ts` — bond card uses the shared meter; radar/shield = skins.
- `tabs/cast.ts` — unfold + strip state.
- `tabs/chronicle.ts` — the Spine rewrite + Journal sub-view (absorbs `tabs/journal.ts`).
- `app.ts` — 4 primary tabs, Graph→icon, Journal removed as top tab.
- `styles.ts` — per-chrome skin blocks for each surface.
- Possibly retire `tabs/journal.ts` once folded into Chronicle.

### Guardrails (unchanged)
Escaping; error boundaries (every new render path degrades gracefully);
reduced-motion; focus ring; contrast re-check per skin × chrome (esp. Crimson/
Noir + the light Parchment); each non-trivial phase leaves one runnable assert.

### Out of scope
Backend / event log / message shapes; the float gaining full tab nav (it stays
"Now"); structural per-theme layouts (Decision 2 = skin only).

---

## Coherency notes resolved by the two decisions
- Item 2 no longer fights items 3/4 — Journal has a home (Chronicle), Graph is an
  icon, 4 primary tabs stand.
- Item 7 is no longer a 4× multiplier — "themed skin" means one layout, four skins,
  built per phase.
- Item 1 reconciles with shipped twin-meters/radar/shield via ONE `bondMeter`.
- Items 3 & 4 merge (Journal lives inside Chronicle), reducing two rewrites'
  surface area and giving Chronicle a single coherent home for "what's known/kept".
- Float-scope reality stated: 4A/4B are drawer-only.

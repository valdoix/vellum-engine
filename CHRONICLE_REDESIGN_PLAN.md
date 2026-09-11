# Chronicle Redesign — Implementation Plan
# Memory · Knowledge · Secrets · Scars · Codex

Reference mockup: `design-mockups/chronicle-memory-redesign.html`

All five views live in `src/ui/tabs/chronicle.ts`. Styles live in
`src/ui/styles.ts`. No schema changes — every change is purely presentation
(HTML generation + CSS). No backend, no domain types, no event log touched.

---

## Guiding Constraints

- **Pure view layer.** `chronicle.ts` renders state → HTML strings. All
  changes stay inside the five render functions and the CSS block in
  `styles.ts`. Zero changes to domain types, backend dispatch, or bridge.
- **Preserve all CRUD wiring.** Every `data-*` attribute that the mount
  handler in `chronicle.ts` delegates on must survive. The new markup wraps
  the same actions — it never replaces them.
- **Additive CSS.** New class names (`vle-m-arc`, `vle-m-chap`,
  `vle-k-card`, `vle-sec-card`, `vle-scar-card`, `vle-lore-*`) are added.
  Existing classes (`vle-mem`, `vle-mem--know`, etc.) are kept so chromes
  and shapes that target them don't regress.
- **No pagination regression.** `paginate()` / `pagerHtml()` / `filterBar()`
  / `applyFilter()` calls are unchanged. The new markup wraps their output
  or replaces only the inner row HTML.
- **Build must pass.** After each section, run `npm run build` and
  `npm run typecheck` before moving to the next.

---

## Section 1 — Memory (`memories()`, lines 774–822)

### What changes
Replace the flat `vle-mem` row-per-entry list with three visually distinct
tiers rendered in a fixed order (arcs first, chapters next, uncovered turns
last), independent of the pagination filter.

### New render structure

```
memories(s)
  ├─ sectionHeader (unchanged)
  ├─ tier filter bar (unchanged — 'all' / 'arc' / 'chapter' / 'turn')
  ├─ fold/delete pick controls (unchanged markup, same data-* attrs)
  ├─ arcList(nonBeat)          ← NEW helper: renders arc covers
  ├─ chapterList(nonBeat, s)   ← NEW helper: renders collapsible chapter cards
  └─ uncoveredTurns(nonBeat)   ← NEW helper: renders raw turn chips
```

### `arcList(memories)` — arc cover cards

Each arc renders as `.vle-m-arc` (full-width cover):

```html
<div class="vle-m-arc [done?]">
  <div class="vle-m-arc-bar"></div>
  <div class="vle-m-arc-body">
    <div class="vle-m-arc-head">
      <span class="vle-m-arc-tier">arc</span>
      <span class="vle-m-arc-span">T{covers[0]}–{covers[1]}</span>
    </div>
    <div class="vle-m-arc-text">{text}</div>
    <div class="vle-m-arc-foot">
      <span class="vle-m-arc-covers">covers {N} chapters</span>
      <span class="vle-mem-ctl">
        <button data-mem-edit ...>✎</button>
        <button data-mem-del ...>×</button>
      </span>
    </div>
  </div>
</div>
```

`done` class applied when the arc has no covers intersection with recent
turns (proxy: `m.covers && m.covers[1] < s.turns - 10`). Pick-mode checkbox
prepended identically to current code when `pickable`.

### `chapterList(memories, s)` — collapsible chapter cards

Module-level `Set<string> _chapExpanded` (like `_threadExpanded`).

Each chapter renders as `.vle-m-chap [open|closed]`:

```html
<div class="vle-m-chap [open|closed]" data-chap-id="{id}">
  <div class="vle-m-chap-head" data-chap-toggle="{id}">
    <span class="vle-m-chap-chev">▶</span>
    <span class="vle-m-chap-tier">chapter</span>
    <span class="vle-m-chap-title">{text truncated to 80ch when closed}</span>
    <span class="vle-m-chap-span">T{covers[0]}–{covers[1]}</span>
    <span class="vle-mem-ctl">
      <button data-mem-edit ...>✎</button>
      <button data-mem-del ...>×</button>
    </span>
  </div>
  <!-- body: only rendered when open -->
  <div class="vle-m-chap-body">
    <div class="vle-m-chap-text">{text}</div>
    <div class="vle-m-chap-turns">
      <div class="vle-m-chap-turns-label">▾ {N} source turns</div>
      <div class="vle-m-chap-turn-list">
        {m.subsumed?.map(sub => `<div class="vle-m-turn-chip">t${sub.turn} · ${oneLine(sub.text, 80)}</div>`)}
      </div>
    </div>
  </div>
</div>
```

Source turns come from `m.subsumed` (already on `Memory`). When `subsumed`
is absent or empty, show `<div class="vle-m-turn-chip vle-m-turn-chip--none">no source turns recorded</div>`.

Toggle wiring in `mount()`: add handler for `[data-chap-toggle]` that
toggles `_chapExpanded` and calls `refreshUI()`. Pattern identical to
`[data-leaf-toggle]` (arcs/threads, ~line 192).

### `uncoveredTurns(memories)` — dense chip rows

Turns NOT subsumed by any chapter (i.e., no chapter's `subsumed` array
contains their id). Renders as:

```html
<div class="vle-m-turns-label">uncovered turns (N)</div>
<div class="vle-m-turns-grid">
  <div class="vle-m-turn-raw">
    <span class="vle-m-turn-t">t{turn}</span>
    <span class="vle-m-turn-x">{oneLine(text)}</span>
    <span class="vle-mem-ctl">
      <button data-mem-edit ...>✎</button>
      <button data-mem-del ...>×</button>
    </span>
  </div>
</div>
```

Uncovered turns detection: build a Set of all subsumed ids from all chapters,
then filter turns that aren't in that set.

### Filter bar interaction
The `cat` filter still works: when 'arc', show only arc covers; when
'chapter', show only chapter list + hide uncovered; when 'turn', show only
uncovered turns grid; when 'all', show everything.

### CSS additions (styles.ts)
```
.vle-m-arc           — flex row, 5px gold left rail, surface2 bg, border
.vle-m-arc-bar       — 5px wide, gradient gold
.vle-m-arc-body      — flex 1, padding
.vle-m-arc-head      — flex, justify-between
.vle-m-arc-tier      — mono, gold, small badge
.vle-m-arc-span      — mono, faint
.vle-m-arc-text      — serif, italic, ink-dim
.vle-m-arc-foot      — flex, space-between
.vle-m-arc-covers    — mono, faint
.vle-m-arc.done      — opacity 0.55
.vle-m-chap          — border, surface2, border-radius
.vle-m-chap-head     — flex, cursor pointer
.vle-m-chap-chev     — rotation transition
.vle-m-chap.open .vle-m-chap-chev  — rotate(90deg)
.vle-m-chap-tier     — mono, faint, small badge
.vle-m-chap-title    — ink, overflow ellipsis when closed
.vle-m-chap-span     — mono, faint, margin-left auto
.vle-m-chap-body     — display none default, border-top
.vle-m-chap.open .vle-m-chap-body  — display block
.vle-m-chap-text     — serif, italic, ink-dim
.vle-m-chap-turns    — bg gold 4%, border, radius
.vle-m-chap-turns-label  — mono, gold-dim
.vle-m-turn-chip     — mono, faint, border-bottom separator
.vle-m-turns-label   — mono, uppercase, faint
.vle-m-turns-grid    — flex column, gap
.vle-m-turn-raw      — flex, bg gold 4%, border, radius
.vle-m-turn-t        — mono, gold-dim
.vle-m-turn-x        — serif, ink-faint, flex 1
```

---

## Section 2 — Knowledge (`knowledge()`, lines 831–849)

### What changes
Replace the flat per-fact `vle-mem` rows with character-grouped epistemic
cards. The `filterBar` / `applyFilter` by `who` becomes the grouping
mechanism instead.

### New render structure

```
knowledge(s)
  ├─ sectionHeader (unchanged)
  ├─ who filter bar (unchanged)
  └─ characterCards(filtered_knowledge, s)  ← NEW
```

Instead of a flat row list, group filtered facts by `k.who`, then render
each group as a `.vle-k-card`:

```html
<div class="vle-k-card">
  <div class="vle-k-card-head">
    <span class="vle-k-card-name">{nameOf(s, who)}</span>
    <span class="vle-k-card-count">{N} facts</span>
  </div>
  <div class="vle-k-rows">
    {facts.map(k => kRow(k, s))}
  </div>
</div>
```

### `kRow(k, s)` — per-fact row

```html
<div class="vle-k-row [believes|suspects|irony]">
  <span class="vle-k-rel vle-k-rel-{reliability}">{icon}</span>
  <span class="vle-k-fact">
    {isFalse ? '<span class="vle-k-irony-label">⚠ false</span>' : ''}
    {esc(k.fact)}
  </span>
  {k.about ? `<span class="vle-k-about">re: {nameOf(s, k.about)}</span>` : ''}
  <button class="vle-mini del" data-know-del data-id="...">×</button>
</div>
```

Reliability → row class + icon:
- `knows`   → no class, `·` icon (neutral, muted)
- `believes`→ `.believes`, `◆` icon (amber)
- `suspects`→ `.suspects`, `›` icon (faint amber)
- `wrong` / `truth === 'false'` → `.irony`, `✗` icon (crimson, full row tint)
- `unaware` → no class (rendered faint)

The existing `relChip()` helper is replaced by the new inline icon approach.
`vle-krel` classes are kept in CSS (not removed) for safety but the new
rows use `vle-k-rel-*` instead.

Pager still applies: `paginate()` runs on the full filtered list before
grouping so page boundaries are respected.

### CSS additions (styles.ts)
```
.vle-k-card          — border, surface2, radius, overflow hidden
.vle-k-card-head     — flex, space-between, padding, border-bottom, gold wash bg
.vle-k-card-name     — serif, font-weight 600, ink
.vle-k-card-count    — mono, faint
.vle-k-rows          — padding 0.5rem 0
.vle-k-row           — flex, align baseline, gap, padding, hover bg
.vle-k-row.believes  — background gold 7%
.vle-k-row.suspects  — background gold 3%
.vle-k-row.irony     — background v-neg 12%, border-left 3px v-neg 60%
.vle-k-rel           — flex-shrink 0, width 18px, text-center
.vle-k-rel-knows     — color ink-faint
.vle-k-rel-believes  — color amber
.vle-k-rel-suspects  — color amber, opacity .6
.vle-k-rel-wrong     — color v-neg-i  (reuses --v-neg-i already in palette)
.vle-k-rel-irony     — same as wrong (truth=false path)
.vle-k-fact          — flex 1, serif, ink-dim
.vle-k-irony-label   — mono, crimson, badge pill, margin-right
.vle-k-about         — mono, faint, flex-shrink 0, nowrap
```

---

## Section 3 — Secrets (`secrets()`, lines 851–865)

### What changes
Replace `vle-mem vle-mem--secret` rows with `.vle-sec-card` danger-coded
envelope cards. The `shapeOrnament()` call is removed (the ornament system
doesn't understand the new structure). The `filterBar` / `applyFilter` by
keeper is kept.

Secret type has no `danger` field. We derive danger from a convention:
- `secret.text.length > 180 || secret.from.length >= 3` → explosive
- `secret.from.length >= 2 || secret.text.length > 80` → major
- else → minor

This is a heuristic and clearly labelled as such in comments. It can be
upgraded to a real field later without touching this plan.

### New render structure

```html
<div class="vle-sec-card vle-sec-card--{danger} [vle-sec-card--revealed]">
  <div class="vle-sec-danger-bar"></div>
  <div class="vle-sec-body">
    {revealed ? '<div class="vle-sec-watermark">REVEALED</div>' : ''}
    <div class="vle-sec-head-row">
      <span class="vle-sec-keeper">{nameOf(s, sec.keeper)}</span>
      <span class="vle-sec-danger vle-sec-danger--{danger}">{danger}</span>
      <span class="vle-sec-from-label">hidden from</span>
      {sec.from.map(f => `<span class="vle-sec-from-chip">{nameOf(s,f)}</span>`)}
    </div>
    <div class="vle-sec-text">{esc(sec.text)}</div>
    <div class="vle-sec-foot">
      <span class="vle-sec-turn">formed t{formedTurn}</span>
      <span class="vle-mem-ctl">
        {!revealed ? `<button data-sec-reveal data-id="...">◐</button>` : ''}
        <button class="vle-mini del" data-sec-del data-id="...">×</button>
      </span>
    </div>
  </div>
</div>
```

Existing `data-sec-reveal` and `data-sec-del` wiring is fully preserved.
`vle-mem vle-mem--secret` class is retained on an invisible wrapper
(or removed cleanly — the mount handler delegates on `data-sec-*` attrs
not class names, so the class can be dropped safely after checking mount).

### CSS additions (styles.ts)
```
.vle-sec-card            — flex, border, radius, overflow hidden, transition
.vle-sec-danger-bar      — 4px wide, flex-shrink 0
.vle-sec-card--minor     — surface2 bg; bar = info blue gradient
.vle-sec-card--major     — warm bg tint; bar = amber gradient
.vle-sec-card--explosive — crimson bg tint; bar = crimson gradient
.vle-sec-card--revealed  — opacity .52, border-style dashed
.vle-sec-body            — flex 1, padding, position relative, overflow hidden
.vle-sec-watermark       — position absolute, rotated, crimson, low opacity
.vle-sec-head-row        — flex, align center, gap, flex-wrap
.vle-sec-keeper          — font-weight 600, ink
.vle-sec-danger          — mono, small badge pill
.vle-sec-danger--minor   — info color
.vle-sec-danger--major   — amber color
.vle-sec-danger--explosive — crimson color
.vle-sec-from-label      — mono, faint
.vle-sec-from-chip       — mono, surface3, border, radius 999px
.vle-sec-text            — serif, ink-dim, line-height 1.6
.vle-sec-foot            — flex, space-between, align center
.vle-sec-turn            — mono, faint
```

---

## Section 4 — Scars (`scars()`, lines 869–884)

### What changes
Replace `vle-mem vle-mem--scar` rows with `.vle-scar-card` palimpsest cards.
The `filterBar` / `applyFilter` by `who` is **dropped** — grouping replaces it.

### New render structure

Group scars by `x.who`. Each group:

```html
<div class="vle-scar-group">
  <div class="vle-scar-group-head">{nameOf(s, who)}</div>
  {scarsForWho.map(x => scarCard(x, s))}
</div>
```

Each card:

```html
<div class="vle-scar-card">
  <div class="vle-scar-head">
    <span class="vle-scar-turn">overturned t{x.turn}</span>
    <button class="vle-mini del" data-scar-del data-id="...">×</button>
  </div>
  <div class="vle-scar-was">
    {esc(x.was)}
    {x.about ? `<span class="vle-scar-about">about: {nameOf(s, x.about)}</span>` : ''}
  </div>
  <div class="vle-scar-divider"></div>
  <div class="vle-scar-now">
    <span class="vle-scar-now-label">proved wrong</span>
    {x.note || 'Belief overturned.'}
  </div>
</div>
```

**Note on `x.note`**: `Scar` currently doesn't have a `note` field — only
`was`, `who`, `about`, `turn`, `id`. The "proved wrong" context line in the
mockup needs content. Options:
1. Show nothing if no note (`proved wrong` label + empty body = fine as stub)
2. Add `note?: string` to `Scar` in `types.ts` — a minor schema addition
   that still requires no backend/event log change (the render just checks
   `x.note ?? ''`)

**Recommendation**: go with option 1 for now and leave a TODO comment.
The label `proved wrong · t{turn}` alone communicates more than the current
design. A note field can be added separately.

`filterBar` for scars is **removed** from this function. The `applyFilter`
call is also removed. `paginate()` is kept on the flat `list` before grouping.

### CSS additions (styles.ts)
```
.vle-scar-group          — margin-bottom
.vle-scar-group-head     — mono, uppercase, gold-dim, border-bottom keyline
.vle-scar-card           — border crimson-dim, bg crimson radial gradient 7%,
                           padding, radius, transition
.vle-scar-card::before   — radial crimson bleed from left (atmospheric)
.vle-scar-head           — flex, align baseline, gap
.vle-scar-turn           — mono, faint
.vle-scar-was            — serif, color rgba(crimson, .65), text-decoration
                           line-through with crimson color, line-height 1.55
.vle-scar-about          — mono, faint, no text-decoration, margin-left
.vle-scar-divider        — repeating-linear-gradient dashed crimson rule
.vle-scar-now            — serif, italic, ink-faint, flex with label
.vle-scar-now-label      — mono, uppercase, crimson-bright, small badge
```

---

## Section 5 — Codex (`codex()`, lines 887–896)

### What changes
Replace flat `vle-mem vle-mem--codex` rows with tag-grouped `.vle-lore-*`
index. No filter bar (grouping replaces it). No pagination (Codex is small;
keep `paginate()` commented out for now with a TODO if it grows).

### New render structure

Group by `x.tag || 'canon'`. Sort groups alphabetically; 'canon' last.
Each group:

```html
<div class="vle-lore-group">
  <div class="vle-lore-group-head">{tag}</div>
  {entriesForTag.map(x => loreRow(x))}
</div>
```

Each row:

```html
<div class="vle-lore-row">
  <span class="vle-lore-fact">{esc(x.fact)}</span>
  <span class="vle-lore-turn">t{x.turn}</span>
  <button class="vle-mini del" data-lore-del data-id="...">×</button>
</div>
```

`data-lore-del` wiring is preserved. The section header `+` button and
`data-lore-add` are unchanged.

### CSS additions (styles.ts)
```
.vle-lore-group          — margin-bottom
.vle-lore-group-head     — mono, uppercase, letter-spacing, gold-dim,
                           border-bottom keyline rule
.vle-lore-row            — flex, align baseline, gap, padding,
                           border-left 2px gold 35%, radius 0 5px 5px 0,
                           hover: border-left gold 100%, bg gold 4%,
                           transition
.vle-lore-fact           — flex 1, serif, ink-dim, line-height 1.5
.vle-lore-turn           — mono, faint, flex-shrink 0
```

---

## Implementation Order

1. **CSS first** — add all new class definitions to `styles.ts` in one block
   at the end of the file (before the closing `].join('\n')`). No visual
   change yet since no HTML uses them. Build passes.

2. **Codex** — simplest rewrite (no new module state, no toggle). Estimated
   10–15 lines of render code. Confirm build + visual check.

3. **Scars** — remove filter bar, add grouping + card HTML. No new module
   state. Estimated 20 lines. Build + check.

4. **Knowledge** — add grouping by character, new `kRow()` helper. Replace
   `relChip()` inline. Estimated 30 lines. Build + check.

5. **Secrets** — add `secretDanger()` heuristic, new card HTML. Estimated
   25 lines. Build + check.

6. **Memory** — largest change: new `_chapExpanded` Set, three new helper
   functions, new mount handler for `[data-chap-toggle]`. Estimated 80 lines.
   Build + full check.

7. **Final pass** — remove any dead CSS from the old `.vle-mem--know`,
   `.vle-mem--secret`, `.vle-mem--scar`, `.vle-mem--codex` left-border rules
   if confirmed unused. Keep `.vle-mem` and its base styles — beats and
   other surfaces still use them.

---

## Checklist

### CSS (`src/ui/styles.ts`)
- [ ] Add `.vle-m-arc*` block
- [ ] Add `.vle-m-chap*` block
- [ ] Add `.vle-m-turns-*` block
- [ ] Add `.vle-k-card*`, `.vle-k-row*` block
- [ ] Add `.vle-sec-card*` block
- [ ] Add `.vle-scar-card*`, `.vle-scar-group*` block
- [ ] Add `.vle-lore-group*`, `.vle-lore-row*` block

### chronicle.ts
- [ ] Add `_chapExpanded: Set<string>` module-level
- [ ] Add `arcList()` helper
- [ ] Add `chapterList()` helper
- [ ] Add `uncoveredTurns()` helper
- [ ] Rewrite `memories()` to call three helpers
- [ ] Add `[data-chap-toggle]` handler to `mount()`
- [ ] Add `kRow()` helper
- [ ] Rewrite `knowledge()` to group by character
- [ ] Add `secretDanger()` helper
- [ ] Rewrite `secrets()` to use `.vle-sec-card`
- [ ] Rewrite `scars()` to group by character, drop filter bar
- [ ] Rewrite `codex()` to group by tag

### Verification
- [ ] `npm run build` passes after each section
- [ ] `npm run typecheck` clean after all sections
- [ ] All `data-mem-edit`, `data-mem-del`, `data-know-del`, `data-sec-reveal`,
      `data-sec-del`, `data-scar-del`, `data-lore-del` still fire correctly
- [ ] Fold / delete pick mode still works in Memory
- [ ] Filter pills correctly hide/show sections in Memory
- [ ] Pagination still works in Knowledge and Secrets

---

## Notes

1. **`Secret.danger`**: The type has no danger field. The heuristic
   (`text.length` + `from.length`) is a temporary proxy. Future: add
   `danger?: 'minor' | 'major' | 'explosive'` to `Secret` in `types.ts`
   and emit it from the backend when secrets are minted.

2. **`Scar.note`**: No note field on `Scar`. The "proved wrong" context line
   in the mockup shows narrative detail that doesn't currently exist. The
   card renders correctly without it — the label alone is an improvement.
   Future: add `note?: string` to `Scar`.

3. **Chapter source turns**: `Memory.subsumed` already contains the raw
   turn summaries that were folded into the chapter. The turn chip list in
   the open chapter uses `subsumed` directly — no new data needed.

4. **Uncovered turns detection**: A turn is "covered" if its `id` appears
   in any chapter's `m.subsumed` array. This requires O(chapters × subsumed)
   per render but chapters are small (< 20 typically) and subsumed arrays
   are small (< 10) so this is negligible.

5. **Removed filter bar in Scars and Codex**: `filterBar()` and
   `applyFilter()` calls are removed from those two functions only. The
   bridge filter state (`_filter.get('scars')`) becomes stale but harmless —
   it's never read without a call to `applyFilter`. No cleanup needed.

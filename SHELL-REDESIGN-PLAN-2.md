# VELLUM II — Shell redesign: remaining phases (concrete plan)

Shipped (commit bcf1ca4): Actions menu (P1), tiered tabs + Context rename (P2),
rationed accent (P3), journal sentiment tokens (P4), `emptyState()` helper + the
two bare "—" empties (P5 core), per-tab scroll (P6), Now tab (P7a).

This plan covers what's left, re-scoped against the actual current code (the
survey changed some assumptions — control glyphs are already consistent, so the
glyph work is small; the header split is the real consistency debt).

Gate every phase: `bun run typecheck && bun run test && bun run build`.

---

## Phase 5b — Finish empty-state + header consistency (low risk, mechanical)

### 5b.1 Adopt `emptyState()` everywhere
Survey shows ~14 hand-rolled `vle-empty` strings still bypass the helper, in two
shapes (terse one-liners vs `<br><span>` hints). Route the plain narrative ones
through `emptyState(msg, hint?)` so voice + markup match:
- `cast.ts:115,122,158,165`, `relations.ts:22,33`, `chronicle.ts:72,81`,
  `journal.ts:36,45,79`, `graph.ts:29`, `injection.ts:27`.
- Leave as-is (intentional, not plain text): `vault.ts:38` (loading spinner),
  `vault.ts:76` (embedded `<b>` actions), `dashboard.ts:53` / `app.ts` dashboard
  catch (error fallback). Document why in a one-line comment so a future pass
  doesn't "fix" them.
- Split into "nothing yet" (with a hint) vs "no match for filter" (terse, no
  hint) — two consistent voices, one per situation.

### 5b.2 One section-header component
Today headers are split: `vle-sec-top` (title + action, used by cast/journal/
relations/vault/injection) vs `vle-sec-h` (glyph + count + inline `+`, used by
chronicle's Memory/Knowledge/Secrets) vs `vle-book-head` (journal book view).
- Add a tiny `sectionHeader({ title, glyph?, count?, action? })` helper in
  `format.ts` returning one consistent structure, and migrate the call sites.
- Keep the two visual roles (top-level section vs sub-section) as modifier
  classes, not separate ad-hoc markup. Normalizes the uneven vertical rhythm
  (the original critique point).
- Pure HTML helper; no behavior change, same `data-*` hooks preserved.

### 5b.3 Glyph audit (small — most already consistent)
Per-row controls are already uniform (edit `✎` U+270E, delete `✕` U+2715). Only
loose ends:
- `chronicle.ts` section glyphs (📖/◈/⛀) are decorative section identity — keep.
- Confirm no functional control still uses ❖ (brand mark). Cast promote already
  moved to ⤴; nothing else does. Just assert it with a grep in review.
Net: 5b.3 is a verification step, not a rewrite. Don't manufacture churn.

## Phase 7b — Chronicle sub-navigation (medium risk, the one real refactor)
`chronicle.ts` stacks 6 heterogeneous sections (scene, arcs, threads, memory,
knowledge, secrets) in one scroll with per-section filter bars + pagers.
- Add light in-tab sub-nav: **World** (scene + arcs + threads) · **Memory** ·
  **Knowledge** · **Secrets**. One active sub-view at a time, default World.
- Reuse the cast tab's local-state-as-segmented-control pattern (`_st`/`setPage`
  + version-key fold) — no new infra.
- Each sub-view keeps its existing filter/pager wiring untouched; this only gates
  which section renders. Reduces the 6-deep scroll to one focused view.
- Risk: it's the only working multi-section view being restructured. Ship it
  alone, verify each sub-view renders + its filters still work, before anything
  else rides along.
- ponytail: if sub-nav feels heavy for 3 short lists, fall back to keeping World
  as the default scroll and only splitting Memory/Knowledge/Secrets. Decide after
  seeing it with real data.

## Phase 8 — Search/command palette (build only if needed)
Still no free-text find across the growing chronicle. Spec if pursued:
- One input (a QOL/`data-actions`-adjacent affordance, or `/`-to-focus) matching
  cast, relations, journal, knowledge, factions by name.
- Results jump to the owning tab + set that tab's existing filter (`setFilter`/
  local `_st`) to the match — reuses filter infra, adds no storage.
- Gate: only build if play with a large chronicle shows find is actually painful.
  YAGNI until then; leave this as a written spec.

---

## Sequencing & risk
1. **5b** first — purely additive helpers + call-site swaps, lowest risk, closes
   the visible consistency gaps. One commit.
2. **7b** second — isolated, the only structural change; its own commit so it can
   be reverted independently if the sub-nav feels wrong with real data.
3. **8** — deferred spec; implement on demand.

## Out of scope (unchanged)
- Graph interaction model (excellent as-is).
- Backend/message shapes.
- No new component framework or deps.

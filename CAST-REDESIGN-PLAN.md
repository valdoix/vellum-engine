# VELLUM II — Cast tab redesign (implementation plan)

Make the Cast tab answer a roster's three questions fast: **who's here, who
matters, find X.** Today presence is buried in section headers, there's no
filter, and the list is shattered across up to 8 independent pagers.

Files: `src/ui/tabs/cast.ts`, `src/ui/styles.ts`, `src/ui/format.ts`. Reuse the
existing `bridge.ts` filter/pagination infra (filterBar/applyFilter/paginate/
pagerHtml/filterOf). No new deps. Gate: `bun run typecheck && bun run test &&
bun run build`.

## Problems being fixed
1. **8-pager fragmentation** — 4 character status groups + 4 faction groups,
   each paginating separately (`paginate('cast-'+gid)`, `paginate('fac-'+gid)`).
2. **Empty groups still render** a header + "—" (cast.ts:95).
3. **Cast has no filters** though it's the most populous list (memory/relations/
   vault all got them).
4. **Status invisible after scroll** — lives only in the header; only Present
   gets a card cue (`.vle-card.on`).
5. **Faction standing is text-only** — plan (FACTIONS line 113) asked for a meter.
6. **Control noise** — 3 mini-buttons always visible per card; promote glyph ❖
   collides with the brand mark.

## Phase 1 — One list + status filter (characters)
- Replace the 4 hard groups with a **single list, single pager** per side.
- Add a status filter bar reusing `filterBar('cast', { cats: [...] })` semantics,
  but cast needs a status dimension + a few sort modes the shared 2-way sort
  doesn't cover, so use a small local control set rendered with the existing
  `.vle-fbar`/`.vle-fb-btn`/`.vle-fb-sel` classes:
  - status chips: `All · ◉ Present n · ○ Active n · ‹ Mentioned n · ★ Added n`
    (chips with count 0 are omitted, not shown empty).
  - sort: `present-first` (default) · `newest` · `oldest` · `A–Z`.
- Default sort `present-first` = order by status rank (present>active>mentioned>
  added) then `byRecent`, so "who's on stage" still floats up without a section.
- Drive filter/sort/page through the existing per-list state; reset page to 0 on
  any filter/sort change (mirror vault's `setPage('cast',0)` calls).
- Fold the filter+sort signature into the tab `version()` key so UI-only changes
  re-render (same pattern as vault's `_sort`).

## Phase 2 — Status on the avatar (self-describing cards)
- Add a status class to the card (`vle-card--present/active/mentioned/added`).
- styles: avatar treatment — present = gold ring + soft glow; active = solid soft
  ring; mentioned = dim dashed outline; added = faint. Keep `.vle-card.on` border
  for present as-is or fold into the present variant. Built on existing `--vg`/
  `--vg-rgb` + semantic tokens; no new hex.
- Collapse `role · age · appearance` competition: one muted meta line
  (`role · age`) + appearance truncated below, as today, but ensure the two tiers
  don't both read at ~the same weight (appearance to `--vi2`, smaller).

## Phase 3 — Faction standing meter (reuse relations bar)
- Extract `bar(label, v)` from `relations.ts` into `format.ts` (pure, returns the
  -100..100 bar HTML using `.vle-bar*` classes). Import it in both tabs.
- In `factionCard`, replace the text `wary (-20)` with the bar + keep the word as
  caption. Standing is the same -100..100 shape as affection, so the bar applies
  directly. Satisfies FACTIONS plan line 113.
- Apply the same single-list + status-filter treatment to factions (one pager).

## Phase 4 — Hover/focus-reveal controls + glyph fix
- styles: `.vle-card-ctl` opacity 0 → reveal on `.vle-card:hover` and
  `:focus-within` (kept in DOM, not display:none — keyboard/touch a11y). Honor
  `data-vle-motion='off'` (transitions already globally killed there).
- Give promote its own glyph (⤴ U+2934 or ⇧) instead of ❖ so it stops colliding
  with the window brand mark.

## Verify
`bun run typecheck` → `bun run test` → `bun run build`. Manual: reload in
Lumiverse, check a lopsided cast (mostly mentioned), empty statuses hidden, one
pager per side, faction meter renders, controls reveal on hover + keyboard focus.

## Deliberately out of scope (YAGNI)
- No separate Factions tab (plan rec: Cast-tab section first).
- No member-management redesign beyond the standing meter + chip tidy.
- No inline editing, no drag-reorder.

## Order / risk
Phase 1 is the biggest win and the riskiest (touches render + state); ship and
eyeball it first. Phases 2–4 are additive polish. Each phase is independently
shippable and independently verifiable.

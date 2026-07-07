# RELATIONS REFACTOR — Implementation Plan

Presentation-layer refactor of the two relationship surfaces (the **Now** tab's
Relations block and the **Bonds** tab) into one shared, density-aware bond
component. **No engine, schema, reducer, or event-log change.** Mockup:
`design-review/40-relations-refactor.svg`.

## Goals

1. One `bondCard` component with three densities (`full` / `compact` / `strip`),
   replacing the divergent `vld-rel` (dashboard) and `vle-rel-*` (relations) paths.
2. Make **asymmetry the headline** — per-direction verdict + an `asymmetric` badge,
   instead of a single averaged verdict that hides it.
3. Replace the 4-bar `bondMeter` with a **dumbbell meter**: one shared track per
   axis, two directional dots, the connector length = the asymmetry.
4. Promote the dual aff/trust **sparkline** out of the collapsed `<details>` into an
   always-on (static) mini view in full density.
5. Fold redundant text (per-direction sentiment word, labels, category chips) into a
   quiet foot; add a category/sentiment **warmth spine** matching cast cards.
6. Preserve every invariant: futuristic radar unchanged, mono numerals + hover
   tooltips (never lossy), `data-vle-motion` / `prefers-reduced-motion` respected,
   error-boundary safety.

## Constraints & anchors (verified in code)

- `Relation` (domain/types.ts:88): `a,b,label,categories,category,affection,trust,
  sentiment,status,history,categoryHistory,lastTurn`. Scores are -100..100.
- Existing helpers to reuse/extend in `src/ui/format.ts`: `bondMeter` (276),
  `bondVerdict` (299), `affectionTone` (325), `trustBand` (331), `bondTitle` (337),
  `bondDot` (346), `catsOf` (233), `abbr` (351), `esc`, `nameHtml`, `nameOf`,
  `CAT_COLORS` (47), `SENT_LABEL` (52).
- Callers: `dashboard.ts:233` `relationsBlock`; `relations.ts:124` `card` (+
  `pairHistoryHtml` 185, `arcSparkline` 211). Futuristic branch uses
  `renderBondRadar` (theme-render.ts:21) — leave as-is.
- CSS lives as string entries in `src/ui/styles.ts` (bond block ≈ lines 591–649,
  649 `vle-bm-*`, plus per-chrome overrides ~1357–1634). Card shape hook: `bonds`
  surface → `.vle-rel-card` (styles.ts:66); keep that root class so
  `data-shape-bonds` / `activeShape('bonds')` keep working.
- Components re-render on a `version()` string diff (component.ts:58). Any new
  visual state must be reflected in the caller `version()` so it repaints.

## Design decisions

- **Directions.** A pair `group` is 1–2 directed edges. Order endpoints by the
  stable sorted key (as `relations.ts:128` already does) so `pa`/`pb` read the same
  regardless of authoring order. "she/he" style labels come from `nameOf`, not gender.
- **Asymmetry test.** `asymmetric = dirs.length === 2 && (signDiff(aff) || signDiff(trust) || Math.abs(aff1-aff2) > 40 || Math.abs(tru1-tru2) > 40)`. Threshold constant, tunable.
- **Dumbbell overlap.** When two dots nearly coincide, they must still read as two:
  each dot gets a 1.5px surface-colored outline + explicit z-order (second dot on
  top). One-sided pairs render a single dot + a faint "no reciprocal" ghost tick.
- **Verdict.** Keep `bondVerdict` but call it **per direction** for the header reads;
  keep the averaged call available for `strip` (space-constrained).
- **Sparkline.** Reuse `arcSparkline` (relations.ts:211) verbatim; render it inline in
  `full`, still static. Numeric score/category trails stay inside `<details>`.

## Work breakdown

### Step 1 — `format.ts`: shared bond primitives
- Add `type BondDensity = 'full' | 'compact' | 'strip'`.
- Add `bondDumbbell(dirs, axis: 'aff'|'trust', nameFor, opts)` returning one track row
  with 1–2 dots + connector; values as mono text in `full`, hover-only in `compact`.
  Reuses the -100..100 → % mapping from `bondRow` (format.ts:260).
- Add `isAsymmetric(dirs)` and `bondReads(dirs, nameFor)` → `{ a: verdictA, b: verdictB, asym: boolean }` (wraps `bondVerdict` per direction).
- Add `bondCard(state, group, density)` composing: spine class (from dominant
  `catsOf`/sentiment), header (pair + reads + asym badge + ctl slot), two dumbbell
  rows, and — in `full` only — the sparkline + label/category foot + history details.
  Keep the ctl buttons (`data-rel-edit`/`data-rel-del`/`data-rel-lock`) as a passed-in
  slot so only the Bonds tab wires CRUD.
- Keep `bondMeter` exported temporarily (deprecation shim) until callers are migrated.

### Step 2 — `styles.ts`: one `.vle-bc` block
- New CSS entries for `.vle-bc`, `.vle-bc--full/compact/strip`, `.vle-bc-spine`,
  `.vle-bc-reads`, `.vle-bc-asym`, `.vle-bc-track`, `.vle-bc-dot`, `.vle-bc-conn`,
  `.vle-bc-foot`. All on theme vars (`--v-pos`, `--v-info`, `--vg`, `--vsurf-*`,
  `--vscale`). Warmth spine mirrors `.vle-card--*` (styles.ts:461-465).
- Keep `.vle-rel-card` as the outer class (shape hook). Add per-chrome tweaks only
  where the existing bond CSS already special-cases (modern/illuminated/futuristic/
  bloom/ember/faewild); dumbbell dots reuse existing glow patterns.
- Ensure `data-vle-motion='off'` + `prefers-reduced-motion` leave the (static)
  sparkline untouched and add no transitions the global kill-switch must fight.

### Step 3 — `relations.ts` (Bonds tab): call the shared component
- Replace `card()` body with `bondCard(s, group, 'full')`, passing the lock badge +
  CRUD ctl slot. Keep `lockForm`/`relForm`/`pairHistoryHtml`/`arcSparkline` (import
  the sparkline from a shared spot or keep local and pass in).
- Preserve futuristic branch: if `getTheme().chrome === 'futuristic'`, viz =
  `renderBondRadar`; else the dumbbell. (Same conditional as today, relations.ts:162.)
- Keep filter bar, pagination, add button, and `mount()` delegation unchanged.
- Update `version()` if a new visual toggle (density) is user-controllable.

### Step 4 — `dashboard.ts` (Now tab): call the shared component
- Replace `relationsBlock`'s bespoke `vld-rel` + `bondMeter` rows with
  `bondCard(s, group, 'compact')` (no CRUD slot). Keep present-filter + cap-at-5.
- Confirm `version()` (app.ts:107 dashboard slice) still captures relation changes
  that affect the compact card (it hashes `s.relations.length`; add score sum if the
  compact card shows values that the current hash misses).

### Step 5 — remove dead code
- Delete the old `vld-rel*` CSS if no longer referenced (grep first: styles.ts:1040,
  1042, 1357-1358, 1251). Remove `bondMeter` shim once both callers migrated. Keep
  `bondDot`/strip usage in `cast.ts` (still used there).

## Verification

- `bun run typecheck` (strict) — must pass.
- `bun run test` (vitest) — run existing suite; add a small unit test for
  `isAsymmetric` and `bondReads` (pure functions, easy to cover).
- `bun run build` then reload the extension in Lumiverse.
- Manual matrix (both surfaces): symmetric pair, asymmetric pair (opposite-sign
  trust), one-sided pair, deceased/`past` status, long names (ellipsis), a pair with
  2+ categories, empty state, and each of the 7 chromes (spot-check futuristic radar
  still renders and modern/illuminated spines look right). Confirm reduced-motion.

## Risks / caveats

- **Dumbbell overlap** at near-equal scores — mitigated by outline + z-order; verify
  at real render sizes and small `--vscale`.
- **`version()` under-hashing** — if the compact card surfaces a value not in the
  dashboard slice hash, turns won't repaint it. Add the field to the hash.
- **Chrome CSS specificity** — the bond block has many `html[data-vle-chrome=...]`
  overrides; renaming classes means re-checking each chrome. Keep `.vle-rel-card`
  outer class to minimize churn and preserve the card-shape system.
- **Scope creep** — resist adding new tracked data; this is display-only. Asymmetry,
  verdicts, and the arc are all derived from existing `Relation` fields.

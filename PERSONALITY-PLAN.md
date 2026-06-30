# VELLUM II — Cast personality section (implementation plan)

Give each cast card a durable **personality** layer: a short `disposition`
one-liner plus a small `traits[]` tag set. This closes a real gap — the preset's
CAST block (vellum-ii.json:353) demands "honor who THIS character is" and
"distinct voice = baseline + background + current state", but the authoritative
feed-back (`structuredBlock`, recall.ts:80-83) only injects `role; age;
appearance`. Personality is never tracked or fed back. `mood/thought`
(PresentChar) is *transient* per-turn state, not stable traits.

Scope: **emergent** personality only (revealed/evolved in play) — NOT a re-state
of the host card's `char_personality` marker. Lean by default. Follows the repo's
3-touchpoint rule: schema field + reducer case + emitter, plus UI + feed-back.

Files: `src/domain/types.ts`, `src/core/events.ts`, `src/core/reduce.ts`,
`src/domain/core-feature.ts`, `src/domain/commands.ts`, `src/parse/parsed.ts`,
`src/ui/tabs/cast.ts`, `src/ui/styles.ts`, `src/domain/promote.ts`,
`src/retrieval/recall.ts`, `presets/vellum-ii.json`. No new deps.
Gate: `bun run typecheck && bun run test && bun run build`.

## Data shape (additive, no migration)
Append-only log + all-optional fields ⇒ no `SCHEMA_VERSION` bump, no migrate
step (old logs simply lack the fields; reduce tolerates absence). Mirror the
existing `color`/`colorTo` additive precedent.

- `CastCard` (types.ts:9) — add:
  - `disposition?: string;` // one-line stable temperament, distinct from `note`
  - `traits?: string[];`    // 3-6 short tags: "guarded", "dry wit", "talker"
- `CastPatch` (events.ts:73) — add `disposition: z.string().optional()` and
  `traits: z.array(z.string()).optional()`. `cast.edit` already routes patches
  through; no new event kind needed.

## Phase 1 — Model & reducer (the spine)
- types.ts: add the two optional fields to `CastCard`.
- events.ts: extend `CastPatch` (drives both `cast.edit` and the user-CRUD path).
- reduce.ts `cast.edit` (123-135): already `Object.assign(c, safe)` over the
  patch, so new keys flow through for free. Add a clear-on-empty rule mirroring
  color (130-132): `if (safe.disposition === '') delete c.disposition;` and treat
  an empty `traits` array as clear (`delete c.traits`). Cap `traits` to ~6 and
  dedupe/trim here so a runaway model can't bloat a card.

## Phase 2 — Emitter (model authorship via `present`)
The model already emits per-character data in the `<vellum>` block's `present[]`.
Add an optional `traits` there so traits are set when a character is first
established and amendable later — no separate top-level array to wire.
- parsed.ts: add `traits: z.array(z.string()).optional().catch(undefined)` to
  `ParsedPresent` (27). (Leave `disposition` to model authorship later/manual —
  start with `traits` to keep extraction simple for weak/local models.)
- core-feature.ts: in the `present` loop that emits `cast.seen` (72-76), when
  `p.traits?.length`, also emit a `cast.edit` with `patch:{ traits }` (src
  'model', so user edits still win per reducer precedence). Reuse the same
  `badName`/`rid` guards already applied to the name so traits never attach to a
  pronoun/mash id. Trim + cap to ~6 before emitting.
- preset (vellum-ii.json:738 state-block spec): extend the `present` field doc to
  `present:[{id,mood,condition,doing,thought,traits[]}]` with a one-line note:
  "traits = 2-4 STABLE personality tags, emit only when first established or when
  a trait genuinely shifts; not mood." Keep it out of the lean default example to
  avoid token cost; add to the `full`-verbosity example only.

## Phase 3 — UI (cast card + edit form)
- cast.ts `card()` expanded detail (187-194): add a traits chip row + a
  disposition line ABOVE `note`, so the lane is clear (`disposition` = structured
  one-liner, `note` = freeform). Render traits with the existing chip pattern
  (`bondChips` shape) using a new neutral class.
- cast.ts `castForm()` (148-163): add `disposition` (text) and `traits`
  (comma-separated text) inputs. `aka` already shows the comma→array convention to
  copy.
- cast.ts edit-button data attrs (205) + the `[data-cast-edit]` reader (88-94):
  thread `data-disposition` and `data-traits` through.
- cast.ts `version()` key (61): append `c.disposition` + `(c.traits ?? [])
  .join(',')` so personality edits re-render (same reason color is in the key).
- styles.ts: add `.vle-traitchip` (clone `.vle-bondchip` at 173 with a neutral
  `--v-chip-c`) + a `.vle-card-disp` line style. No new hex; reuse tokens.

## Phase 4 — Raise the maximum recall budget
Independent of personality, but bundled here: the per-turn injection ceiling
lives in `src/retrieval/recall.ts`:
- `CAPS = { structured: 1400, recall: 1800 }` (36)
- `TOTAL = 3600` (37)
The comment (33-35) documents the headroom invariant: `structured + recall ≤
TOTAL` so the proportional down-scale in `allocate` (budget.ts:24-27) never
fires. Any change MUST preserve that invariant or every block silently shrinks.

Change:
- Bump BOTH caps and `TOTAL` together, keeping `structured + recall ≤ TOTAL`.
  Proposed: `CAPS = { structured: 1800, recall: 2600 }`, `TOTAL = 4400`
  (1800 + 2600 = 4400 ≤ 4400 → no scaling). `structured` +29% gives the
  cast/bonds/factions block (where personality traits live) room so the new
  traits clause never crowds out a bond line; `recall` +44% gives the compressed
  summaries/facts room they're currently clipped out of.
- Update the explanatory comment (33-35) to the new arithmetic so the invariant
  stays self-documenting.
- The phase multiplier (`phaseMult`, scales only the `recall` slice in
  allocate 19) and the traversal-tree 1.8× detail override (219, 233) ride on top
  of the new cap automatically — no other edits needed.
- Interaction with Phases 1-3/5: the capped traits clause added to the cast line
  (Phase 5-feedback) spends from the now-larger `structured` cap, so the traits
  injection and the existing cast/bond lines no longer compete for the old 1400.

Caveat to flag, not silently assume: a larger injection means more tokens per
turn. This is a deliberate quality/cost trade. If a configurable ceiling is
wanted instead of a hard bump, expose `recall`/`total` as settings (mirror
`genMaxTokens` in app.ts:477 with min/max), reading from the same options store
the summarizer config uses — larger change, defer unless asked.

Test: `allocate({ total: 4400, caps: { structured: 1800, recall: 2600 } })`
returns the caps unscaled (no down-scale); `fitLines` admits more recall lines
under the new cap.

## Phase 5 — Command + promote + feed-back
- commands.ts `cast_upsert` (24-30): include `disposition` in the scalar copy
  loop and parse `traits` comma-string → array (mirror the `aka` branch at 29-30).
- promote.ts `castContent` (29-32): append traits/disposition to the world-book
  projection so a promoted character entry carries personality (keeps Vault sync
  consistent; `hash` change auto-triggers Tier-B refresh).
- recall.ts `structuredBlock` cast line (80-83): append a capped traits clause,
  e.g. `- Cersei (Queen Regent; guarded, proud, sharp-tongued)`. Cap to top 3
  traits and let the shared `fitLines` budget (110-115) clip — this is the
  highest-value change (what actually improves prose consistency). Keep
  disposition OUT of the per-turn inject (note-length) to protect the budget.

## Tests (vitest)
- reduce: `cast.edit` with `traits`/`disposition` sets them; `''`/`[]` clears;
  cap enforced; user edit beats a later model edit (precedence).
- core-feature: a `present` entry with `traits` emits a `cast.edit`; a pronoun/
  mash `present` entry with traits emits none.
- commands: `cast_upsert` comma-string `traits` → array; round-trips through edit.
- promote: `castContent` includes traits; `hash` changes when traits change.
- recall: structured cast line includes the capped traits clause and respects the
  budget.
- budget: `allocate({ total: 4400, caps: { structured: 1800, recall: 2600 } })`
  returns caps unscaled (invariant preserved, no down-scale).

## Verify
`bun run typecheck` → `bun run test` → `bun run build`. Manual: reload in
Lumiverse, edit a character's traits/disposition, confirm chips render in the
expanded card, confirm the Context tab shows the traits clause injected, confirm
a model turn emitting `present[].traits` populates the card.

## Deliberately out of scope (YAGNI)
- No trait *history*/drift events yet (mirror of ScoreSample). Add only after the
  model proves it emits traits reliably — that's the real differentiator but it's
  a second event kind + timeline UI.
- No auto-deriving personality from `mood`/`thought` history (inferring stable
  traits from noisy transient state).
- No duplication of the host `char_personality` card — emergent traits only.
- No strip-mode personality (cast.ts:211) — keep strips one-line; chips are
  expanded-card only.

## Order / risk
Phase 1 is additive and safe (no migration). Phase 4 (recall budget bump) is a
2-line constant change — do it first and independently; just keep the
`structured + recall ≤ TOTAL` invariant. Phase 5's recall feed-back is the
biggest personality payoff and lowest risk (one line + cap). Phase 2 (model
emission) is the only behavioral uncertainty — ship Phases 1+3+5 first (manual +
UI value), then turn on Phase 2 emission once the card/feed-back path is proven.
Each phase is independently shippable and verifiable.

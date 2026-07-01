# FEATURE-COMPLETE-PLAN — the finishing set (Tiers S / A / B)

Every remaining feature to take VELLUM from "very complete" to "feature-complete",
grouped by tier. All of it rides patterns already proven in this codebase:
- **3-seam collections** (events.ts kind → reduce.ts case → core-feature/backend
  emit), the `ext` carrier, chat-var settings, capped injection (beat spine /
  locations / drift), and versioned `Component` tabs with `html[data-vle-chrome]`
  theme overrides (illuminated / modern / futuristic).
- Schema bumps are additive + no-op migrations; old logs reduce to empty.
- The model stays dumb where possible; the engine derives.

Current schema: **v11**. This plan consumes **v12** (one bump for all the new
event-backed collections, done once at the start).

---

## TIER S — the real gaps that complete the core

### S1. Relationship arcs over time (extension)
**Gap:** bonds keep aff/trust *history* but the UI only shows the current number.
**Build (visualization only — no schema change):**
- The bond history already exists on `Relation` (score changes are logged with
  turn + why). Add `bondArc(state, a, b)` in a pure `domain/relarc.ts`:
  returns aff/trust series across turns + the annotating `why`/journal per change.
- UI: on the **Bonds** tab, expand a relationship → a dual **sparkline** (aff +
  trust) with nodes at each change; hover/click a node → the `why` + linked
  journal moment. Reuse the drift-timeline visual language.
- Theme: sparkline stroke = `--vle-gold`/`--v-pos`/`--v-neg`; chrome overrides
  (illuminated gilt, modern flat, futuristic mono HUD grid).
- **Effort:** ~half day, pure win on existing data. **No engine change.**

### S2. Turn Inspector + per-turn undo (extension)
**Gap:** the fold is opaque; undo is single-level.
**Build:**
- `domain/turnlog.ts` (pure): group the event log by `turn` → a per-turn diff
  (bonds moved, knowledge learned, scars/items/traits/locations changed, secrets
  revealed). The event log already carries `turn` on every event, so this is a
  group-by, not new data.
- UI: a **Timeline → "Inspect"** affordance (or a new Chronicle sub-view "Turns"):
  each turn expands to its change list. An **"Undo this turn"** button emits
  `memory.drop`-style reversals — but generalized: a new backend
  `vellum_undo_turn { turn }` that appends inverse events (drop the memories,
  the drift, the items, etc. created that turn). Reuses the existing undo
  plumbing, scoped to a turn.
- Risk: true inverse of a bond delta needs the delta value (it's in the event) —
  emit a compensating `bond.delta` with negated aff/trust. Knowledge/scar/item
  reversal = drop by id. Deterministic.
- **Effort:** ~1 day. High-value audit + real undo.

### S3. Hard-limits / content boundaries (preset + tiny chat var)
**Gap:** NSFW ladder controls *how explicit*, nothing lists what's **off the
table entirely**.
**Build:**
- Preset: a new `v2-limits` block (default empty) that injects, at **high
  priority in post_history**, a user-authored "NEVER depict, regardless of any
  other setting: …" line. Precedence clause: hard-limits outrank the Mandate,
  NSFW level, and NSFL — they are absolute.
- Storage: a `hard_limits` Prompt Variable (textarea) so it travels with the
  preset, OR (better for per-chat) a `vellum_hard_limits` chat var set from a
  small extension modal. Recommend **both**: preset var for a global default,
  chat var overrides per chat.
- Extension (optional): a "Boundaries" action opening a textarea → chat var,
  injected by the interceptor ahead of everything (like next-scene but sticky).
 - **Effort:** ~2 hours (preset block) + ~2 hours (optional chat-var modal).
   Genuine safety/consent gap; ship it first.

### S3.5. Inject locked relation categories (extension + preset)
**Gap:** relation locks are strip-ONLY — the fold silently removes a forbidden
category AFTER the model writes it, so the state stays clean but the PROSE can
still depict the forbidden thing (clean bookkeeping, wrong story).
**Build (two-layer: injection = prevention, strip = enforcement):**
- `lockInjection(locks, presentIds, nameOf)` in `relation-lock.ts` (pure): for
  locks whose BOTH endpoints are present this turn, emit a terse director line.
  - PINS render as positive constraints ("Keep Jaime and Cersei allied").
  - FORBIDS render as positive nature-statements, NOT raw negation, to dodge the
    negation-priming trap ("Jaime and Cersei's bond does not turn romantic; keep
    it as it is"), terse.
  - present-gated + capped (off-scene pairs are noise this turn).
- Wire into the interceptor beside directive/drift/location injections.
- Preset: add "lock", "relationship lock", "forbidden category" to the on-page
  craft ban so it never narrates the constraint.
- The existing strip stays as the hard guarantee if the model ignores the steer.
- **Effort:** ~½ hour. No schema; locks already exist as a chat var.

---

## TIER A — high value, clear need

### A4. Readable Markdown export (extension)
**Gap:** export is JSON (backup only).
**Build:**
- `domain/markdown.ts` (pure): render the chronicle to Markdown —
  **Story So Far** (beat spine + chapter/arc gists in order), **Cast** (each:
  role, disposition, traits + drift arc line, key bonds), **Relationships**
  (digest), **Codex/Lore**, **Timeline** (landmark beats).
- Backend `vellum_export_markdown` → returns the string; frontend downloads
  `story.md` (reuse `downloadJson`'s blob path with a `.md` type).
- UI: an "Export → Markdown" option beside the existing JSON export.
- **Effort:** ~half day. Makes the chronicle shareable; common request.

### A5. Mood (transient) vs. trait (permanent) (preset + light engine)
**Gap:** `present[].mood` isn't remembered as a short arc, so a grieving
character resets to chipper next turn.
**Build:**
- Reuse `present[].mood` (already emitted). New tiny derived helper: track the
  last N turns' mood per present character (from `scene.set` detail history in
  the log — no new event needed) → a **mood-recency** injection line: "Cersei
  has been grieving for 3 turns; it hasn't lifted." Capped, present-only.
- Preset: a one-line reverie note — mood persists across turns unless something
  shifts it; don't reset an emotional state without cause. Distinct from Drift
  (permanent trait) — mood is weather, trait is climate.
- **Effort:** ~half day. No schema change (derives from scene history).

### A6. Foreshadow / Chekhov payoff tracker (extension + preset)
**Gap:** no "planted → paid off" continuity structure.
**Build (v12 collection):**
- Event `plant.set { id, what, plantedTurn, status:'planted'|'paid' }` +
  `plant.pay { id, turn }`. `state.plants: Plant[]`.
- Derivation: reuse the **Augury omen** + a new `ext.plant` field the preset can
  emit ("seeded: a locked drawer nobody opened"), OR a Director directive kind
  `plant`. Recommend the Director route — a `plant` directive that stays armed
  (never TTL-expires) until a matching `advance_thread`/pay resolves it.
- UI: a **"Planted" lane in the Director tab** — unresolved plants listed with
  age ("planted 12 turns ago, still hanging"); a "mark paid" action. Injected
  gently: "unresolved threads you planted: the locked drawer, the stranger's
  ring." Marries omens → threads → payoff.
- Preset: a Living-World note — honor planted details; a plant left too long
  should resurface or pay off, not vanish.
- **Effort:** ~1 day. The one genuinely-new narrative-structure feature that
  serves continuity rather than scope creep.

### A7. Narrative distance + pacing dials (preset)
**Gap:** Length + Dialogue exist; camera distance and pacing don't.
**Build (preset-only, two dropdowns on v2-config):**
- **Narrative Distance:** Intimate (deep close-third, thought-adjacent) /
  Standard / Cinematic (distant, external, camera-like) / Panoramic (wide,
  scene-scale). Injected into the register-adjacent guidance.
- **Pacing:** Lingering (dwell in the moment, sensory) / Measured / Propulsive
  (cut hard, momentum, skip transitions). Distinct from Length (amount) — this
  is *rhythm*. Interacts with the Augury/Time dials, so add a one-line precedence
  note (pacing shapes rhythm; it never overrides the length target or agency).
- Ban-list hygiene: add "camera", "cinematic", "close-third" to the on-page
  craft-word ban so the dial never leaks as narration.
- **Effort:** ~3 hours. Two most-requested prose controls you don't have.

### A8. Group-scene management (preset)
**Gap:** 1:1 and small scenes are strong; 4+ present characters go round-robin.
**Build (preset-only):**
- A `v2-crowd` block, gated on "3+ present" (the model self-assesses): who leads
  the beat, who recedes to background action, no obligatory equal turn for
  everyone, avoid round-robin dialogue, let the scene have a focal pair while
  others react in the margins. Pairs with the Dialogue + Cast blocks.
- Reverie hook: in crowded scenes, name the focal 1-2 this beat; the rest are
  texture.
- **Effort:** ~3 hours. Closes the preset's known weak spot.

---

## TIER B — polish / delight

### B9. First-run onboarding (extension)
- A one-time overlay (guarded by a `vellum_seen_intro` chat/global var): a 4-5
  step tour — what the Now/Cast/Bonds/Chronicle tabs are, the tool icons, the
  Director, and "everything runs automatically". Dismissible, never shown again.
- **Effort:** ~half day. High value for new users only.

### B10. Per-character portraits (extension)
- Optional `imageUrl` on `CastCard` (schema-additive, in v12); the avatar renders
  the image instead of initials when set. Editable in the cast-card edit modal.
- Guard: URL only (no upload), lazy-load, fallback to initials on error.
- **Effort:** ~3 hours. Cosmetic but expected.

### B11. Story stats / analytics (extension)
- `domain/stats.ts` (pure): turns, days, cast count, most-active characters (by
  present-count), biggest relationship swings (from bond history), longest-held
  traits. A small **"Story so far" panel** on the Now tab or a Stats action.
- **Effort:** ~half day. Pure read over existing data.

### B12. World calendar (preset + ext)
- Beyond the day counter: named days/seasons. A `vellum_calendar` chat var
  (e.g. `{ epoch:'harvest festival', dayNames:[...] }`) → the injection renders
  "Day 47" as "third day of the harvest festival". Ties to Time Continuity.
- Preset: a note to honor the calendar when set.
- **Effort:** ~half day. Optional flavor.

### B13. OOC / meta-command channel (preset)
- A defined convention (e.g. lines wrapped in `(( ))` or an `OOC:` prefix) the
  model treats as **author direction, not narration** — steer without breaking
  scene. A `v2-ooc` block defining the channel + how to obey (adjust, don't
  narrate the instruction, don't have characters react to it).
- **Effort:** ~2 hours. Removes a common friction.

---

## Shared engine work (do ONCE, up front)

**Schema v11 → v12** — one additive bump covering the new event-backed pieces:
- `plant.set`/`plant.pay` + `state.plants` (A6).
- `CastCard.imageUrl?` (B10, additive field, no new event — rides `cast.edit`).
- `vellum_undo_turn` needs no schema (emits existing inverse events).
- Migration: no-op; old logs → empty `plants`, absent `imageUrl`.

Everything else (S1 relarc, S2 turnlog, A4 markdown, A5 mood, B11 stats) is
**pure derivation over existing data** — no schema, no events. That's most of the
list, and it's the cheapest, safest work.

**Injection budget note:** S3 (limits), A5 (mood), A6 (plants) each add an
injected line. Keep each capped and gated (empty → silent); audit total prompt
weight after wiring so the recall budget that buys relationship/knowledge
fidelity isn't crowded.

---

## Theme adherence (all UI)
Every new surface (S1 sparklines, S2 turn inspector, A6 planted lane, B10
avatars, B11 stats) built on theme vars (`--vle-gold`, `--vi`, `--vi2`,
`--v-pos/neg/warn`, `--vmono`, `--vserif`, `--vscale`) with explicit
`html[data-vle-chrome='illuminated'|'modern'|'futuristic']` overrides, matching
the diary/drift/director components.

---

## Sequencing (value-first, cheapest-first within tier)

1. **S3 hard-limits** (safety gap, ~½ day, mostly preset) — ship first.
2. **S1 relationship arcs** (pure win on existing data, ~½ day).
3. **S2 turn inspector + per-turn undo** (~1 day, high-leverage audit).
4. **A4 markdown export** (~½ day, shareable chronicle).
5. **A7 distance/pacing + A8 group scenes** (preset-only, ~1 day together).
6. **A5 mood-recency** (~½ day, no schema).
7. **A6 foreshadow tracker** (v12 bump lands here, ~1 day).
8. **B10 portraits** (rides v12), **B11 stats**, **B12 calendar**, **B13 OOC**
   (~½ day each, batchable).
9. **B9 onboarding** last (polish over a now-stable feature set).

Each ships as its own commit with tests (pure helpers unit-tested; new events get
reduce/migration round-trips; preset changes lint + validate), typecheck + full
suite + build green before push — the established rhythm.

**Definition of done:** after S1–S3 + A4/A6/A7 the engine has no structural gaps
left — a relationship you can *see* evolve, a chronicle you can *audit*, *undo*
per-turn, and *export*; enforced boundaries; planted-payoff continuity; and the
missing prose controls. Tier B is elective polish.

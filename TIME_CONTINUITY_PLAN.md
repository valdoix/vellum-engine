# Time Continuity — Implementation Plan

Covers proposals **A–G** from the time-continuity analysis. Ordered by dependency and risk:
quick correctness wins first, then the foundational clock model, then the features that build on it.

Architecture reminder (`EXTENDING.md`): a change touches **event kind → reducer case → derived state → feature/injection → test**. Schema changes go through `migrate.ts` with a `SCHEMA_VERSION` bump. Nothing mutates `ChronicleState` outside `reduce.ts`.

Current `SCHEMA_VERSION` is **16** (`src/core/events.ts:10`). This plan adds versions **17** (config: clock/epoch-minutes) and **18** (optional `scene.clock` on `EvSceneSet`); both additive.

---

## Phase 0 — Quick wins (no schema change)

### D. Fix and enrich `spanLabel`
**File:** `src/domain/date-format.ts` (`spanLabel`, lines 145–151).

Rewrite the bucketing to be continuous, calendar-consistent, and to add the missing **weeks (2–13 days)** and **years** buckets. Keep the `< 2 days → ''` contract (it means "not a skip").

```
d < 2          → ''
d < 14         → "N days"
d < 70         → "N week(s)"          (round d/7)
d < 730        → "N month(s)"         (round d/30.44 — matches Gregorian avg)
else           → "N year(s)"          (round d/365.25)
```

**Test contract change:** `test/skip-sync.test.ts:81–88` currently asserts:
- `spanLabel(5) === '5 days'` ✅ unchanged
- `spanLabel(14) === '2 week(s)'` ✅ unchanged (14/7 = 2)
- `spanLabel(60) === '2 month(s)'` → **changes to `'2 month(s)'`** (60/30.44 = 1.97 → 2) ✅ still holds
- Add new assertions: `spanLabel(3) === '3 days'`, `spanLabel(400) === '1 year(s)'` — the year bucket the README advertised but code never produced.

Add a companion `spanLabelHours(minutes)` for sub-day spans (used by Phase 2's NOW line): `< 90m → "N minutes"`, `< 20h → "N hour(s)"`, else defer to day bucketing.

**Effort:** ~30 min. **Risk:** low (one pure fn + test update).

---

## Phase 1 — Day-counter sanity + correctability (A)

The day counter is model-supplied and monotonic via `Math.max` (`reduce.ts:82`), so a bad `day:9999` sticks forever and a `day:1`-every-turn model freezes the calendar. Add a sanity layer at the fold and a way to correct it.

### A1. Sanity-check `parsed.day` at the fold
**File:** `src/bus/lifecycle.ts` (line 39, `const day = parsed.day ?? prior.day ?? 1`).

Replace with a small pure helper `reconcileDay(parsed.day, prior.day, prior.scene.time, parsed.scene?.time)` (new export in a new `src/domain/clock.ts`, see Phase 2):

- `parsed.day` absent → keep `prior.day` (no forced `1`).
- `parsed.day < prior.day` → **keep `prior.day`**, and emit a `continuity.flag` (`code: 'day_backward'`) so the Director Log shows "model reported Day N→M; kept N".
- `parsed.day` jumps `> 30` in one turn **with no time-skip cue** in prose (no "weeks later" / "next month" markers — reuse a small regex) → accept it (author may intend a skip) but emit `continuity.flag` `code: 'day_jump'` for review.
- Otherwise accept `parsed.day`.

Because `turn.fold` still carries `day` and `reduce` does `Math.max`, the accepted value flows normally. The flag path uses the existing `EvContinuityFlag` kind — **no schema change**.

### A2. `time.correct` — walk back a bad monotonic day
Add a user command + panel action so a spurious high day can actually be fixed (today it's unfixable without a full Rebuild).

- **Event:** reuse `config.set` is wrong (it's date-format). Add a tiny new kind `EvDaySet` (`kind: 'day.set'`, `{ day: int, absolute?: bool }`). SCHEMA bump → 17.
- **Reducer:** `case 'day.set':` → `s.day = e.absolute ? e.day : Math.max(s.day, e.day)`. This is the **one** sanctioned way to *lower* `s.day` (absolute), overriding the monotonic rule intentionally.
- **Command:** in `src/domain/commands.ts` `cmdEvents`, add a `'day'` type emitting `day.set`.
- **Backend:** a handler + panel Action "Set day" (Chronicle → World toolbar).
- **Migrate:** `if (version < 17) version = 17;` (additive, no rewrite).

**Effort:** ~2–3 h. **Risk:** low-med (new event kind — reducer exhaustiveness guard enforces the case).

---

## Phase 2 — Ordered sub-day clock (B) — the foundation

Model time-of-day as an ordered integer alongside the human string, so code (not just prose) can enforce "time only moves forward".

### B1. New pure module `src/domain/clock.ts`
- `CLOCK_SLOTS`: canonical map `dawn|morning|midday|afternoon|dusk|evening|night|late-night → minutes` (e.g. dawn=300, midday=720, dusk=1140, late-night=90).
- `parseClock(time: string): number | undefined` — map a free-text `scene.time` to minutes: match a slot keyword, else parse `"9:47 PM"` / `"21:47"`, else `undefined`.
- `clockLabel(minutes): string` — inverse, for display.
- `reconcileDay(...)` from A1 lives here.
- `detectBackwardClock(priorDay, priorMin, newDay, newMin)` — true when same day and `newMin < priorMin - tolerance` (tolerance ~30 min for narration jitter).
- `rollover(priorDay, priorMin, newMin)` — if `newMin < priorMin` and prose implies a new day, suggest `day+1`.

Fully unit-tested (`test/clock.test.ts`), zero I/O.

### B2. Add optional `clock` to the scene event + state
- **Event:** extend `EvSceneSet` (`events.ts:63`) with `clock: z.number().int().min(0).max(1439).optional()`. SCHEMA bump → 18.
- **Parse:** extend the `scene` object in `parsed.ts:110` with `clock: z.number().optional().catch(undefined)` (models may emit it; if absent we derive from `time`).
- **State:** add `clock?: number` to `Scene` in `types.ts:169`.
- **Reducer:** in `case 'scene.set'` (`reduce.ts:134`), set `clock` from the event, else derive via `parseClock(e.time)`. On the merge path leave existing clock intact.
- **Feature:** in `core-feature.ts` scene extraction (`~line 135`), emit `clock` when parsed, else `parseClock(parsed.scene.time)`.
- **Migrate:** `if (version < 18) version = 18;` — old scenes have no clock; derived lazily on next fold.

### B3. Code-level "time only moves forward" enforcement (advisory)
In `checkContinuity` (`src/domain/continuity.ts:26`) add a `scene.set` sub-check using `detectBackwardClock` against `prior.scene`:
- new warning kind `clock_backward` (add to the `ContinuityWarning` union, line 22) → "It was 'midnight' but the scene now reads 'dawn' with no day rollover — a slip?"
- Auto-rollover suggestion: if backward AND prose has a day-advance cue, the flag suggests `day+1`.

This finally enforces `TIME - INVIOLABLE` (preset `v2-time`) in code, not only in the LLM's reading of prose. Advisory only — never blocks.

### B4. Preset: ask the model for the slot
**File:** `presets/vellum-ii.json` — the `v2-state` block's field list (line ~1369) already documents `scene:{loc,time,tension,weather}`. Add `clock` (optional, "coarse slot: dawn|morning|midday|afternoon|dusk|evening|night|late-night, or minutes-since-midnight"). Backward compatible: absent → derived from `time`.

**Effort:** ~1 day. **Risk:** med (schema + reducer + parse + preset). Additive everywhere; old logs and blocks keep working.

---

## Phase 3 — Authoritative "NOW" injection (C)

The structured recall block injects cast/bonds/threads but **not the current clock** (`recall.ts` `structuredBlock`). The only day injection today is the *optional* `calendarInjection` and author `beatSpine`. Put the clock on the same "verbatim, authoritative" footing as other hard facts.

### C1. `nowInjection` builder
**File:** `src/retrieval/recall.ts` (new exported pure fn near `structuredBlock`).

```
[NOW — authoritative clock. Do not contradict or reset.] Day 47 (Frostfall 5, 312 A.R.), dusk. ~2 days since the previous scene.
```

Compose from: `formatDate(state.day, state.dateFormat, state)` + `clockLabel(scene.clock)`/`scene.time` + `spanLabel(state.day - prevSceneDay)` for the "since last scene" tail. The prev-scene day comes from the most recent scene-bearing turn (track a lightweight `state.lastSceneDay` set in the `scene.set` reducer case, or derive from the newest beat/turn).

### C2. Wire it into the prompt
**File:** `src/backend.ts` interceptor (`~line 1055`, the `injText` join). Prepend `nowInjection(state)` right after `limitsText` so it sits at high salience. It's cheap (one line) and always-on when a scene exists.

Fold it into the `structuredBlock` output rather than a separate host call — no extra I/O on the hot path.

**Test:** `test/retrieval.test.ts` — assert the NOW line appears with correct day/time and span wording.

**Effort:** ~half day. **Risk:** low. Depends on Phase 2 for `clock` (degrades to `scene.time` string if clock absent).

---

## Phase 4 — Verifiable off-screen catch-up (E)

Today `simEvents` stamps every touched subplot's `lastDay = state.day` (`offscreen.op` reducer, `reduce.ts:477`), so after a time-skip catch-up **every** subplot reads as "current" even if the model only advanced one — silently defeating `checkThreadOffscreenSync` for the rest.

### E1. Per-subplot day from the parse
- **Parse `ParsedSim`** (`offscreen.ts:190`): add optional `lastDay`/`onDay` per offscreen entry (`parseSim` reads `p.day` if present).
- **`simEvents`** (`offscreen.ts:266`): stamp each `offscreen.op` event's `day` from the parsed per-subplot day when present, else the tick day. Only subplots the model actually returned a beat for get bumped.

### E2. Don't blanket-advance untouched subplots
No code currently advances untouched subplots (good) — but confirm the catch-up prompt (`timeSkipNote`, `offscreen.ts:86`) asks the model to report the net result **per subplot**, and that `maybeSimulate` (`backend.ts:707`) awaits the skip tick (it does). Add a guard: after the tick, subplots with no returned beat keep their stale `lastDay`, so `checkThreadOffscreenSync` (`continuity.ts:74`) correctly flags them as lagging.

### E3. Extend desync to thread-vs-thread
**File:** `src/domain/continuity.ts` `checkThreadOffscreenSync` (line 74).
Add a second pass: cross-check every pair of **open on-screen threads** whose `lastDay` diverge by a skip-span (`spanLabel >= '' `), emitting `thread_offscreen_conflict` (or a new `thread_thread_desync`) — "The Siege (Day 3) is ~5 weeks behind The Wedding (Day 40)". Cap the pairs checked (e.g. top 6 by recency) to bound cost.

**Test:** extend `test/skip-sync.test.ts` and `test/director-offscreen.test.ts`.

**Effort:** ~half day. **Risk:** low-med. Depends on nothing beyond current sim; complements Phase 1.

---

## Phase 5 — Elapsed-time state decay ("Living Clock", F)

New opt-in feature: on a detected skip, surface advisory injections for time-sensitive state so nothing frozen-in-time slips through.

### F1. New pure module `src/domain/aging.ts`
Given `state`, `nowDay`, and a skip span, produce advisory injection lines (no state mutation — advisory only, like `offscreenInjection`):
- **Conditions:** `PresentChar.condition` entries → "a wound noted ~3 weeks ago should have healed/scarred by now."
- **Plants:** `Plant` (status `planted`) older than a span → "seeded ~N weeks ago, still unpaid — consider paying or abandoning." (Plants have `plantedTurn`; add day awareness by mapping turn→day, or stamp `plantedDay` on `EvPlantSet` — a small additive schema field, SCHEMA 18 already open.)
- **Recency-weighted salience:** journal/mood already have recency; extend so a defining beat from months ago is recalled as *distant* ("months ago: …") using `spanLabel(nowDay - entry.day)`.
- **Aging (optional):** when a skip crosses months/years and `CastCard.age` is numeric, emit an advisory "characters are ~N months older" (never auto-edits age; the author confirms).

### F2. Wire as an injection block
Register via the `inject` seam or add to the `injText` join in `backend.ts` (`~1055`), gated by a `vellum_living_clock` chat var (off by default), capped by `budgetCaps`. Mirrors `offText`/`plantText`.

### F3. Config toggle
Panel Action + preset var (default off), consistent with the "twelve blocks off by default" pattern in the README.

**Test:** `test/aging.test.ts` — golden lines for a 3-week and a 6-month skip.

**Effort:** ~1–1.5 days. **Risk:** med (new feature + budget interplay). Depends on Phase 0 (span) and Phase 2 (day anchors).

---

## Phase 6 — Panel time-health surfacing (G)

Make the clock and desync findings browsable.

### G1. Clock ribbon on the Timeline
**File:** `src/ui/tabs/chronicle.ts` (Timeline sub-view). Beats already render `beatLabel` (`beats.ts:71`, `[Day N · time]`). Add sub-day ordering using `scene.clock`/`beatTime`→minutes so same-day beats sort by time, and render a per-day clock ribbon.

### G2. Desync inspector
New Chronicle sub-view (or a section in the World view) listing every open thread with `lastDay`, its lag vs `state.day` (via `spanLabel`), and the `checkThreadOffscreenSync` findings. Each row gets a **"Catch up this thread"** action that arms a directive (reuse the existing directive/`focusId` sim path — `simulateOffscreen(chatId, uid, threadId)`).

### G3. NOW chip
The floating "Now" window (`src/ui/float.ts`) shows the scene; add the authoritative day/time chip from Phase 3's `nowInjection` source.

**Test:** `test/dashboard.test.ts` / a `chronicle` UI test asserting ordering + lag labels. UI has error boundaries, so a render throw degrades gracefully.

**Effort:** ~1 day. **Risk:** low (UI-isolated). Depends on Phases 2–4.

---

## Sequencing & checkpoints

| Phase | Proposal | Depends on | Schema | Effort |
|------|----------|-----------|--------|--------|
| 0 | D span fix | — | none | ~0.5h |
| 1 | A day sanity + `day.set` | 0 | **17** | ~0.5d |
| 2 | B ordered clock | 1 | **18** | ~1d |
| 3 | C NOW injection | 2 | none | ~0.5d |
| 4 | E verifiable catch-up | 1 | none | ~0.5d |
| 5 | F living-clock decay | 0,2 | 18 (plant day) | ~1.5d |
| 6 | G panel surfacing | 2,3,4 | none | ~1d |

Run after **each** phase (per README/`EXTENDING.md`):
```
bun run typecheck   # tsc --noEmit (strict) — reducer exhaustiveness guard catches missing cases
bun run test        # vitest
bun run build       # dist/backend.js + dist/frontend.js
```

## Guarantees preserved
- **Additive schema only** — every new field optional; `migrate.ts` steps are no-ops (17) or lazy-derive (18). Old chronicles load unchanged.
- **Advisory, never blocking** — all new continuity checks emit `continuity.flag`s (existing kind) or injection hints; none mutate canon or block generation.
- **Authoritative facts stay verbatim** — the NOW line is injected structurally, never similarity-retrieved (respects the retrieval invariant in `invindex.ts:7`).
- **Feature isolation** — the living-clock and desync checks run in wrapped extractors/injectors; a throw can't break the fold.
- **`day.set` absolute is the single sanctioned override** of the monotonic day rule, so the "unfixable bad day" hole is closed without weakening the default forward-only guarantee.

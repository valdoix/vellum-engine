# VELLUM II — Off-screen simulation (implementation plan)

Tick the world forward while it's off-stage: when the player's scene is focused
on a place/group, other characters and factions keep acting elsewhere
("meanwhile, in King's Landing…"). Today VELLUM only *records* an off-screen
beat if the model happens to narrate one in its `parallel` block — this makes
the off-screen world advance on its own and feeds it back into the next scene.

This is the most ambitious Plot Director idea and the one with the most ways to
go wrong, so the plan is conservative: opt-in, permission-gated, bounded, and it
writes through the SAME event types the model already emits (`parallel.set`,
`thread.op`) so nothing new touches the reducer.

## What already exists (the substrate)
- **`parallel` block + `parallel.set` event** (`core-feature.ts:169`,
  `reduce.ts:105`, `types.ts:143`): off-screen `{who, where, activity, note}`
  items already render in the dashboard's Parallel section. The sim writes here.
- **`controllerGenerate` / `internalGenerate`** (`host/generation.ts`): cheap,
  thinking-off, timeout-bounded LLM calls, permission-gated (`has('generation')`).
- **`maybeTidyThreads`** (`backend.ts:250,264`): the EXACT template — a post-fold,
  serialized-per-chat (`_tidying` set), best-effort LLM job that emits events or
  does nothing. The sim is a sibling of this.
- **Tone dials + relation locks + directives**: the sim must RESPECT these (a
  locked pair, a disposition, an armed directive all constrain what off-screen
  characters may do).

## Design constraints (non-negotiable)
1. **Opt-in + off by default.** A per-chat toggle (chat var, like tidy/traverse).
   It costs an extra generation per tick — never silently on.
2. **Permission-gated.** No `generation` permission → no-op, exactly like tidy.
3. **Bounded.** One controller call per tick, hard timeout, capped output (≤4
   off-screen beats), throttled (every N turns, not every turn).
4. **Never blocks the prompt path.** Runs post-fold as `void maybeSimulate(...)`,
   off the interceptor's synchronous path.
5. **Respects the world rules.** The sim prompt is fed the locks/directives/tone
   so it can't, e.g., advance a forbidden romance off-screen.
6. **Visible + reversible.** Off-screen beats are tagged `src:'sim'`, shown
   distinctly in the Parallel section + Context tab, and (since the event log is
   append-only) undoable like any turn.

## Phase 1 — Pure simulation core (`domain/offscreen.ts`, tested)
No I/O. Decide WHO is off-screen and build the controller prompt + parse.
- `offscreenCast(state)`: characters with `status==='active'` (known, not in the
  current `scene.present` set) — the ones plausibly "elsewhere". Cap to ~5 by
  recency. Factions with non-resolved standing similarly.
- `buildSimPrompt(state, ctx)`: a compact system+user prompt asking "advance
  these off-screen characters one small beat each, consistent with their goals
  and the world; STRICT JSON `{parallel:[{who,where,activity,note}], threads:[…]}`."
  Inject the guardrails: forbidden-locked pairs, armed directives, tone
  disposition. Bounded output instruction (≤4 beats, one clause each).
- `parseSim(text)`: tolerant JSON parse (mirror `parseStep`/`parseMergeReply`),
  validate against the parallel/thread shapes, drop anything malformed.
- `simEvents(parsed, ctx)`: map to `parallel.set` + `thread.op` events with
  `src:'sim'`. Pure. ZERO new event kinds — rides the existing reducer.
- Tests: offscreenCast excludes present + dormant; parse tolerates fenced/garbage;
  forbidden-locked pair guidance present in the prompt; output cap enforced.

## Phase 2 — Backend tick (`maybeSimulate`, mirrors maybeTidyThreads)
- `_simulating = new Set<string>()` (serialize per chat); a turn-cadence guard
  (e.g. every 3rd turn, configurable) so it isn't every turn.
- Gate: chat var `vellum_offscreen` on AND `has('generation')` AND enough
  off-screen cast to bother.
- Build prompt → `controllerGenerate` (timeout ~3s, off the prompt path) → parse
  → `simEvents` → `append` → `broadcastState`. Fail/timeout/empty → no-op.
- Called as `void maybeSimulate(chatId, userId)` alongside the other post-fold
  `maybe*` jobs (`backend.ts:248-252`).
- A `vellum_set_offscreen` handler persists the toggle; broadcast it in state.

## Phase 3 — UI
- A toggle in the Actions menu (`Toggles` group, beside Hide/Traverse/Tone),
  reusing the existing `data-qol` toggle wiring + state label.
- Tag `src:'sim'` parallel rows in the dashboard Parallel section with a small
  "auto" marker so the user sees what the world did on its own vs what the model
  narrated.
- The Director panel/Context already surface injections; sim beats show there too.

## Phase 4 — Feed-forward (close the loop)
Off-screen beats must influence the NEXT scene, not just display.
- The interceptor already injects the dashboard-ish recall; ensure recent
  `src:'sim'` parallel beats are eligible for injection (they're in `state.parallel`
  already, so this may be free — verify the recall path includes parallel, else
  add a compact "MEANWHILE (off-screen)" line to the injection, gated to the last
  N beats). This is what makes the sim *matter*.

## Sequencing & risk
1. **Phase 1** first — pure, fully testable, zero runtime risk. The whole
   judgment of the feature (who's off-screen, guardrails, parse) lives here.
2. **Phase 2** — rides the proven `maybeTidyThreads` shape; the only new runtime
   surface, gated three ways (toggle + permission + cadence).
3. **Phase 3/4** — UI + feed-forward once the events flow correctly.

## The honest risks
- **Cost/latency.** Every tick is an extra generation. Mitigated by off-by-default
  + cadence throttle + cheap controller call. Still: flag it as a paid feature in
  the toggle tooltip.
- **Drift / contradiction.** An off-screen sim can invent things that clash with
  on-screen canon. Mitigations: feed it the locks/directives/tone; keep beats
  SMALL (activity clauses, not plot bombs); run the Phase 5 continuity alarm over
  sim events too; `src:'sim'` tagging so the user can spot and undo.
- **Over-reach.** Resist letting the sim move bonds/affection or reveal secrets
  off-screen in v1 — restrict it to `parallel` activity + at most thread
  `advance`/`stall`. Bond/secret changes off-screen are a later, opt-in escalation.
  `ponytail:` v1 = activity + thread nudge only; widen scope only if it proves safe.
- **Idempotency.** The cadence guard + serialize-set prevent double-ticking on
  regenerate/swipe (which re-fires GENERATION_ENDED) — mirror tidy's guard exactly.

## Out of scope (YAGNI)
- Off-screen bond/secret mutation (escalation, later).
- A full "world clock" autonomous of turns.
- Multi-step off-screen planning — one small beat per tick is the whole point.

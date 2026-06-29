# VELLUM II — Off-screen simulation as living threads (implementation plan)

## Why it currently shows nothing (diagnosis)
1. **Chronicle never renders `parallel`.** The World view (`chronicle.ts:31`) is
   `scene + arcs + threads` only; sim beats live in `s.parallel`, which the
   Chronicle tab doesn't render anywhere. (They DO show in the float dashboard's
   parallelBlock tagged `auto`.) → primary "nothing in chronicle" cause.
2. **`offscreenCast` needs `status==='active'`** AND not in the scene. Characters
   tagged present/mentioned/added are excluded → empty cast → silent return.
3. **Cadence + permission gates**: runs only every 3rd turn and needs
   `generation`; most turns are a deliberate no-op.
4. **Design gap (the real ask):** sim beats are stored as `parallel` — a
   full-REPLACE snapshot capped at 8. They can't accumulate, advance, resolve, or
   spawn new subplots. You want them to behave like plot threads (round-trip to
   the prompt; advance/resolve/create).

## Decision: a dedicated "Offscreen" subplot model, surfaced in the World view
Keep it in the **World tab** (scene + arcs + threads + offscreen all belong to
"the state of the world"), as its own section under threads — NOT a new top tab.
Promote off-screen activity from ephemeral parallel snapshots to first-class
**offscreen threads** that round-trip through the prompt.

Rather than overload the existing `thread.op` reducer (on-screen plot threads,
different lifecycle + UI), add a parallel-but-separate track type so the two
don't entangle. It mirrors the thread shape, so most code is reuse.

## Phase 1 — Data: an offscreen-thread track (events + reduce + type)
- `ChronicleState.offscreen: OffscreenThread[]` — `{ id, name, who?, where?,
  status:'active'|'resolved', gist, firstTurn, lastTurn, beats: string[] }`.
  (`beats` = the running log of what's happened off-screen in that subplot.)
- New events (mirror thread.op): `offscreen.op` with `op:'new'|'advance'|'resolve'`
  + `id`/`name`, `gist`, optional `who`/`where`. Reducer upserts by id, appends
  the beat to `beats` (cap ~6), flips status on resolve. `core/events.ts` +
  `core/reduce.ts` + `domain/types.ts`.
- Keep `parallel.set` as-is for the model's own narrated meanwhile-lines (still
  shown in the dashboard); the SIM now writes offscreen threads instead, so it
  accumulates instead of being overwritten.
- Tests: new/advance/resolve upsert; beats cap; status flip.

## Phase 2 — Sim emits + round-trips offscreen threads (domain/offscreen.ts)
- `SIM_SYS` + `buildSimPrompt`: feed the model the CURRENT open offscreen threads
  (id + name + last beat) so it can **advance/resolve** them or **create new**
  ones — exactly like on-screen threads round-trip. Output schema gains
  `offscreen:[{op,id?,name,who?,where?,gist}]`.
- `parseSim`: parse the offscreen array (tolerant, capped); keep parallel parse
  for back-comat but prefer offscreen.
- `simEvents`: emit `offscreen.op` events (resolve `who` to a cast id when known;
  offscreen threads MAY reference a not-present character without minting a
  scene). Still no bond/secret mutation (v1 scope holds).
- Tests: advancing an existing offscreen thread by id; creating a new one;
  resolving; guardrails (locks/directives) still injected.

## Phase 3 — Feed-forward into the prompt (recall.ts)
- Replace the `[MEANWHILE, OFF-SCREEN]` block (which reads `parallel src:'sim'`)
  with one built from **open offscreen threads** (name + latest beat), so the
  on-screen model can acknowledge and react to them. Cap to recent N. This is the
  loop that makes them matter — same role the CAST/THREADS blocks play.

## Phase 4 — UI: an Offscreen section in the World view (chronicle.ts)
- Under Threads in the World view, render an **Offscreen** sub-section: each
  offscreen thread as a card (name, who/where chip, latest beat, status, a small
  beats-history disclosure), reusing the `.vle-track`/thread card styling.
- World view empty-state + counts updated to include offscreen.
- Also render `parallel` (model-narrated meanwhile) here so ALL off-stage life is
  visible in one place — fixes the "shows nothing" even before the sim ticks.
- Manual CRUD optional (resolve/delete an offscreen thread) reusing the cmd path;
  ponytail: read-only v1 if the cmd wiring balloons.

## Phase 5 — Make it actually run (the gates that hide it)
- `offscreenCast`: include `present`? No — but widen to `active` OR `mentioned`
  with a recent `lastTurn`, so a known-but-offstage character qualifies. Keep the
  cap. (The current `active`-only filter is why the list is often empty.)
- Surface cadence: keep every-3rd-turn default but **run once immediately when the
  toggle is switched on** (so the user sees something without waiting 3 turns),
  and log when it no-ops for visibility in the Context tab.
- Keep permission gating + the serialize guard.

## Verify
typecheck → test → build → reload. Manual: toggle Offscreen on → within a tick,
the World view shows offscreen subplots that persist and evolve across turns; the
next on-screen turn can reference them; resolving one removes it from the feed.

## Sequencing / risk
1. Phase 1 (data) + Phase 4 (render parallel + offscreen) FIRST — this alone
   fixes "shows nothing" and is low-risk (additive type + a render section).
2. Phase 2/3 (the thread round-trip) — the behavioral core.
3. Phase 5 (gates) — tuning so it fires.
Out of scope: off-screen bond/secret mutation (still forbidden in v1);
auto-promoting an offscreen thread to an on-screen arc (later).

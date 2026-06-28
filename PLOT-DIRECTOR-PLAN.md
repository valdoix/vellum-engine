# VELLUM II — Plot Director (implementation plan)

Flip VELLUM from purely **descriptive** (records what happened) to optionally
**prescriptive** (steers what happens next), without suffocating emergent play.
Design principle throughout: directives are **gentle, optional, self-clearing
nudges with visible status** (a writers'-room whiteboard) — EXCEPT the locks,
which are hard mechanical guarantees because they act on the model's *output*.

Foundations already in the codebase this builds on:
- **One fold chokepoint** — every model-emitted bond passes `adjustBond`/the
  absolute branch in `core-feature.ts:62-94` before becoming a `bond.delta`.
  "Romance OFF" already strips the `romantic` category there (`tone.ts:62-65`).
- **Per-chat persisted dials** — tone is stored via `setChatVar`/`getChatVar`
  (`backend.ts:809-816`); locks/directives use the same store.
- **Observable event log** — `secret.reveal`, knowledge events, `bond.delta`,
  `thread.op` all fire, so directives can self-detect fulfillment.
- **Injection pipeline** — recall/assemble already composes text into the prompt;
  directives + lock-notes are an additive block.
- **Chronicle sub-nav** (World/Memory/Knowledge/Secrets) — the timeline is a new
  sub-view; the Context tab already surfaces what's injected.

Gate every phase: `bun run typecheck && bun run test && bun run build`.
Order = the lock first (highest guarantee, lowest risk), then the directive-queue
primitive (the spine the steering ideas share), then the cheap/high-value views.

---

## Phase 1 — Relation locks (forbid / pin) ★ PRIORITIZED
The only Plot Director feature that doesn't depend on the model cooperating —
it strips disallowed categories at the fold chokepoint, so the graph can never
record them.

- **State/persistence:** a per-chat list `relationLocks: [{ a, b, forbid: Category[], pin: Category[] }]` via chat var (mirror tone). `a`/`b` stored as the **sorted canonical pair** so direction never matters.
- **Enforcement (core-feature.ts chokepoint):** before pushing a `bond.delta`,
  look up the lock for the normalized pair; drop any `addCats` in `forbid`, and
  drop any `removeCats` in `pin`. Reuse the exact tone-strip shape. Pure helper
  `applyLock(bond, lock)` next to `adjustBond` so it's unit-testable.
- **One-time cleanup on apply:** when a lock is *created* on an already-offending
  pair, emit a `bond.drop`-of-category event (commands.ts already supports
  category drop) so an existing romantic edge is removed, not just future ones.
- **Negative directive (prose cooperation):** when a pair has a `forbid`, inject
  a one-line note ("Cersei and Jaime are not and will not become romantic") via
  the assemble block, so the prose stops fighting the strip. This is the bridge
  to Phase 2's injection.
- **UI:** a lock control on the relation card (relations.ts already has
  `categoryHistory`/`userEdited`); a small modal to pick forbidden/pinned
  categories. Locked state shown as a badge.
- **Tests:** forbid strips `romantic` both directions; pin blocks removeCats;
  creating a lock on an existing romantic pair drops the edge; no lock = today's
  output byte-identical.
- ponytail: v1 locks the **category**; aff-bleed (model pumps aff under a
  relabeled category) is left unclamped — add an optional aff cap on locked pairs
  when/if it leaks. Feasibility: small-medium, low risk.

## Phase 2 — Directive queue primitive (the spine)
A typed list of pending intentions that (a) inject as guidance while armed,
(b) self-clear when the fold observes the matching event, (c) expire via TTL.

- **State:** `directives: [{ id, kind, payload, status:'armed'|'fired'|'done', createdTurn, ttl }]` persisted per chat. Kinds v1: `reveal_secret`,
  `reveal_knowledge`, `advance_thread` (clean observable events exist for all).
- **Inject (assemble):** armed directives render a compact "DIRECTOR'S INTENT"
  block into the prompt ("Next scene: Cersei should reveal the poison secret").
- **Self-clear (post-fold):** after reduce, scan new events; a directive whose
  target transition fired (`secret.reveal` for that secret, etc.) → `done`.
  Armed past `ttl` turns → expire (drop, don't nag).
- **Status visible:** surface in the Context tab + a Director panel: armed /
  fired-but-unconfirmed / done.
- **UI:** "Direct" actions on secrets/knowledge/threads ("reveal next scene"),
  feeding the queue. Reuses the Chronicle CRUD button pattern.
- **Tests:** armed directive injects; matching fold event clears it; TTL expiry;
  ignored directive doesn't duplicate.
- Honest risk: the model may not comply — hence status + TTL + user visibility,
  never a hard block. Feasibility: high (injection is additive; events exist).

## Phase 3 — Timeline sub-view (Chronicle)
Cheap, high-value, unlocks Phase 4.

- New Chronicle sub-view "Timeline" (the sub-nav already exists). Spine = the
  reliable **turn axis** with `day` labels overlaid (day is model-emitted and
  sparse — never the primary axis or it breaks when omitted). Render arcs/
  chapters as spans (they carry `covers`), leaves as ticks by `turn`.
- Pure view over existing data; no schema change.
- ponytail: strict calendar mode deferred until `day` proves reliable.

## Phase 4 — Scheduled events (timeline × directives)
The payoff combo: a future-dated directive that arms when the timeline reaches
its turn/day.

- A directive kind `scheduled` with a `whenTurn`/`whenDay`; dormant until the
  current turn reaches it, then becomes `armed` and injects like any directive.
- Surfaces on the timeline as an upcoming marker ("⚑ the wedding · day 12").
- Rides entirely on Phase 2's queue + Phase 3's view. Feasibility: medium.

## Phase 5 — Contradiction / continuity alarm (passive guard)
Arguably the highest-value guard; warns, never blocks.

- Post-fold, compare new events to prior state and flag impossibilities: a
  character reveals a secret they don't keep; references an absent/dead
  character; "learns" something already known; a bond delta on a forbidden-locked
  pair (ties to Phase 1).
- Pure comparison over state + fold output (the Phase 1 helper plumbing helps).
- Surface as non-blocking warnings in the Context/Director panel + a toast.
- Honest risk: false positives → it must advise, not enforce. Feasibility:
  medium-high.

## Phase 6 — Steering directives: agendas & scene beats (layer on the queue)
Once the queue is proven, add the softer steers:
- **Character agenda** — a standing per-character goal that injects until met
  ("Jaime wants to desert"). Persists across turns; clears on fulfillment.
- **Scene beat** — a turn-scoped intended beat ("escalate to violence", "a quiet
  reconciliation"); injects for the next turn only.
- **Tension governor** — extend Tone with a target tension; inject raise/lower
  stakes nudges. Reuses the tone dial UI.
- All three are directive *kinds*; no new infra beyond Phase 2. Feasibility: high.

---

## Sequencing & rationale
1. **Locks (Phase 1)** — ship first: the only hard guarantee, rides a proven
   chokepoint, fails open, independently useful, directly solves the Jaime/Cersei
   case. One commit.
2. **Directive queue (Phase 2)** — the primitive everything prescriptive shares;
   build with reveals/knowledge/threads (clean events) before anything fancier.
3. **Timeline (Phase 3)** — cheap, and the substrate for Phase 4.
4. **Scheduled (Phase 4)** — timeline × queue payoff.
5. **Contradiction alarm (Phase 5)** — passive guard, high value, reuses Phase 1
   comparison plumbing.
6. **Agendas/beats/tension (Phase 6)** — soft steers, free once the queue exists.

## Cross-cutting design rules
- **Locks are mechanical (output-side guarantee); directives are suggestive
  (input-side nudge).** Never pretend a directive is a guarantee.
- **Everything injected is visible** in the Context tab — no hidden puppeteering.
- **Self-clearing + TTL** on every directive so nothing nags forever.
- **Fail open** — a malformed lock/directive does nothing, never corrupts state.
- The append-only event log means none of this rewrites history; locks/directives
  are a layer *over* the fold, not a mutation of past events.

## Out of scope (YAGNI until asked)
- Off-screen simulation, save-point/branching (cool, niche — defer).
- aff-clamp on locked pairs (add only if category-strip leaks).
- Strict calendar timeline (until `day` proves reliable).
- No backend model/prompt-shape changes beyond the additive injected blocks.

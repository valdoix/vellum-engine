# VELLUM II — Implementation Plan

**Codename:** *Palimpsest* — a manuscript page written, scraped, and rewritten, every layer still legible underneath. The name encodes the core architectural bet: an **append-only event log** where the present state is the top layer and the whole history stays readable beneath it.

**New repo:** `vellum-engine` (fresh GitHub repo, not a fork of `vellum-tracker`). The old repo stays frozen as `vellum-tracker` (legacy/1.x). VELLUM II ships as a clean TypeScript + Bun project with a real build step, modules, and tests.

This plan covers the rebuild of **both** halves: the **preset** (the prompt that drives the model) and the **extension** (the Spindle worker + UI). They are co-designed around one shared contract.

---

## Project state / decisions log

> Running, authoritative catch-up for any future session. Newest at top. If you're resuming cold: read this section, then §1 (repo layout) and §10 (phases).

- **2026-06-26 — Phase 3 COMPLETE & shipped.** Semantic recall: `retrieval/fuse.ts` (Reciprocal Rank Fusion), `retrieval/embed.ts` (host `memories.cortex` adapter, capability-gated → returns null when vectorization off), `buildInjectionHybrid` fuses lexical(×1.1) + vector(×1.0) via RRF and **falls back to pure lexical** when vectors unavailable — continuity precision never lost. Hierarchical memory `domain/memory.ts` (`planChapter`/`chapterEvents`) compresses oldest turn-memories into chapter memories as `memory.record` events that flow through the SAME index/fuser (fixes legacy memTree that never fed recall). Interceptor uses hybrid path. **35 tests pass**, typecheck + build clean. Next: Phase 4 (component UI: Chronicle/Cast/Graph/Vault/Pulse tabs) + Phase 5 (preset, importer, controller-retrieval).

- **2026-06-26 — Phase 2 COMPLETE & shipped.** Retrieval layer: `retrieval/tokenize.ts` (stoplist), `invindex.ts` (incremental token→ids inverted index + IDF), `lexical.ts` (BM25 — rare proper nouns outrank filler, the continuity-precision tier), `budget.ts` (char allocator + phase mult), `recall.ts` (buildInjection: **authoritative structured cast/bonds verbatim** + scene-relevant **recall** of prose items). Interceptor wired in backend (scene query from recent msgs, index invalidated on fold). **Continuity guardrail enforced at the type boundary** — only knowledge/secrets/memories are RetrievableItems; cast/relation scores are never scored. **28 tests pass**, typecheck + build clean. Next: Phase 3 (host embeddings + RRF fusion, capability-gated; hierarchical chapter/arc memory).

- **2026-06-26 — Phase 1 COMPLETE & shipped.** JSON state-block contract (`parse/state-block.ts`) with `‹vellum›` fences + regex fallback (`parse/fallback-regex.ts`), format-agnostic `ParsedState` seam, **FOLD lifecycle** (`bus/lifecycle.ts`, pure + sig-idempotent), **extensibility registry** (`bus/registry.ts` — `registerFeature`/`runExtractors`), core feature mapping parsed→events, backend wired to `GENERATION_ENDED`→fold with a dispatch table, frontend renders live cast/relations preview. `EXTENDING.md` documents the 3-seam feature-add model. **20 tests pass**, typecheck + build clean. Next: Phase 2 (inverted index + lexical recall + interceptor injection + budget).
- **2026-06-26 — Extensibility model (LOCKED):** add a feature via 3 seams — (1) event kind in `core/events.ts` + (2) one `case` in `core/reduce.ts` (exhaustive switch fails build until handled) + (3) a `Feature` in `bus/registry.ts`. Parser carries arbitrary `ext` data; lifecycle runs all extractors (isolated try/catch); store/broadcast ship new state automatically. See `EXTENDING.md`.
- **2026-06-26 — Blocks over profiles (CONFIRMED, supersedes earlier draft).** The preset stays **block-based for maximum user control**, per maintainer intent. We use Lumiverse-native **Prompt Variables** (typed UI inputs), **Block Groups** (radio/checkbox), **per-block Injection Triggers**, and **Context Filters** — NOT coarse "swap-everything" profiles. Every legacy `{{if}}` toggle becomes a Prompt Variable or a block-in-a-group. See §4.
- **2026-06-26 — Repo:** new repo `vellum-engine` (TypeScript + Bun + tests + CI), legacy `vellum-tracker` frozen as 1.x. Local working copy at `C:\Users\User\Downloads\preset\vellum-engine`.
- **2026-06-26 — Architecture bet locked:** append-only **event log** + pure reducers + serialized write queue; **JSON state block** contract (regex fallback); **hybrid retrieval** (lexical ⊕ host-embeddings ⊕ structured, RRF) with structured facts kept authoritative (never similarity-retrieved); isolated UI components with error boundaries.
- **Continuity guardrail (NEVER violate):** bond scores, who-knows-what, day counter, cast identity, relationship categories are extension-owned and injected verbatim — never retrieved by similarity.

---

## 0. Guiding principles (the throughline)

The legacy system fights the grain in four ways. VELLUM II flips each:

| Legacy (vellum-tracker) | VELLUM II (Palimpsest) |
|---|---|
| Prose → brittle regex → structure | Model emits a **validated JSON state block**; regex is fallback only |
| Bag-of-words token-overlap recall | **Hybrid retrieval**: host embeddings ⊕ BM25/lexical ⊕ structured, fused by RRF |
| Mutable blobs mutated by racing tasks | **Append-only event log** + pure reducers + one serialized write queue |
| Two giant files; one throw freezes a tab | **Modules + isolated UI components**; failures degrade locally |
| `userId \|\| _lastUserId` scattered, in-memory | One **persisted identity + capability** layer |
| `version:3` read by nothing | Real **schema + migrations**, zod-validated |
| No tests | Pure parsers/reducers/retrieval are **unit-tested** |

**Non-negotiable continuity guardrail:** structured facts the extension owns deterministically — bond scores, who-knows-what, the day counter, cast identity, relationship categories — are **authoritative and injected verbatim, never retrieved by similarity**. Retrieval (lexical or vector) only ever surfaces *prose context*. This keeps embeddings additive to continuity, never subtractive.

---

## 1. Repository & toolchain

```
vellum-engine/
  package.json            bun + tsup build, vitest, eslint, prettier
  tsconfig.json           strict: true
  spindle.json            manifest (permissions, entry points, version)
  src/
    core/                 schema.ts (zod), events.ts, reduce.ts, migrate.ts, ids.ts, hash.ts, result.ts
    parse/                state-block.ts (JSON), ledger.ts, fallback-regex.ts, sanitize.ts
    domain/               cast.ts, relations.ts, knowledge.ts, memory.ts, threads.ts, scene.ts
    retrieval/            invindex.ts, embed.ts (host), lexical.ts, fuse.ts (RRF), rerank.ts, budget.ts
    store/                chronicle.ts, writeQueue.ts, cache.ts
    host/                 user.ts, capability.ts, worldbooks.ts, generation.ts, chats.ts
    bus/                  events.ts, pulse.ts, lifecycle.ts
    backend.ts            entrypoint: wires interceptor, events, message dispatch
    ui/
      app.ts              setup(ctx): mounts shell, registers tabs
      runtime.ts          shared frontend state, send/recv helpers
      component.ts        tiny component model (render/mount/update + error boundary)
      tabs/               window.ts, chronicle.ts, cast.ts, graph.ts, vault.ts, pulse.ts
      graph/              model.ts, layout.ts, factions.ts, scrub.ts, render.ts
      styles.ts           themed CSS (CSS variables, skins)
    shared/               types.ts, dto.ts, format.ts
  test/                   *.test.ts (vitest) — parsers, reducers, retrieval, migrations
  dist/                   built backend.js + frontend.js (wired, unlike legacy)
  presets/
    vellum-ii.json        the preset (blocks format, token-lean)
    vellum-ii-regex.json  display + context-strip regex pack
    looms/                style packs (Wilde, Laini-Taylor, + new)
  README.md               accurate: permissions table, real features, install/build
```

- **Language:** TypeScript, `strict`. Both inspiration repos (LoreRecall, LumiBooks) are 100% TS with `bun run build` → `dist/`. We match that convention so contributors and the ecosystem recognize it.
- **Build:** `bun run build` (tsup → two IIFE bundles). `bun run typecheck`, `bun run test`, `bun run lint`. CI on GitHub Actions runs all four on push.
- **No runtime deps** beyond `lumiverse-spindle-types` (dev) and `zod` (bundled). Everything else hand-rolled and tested.

---

## 2. The core: append-only event log

This is the spine everything else hangs on.

### 2.1 Event shape
```ts
type VellumEvent =
  | { t: number; day: number; kind: 'turn.fold'; sig: string }
  | { kind: 'bond.delta'; a: Id; b: Id; aff?: number; trust?: number; cats?: Cat[]; why?: string; src: Src }
  | { kind: 'cast.seen'; id: Id; name: string; status: Status; src: Src }
  | { kind: 'cast.edit'; id: Id; patch: Partial<CastCard>; src: Src }
  | { kind: 'knowledge.learn'; who: Id; fact: string; about?: Id; src: Src }
  | { kind: 'secret.form' | 'secret.reveal'; id: Id; keeper: Id; from?: Id[]; text: string; src: Src }
  | { kind: 'memory.record'; tier: 'turn'|'chapter'|'arc'; text: string; keys: string[]; covers?: [number,number] }
  | { kind: 'thread.op'; op: 'new'|'advance'|'stall'|'resolve'; name: string; note?: string }
  | { kind: 'scene.set'; location?: string; tension?: number; present: Id[] }
  // src = 'model' | 'user' | 'living' | 'scan' | 'import'
```
- Every meaningful change is an **immutable event**, appended through a **per-chat serialized write queue** (`store/writeQueue.ts`). No two tasks ever mutate the same object concurrently — the legacy last-writer-wins clobber bug becomes structurally impossible.
- Events carry `src`, so provenance is first-class (model-asserted vs user-edited vs auto-extracted). User edits win deterministically; auto sources can be down-weighted or rolled back.

### 2.2 Reducers (pure, tested)
```ts
state = reduce(events)   // { cast, relations, knowledge, secrets, memory, threads, scene, day, turns }
```
- `reduce()` and each domain sub-reducer (`relations.ts`, `cast.ts`, …) are **pure functions, unit-tested** against fixture event streams. This is where the multi-category relation logic, knowledge/secret dramatic-irony model, and day-counter live — now provably correct.
- Derived state is **cached** and recomputed incrementally (fold only the new events onto the last snapshot), so it's O(new events), not O(all history) per turn.

### 2.3 What the event log unlocks for free
- **Time scrubber** (the graph feature I prototyped): `reduce(events.filter(e => e.t <= T))`. No bespoke `history[]`/`categoryHistory[]` arrays.
- **Undo / redo:** pop/replay events. Destructive actions become reversible by construction.
- **Branching / what-if timelines:** fork the log at turn N. (Pairs naturally with Lumiverse's branch tree.)
- **Audit "why does the model believe X":** every fact traces to the event (and turn, and source) that asserted it. Surfaced in the UI as provenance.
- **Faithful replay** of the whole story's emotional arc.
- **Migrations:** `migrate(events, fromVersion)` upgrades the *log*, not a tangle of ad-hoc backfills.

---

## 3. The preset ↔ extension contract (kills the #1 bug class)

### 3.1 Structured state block (JSON-first)
The model appends one fenced block after prose, hidden from the reader by the regex pack:

```
‹vellum›
{ "v": 2, "turn": 41, "day": 3,
  "scene": { "loc": "godswood", "tension": 7 },
  "present": [ { "id": "cersei", "mood": "wary", "doing": "watching the door" } ],
  "delta": {
    "bonds":   [ { "a": "cersei", "b": "jaime", "aff": 8, "trust": -2, "cat": ["romantic"], "why": "the look" } ],
    "threads": [ { "op": "advance", "name": "the letter", "note": "sent at dawn" } ]
  } }
‹/vellum›
```

- The backend `JSON.parse`s and **validates against a zod schema** (`parse/state-block.ts`). Valid → emit events. Invalid/missing → **graceful fallback** to the legacy terse-regex parser (`parse/fallback-regex.ts`) so token-tight local models still work. This eliminates the entire class of regex-divination failures (the `aff 55, trust -8` lone-minus misread, format drift across models).
- "Deltas only" preserved for token economy. A `[CP]` checkpoint variant (full restate) every ~10 turns, on scene change, or re-entry — but as JSON.
- Knowledge/secrets/memory remain **prose-derived** (auto-extracted by the extension), not hand-written by the model — keeping the model's token budget on the *story*. Bonds + threads + scene are the only things the model explicitly emits, because those need its in-the-moment judgment.

### 3.2 Robust ingestion
- `host/generation.ts` reads the **raw stored message** (regex-proof) on `GENERATION_ENDED`, never trusting the possibly-stripped event payload — but as a clean, single, tested path (not three nested fallbacks).
- A formal lifecycle (`bus/lifecycle.ts`): **INTERCEPT → GENERATE → FOLD → EXTRACT → INDEX → BROADCAST**, each a named, individually-testable step. The expensive `saveChronicle` moves *off* the prompt-assembly hot path.

---

## 4. The preset — granular block control, token-lean & beautiful

**Design correction (per maintainer intent):** the original VELLUM uses **blocks, not profiles, deliberately — to give the user maximum control.** VELLUM II keeps and *deepens* that. We do NOT collapse capability into "pick one profile that swaps everything." Instead we lean on Lumiverse's **native** preset machinery, which already provides finer-grained control than a `{{if}}` toggle soup *or* a coarse profile:

- **Prompt Variables** — typed, user-facing inputs (text / slider / select / toggle) that render a clean modal when the preset is selected, and feed values into macros. This replaces hand-edited `{{if::{{var::x}}}}` plumbing with first-class UI the user sees and tunes.
- **Block Groups** — `radio` (one-at-a-time) and `checkbox` (multi-active) membership. This gives the user *direct* control over alternative instruction sets without any profile abstraction.
- **Per-block Injection Triggers** — `normal / continue / regenerate / swipe / impersonate / quiet`, so a block can be scoped to exactly the generation types it should affect.
- **Position + Depth + Role** per block (`pre_history / post_history / in_history` at depth; `system/user/assistant/append`).

So the unit of control stays the **individual block**, exactly as you intended — VELLUM II just makes each block smarter and each knob a real UI control.

### 4.1 Block architecture (everything stays user-togglable)
Organize the existing block philosophy into **named Block Groups** so the user composes freely:
- **Core Doctrine** (checkbox group, each independently togglable): prose craft, body-first interiority, "write the wrong impulse first," anti-slop forge — every rule its own block the user can disable/reorder. Crown jewels kept, never bundled away.
- **Prose Register** (radio group): literary / pulp / screenplay / chat — the user picks one *block*, not a hidden profile; switching is one click and fully visible.
- **Length Tier** (radio group): drabble → epic, plus the new titled-sub-scene long-form block.
- **Knowledge Discipline** (checkbox): dramatic-irony / POV-gating blocks — the differentiator, individually controllable.
- **Model-Family Adapter** (radio group): Claude / Gemini / local-Mistral quirk + sampler-hint blocks. Solves the README's admitted gap *as selectable blocks*, not an opaque profile.
- **State Contract** block: the JSON spec from §3, with a Prompt Variable for verbosity/depth so the user dials how much the model emits.

Anything that was a `{{if}}` toggle in legacy becomes either a **Prompt Variable** (continuous/typed control) or a **block in a group** (discrete choice) — strictly *more* control, surfaced in real UI, and exportable via **Preset Profiles** (per-character/per-chat block-state snapshots) so a user's exact block configuration travels with the character.

### 4.2 Token-lean techniques (control without bloat)
- **Macro-driven assembly:** heavy doctrine text lives in the extension as registered `{{vellum:*}}` macros (`spindle.macros`); blocks reference compact macros instead of re-sending kilobytes of literal prose every turn. The user still sees/toggles the *block*; the weight is deduplicated behind the macro.
- **Prompt-Variable gating instead of duplicated blocks:** one block whose content scales by a `{{var::depth}}` slider, rather than three near-duplicate blocks — fewer tokens, more control.
- **Injection-trigger scoping:** e.g. the full anti-slop doctrine on `normal`, a one-line reminder on `continue/swipe` — saves tokens on cheap turns without losing the rule.
- **Depth-gated detail:** rare/expensive sub-doctrines (e.g. the VTK toolkit) ship a lean always-on core block + an optional expansion block the user enables when needed — never the full ~2KB unconditionally.
- Target: materially smaller per-turn prompt than legacy's 80KB monolith, with *more* user control, because weight is macro-referenced and only the user's chosen blocks render.

### 4.3 No self-poisoning
- The extension owns canonical anchors (day, bonds, cast). The prompt receives **derived, validated** anchors via macros, marked "reference — correct if the scene contradicts," never the model's own raw `@vellum_*` vars fed back verbatim.

### 4.4 Beautiful output
- A refreshed regex display pack (its own `*-regex.json`): reverie card, inner-thought inset, dialogue glow, **scene-tension sparkline** rendered from the state block, titled sub-scene headers for the long-form tier. Themed to match the extension UI via shared accent variables.
- Use **Context Filters** (native) to strip the `‹vellum›` state block and reverie scaffolding from older messages, keeping context lean without custom regex fighting the platform.

---

## 5. Retrieval & intelligence — retrieve, don't reimplement

Borrowing the *best ideas* from the inspiration repos, rebuilt in our own engine and words.

### 5.1 Hybrid recall (continuity-safe)
`retrieval/fuse.ts` combines three ranked lists via **Reciprocal Rank Fusion**:
1. **Lexical/BM25** over an **inverted index** (`invindex.ts`, `token→entryIds`, maintained incrementally on fold) — exact precision for names, numbers, rare lore. *This is what protects continuity* (proper nouns, negations, dates).
2. **Host embeddings** (`embed.ts`) via `memories.cortex.query()` / `chatMemory.get()`, or by pushing the chronicle into a chat-scoped **databank** the host vectorizes — semantic recall for paraphrase ("the betrothal" ≈ "the engagement").
3. **Structured layer** — VELLUM's own knowledge/secrets/arcs that the host doesn't know about.
Then a **recency + feedback + provenance re-rank**, under one `budget.ts` allocator. **Capability-gated:** if the user hasn't enabled vectorization, tier 2 silently drops and lexical+structured carry on.

### 5.2 Hierarchical memory (LumiBooks-inspired, our take)
- **Splice-in-place chapter/arc compression**, like LumiBooks: oldest uncompressed window → a **chapter** memory event; many chapters → an **arc**; covered messages hidden, restored on delete. But in *our* engine these are **memory-tier events** in the log, recalled through the hybrid fuser — so the deep past compresses *and stays retrievable*, fixing legacy's linearly-growing memory that never fed back into recall.
- Stored as editable **world-book entries** (host-native), so they're visible/editable in Lumiverse too.

### 5.3 Controller-guided retrieval, optional (LoreRecall-inspired)
- For users with a controller connection: an optional **traversal mode** where a small LLM reasons over a **tree of the chronicle** ("what does *this scene* need?") instead of pure similarity — LoreRecall's core insight. Default stays the fast deterministic hybrid fuser; traversal is opt-in for power users, capability-gated, with a hard step/timeout budget.
- A **live retrieval feed** (LoreRecall's debuggable-UX idea, our visual language): scope → candidates → fused → injected, streamed as it happens, so recall is transparent and tunable.

### 5.4 Feedback signal fixed
Crediting an entry as "referenced" requires **phrase/multi-token** overlap (not any ≥4-char token), and is **idempotent per turn-signature** so swipes don't double-count and corrupt the precision auto-tune.

---

## 6. Host integration — identity & capability, done once

- `host/user.ts`: the **only** place that resolves `userId`. Resolves from payload → **persisted** last-seen uid (survives idle-unload, fixing the cold-worker Vault failure) → typed error. Never the in-memory-only global the legacy used.
- `host/capability.ts`: probe **once per chat** what's available (embeddings, world_books, generation, controller) and cache it. Every feature checks capability and **degrades with a visible reason** — no silent `catch(e){}`.
- Manifest permissions documented honestly in the README with a **"what breaks without it"** table (legacy README lied about permissions). Likely set: `interceptor, chats, chat_mutation, generation, ui_panels, world_books, memories` — each justified.

---

## 7. The frontend — components, isolation, beauty

- **Tiny component model** (`ui/component.ts`): every panel = `{ render(state)→html, mount(el), update(state) }` wrapped in an **error boundary**, so one panel's failure shows a placeholder and never freezes the tab (the "stale Relations tab" bug becomes impossible by design).
- **Targeted updates, not full innerHTML churn:** panels re-render only on the slice of state they subscribe to (keyed on the event-log version), preserving scroll/focus and killing the re-bind churn.
- **Security baked in:** one central `escape()` covering `& < > " '` (legacy missed `"`/`'` — a real XSS vector since model-authored facts land in quoted attributes), and DOM construction over string concat for anything model-authored.
- **Pointer events from day one:** drag/resize/graph-drag via Pointer Events (works on the phone skin), window geometry **persisted + clamped** on restore, ARIA/keyboard on interactive controls.
- **The relationship graph** (force layout, faction hulls, time scrubber) ported as a first-class themeable component, layout in a worker for big casts, reading directly off the event-log-derived state.
- **Beautiful, themed UI:** shared CSS-variable accent system, the gilt/illuminated-manuscript aesthetic refined, skins, the live retrieval feed and pulse feed as polished components. Tabs: **Window · Chronicle · Cast · Graph · Vault · Pulse**.

---

## 8. Testing & quality gates

- **Unit tests (vitest):** state-block parser (valid/invalid/fallback), every reducer (bond multi-category evolution, knowledge/secret irony, day counter), migrations, RRF fusion, inverted index, hull/layout/scrub geometry.
- **Golden fixtures:** recorded event streams → asserted derived state, so refactors can't silently regress continuity.
- **CI:** typecheck + lint + test + build must pass before merge.
- **No `any` in domain code; `Result<T,E>`** for fallible host calls instead of throw-and-swallow.

---

## 9. Migration from legacy

- A one-time **importer** reads a `vellum-tracker` chronicle blob and replays it into the event log (cast, relations w/ categories, knowledge, secrets, memories, threads) via `src:'import'` events — so existing users keep their history.
- Legacy preset users get a **profile mapping** (old toggles → new Mode Profile) documented in the README.

---

## 10. Phased delivery (each phase shippable & tested)

**Phase 0 — Skeleton.** Repo, build, CI, manifest, `host/user.ts` + `host/capability.ts`, component model + error boundary, empty tabs render. *Ship: installs, no features, never crashes.*

**Phase 1 — Event-log core + contract.** `core/` (schema, events, reduce, migrate), `parse/state-block.ts` + regex fallback, write queue, the JSON state block in the preset, FOLD lifecycle. Cast + relations reducers. *Ship: live window + cast/relations update from the new contract, fully tested.*

**Phase 2 — Retrieval.** Inverted index + lexical, budget allocator, interceptor injection, feedback (fixed). *Ship: scene-relevant recall, lexical-only, deterministic.*

**Phase 3 — Intelligence.** Host embeddings + RRF fusion + capability gating; hierarchical chapter/arc compression as memory-tier events backed by world books. *Ship: semantic + long-arc recall, degrades gracefully.*

**Phase 4 — UI depth.** Chronicle/Cast/Graph (force + factions + scrubber)/Vault/Pulse as components; live retrieval feed; persisted geometry; pointer events; theming. *Ship: the beautiful, complete UI.*

**Phase 5 — Preset polish + optional controller retrieval + importer + README.** Mode profiles, model-family adapters, macro-driven doctrine, regex display pack, LoreRecall-style traversal mode (opt-in), legacy importer, honest docs. *Ship: 2.0.*

---

## 11. Naming & credits

- Product: **VELLUM II** (engine codename *Palimpsest*). Repo: `vellum-engine`.
- Credit, in the README, the *influence* of LoreRecall (controller-guided tree retrieval + live feed UX) and LumiBooks (splice-in-place chapter/arc compression) — as inspiration, rebuilt natively, our own code and words. Honor their AGPL lineage if any pattern is close enough to warrant it; otherwise an acknowledgements section.

---

### The one-line bet
*Make state an immutable event log, make the model emit validated JSON, make retrieval hybrid with the host's embeddings, and make the UI components that fail in isolation — and every feature (scrub, undo, branch, audit, semantic recall, long-arc memory) falls out of the architecture instead of being bolted on.*

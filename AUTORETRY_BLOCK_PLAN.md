# Option C — Auto-Repair a Missing `<vellum>` State Block

**Goal:** When a just-generated turn folds with `source === 'none'` (the parser recovered
no state — neither the JSON block nor the terse-ledger fallback), fire ONE cheap,
prose-scoped LLM call that transcribes the turn's prose into a valid `<vellum>` JSON
block, append that block to the existing assistant message, and re-fold so the block
lands in the chronicle the canonical way.

This is a **targeted extension of the existing PASS-2 prose-extraction safety net**
(`src/bus/extract.ts`), not a new subsystem. It recovers the *authoritative* block
(scene.time/clock, full present roster, thread ops, parallel, faction standing, scars/
codex) that the PASS-2 extractor's narrower schema does not fully cover — and, as a
virtuous side effect, seeds a correctly-formatted block into the transcript that the
preset's `min_depth:1` context regex re-shows next turn as a worked example.

---

## Why Option C (recap of the feasibility analysis)

- The extension already subscribes to `GENERATION_ENDED` → `foldChat` → `foldChatInner`
  (`src/backend.ts:1306`, `:368`).
- The fold loop already computes the per-turn parse `source` and, from the earlier
  block-validation work, captures the newest turn's `_latestContent` / `_latestSource`
  (`src/backend.ts:406`, `:424`). **`source === 'none'` is exactly the trigger signal.**
- Permissions `generation` and `chat_mutation` are already granted (`spindle.json:9`).
- `spindle.chat.updateMessage(chatId, msgId, { content })` rewrites the stored message
  (content wins, mirrors into `swipes[swipe_id]`). The raw stored message already keeps
  the `<vellum>` block on a normal turn (display regex only hides it), so appending a
  repaired block produces a **transcript identical in shape to a normal turn**.
- `internalGenerate` (`src/host/generation.ts:53`) is the bounded, permission-gated,
  reasoning-off, schema-capable generation helper we reuse — same one PASS-2 uses.

Rejected alternatives: **B (full-turn re-roll via dryRun→quiet)** costs a second full
generation and needs interceptor re-assembly; **A (appendMessage + triggerGeneration)**
pollutes the transcript with an extra visible user/assistant pair. C is the cheapest and
most architecturally consistent.

---

## Design

### Trigger placement
Inside `foldChatInner`, **after the fold loop and after `if (!added) return;`, but
BEFORE the PASS-2 extraction / early-broadcast block.** Rationale: on a successful
repair we re-fold from scratch (the reconcile path), so we must not first broadcast the
block-less state and run PASS-2 only to immediately discard it.

Gate (ALL must hold):
1. Opt-in chat var `vellum_autoretry_block` is on (default **off**).
2. `_latestSource === 'none'` (newest turn recovered no state).
3. `looksLikeVellumTurn(_latestContent)` is true (reuse `src/host/validation.ts`) — so
   plain non-VELLUM chats never trigger a generation.
4. `await has('generation')`.
5. Loop guard allows it (see below).

If the gate fails, behavior is **unchanged from today** (fall through to PASS-2).

### The repair generation
New module `src/bus/block-repair.ts`, mirroring `extract.ts`:

- `VELLUM_BLOCK_REPAIR_SYS`: a system prompt instructing the model to read the prose and
  emit **only** the `<vellum>` state block per the v2-state schema — deltas only, real
  names, `{{user}}` inner fields empty, `scene.time` advanced forward. Adapt the existing
  `VELLUM_STATE_BLOCK_CONTENT` constant (`src/backend.ts:61`) so the schema text stays in
  one place (export it and import into the repair module).
- `buildRepairContext(prior, turnNo)`: a compact header — `turn: N`, `day: D`, prior
  `scene.loc` / `scene.time` / `scene.clock`, and the present cast display names — so the
  model produces correct forward deltas instead of guessing turn/day.
- `repairStateBlock(prose, ctx, userId)`:
  1. `internalGenerate([{system}, {user: context + prose.slice(0, 8000)}], { temperature: 0.2, max_tokens: 500 }, userId, { reasoningOff: true, timeoutMs: 30000, responseFormat: STATE_JSON_SCHEMA })`.
     - The schema asks for **raw JSON** (not the fenced wrapper), so `response_format`
       can be enforced when `generation_parameters` is granted.
  2. Validate the returned text with the **existing** `parseState()` (it already accepts a
     bare balanced `{…}` carrying schema keys, `src/parse/state-block.ts:44`). Only accept
     `source === 'json' | 'json-partial'`.
  3. On success return `{ block, state }` where `block = \`<vellum>\n${canonicalJson}\n</vellum>\``.
  4. On any failure (no perm, timeout, unparseable, empty) return `null`.

Keep the pure parts (prompt/context builders, block assembly from parsed JSON) separate
from the `internalGenerate` I/O so they're unit-testable, exactly as `mapExtracted` is
split from `extractFromProse`.

### Write-back + re-fold (the reconcile path)
On a successful `repairStateBlock`:
1. Read the newest assistant message via `getRawMessages(chatId)` → last `role==='assistant'`
   → `{ id, activeContent }` (`src/host/chats.ts:17`, `:40`).
2. `spindle.chat.updateMessage(chatId, id, { content: activeContent + '\n\n' + block })`.
   - Do **not** set `skipChunkRebuild` — a normal turn stores the block in the message
     anyway, so let chunk rebuild behave normally (consistency over micro-optimization).
   - Content-only patch emits `MESSAGE_EDITED` only (no swipe fields) — and the fold is
     wired to `GENERATION_ENDED`, **not** `MESSAGE_EDITED`, so this does not auto-loop.
3. Record the guard attempt for this `messageId`.
4. `void foldChat(chatId, userId)` (chained via `_foldChain`) and **`return`** from the
   current inner pass.
   - The chained fold re-reads messages; `divergedTurn` sees the changed content
     signature for that turn, `truncateAfterTurn(turnNo-1)` rolls it back (discarding the
     block-less fold marker, memory record, and any events), then re-folds with the block
     present → `source === 'json'`, and PASS-2 runs **once** on the repaired turn.
   - Net cost of a repaired turn: original generation + **1 repair call** + the normal
     single PASS-2 in the re-fold. No duplicate PASS-2, no event double-counting (the
     rollback cleans the slate before re-folding).

If `repairStateBlock` returns `null`: record the attempt, **do not return early**, and
fall through to the existing PASS-2 safety net (current behavior preserved).

### Loop guard / idempotency
- Module-level `const _blockRepairAttempts = new Set<string>()` keyed by
  `chatId + '\u0000' + messageId`.
- Enter repair only if the key is absent; add it on **any** attempt (success or fail),
  capping at exactly **1 repair per message**.
- `messageId` is stable across the content edit, so the chained re-fold cannot re-enter
  repair for the same message.
- Clear the chat's keys in `pruneChatState` (`src/backend.ts:1322`) on `CHAT_SWITCHED`.
- Because the gate requires `_latestSource === 'none'` on the **newest** folded turn, this
  is inherently newest-turn-only — it never storms historical block-less turns on a long
  chat or on the `vellum_get_state` self-heal path (those turns aren't the newest, and
  their messageIds accumulate no attempts because we only ever key the last assistant msg).

---

## Files to change

1. **`src/bus/block-repair.ts` (new)**
   - `VELLUM_BLOCK_REPAIR_SYS`, `buildRepairContext`, `assembleBlock` (pure),
     `repairStateBlock` (I/O). Uses `internalGenerate`, `parseState`, `has`.
2. **`src/backend.ts`**
   - Export `VELLUM_STATE_BLOCK_CONTENT` (or move the schema string into block-repair and
     import back) to avoid schema duplication.
   - `import { repairStateBlock } from './bus/block-repair.js'`.
   - Add `_blockRepairAttempts` Set + clear it in `pruneChatState`.
   - In `foldChatInner`, after `if (!added) return;` and before the `willExtract`/early
     broadcast: the gated repair block described above.
   - Dispatch handler `vellum_autoretry_set` (mirror `vellum_offscreen_set` at
     `src/backend.ts:2347`): `setChatVar(chatId, 'vellum_autoretry_block', enabled?'1':'')`,
     reply `vellum_autoretry_set_done` with `available: await has('generation')`.
   - `broadcastState`: read `vellum_autoretry_block` in the parallel batch (`:143`) and
     include `autoRetryBlock` in the `vellum_state` payload (`:166`).
3. **`src/ui/` (settings/options tab)**
   - Add a toggle bound to `vellum_autoretry_block`, mirroring the existing
     Off-screen / Tidy-threads toggles (they already have set-handlers + broadcast fields
     and a "requires generation" availability hint). Keep copy honest: "Auto-repair a
     missing state block (1 extra generation per affected turn; needs the generation
     permission)."
4. **`test/block-repair.test.ts` (new)**
   - Pure tests: `buildRepairContext` shape; `assembleBlock` wraps valid JSON into a
     `<vellum>…</vellum>` string that `parseState` accepts with `source === 'json'`;
     junk/empty JSON → `assembleBlock`/validation returns null.
   - A guard-logic test if the guard is extracted to a pure helper.

---

## Cost, safety, and caveats (call these out in review)

- **Opt-in, default off.** No behavior change for existing users until enabled.
- **Bounded:** newest turn only, max 1 attempt/message, reasoning off, ~500 tokens,
  30s timeout, generation-permission gated.
- **`internalGenerate` bypasses the interceptor** — acceptable here. The repair
  *transcribes already-written prose into a state block*; it is not authoring new fiction,
  so VELLUM's recall injection is not needed. This is the same assumption PASS-2
  `extractFromProse` already relies on.
- **Reasoning models** may still refuse to emit the block (they plan in a hidden channel).
  A failed repair degrades cleanly to today's PASS-2 fallback — **no regression**, just no
  improvement, exactly where failures cluster.
- **No event-loop risk:** our edit emits `MESSAGE_EDITED`, which is not a fold trigger; the
  single re-fold is explicit and guard-protected.
- **No double-count:** the reconcile rollback (`truncateAfterTurn`) removes the block-less
  turn's events before re-folding, so bonds/knowledge are not applied twice.
- **Decision point — chat-memory chunks:** we let chunk rebuild run normally (the block is
  small and a normal turn stores one anyway). Do **not** reach for `skipChunkRebuild`; the
  docs warn it drifts retrieval from stored content.

## Verification

- `npm run typecheck`, `npm test` (add the new test file).
- Manual: a model/config that reliably drops the block (or a stub), toggle on, confirm the
  repaired `<vellum>` appears in the stored message, the chronicle advances (`source` logs
  `json` on the re-fold), and the guard prevents a second attempt on the same message.
- Confirm no repair fires on a plain non-VELLUM chat (gate 3) and none fires on
  `vellum_get_state` hydrate of historical block-less turns (newest-turn gate).

## Rollout

Ship behind `vellum_autoretry_block` (off). If it proves reliable, consider defaulting it
on for non-reasoning connections only, keyed off the Model Errata selection.

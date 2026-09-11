# Scope — Option 2: Element-Level Salvage for the State Block

## Problem this solves

A single character-level corruption anywhere in the `<vellum>` block currently
fails `JSON.parse`, which loses the **entire turn's** structured state (scene,
present, all delta arrays), forcing a degraded prose-only fallback. The observed
case was a run-on in one journal element:

```
"weight":"significantsentiment":"positive"   // dropped delimiter → "str":"str":"str"
```

The parser's three repair rungs (happy path → repair scan → truncation close)
none of them handle a mid-block malformation, so one bad element in one array
nukes a turn that was otherwise 99% valid — 6 present characters, 3 bonds, 4
parallel entries, 3 knowledge facts, scene, codex, all lost.

**Goal:** when the whole-object parse fails, recover every part that IS valid and
drop only the corrupt element(s). Turn a whole-turn loss into a one-element loss.

---

## Where it fits

New **rung 4** in `lenientParse` (`src/parse/state-block.ts`), reached only after
rungs 1–3 fail. This is important:

- Zero impact on healthy blocks (happy path still wins at rung 1).
- Zero impact on currently-recovered blocks (rungs 2–3 unchanged).
- Pure additive last resort before `parseState` returns `null`.

```
1. JSON.parse(balanced)                    ← unchanged
2. repair scan + structural fixups          ← unchanged
3. close truncated from bracket stack        ← unchanged
4. ELEMENT SALVAGE  (new)                    ← recover valid parts, drop corrupt
```

---

## Core new primitive: top-level key/value tokenizer

The one genuinely new piece of code. A quote- and bracket-aware walk that splits a
top-level object into `{ key, rawValue }` pairs, capturing each value's exact
substring span. Reuses the same quote-family / control-char discipline already in
`scanJson` / `balancedObject`, so it can't be fooled by braces, commas, or colons
inside strings.

```ts
interface KV { key: string; value: string; }   // value = exact source substring
function tokenizeTopLevel(objSrc: string): KV[] | null
```

- Walks at depth 1 inside the outer `{...}`.
- At each `"key":` boundary, captures the value span up to the next depth-1 comma
  (scalar), or the matching `}`/`]` (object/array value).
- Returns `null` if the outer object itself isn't recoverable enough to segment
  (then rung 4 gives up → `null`, same as today).

This tokenizer is the risk center. It gets the heaviest test coverage.

---

## Salvage algorithm (two levels — matches the schema shape)

`ParsedState` is exactly two levels deep for the data we care about:
top-level (`turn`, `day`, `scene`, `present`, `ext`) + `delta.*` arrays. So a
**two-level** salvage covers the whole schema without a general recursive parser.

```
salvage(objSrc):
  pairs = tokenizeTopLevel(objSrc)            // ["turn":…, "scene":…, "present":…, "delta":…, "ext":…]
  result = {}
  for {key, value} in pairs:
    if value is a scalar or object:
        parsed = tryParse(value) ?? tryParse(repair(value))
        if ok: result[key] = parsed          // e.g. scene survives whole
    if value is an array:
        result[key] = salvageArray(value)     // element-by-element
    if key === 'delta' and value is an object:
        result.delta = salvageDelta(value)     // recurse ONE level
  return result

salvageArray(arraySrc):
  elements = splitElements(arraySrc)           // depth-1 element spans (quote/bracket aware)
  out = []
  for el in elements:
    parsed = tryParse(el) ?? tryParse(repair(el))   // per-element repair too
    if ok: out.push(parsed)                    // corrupt element silently dropped
  return out

salvageDelta(deltaSrc):
  pairs = tokenizeTopLevel(deltaSrc)
  out = {}
  for {key, value} in pairs:
    if value is array: out[key] = salvageArray(value)
    else:              out[key] = tryParse(value) ?? tryParse(repair(value))
  return out
```

`repair(x)` = the existing `structuralFixups(scanJson(x).out)` — so each element
gets the SAME repair the whole block gets today, just scoped down. This means a
corrupt element can still be individually recovered when the corruption is one the
repair scan handles; only genuinely unrecoverable elements are dropped.

`splitElements` reuses the depth/quote walk (shared with `balancedObject`), NOT a
comma split — commas inside strings and nested objects must not break elements.

### Outcome on the reported block

- `turn`, `day`, `scene` → survive whole
- `present` → all 6 survive
- `delta.bonds` (3), `delta.threads` (1), `delta.parallel` (4), `delta.knowledge` (3) → survive
- `delta.journal` → elements 0,1,2 survive; **element 3 (the run-on) dropped**
- `ext.codex` → survives

Net: everything recovered except Oberyn's one journal entry, vs. **total loss**
today.

---

## Reassembly & validation

Build a plain JS object from the salvaged pieces (no re-stringify) and feed it to
the existing pipeline unchanged:

```ts
hoistDeltaFields(salvaged);
normalizeBlock(salvaged);
const validated = ParsedState.safeParse(salvaged);
```

Zod's per-field `.catch(undefined)` tolerance still applies on top, so a survivor
element with a stray field degrades gracefully exactly as it does today.

---

## Signal + logging change (so silent data loss is diagnosable)

Salvage discards data. That must be visible, not silent.

1. Extend the parse source enum:
   `ParseResult.source: 'json' | 'json-partial' | 'regex' | 'none'`
   (touches `src/parse/parsed.ts`, `src/parse/state-block.ts`,
   `src/bus/lifecycle.ts` `FoldResult.source`).
2. Rung 4 returns `source: 'json-partial'` and reports a count of dropped
   elements.
3. Backend fold log (`src/backend.ts:427`) already prints `via ${source}`, so it
   becomes `folded turn N via json-partial: +K events`. Add a `warn` with the
   dropped-element count and which arrays lost members, so recurring model
   malformations are quantifiable in the logs.
4. `hadBlock` (drives the PASS-2 "FALLBACK" label) should treat `json-partial` as
   `true` — the block WAS parsed, just partially — so the safety-net extractor
   still runs but the log doesn't mislabel it as "no block".

---

## Edge cases to handle explicitly

- **Truncated AND corrupt**: rung 3 (truncation) runs before rung 4; if it fails,
  rung 4 operates on the from-brace slice and simply drops the trailing incomplete
  element. `splitElements` must tolerate a final unterminated element (skip it).
- **Corruption in `scene` (an object, not an array)**: `scene` is salvaged as a
  whole value; if it fails even after element-level repair, it's omitted and Zod
  treats scene as absent (no scene change that turn) rather than failing the block.
- **Corruption in a top-level scalar** (`"day": 13x`): scalar fails → key omitted →
  Zod default. No collateral.
- **Nested corruption inside an otherwise-valid element** (e.g. a bad `parallel`
  entry with a broken inner field): dropped at the element level; siblings kept.
- **Everything corrupt / tokenizer returns null**: rung 4 returns null → existing
  regex fallback → existing `none`. No regression: worst case equals today.
- **Do-no-harm guarantee**: rung 4 can only ADD recoveries. If it produces an
  object that fails Zod, we fall through to the regex fallback exactly as today.

---

## Files touched

| File | Change |
| --- | --- |
| `src/parse/state-block.ts` | new `tokenizeTopLevel`, `splitElements`, `salvageObject` + rung 4 wiring in `lenientParse`/`parseState` |
| `src/parse/parsed.ts` | add `'json-partial'` to `ParseResult.source` |
| `src/bus/lifecycle.ts` | `FoldResult.source` union + pass-through |
| `src/backend.ts` | treat `json-partial` as `hadBlock`; log dropped-element count |
| `test/lenient-parse.test.ts` | new salvage suite (below) |

No schema changes to events, reduce, or UI. Contained to the parse seam.

---

## Test plan (the tokenizer/splitter is the risk — cover it hard)

Reproduction:
- the exact `"weight":"significantsentiment":"positive"` run-on → block parses as
  `json-partial`, journal loses exactly one entry, bonds/parallel/knowledge/scene/
  present all intact.

Salvage correctness:
- corrupt element in the FIRST / MIDDLE / LAST position of an array
- two corrupt elements in the same array
- corrupt element in `present` (top-level array) vs `delta.*` (nested array)
- corrupt `scene` object → scene omitted, rest survives
- corrupt top-level scalar → key omitted, rest survives

Splitter robustness (must NOT mis-split):
- commas inside string values
- nested objects/arrays inside an element
- braces/brackets inside single- and double-quoted strings
- smart quotes and apostrophes inside element strings
- a trailing unterminated element (truncation + corruption combined)

Do-no-harm / no-regression:
- every EXISTING lenient-parse test still returns `source: 'json'` (NOT
  `json-partial`) — salvage must never trigger on blocks the earlier rungs handle
- an all-corrupt block still falls back to `regex`/`none` (no false salvage)
- a healthy block never loses elements

Signal:
- a partially-salvaged block reports `source: 'json-partial'` and the correct
  dropped count; `hadBlock` stays true.

---

## Effort & risk

- **Effort:** medium. ~120–160 lines in `state-block.ts` (tokenizer + splitter +
  salvage), small enum/log plumbing, ~20 focused tests.
- **Risk:** concentrated in the two walkers. Mitigated by (a) reusing the proven
  quote/bracket discipline from `scanJson`/`balancedObject`, (b) the do-no-harm
  fall-through (a bad salvage just yields the current behavior), and (c) the
  no-regression assertions pinning existing blocks to `json`.
- **Relation to Option 1:** orthogonal and complementary. Option 2 recovers all
  siblings; the per-element `repair()` step means adding the Option-1 doubled-colon
  fixup to `structuralFixups` would ALSO recover the corrupt element itself. Ship
  Option 2 for the structural safety net; optionally fold in Option 1's fixup later
  for maximum fidelity.

---

## Recommendation

Build rung 4 as scoped. It converts the entire class of "one mangled element kills
the turn" into "one mangled element is dropped," which is the correct durability
posture for untrusted model output — and it degrades to exactly today's behavior in
the worst case. The `json-partial` signal keeps the data loss honest and
measurable instead of hidden.

---

# Separate, unrelated bug — `stampCompanionPreset` userId

## The error

```
[vellum_engine] stampCompanionPreset: userId is required for operator-scoped extensions
```

## Root cause

`stampCompanionPreset(chatId, userId)` is called at `backend.ts:531` as
`void stampCompanionPreset(chatId, userId)` — passing the fold's `userId`
**without the `?? currentUser()` fallback** that every other host call in
`foldChatInner` uses (see lines 448, 468, 501, 524).

On an operator-scoped host, the `GENERATION_ENDED` path can arrive with
`userId = null` (the event doesn't always carry one — that is exactly why the
codebase has the persisted `currentUser()` resolver in `host/user.ts`). When
null flows through to `spindle.presets.list({ limit: 50 }, null)` /
`spindle.presets.update(..., null)`, the operator-scoped host rejects it with
"userId is required."

Every other call site guards this; this one was missed. `stampPresetMetadata`
and the `list` call both need a real uid.

## Fix (small, unambiguous)

Resolve the uid the same way the rest of the fold does. Two defensible forms:

**A — mirror the existing pattern at the call site (`backend.ts:531`):**
```ts
void stampCompanionPreset(chatId, userId ?? currentUser());
```

**B — resolve inside the function using the typed resolver (more robust):**
At the top of `stampCompanionPreset`, replace the raw `userId` with
`requireUser(userId)` from `host/user.ts` and bail cleanly when there is no uid:
```ts
const uid = requireUser(userId);
if (!uid.ok) return;               // no user yet (cold worker) — skip, retry next fold
// …use uid.value for list() and stampPresetMetadata()…
```

Recommendation: **B**. It matches the module's stated purpose ("return a typed
error instead of silently proceeding with undefined") and means the throttle map
isn't marked stamped on a no-uid skip, so it naturally retries on the next fold
once a uid is known. Also apply the same `uid.value` to the `spindle.presets.list`
call inside the function, which currently passes the same possibly-null `userId`.

## Impact

Low. It's a background best-effort stamp that never blocks the fold (the error is
caught and only warns). But it means the companion-preset metadata is never
stamped on operator-scoped hosts until a uid happens to be present, and it spams
the log each fold. The fix silences the log and makes stamping actually work
there.

## Files touched

| File | Change |
| --- | --- |
| `src/backend.ts` | resolve uid via `requireUser` in `stampCompanionPreset` (import already present via `currentUser`; add `requireUser`) and use it for both `presets.list` and `stampPresetMetadata` |

No tests strictly required (background path), but a small unit asserting
`stampCompanionPreset` no-ops without a uid and does not mark the throttle map
would lock the behavior.

# Implementation Plan — Parse Salvage (Option 1 + Option 2) & stampCompanionPreset uid fix

Three independent, additive changes. None touch the event log, reducers, or UI
schema. All degrade to exactly today's behavior in the worst case.

1. **Option 1** — a targeted `structuralFixups` rule for the doubled-colon run-on
   (`"key":"strA":"strB"`). Cheap, recovers the corrupt element itself.
2. **Option 2** — a new element-salvage rung in `lenientParse` that recovers every
   valid sibling and drops only genuinely unrecoverable elements.
3. **stampCompanionPreset** — resolve the uid via `requireUser` so operator-scoped
   hosts stop failing + spamming the log.

Ship order: **Option 1 first** (smallest, and Option 2's per-element repair reuses
it), then **Option 2**, then the **uid fix** (fully independent — can land anytime).

---

## PART A — Option 1: doubled-colon fixup

### The defect it targets
Model drops the `","` delimiter between a value and the next key, fusing them:
```
"weight":"significant","sentiment":"positive"      ← correct
"weight":"significantsentiment":"positive"          ← corrupt: "str":"str":"str"
```
A quoted string in VALUE position followed by `:` is invalid JSON in every parser,
so `JSON.parse` fails and (today) the whole block is lost.

### The fix
In `structuralFixups` (`src/parse/state-block.ts`), add ONE regex rule that runs on
the already-string-safe scaffold (strings are closed/escaped by `scanJson` first, so
the pattern can't match content inside a string):

```ts
// A string in VALUE position immediately followed by ':' is illegal JSON — the
// model fused a value and the next key by dropping the '","' between them
// ("weight":"significant","sentiment":.. → "weight":"significantsentiment":..).
// Wrap the fused pair into an object so the block parses; Zod's per-field
// .catch(undefined) then drops the now-object-typed field, and the sibling
// fields of that element survive instead of the whole turn being lost.
.replace(/:\s*("(?:[^"\\]|\\.)*")\s*:/g, ':{$1:') // "k":"a":"b" → "k":{"a":"b"
```

**Why wrap into `{...}` rather than guess the split point:** we cannot know where the
value ended and the key began (`significant` + `sentiment`? `significants` +
`entiment`?). Guessing risks silent data corruption. Wrapping is deterministic and
lossless-of-siblings: the fused field becomes an object, Zod's `.catch(undefined)`
on that field discards it, and every OTHER field of the element is preserved.

> IMPORTANT balance check: `:{$1:` opens a brace, so the closer must be accounted
> for. This is handled naturally because the wrapped object sits inside the element
> and the element's own `}` closes it — but a fused pair at the END of an object
> (`..,"weight":"significantsentiment":"positive"}`) becomes
> `..,"weight":{"significantsentiment":"positive"}` which is balanced. Verify with
> tests covering the fused pair in MIDDLE and LAST field position.

### Do-no-harm
- Runs only in rung 2 (`structuralFixups`), which today only fires after the happy
  path fails — healthy blocks never reach it.
- The pattern requires a complete quoted string followed by `:` — a normal
  `"key":"value"` (value followed by `,` or `}`) never matches.
- Add an explicit no-regression test: a valid `"a":"b","c":"d"` is untouched.

### Tests (add to `test/lenient-parse.test.ts`)
- the exact `"weight":"significantsentiment":"positive"` fragment → block parses as
  `json`, that journal entry survives WITHOUT its weight/sentiment, siblings intact
- fused pair in the middle vs. last field of an object (brace balance)
- a legitimate `"a":"b","c":"d"` object is NOT altered (no-regression)
- a URL-with-colon inside a string value (`"loc":"http://x"`) is NOT altered
  (guards the string-safety assumption)

---

## PART B — Option 2: element-salvage rung

### Where it fits
New **rung 4** in `lenientParse` (`src/parse/state-block.ts`), reached ONLY after
rungs 1–3 fail:
```
1. JSON.parse(balanced)                 ← unchanged
2. repair scan + structural fixups       ← now includes Option 1
3. close truncated from bracket stack     ← unchanged
4. ELEMENT SALVAGE (new)                  ← recover valid parts, drop corrupt
```
Zero impact on healthy or currently-recovered blocks.

### New primitives (all in state-block.ts)

**1. `tokenizeTopLevel(objSrc): KV[] | null`** — the risk center.
A depth-1, quote/bracket-aware walk (reusing the exact quote-family + control-char
discipline from `scanJson`/`balancedObject`) that splits the outer object into
`{ key, value }` pairs where `value` is the EXACT source substring (scalar span up
to the next depth-1 comma, or the matching `}`/`]` for object/array values).
Returns `null` if the outer object can't be segmented at all.

```ts
interface KV { key: string; value: string; }
function tokenizeTopLevel(objSrc: string): KV[] | null
```

**2. `splitElements(arraySrc): string[]`** — depth-1 element spans of an array,
quote/bracket aware (NOT a comma split — commas in strings/nested objects must not
break elements). Tolerates a trailing UNTERMINATED element (skips it) so
truncation+corruption combined still salvages the complete prefix.

**3. `salvageObject(objSrc): Record<string, unknown> | null`** — two-level salvage
matching the schema shape (`ParsedState` is top-level scalars/objects/arrays +
`delta.*` arrays; no deeper recursion needed):

```
salvageObject(objSrc):
  pairs = tokenizeTopLevel(objSrc); if null → return null
  result = {}
  for {key, value} in pairs:
    if key === 'delta' and value is object → result.delta = salvageDelta(value)
    else if value is array  → result[key] = salvageArray(value)
    else                    → v = tryParse(value) ?? tryParse(repair(value))
                              if v !== undefined → result[key] = v
  return result

salvageArray(arraySrc):
  out = []
  for el in splitElements(arraySrc):
    v = tryParse(el) ?? tryParse(repair(el))   // per-element repair (incl. Option 1)
    if v !== undefined → out.push(v)            // corrupt element silently dropped
  return out

salvageDelta(deltaSrc):
  pairs = tokenizeTopLevel(deltaSrc); if null → return {}
  out = {}
  for {key, value} in pairs:
    if value is array → out[key] = salvageArray(value)
    else              → v = tryParse(value) ?? tryParse(repair(value)); if ok out[key]=v
  return out
```

`repair(x)` = existing `structuralFixups(scanJson(x).out)` — so each element gets the
SAME repair (now including Option 1's doubled-colon rule) scoped down. A corrupt
element is recovered when its corruption is repairable, and dropped only when it is
genuinely unrecoverable.

### Wiring in `lenientParse`
```ts
// 4. element salvage — recover valid parts, drop only corrupt element(s)
const salvaged = salvageObject(obj0) ?? salvageObject(fromBrace);
if (salvaged && Object.keys(salvaged).length) {
  // mark partial so parseState can surface the source honestly
  (salvaged as any).__partial = true;   // stripped before validation (see below)
  return salvaged;
}
return null;
```
`parseState` detects the `__partial` marker, deletes it before `ParsedState.safeParse`,
and sets `source: 'json-partial'` on success.

### Signal: `'json-partial'` source
Data is discarded, so it must be visible, not silent.

| File | Change |
| --- | --- |
| `src/parse/parsed.ts` | `ParseResult.source: 'json' \| 'json-partial' \| 'regex' \| 'none'` |
| `src/parse/state-block.ts` | rung 4 path returns `source: 'json-partial'`; strip `__partial` before Zod |
| `src/bus/lifecycle.ts` | `FoldResult.source` union widened; pass-through only |
| `src/backend.ts` | (a) `hadBlock` treats `json-partial` as TRUE (block WAS parsed — safety-net extractor still runs but log isn't mislabeled "no block"); (b) fold log already prints `via ${source}` → becomes `via json-partial`; add a `warn` with a dropped-element count |

Dropped-element count: `salvageArray` can tally `attempted - kept` per array; bubble a
small `{ droppedBySection: Record<string,number> }` up so the backend `warn` reads
e.g. `salvaged turn 42 (dropped 1 journal entry)`. Keep it best-effort; never throw.

### Outcome on the reported block
`turn`/`day`/`scene`/all 6 `present`/`bonds`(3)/`threads`(1)/`parallel`(4)/
`knowledge`(3)/`ext.codex` all survive; only Oberyn's run-on `journal` entry is
dropped — and WITH Option 1's per-element repair, even that entry survives (minus its
fused weight/sentiment). Net: whole-turn loss → at most one-field loss.

### Edge cases (explicit tests)
- corrupt element in FIRST / MIDDLE / LAST array position
- two corrupt elements in one array
- corrupt element in `present` (top-level array) vs `delta.*` (nested)
- corrupt `scene` OBJECT → scene omitted, rest survives
- corrupt top-level SCALAR (`"day":13x`) → key omitted, Zod default, rest survives
- truncated AND corrupt (rung 3 runs first; rung 4 drops the trailing partial)
- splitter must NOT mis-split on: commas in strings, nested objects/arrays, braces
  in single/double-quoted strings, smart quotes/apostrophes
- everything corrupt / tokenizer null → rung 4 returns null → regex/none (today)

### Do-no-harm assertions (critical)
- EVERY existing lenient-parse test still returns `source: 'json'` (never
  `json-partial`) — salvage must never trigger on blocks rungs 1–3 handle
- an all-corrupt block still falls back to `regex`/`none`
- a healthy block never loses elements

### Effort / risk
~120–160 lines in state-block.ts (tokenizer + splitter + salvage) + small enum/log
plumbing + ~20 tests. Risk concentrated in the two walkers, mitigated by reusing the
proven `scanJson`/`balancedObject` discipline and the do-no-harm fall-through.

---

## PART C — stampCompanionPreset uid fix

### Root cause
`backend.ts:531` calls `void stampCompanionPreset(chatId, userId)` WITHOUT the
`?? currentUser()` fallback every other host call in `foldChatInner` uses. On
operator-scoped hosts the `GENERATION_ENDED` path can arrive with `userId = null`,
which flows into `spindle.presets.list(..., null)` / `update(..., null)` and is
rejected — throwing `userId is required for operator-scoped extensions` on every fold.

### The fix (recommended)
Resolve the uid INSIDE `stampCompanionPreset` via the existing typed `requireUser`
from `host/user.ts`, and bail cleanly (no throttle write) when there's no uid, so it
retries on the next fold once a uid is known.

```ts
import { requireUser } from './host/user.js';   // (add to existing imports)

async function stampCompanionPreset(chatId: string, userId: string | null): Promise<void> {
  try {
    const last = _presetStamped.get(chatId) ?? 0;
    if (Date.now() - last < PRESET_STAMP_THROTTLE) return;

    const u = requireUser(userId);              // explicit ?? persisted uid
    if (!u.ok) return;                           // no uid yet — DO NOT mark stamped; retry next fold
    const uid = u.value;

    if (!(await has('presets'))) return;
    if (!spindle.presets?.list) return;
    const { data } = await spindle.presets.list({ limit: 50 }, uid);   // was userId
    // ...unchanged selection/skip logic...
    const result = await stampPresetMetadata(preset.id, meta, uid);    // was userId
    // ...unchanged...
  } catch (e) {
    spindle.log?.warn?.('[vellum_engine] stampCompanionPreset: ' + ((e as Error)?.message ?? e));
  }
}
```

Changes:
1. add `requireUser` import
2. resolve uid at the top, bail (without marking stamped) when absent
3. pass the resolved `uid` to BOTH `presets.list` and `stampPresetMetadata`

### Do-no-harm
- When a uid IS available (the normal case), behavior is identical to today.
- When absent, it now no-ops silently and retries later instead of throwing + logging.
- The 5-minute throttle is NOT set on a no-uid skip, so the first fold after a uid
  becomes known still stamps.

### Test
`stampPresetMetadata` is already covered indirectly; add a focused unit test only if
easy to fake `spindle` — otherwise rely on the requireUser unit path. Minimum: a
`requireUser(null)` with no persisted uid returns `Err('no_user')` (already true) and
the caller bails. No new test infra required.

---

## Global verify checklist
- [ ] `npm run build` emits both bundles
- [ ] `npm run typecheck` clean (watch the widened `source` union in lifecycle.ts + backend.ts)
- [ ] `npm test` green — new Option 1, Option 2, and no-regression suites
- [ ] existing lenient-parse tests all still report `source: 'json'`
- [ ] both regex/preset files untouched (parse-only change)
- [ ] manual: a real corrupt block logs `via json-partial` with a dropped count,
      and the drawer shows the recovered scene/cast/bonds instead of a prose-only fallback

## Sequencing note
Option 1 lands inside `structuralFixups`, which Option 2's `repair()` reuses — so
building Option 1 first means Option 2 automatically gets doubled-colon recovery at
the element level for free. The uid fix is orthogonal and can be committed in the
same PR or separately.

# Implementation Plan — Intelligent Scaffold Stripping from Turns Memory

Make the extension strip the reverie (planning) and vellum (JSON state) scaffold
from **turns memory** as robustly as the parser already extracts state from it —
so mangled, truncated, or tag-drifted blocks stop leaking into the chronicle.

---

## The problem, precisely

Two independent strip paths exist with very different quality:

| Path | Where | Robustness |
| --- | --- | --- |
| **Parse** (`parseState`/`lenientParse`) | `src/parse/state-block.ts` | HIGH — 4 fence spellings, missing-close recovery, salvage, optional reverie open tag |
| **Gist** (`turnGist`) | `src/backend.ts:191` | LOW — two regexes, each needs a well-formed open AND close tag |

`turnGist` today:
```js
let s = content
  .replace(/(?:‹vellum›|<vellum>)[\s\S]*?(?:‹/vellum›|<\/vellum>)/gi, '')
  .replace(/<reverie>[\s\S]*?<\/reverie>/gi, '')
  .replace(/\s+/g, ' ').trim();
```
When a tag is mangled/incomplete, the parser still reads the state, but `turnGist`
fails to strip — so the reverie planning + JSON blob leak into the turn memory
(`memory.record` tier:`turn`, backend.ts:421). That gist is ALSO the basis for
chapter/arc summaries (`domain/memory.ts`) and PASS-2 prose extraction
(`extractFromProse`, backend.ts:1429), so one leak pollutes three surfaces.

### Why position beats tag-matching
The preset enforces a FIXED shape (Output Format Contract block): **reverie first,
prose middle, vellum last** — "reply starts with `<reverie>` and ends with
`</vellum>`", and the reverie open tag is PREFILLED (`Reverie Prefill (assistant)`
block emits `<reverie>\n`), so model output often starts mid-reverie. This gives us
structural guarantees stronger than any tag pair:
- **vellum is always a suffix** — nothing legitimate follows it → cut to end-of-string
- **reverie is always a prefix** — cut from start to its close
- **prose is the middle** — the value; never cut into it

---

## Design principle (non-negotiable)

**Leak, never eat.** Stray planning text left in memory is a cosmetic annoyance.
Eating a paragraph of real prose is permanent data loss (it corrupts the turn
record, every summary built on it, and prose extraction). Every heuristic below
fires ONLY on a confident structural match and defaults to leaving text in.

---

## PART A — Shared `stripScaffold()` in the parse module

Create ONE exported function both paths use, so they can never diverge again.

**File:** `src/parse/state-block.ts` (new export; reuses `FENCES`, `balancedObject`,
`SCHEMA_KEY` already defined there)

```ts
/** Remove the reverie (prefix) and vellum (suffix) scaffold from a raw turn,
 *  leaving only the prose. Position-aware and fence-tolerant — as robust as the
 *  parser, and biased to LEAK rather than eat prose. */
export function stripScaffold(content: string): string
```

### A1 — vellum suffix (cut to end-of-string)
The vellum block is always last, so find the EARLIEST vellum start marker and cut
from there to the end. Markers, in order of trust:
1. any fence OPEN variant (`<vellum>`, `‹vellum›`, ` ```vellum `, `[VELLUM]`) — case-insensitive, tolerate whitespace inside the tag
2. a spaced/partial close that implies a block we didn't catch the open of
3. **fallback:** a trailing balanced `{…}` (via `balancedObject`) whose content
   matches `SCHEMA_KEY` (`"turn"|"scene"|"delta"|"present"|"day"`) AND sits in the
   last ~40% of the message — this catches "model emitted JSON but forgot/mangled
   the tag". Safe because story prose ~never ends with a schema-keyed JSON object.

Take the MIN index across (1)–(3); slice `[0, idx)`. If none match, leave as-is.

### A2 — reverie prefix (cut from start)
Reverie is always first. Cut from message start to the reverie close:
- match `</reverie>` in tolerant form (spaced/partial: `</ reverie>`, `</rever…>`)
  exactly as parseState already does: `/<\/\s*rever[a-z]*\s*>/i`
- open tag OPTIONAL (prefill often eaten) — if a close exists, cut `[0, closeEnd]`
  regardless of whether an open tag is present
- if an open tag exists but NO close (truncated reverie) → Part C heuristic

### A3 — order & safety
1. strip vellum suffix first (A1) — shrinks the search space
2. strip reverie prefix (A2)
3. if after both a residual dangling fence tag remains (`</vellum`, `<reverie>`
   with nothing between), remove the bare tag token only
4. NEVER return empty when the input had prose: if stripping would remove
   everything, return the ORIGINAL collapsed (leak-not-eat guard)

---

## PART B — Rewire the two call sites

### B1 — `turnGist` (backend.ts:191)
Replace the two inline regexes with `stripScaffold(content)`, keep the rest
(whitespace collapse, persona-token → name, MAX ceiling) unchanged:
```ts
let s = stripScaffold(content).replace(/\s+/g, ' ').trim();
if (names?.user) s = s.replace(/\{\{\s*user\s*\}\}/gi, names.user);
// … unchanged …
```

### B2 — `parseState` regex fallback (state-block.ts:469)
The fallback's ad-hoc `withoutReverie` line becomes `stripScaffold(content)` so the
regex-divination path sees the SAME clean prose the gist does. (Low risk: it only
feeds `parseFallback`, which already expects reverie-stripped text.)

---

## PART C — Truncated-reverie heuristic (best-effort, confident-match only)

The one genuinely hard case: `<reverie>` opens, never closes, prose follows with no
marker. There is no perfectly reliable boundary. Strip ONLY up to the first
blank-line-separated paragraph that does NOT look like planning, where "planning"
is identified by the preset's own structural fingerprints:
- lines starting `SCENE:` / `STATE:` (the reverie's terse note lines)
- bracketed directive headers the preset injects: `[REVERIE`, `[CONFIG`,
  `[GENESIS PENDING]`, `[THE CARTOGRAPHER`, `[EXAMPLE`, `[OUTPUT FORMAT`,
  `[STATE BLOCK`
- fire the cut ONLY if the FIRST block matches ≥1 fingerprint; stop at the first
  block that matches NONE (that's prose). If the first block already looks like
  prose, strip NOTHING (confident-match-only).

Clearly comment as best-effort. A model that free-writes its reverie without any
fingerprint defeats this — and that's acceptable per leak-not-eat.

---

## PART D — Tests

**New file:** `test/strip-scaffold.test.ts` — unit-test `stripScaffold` directly.

Fixtures (raw turn → expected prose-only):
- **happy path:** `<reverie>…</reverie>\nPROSE\n<vellum>{…}</vellum>` → `PROSE`
- **prefilled reverie (no open tag):** `SCENE:…\nSTATE:…\n</reverie>\nPROSE\n<vellum>…` → `PROSE`
- **truncated vellum (no close):** `PROSE\n<vellum>{"turn":5,…` → `PROSE`
- **tagless vellum (JSON, no fence):** `PROSE\n{"turn":5,"scene":{…}}` → `PROSE`
- **fence variants:** `‹vellum›`, ` ```vellum `, `[VELLUM]` each → `PROSE`
- **spaced/partial close:** `</ reverie >`, `</vellum` → stripped
- **truncated reverie (Part C):** `<reverie>\nSCENE:…\nSTATE:…\n\nPROSE` → `PROSE`
- **leak-not-eat guards (CRITICAL):**
  - prose that legitimately CONTAINS a quoted `{`/`}` or the word "scene" mid-sentence → untouched
  - prose ending in a NON-schema JSON-ish string (`"…he said {maybe}"`) → untouched
  - a reverie-less, vellum-less plain turn → returned verbatim (collapsed)
  - stripping that would empty the turn → original returned
- **regression:** every existing `turnGist`-shaped input still yields identical
  output to today for well-formed blocks (parity check vs old regex)

**Also:** add 2–3 cases to `test/lenient-parse.test.ts` confirming `parseState`'s
fallback path is unchanged for well-formed blocks (B2 must not alter `source`).

---

## Verify checklist
- [ ] `npm run build` emits both bundles
- [ ] `npm run typecheck` clean
- [ ] `npm test` green — new strip-scaffold suite + no-regression
- [ ] existing lenient-parse tests unchanged (`source` values identical)
- [ ] preset/regex files untouched (extension-only change)
- [ ] manual: a turn with a mangled/truncated `<vellum>` shows CLEAN prose in the
      Chronicle turns memory (no JSON blob, no SCENE:/STATE: lines)

---

## Honest scope boundary
This makes turns memory as robust as the parser for anything with a surviving
marker (fence variant, close tag, or schema-keyed trailing JSON) — the large
majority of leaks. It will NOT be 100% on fully tagless reverie with no
fingerprints (Part C is a confident-match heuristic, not a solver). Chasing that
last few percent means guessing where planning ends and prose begins, which risks
eating real prose — so we deliberately stop at leak-not-eat. Skip any attempt to
separate untagged planning prose from untagged story prose in the general case;
it's the same unsolvable class as untagged dialogue attribution.

## Sequencing
Part A (shared fn) → Part B (rewire, gated by A's tests) → Part C (heuristic, additive)
→ Part D throughout. Parts A+B deliver most of the value; Part C is an optional
follow-up that can land separately.

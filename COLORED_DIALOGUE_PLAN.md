# Implementation Plan — Extension-Owned Colored Character Dialogue

## Goal

Let the VELLUM extension color each character's spoken dialogue in the chat stream,
using **per-character colors the user picks in the cast card**. The extension owns a
`display`-target regex script that maps each speaker to a color, regenerated whenever
the cast or its colors change.

## Committed decisions

1. **Permission:** add `regex_scripts` to the manifest.
2. **Attribution:** commit to the preset's speaker-tag convention
   `[spk=Name]"..."[/spk]`. The AI emits the tags (preset's Colored Dialogue block);
   the extension owns the display coloring + the prompt-strip so tags never reach the
   model context or the chronicle.
3. **Per-character color:** users set a dedicated **`dialogueColor`** on each cast card
   (separate from the existing name `color`). Unset → deterministic slot color from the
   shared palette (matches the panel's cast hues). This gives collision-free defaults
   with per-character override.

## Architecture at a glance

```
cast card (user picks dialogueColor)  ──cmd──▶ cast.edit event ──▶ ChronicleState.cast
                                                                          │
fold tail: maybeColorSync(chatId) ◀──────────────── cast changed ────────┘
   │  build {name/aka → hex} from cast + shared palette
   ▼
spindle.regex_scripts.create/update  (display script: [spk=Name] → colored <span>)
   +  ensure prompt-strip script      (strips [spk=…] from model context)
   +  disable preset's vellum2-spk-display to avoid double-wrap
```

Coloring is **display-only** (never mutates stored text or model context), reversible,
and reuses the existing deterministic hue wheel.

---

## Phase 0 — Manifest + capability (enable the API)

**`spindle.json:9`** — add `"regex_scripts"`:
```json
"permissions": ["interceptor", "chats", "chat_mutation", "generation", "ui_panels", "world_books", "memories", "regex_scripts"],
```

**`src/host/capability.ts:10`** — extend the union:
```ts
export type Capability = 'generation' | 'world_books' | 'memories' | 'chats' | 'chat_mutation' | 'interceptor' | 'regex_scripts';
```

**`src/host/capability.ts:23`** — add `'regex_scripts'` to the fallback probe array
(the primary `getGranted()` path needs no change, but the `has()`-only fallback loop is
hardcoded).

> Note: adding a permission means users re-grant on update. Call this out in the README.

---

## Phase 1 — Shared deterministic palette (pure, reused front + back)

The hue logic (`slotFor` / `slotColor` / `hslHex` / `hash01`) currently lives in
`src/ui/format.ts` (frontend only). Extract the pure math so the backend can compute the
same colors when generating the regex.

**New `src/core/palette.ts`** (pure, no DOM, no spindle):
- Move/duplicate `hslHex`, and add `castSlotColors(castIds: string[]): Map<string,string>`
  that reproduces `format.ts`'s collision-free 24-slot wheel assignment (sorted ids,
  linear probing, lightness banding). Uses `hash01` from `src/core/ids.ts` (already pure).
- Export `HEX6` regex + a `safeColor()` guard (mirror `format.ts:62,68`).

**`src/ui/format.ts`** — refactor to import `hslHex`/slot logic from `core/palette.ts`
so there is one source of truth. Keep the existing exports (`nameHtml`, `resolveColor`,
`autoNameMode`, `warmCastColors`) intact; only the internals move. Verify the Cast tab
still renders identically.

Rationale: the generated regex must bake concrete hex per name (a regex `replace_string`
can't run a JS hash), so the backend needs the palette as a pure function.

---

## Phase 2 — `dialogueColor` field on the cast card (additive, no schema bump)

All additive/optional, so existing logs validate unchanged (`SCHEMA_VERSION` stays 18).

1. **`src/domain/types.ts`** (`CastCard`, ~line 26) — add:
   ```ts
   dialogueColor?: string; // optional #hex tint for this character's spoken lines; absent = auto slot color
   ```

2. **`src/core/events.ts:135`** (`CastPatch`) — add:
   ```ts
   dialogueColor: z.string().optional(),
   ```

3. **`src/core/reduce.ts`** (`cast.edit`, ~line 200) — add the clear-to-inherit line
   alongside the existing color deletes:
   ```ts
   if (safe.dialogueColor === '') delete c.dialogueColor;
   ```
   (`Object.assign(c, safe)` already copies the field.)

4. **`src/domain/commands.ts:28`** (`cast_upsert`) — validate + patch, mirroring `color`:
   ```ts
   if (e.dialogueColor !== undefined) { const c = hex(e.dialogueColor); if (c !== undefined) patch.dialogueColor = c; }
   ```

5. **`src/ui/tabs/cast.ts`**:
   - `castForm` (~line 176) — add the picker field:
     ```ts
     { key: 'dialogueColor', label: 'Dialogue color', type: 'color', value: v.dialogueColor },
     ```
   - `version()` cache key (~line 66) — append `|${c.dialogueColor ?? ''}` so the card
     re-renders on change.
   - Both edit buttons (`card()` ~line 270, `strip()` ~line 292) — add
     `data-dialoguecolor="${c.dialogueColor ?? ''}"`; the click handler (~lines 93–105)
     reads it into the form seed `v.dialogueColor`.

No new command type or backend case — it flows through the existing `cast_upsert` →
`cast.edit` path and the generic `vellum_cmd` dispatch.

---

## Phase 3 — Regex host wrapper (mirror `worldbooks.ts`)

**New `src/host/regex.ts`** — same house style as `src/host/worldbooks.ts`:
```ts
import { has } from './capability.js';
import { tryCatchAsync, type Result, Ok, Err } from '../core/result.js';
declare const spindle: any;

function api(): any { return spindle.regex_scripts || null; }
export async function hasRegex(): Promise<boolean> { return (await has('regex_scripts')) && !!api(); }

export async function listVellumScripts(uid: string | null): Promise<RegexScriptDTO[]>   // list, filter metadata.vellum, degrade to []
export async function upsertScript(input: RegexScriptCreateDTO, uid: string | null): Promise<Result<string,string>> // get-by-script_id → update else create
export async function setScriptDisabled(scriptId: string, disabled: boolean, uid: string | null): Promise<Result<true,string>>
export async function deleteScript(scriptId: string, uid: string | null): Promise<Result<true,string>>
export { Ok, Err };
```
Conventions to copy exactly: `api()` gate + `Err('no_permission')`; `uid` as trailing
arg; `tryCatchAsync`; create returns `Result<string>` (the id), update/delete return
`Result<true>`; stamp `metadata: { vellum: true, castHash }` for ownership + idempotency.

Note `list` takes `userId` **inside** the options object; `get/create/update/delete` take
it as the trailing positional arg. `scope_id` (create DTO) vs `scopeId` (list options) —
mind the naming.

---

## Phase 4 — Color script generator (pure) + fold-tail sync

**New `src/domain/dialogue-color.ts`** (pure) — builds the script DTOs from state:
- `buildColorReplaceString(state): string` — construct a `{{switch}}` over every cast
  name (and each `aka`) → its `dialogueColor` (if set) or `castSlotColors()` default,
  with a trailing default (skin ink `#b9ad92`). Shape:
  ```
  <span style="color:{{switch::$1::Cersei::#e0736b::Jaime::#6f9be0::…::#b9ad92}}" title="$1">$2</span>
  ```
  - Escape/normalize names for switch safety; cap total length; if the cast is huge, fall
    back to the first-letter switch (like the preset) past a sane name cap.
- `colorScripts(chatId, state)` — returns two `RegexScriptCreateDTO`s with stable
  `script_id`s (chat-scoped):
  - **Display:** `script_id: 'vellum-engine-spk-display-' + chatId`, `scope:'chat'`,
    `scope_id: chatId`, `target:'display'`, `placement:['ai_output']`,
    `find_regex: '\\[spk=([^\\]]{0,40})\\]([\\s\\S]*?)\\[/spk\\]'`, `flags:'gi'`,
    `substitute_macros:'after'`, `replace_string` from `buildColorReplaceString`,
    `run_on_edit:true`, `sort_order:30`, `metadata:{vellum:true, castHash}`.
  - **Strip:** `script_id: 'vellum-engine-spk-strip-' + chatId`, `target:'prompt'`,
    `find_regex: '\\[/?spk(?:=[^\\]]{0,40})?\\]'`, `replace_string:''` — keeps tags out
    of model context (self-contained; independent of the preset).
- `castColorHash(state): string` — hash the sorted `id → (dialogueColor|slot)` map (via
  `hashStr`) for idempotency.

**`src/backend.ts`** — new `maybeColorSync`, modeled on `maybeVaultSync` (backend.ts:742):
```ts
const _colorSyncing = new Set<string>();
async function maybeColorSync(chatId: string, userId: string | null): Promise<void> {
  if (_colorSyncing.has(chatId)) return;
  if (!(await hasRegex())) return;
  const on = !!(await getChatVar(chatId, 'vellum_colored_dialogue'));
  _colorSyncing.add(chatId);
  try {
    if (!on) { /* disable/remove our two scripts if present; re-enable preset's if we disabled it */ return; }
    const state = await loadState(chatId);
    const hash = castColorHash(state);
    // skip if unchanged: compare against our display script's metadata.castHash
    // else upsert display + strip scripts, and disable preset 'vellum2-spk-display' to avoid double-wrap
  } finally { _colorSyncing.delete(chatId); }
}
```
Call it fire-and-forget in the `foldChatInner` tail next to `void maybeVaultSync(...)`
(backend.ts:504): `void maybeColorSync(chatId, userId);`

**Double-wrap avoidance:** when enabling, look up the preset's `vellum2-spk-display` via
`listVellumScripts`/`get` and set it `disabled:true` (record that we disabled it in our
script metadata); when the feature is turned off, restore it. Both scripts share the same
`find_regex`, so only one may be active.

---

## Phase 5 — Per-chat enable toggle (wire end-to-end)

Add `vellum_colored_dialogue` chat var (default off; the feature is opt-in like the
preset block).

1. **`src/backend.ts` `broadcastState`** — add to the `Promise.all` (backend.ts:120) and
   to the `sendToFrontend` `vellum_state` payload (backend.ts:143):
   ```ts
   getChatVar(chatId, 'vellum_colored_dialogue').catch(() => ''),
   ...
   coloredDialogue: !!coloredDialogueRaw,
   ```
   > Both spots are mandatory (the documented "hide-toggle bug" at backend.ts:116–119 —
   > omit either and it silently reverts on reload/chat-switch).

2. **Dispatch handler** — add a `vellum_set_colored_dialogue` case (near the other toggle
   handlers) that calls `setChatVar(chatId, 'vellum_colored_dialogue', on ? '1' : '')`,
   then `await maybeColorSync(chatId, uid)` (immediate apply/teardown), then
   `broadcastState`.

3. **Frontend** — add a toggle in the Actions/toolbar menu (`src/ui/app.ts`, near the
   `tone`/`hide`/`traverse` QoL toggles) that sends `vellum_set_colored_dialogue` and
   reflects `p.coloredDialogue` from the `vellum_state` broadcast (mirror `_hideOn` at
   app.ts:818). Optionally surface it in the Cast tab header too.

---

## Phase 6 — Lifecycle & cleanup

- **Clear chronicle / uninstall:** in the existing `Clear` handler, delete the two
  chat-scoped scripts (`deleteScript`) and restore the preset's display script.
- **Chat switch:** scripts are chat-scoped (`scope:'chat'`, `scope_id`), so they don't
  bleed across chats; no per-switch work needed beyond the existing var-cache invalidation.
- **Permission revoked at runtime:** `hasRegex()` gate makes `maybeColorSync` a no-op;
  existing scripts simply stop being managed (host still renders them). Acceptable.
- **No regex permission granted:** feature toggle can still flip the var, but
  `maybeColorSync` no-ops; frontend should show the toggle as unavailable with a reason
  (mirror the capability-degrade pattern in `capability.ts`).

---

## Phase 7 — Tests & verification

- **`test/dialogue-color.test.ts`** (vitest, golden-fixture style like `parse-fold.test.ts`):
  - `buildColorReplaceString` produces a switch containing each cast name → expected hex
    (explicit `dialogueColor` wins; unset → deterministic slot color; unknown → ink).
  - `castColorHash` is stable across reorder and changes when a color changes.
  - `palette.castSlotColors` matches `format.ts`'s prior output for a fixed id set
    (regression guard for the extraction).
  - `cast_upsert` with `dialogueColor` emits a `cast.edit` patch; `''` clears it in
    `reduce`.
- **Build/typecheck:** `bun run typecheck` (strict), then `bun run test`, then
  `bun run build` (→ `dist/backend.js` + `dist/frontend.js`). The reducer exhaustiveness
  guard will flag any missed event handling.
- **Manual smoke (in Lumiverse):** enable the preset's Colored Dialogue block + the
  extension toggle; confirm `[spk=]` lines render tinted per the cast color, that editing a
  character's Dialogue color re-tints on the next turn, that tags never appear in the model
  context (Context tab), and that turning the toggle off restores plain rendering.

---

## Touch-point summary

| File | Change |
|---|---|
| `spindle.json` | + `regex_scripts` permission |
| `src/host/capability.ts` | + `'regex_scripts'` in union & fallback list |
| `src/core/palette.ts` | **new** — pure hue/slot palette |
| `src/ui/format.ts` | import palette from core (dedupe) |
| `src/domain/types.ts` | + `dialogueColor?` on `CastCard` |
| `src/core/events.ts` | + `dialogueColor` in `CastPatch` |
| `src/core/reduce.ts` | + clear-on-empty for `dialogueColor` |
| `src/domain/commands.ts` | + `dialogueColor` hex validation in `cast_upsert` |
| `src/ui/tabs/cast.ts` | + picker field, version key, edit-button data attrs |
| `src/host/regex.ts` | **new** — regex_scripts wrapper |
| `src/domain/dialogue-color.ts` | **new** — pure script/replace-string builder + hash |
| `src/backend.ts` | + `maybeColorSync`, fold-tail call, toggle var in `broadcastState`, dispatch handler, Clear cleanup |
| `src/ui/app.ts` | + toggle control + state hydration |
| `test/dialogue-color.test.ts` | **new** |

## Risks / caveats

- **Attribution depends on the preset's `[spk=]` tags.** Without the preset (or with a
  model that omits tags), nothing is colored — this is by design (committed decision).
- **`{{switch}}` size:** very large casts produce a long `replace_string`; the generator
  caps it and falls back to the first-letter switch past a name-count threshold.
- **Double-wrap:** the preset's `vellum2-spk-display` and our display script share the same
  `find_regex`; the sync must keep only one active (we disable the preset's when ours is on).
- **Name matching:** `$1` must exactly match a cast name or aka; the generator includes
  `aka` and normalizes case via the switch to reduce misses.

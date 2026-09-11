# Preset Variables Tab — Loom + Stat Strip + Live Preview

Upgrade the host preset editor tab from the current "variables-only Loom editor
+ collapsed diagnostics" into **The Loom, Instrumented**: the same warm grouped
variable grid, crowned by a compact **stat strip** (variable count, standing
token budget, state-block health, extraction status) and a **live manuscript
preview** that resolves the session-settings block against the open chat.

Additive to the work already shipped on `testing` (`feat(preset-tab): grouped
variables-only editor + link diagnostics`, commit `3f1a1a0`). Every new host
call is probed behind `as any` + try/catch and degrades to the current tab on
older hosts.

---

## Architecture: three stacked regions in the tab

The current tab shell (`renderPresetEditorTab` in `src/ui/app.ts`) builds a
stable skeleton once:

```
┌─ host preset editor tab (root) ──────────────┐
│  [ Configure Variables ]   (existing header)  │
│  [ Configure prompt variables ]               │  ← vars editor (exists)
│  ▸ Diagnostics                   (collapsed)  │  ← diagnostics (exists)
└────────────────────────────────────────────────┘
```

After this plan:

```
┌─ host preset editor tab (root) ──────────────┐
│  [ Configure Variables ]                      │  header (unchanged)
│  ┌── stat strip ────────────────────────────┐ │  NEW — 4 cells, one row
│  │ 7 vars │ 1.2k tok │ ✓ block │ 4/4 ext   │ │
│  └──────────────────────────────────────────┘ │
│  ┌── live manuscript preview ───────────────┐ │  NEW — assembled prompt
│  │ ◆ Live Manuscript        assembled·noLLM │ │       (or no-chat fallback)
│  │ Rain threaded the lamplight as Elara …   │ │
│  │ 3rd limited · past · stakes 6   ↻ refresh│ │
│  └──────────────────────────────────────────┘ │
│  [ Configure prompt variables ]               │  vars editor (unchanged)
│  ▸ Diagnostics                   (collapsed)  │  diagnostics (unchanged)
└────────────────────────────────────────────────┘
```

Only `renderPresetEditorTab`'s **shell HTML** and two new render helpers change.
The existing `renderVariablesEditor`, `renderTabDiagnostics`, and all control
mounts stay untouched — the stat strip + preview sit *above* the variables and
share the same stable-slot repaint discipline.

---

## Phase 1 — Stat strip (frontend-only, no new host calls)

### 1.1 Data sources (all already available)

The strip's four cells read from data the tab already fetches:

| Cell | Source | Already in tab state? |
|---|---|---|
| variable count | `scoped.blocks[].variables` length | yes (`renderVariablesEditor` computes `groups`) |
| standing tokens | `_ptChatBudget` (the `vellum_budget` reply already wired) | yes (`app.ts` `_ptChatBudget`) |
| state block health | `_ptStatus.extractOk` + the health-check feature 2 result | yes (`_ptStatus`) |
| extraction status | `_ptStatus.extractOk` (4/4 style) | yes (`_ptStatus`) |

No new backend message. The strip is a pure render of existing state.

### 1.2 Shell change (`renderPresetEditorTab`)

Insert a `<div class="vle-strip" data-vle-strip>` **above** the
`[data-vle-vars-sec]` in the one-time shell skeleton. Like the vars section, it
is a stable node — only its *children* get repainted, never the slot itself.

### 1.3 `renderStatStrip()` helper

Called from `renderPresetEditorTab` (full render) **and** from the
`vellum_budget_state` / `vellum_preset_tab_status` reply handlers (so the strip
updates live without touching the editor). It queries `[data-vle-strip]` and sets
its `innerHTML` to the four `<div class="vle-stat">` cells. Reads the scoped
state for the variable count, `_ptChatBudget` for tokens, `_ptStatus` for the
health/extract cells. When any datum is absent (older host, budget not yet
fetched), the cell renders an em-dash rather than a misleading `0`.

### 1.4 Styles (`src/ui/styles.ts`)

Add `.vle-strip` (flex, 1px gold hairline gutters via the `gap:1px;
background:var(--kl)` trick), `.vle-stat` (centered, dark gradient surface),
`.vle-stat .v` (mono, gold, the value) and `.vle-stat .k` (mono micro-caps, the
label). The `.ok` modifier tints the value sage-green for the ✓ cells.

---

## Phase 2 — Live manuscript preview (the substantive new feature)

### 2.1 The host API (verified)

`spindle.assemble(input)` — exposed in `worker-runtime.ts:1186`, handled at
`worker-host.ts:4140`. Takes:

```ts
{
  blocks: PromptBlockDTO[];          // the preset's block graph
  chatId: string;                    // the live chat to resolve against
  connectionId?: string;
  personaId?: string;
  generationType?: string;           // default "normal"
  promptVariables?: PromptVariableValuesDTO;  // Record<blockId, Record<varName, value>>
  signal?: AbortSignal;
}
```

Returns `{ messages: LlmMessageDTO[], breakdown: AssemblyBreakdownEntryDTO[] }`.
It runs the **full assembly pipeline** (macro resolution against character,
history, world-info, persona) and substitutes the supplied `promptVariables` —
**without invoking an LLM**. Permission gate: `generation` (vellum already holds
it). `userId` resolved via the standard dispatch path.

This is the right primitive: it returns the *actual* system message the model
would see, with the user's in-progress variable choices applied — accurate, free,
instant.

### 2.2 What we render

From `result.messages`, find the first `role === 'system'` message whose content
contains the session-settings block (the `v2-config` block in your preset — the
one carrying the `{{var::*}}` macros). Render its `content` as a manuscript
excerpt in the preview body, with a fade-out gradient at the bottom and a footer
echoing the active dials (POV · tense · stakes) drawn from `_varValues` so
cause-and-effect is legible. Highlight resolved variable values in gold italic
(best-effort: wrap substrings matching the chosen option's `value` text).

### 2.3 `renderPreview()` helper + state

New module state beside `_varControls`/`_varPresetId`:

```ts
let _pvChatId = '';              // active chat, '' when none
let _pvTimer: ReturnType<typeof setTimeout> | null = null;  // 800ms debounce
let _pvAbort: AbortController | null = null;                 // cancel in-flight
let _pvLast: string | null = null;                           // last rendered text (avoid rerender flicker)
```

`renderPreview(root)`:
1. Resolve the active chat id. Prefer `spindle.chats` / the host's "active chat"
   surface; fall back to `''`. Cache in `_pvChatId`; re-resolve on each full tab
   render (chat may have changed).
2. If `_pvChatId === ''` → render the **fallback** (State B): a quiet "Open a
   chat to preview" panel. Return.
3. Otherwise render the **populated** shell (State A) with a "refresh" affordance
   and schedule an `assemble` via `schedulePreviewAssemble()`.

`schedulePreviewAssemble()` (debounced 800ms, mirrors the variable-save debounce):
- Abort any in-flight `_pvAbort`; create a fresh `AbortController`.
- Send a backend message `vellum_preview_assemble` carrying `{ presetId, chatId,
  promptVariables: _varValues }`. The backend does the `spindle.assemble` call
  (so the `chatId`/`userId` resolution and the `generation` permission check
  happen host-side, exactly like the existing `vellum_preset_vars_save` pattern).
- On reply `vellum_preview_assembled { systemText }`, call `paintPreviewBody()`
  only if `systemText !== _pvLast` (suppress identical rerenders).

### 2.4 Backend dispatch handler (`src/backend.ts`)

Add `vellum_preview_assemble` next to `vellum_preset_vars_save`:

```ts
vellum_preview_assemble: async (p, uid) => {
  const presetId = String(p?.presetId ?? '').trim();
  const chatId = String(p?.chatId ?? '').trim();
  const pv = (p && typeof p.promptVariables === 'object' && p.promptVariables) ? p.promptVariables : {};
  const done = (systemText: string | null) => spindle.sendToFrontend?.(
    { type: 'vellum_preview_assembled', systemText }, uid ?? currentUser());
  if (!presetId || !chatId || !(await has('generation')) || !spindle.assemble) { done(null); return; }
  try {
    // Seed blocks from the live preset (same read the stamp path uses) so the
    // preview reflects the saved graph, not a stale snapshot.
    const preset = await spindle.presets?.get?.(presetId, uid);
    if (!preset || !Array.isArray(preset.blocks)) { done(null); return; }
    const result = await spindle.assemble({ blocks: preset.blocks, chatId, promptVariables: pv }, uid);
    const sys = Array.isArray(result?.messages)
      ? (result.messages.find((m: any) => m?.role === 'system' && typeof m?.content === 'string')?.content ?? null)
      : null;
    done(sys ?? null);
  } catch (e) {
    spindle.log?.warn?.('[vellum_engine] preview_assemble: ' + ((e as Error)?.message ?? e));
    done(null);
  }
},
```

> **Why backend-side:** `spindle.assemble` is a worker API; calling it from the
> frontend would require a new frontend→backend bridge anyway. Keeping it
> backend-side matches `vellum_preset_vars_save`, lets the host resolve
> `userId`/`chatId` consistently, and means the frontend only deals with a
> string. The `blocks` are read fresh from the preset so a saved-but-unremounted
> edit still previews correctly.

### 2.5 Trigger wiring

- **Variable change** → `saveVarValues()` already debounces 400ms for the
  *save*. Add a second debounced call (800ms) to `schedulePreviewAssemble()` so
  the preview refreshes *after* the value settles, without racing the save.
  Simplest: have `saveVarValues`'s setTimeout body also call
  `schedulePreviewAssemble()` once the coordinator write is dispatched.
- **Preset change** → `renderPresetEditorTab` already rebuilds on preset-id
  change; have it call `renderPreview()` after `renderVariablesEditor()`, which
  re-resolves `_pvChatId` and kicks the first assemble.
- **Manual refresh** → the "↻ refresh" affordance calls `schedulePreviewAssemble()`
  with zero debounce (immediate).

### 2.6 Abort + teardown

- `_pvAbort?.abort()` at the start of every new assemble and in the tab teardown
  block (next to `destroyVarControls()`). The host treats `AbortError` as
  non-error (`worker-host.ts:4172`), so an aborted request logs nothing.
- Clear `_pvTimer` in teardown.

### 2.7 Styles

`.vle-pv` (the panel: gold-hairline border, manuscript-paper gradient),
`.vle-pv-top` (header row: pulsing gold spark + "Live Manuscript" + "assembled ·
no LLM" tag), `.vle-pv-body` (Playfair serif, max-height with fade-out mask via
`.vle-pv-body::after`), `.vle-pv-hl` (gold italic for resolved values),
`.vle-pv-foot` (mono micro row: active dials + refresh link),
`.vle-pv-empty` (fallback: a centered glyph + the "open a chat" message). The
pulse animation is a 2.4s opacity keyframe on the spark dot.

---

## Phase 3 — Active-chat resolution (the one missing piece)

The preview needs the *currently open* chat id. vellum already has `chats`
permission, but the preset editor tab is opened from the preset library, where
there may be no active chat. Two options:

1. **`spindle.chats.list` + a "last active" heuristic** — list chats, pick the
   most recently messaged. Works without host help but is guesswork.
2. **A host "active chat" surface** — check whether `ctx.ui` or the worker
   exposes the currently-open chat (the chat panel's active id). If present,
   prefer it; it's the chat the user is actually looking at.

Recommendation: implement option 1 first (it's self-contained and the preset tab
is usually opened *from* a chat session anyway), and probe for an active-chat API
to refine later. The fallback (State B) already covers the no-chat case
gracefully, so a wrong guess degrades to "open a chat" rather than broken text.

---

## Files touched

| File | Change |
|---|---|
| `src/ui/app.ts` | Shell: insert `[data-vle-strip]` + `[data-vle-pv]` above the vars section. Add `renderStatStrip()`, `renderPreview()`, `schedulePreviewAssemble()`, `paintPreviewBody()`; wire strip repaint into the budget/status reply handlers; wire preview refresh into `saveVarValues` + preset change + manual refresh; add `_pv*` state + abort/teardown. |
| `src/backend.ts` | Add `vellum_preview_assemble` dispatch handler (calls `spindle.assemble`, returns the first system message's content). |
| `src/ui/styles.ts` | `.vle-strip`/`.vle-stat` (strip) + `.vle-pv`/`.vle-pv-*` (preview panel, fallback, pulse animation). |
| `test/preset-preview-assemble.test.ts` | New: stub `spindle.assemble` + `spindle.presets.get`; assert `vellum_preview_assemble` sends the right `{ blocks, chatId, promptVariables }`, returns the first system message content, and returns `null` when no chatId / no generation permission / assemble throws. |

**Explicitly NOT changed:** `renderVariablesEditor`, `renderTabDiagnostics`,
`mountVarControl`, the control mounts, `vellum_preset_vars_save`, the Actions
modal. The stat strip + preview are purely additive regions above the existing
editor.

No `package.json` change: `spindle.assemble` is already in the worker runtime
and `generation` is already granted.

---

## Known limitations (surface in UI / docs)

1. **Preview = the prompt, not a generated response.** It shows the assembled
   system message the model *would* see, not a sample of the model's prose. An
   actual generated sample would use `spindle.generate.quiet()` and cost tokens —
   deferred to an explicit "generate sample" button if wanted later.
2. **No chat → no preview.** Macros like `{{char}}`/`{{user}}` can't resolve
   without a live chat; the fallback panel says so plainly rather than rendering
   broken text.
3. **Debounce cadence.** Variable save = 400ms; preview re-assemble = 800ms. The
   preview intentionally lags the save so a slider drag doesn't fire an assemble
   per tick. The manual "↻ refresh" bypasses the debounce for an immediate look.
4. **Public-mount macro scope.** (Inherited, doesn't affect `assemble`.) The
   `assemble` path resolves macros server-side against the real chat, so this is
   *not* subject to the public-mount macro-picker filtering that the in-tab
   Loom editor would have been. The preview is actually *more* accurate than the
   editor's macro picker would have been.

---

## Verification

```sh
bun install
bun run typecheck
bun run test            # incl. new test/preset-preview-assemble.test.ts
bun run build
```

Then copy `dist/{backend,frontend}.js` into
`C:\Users\User\Lumiverse\data\extensions\vellum_engine\repo\dist\` and reload the
extension (as established this session).

Manual, on a host with `spindle.assemble`:
1. Open a linked companion preset **from within a chat** → VELLUM tab. Stat strip
   shows 4 cells; preview populates within ~800ms with the resolved
   session-settings block as a manuscript excerpt; footer echoes the active dials.
2. Change a variable (e.g. POV → First) → within ~800ms the preview re-resolves
   to the new wording; the save fires at ~400ms. No focus loss in the control.
3. Close the chat (or open the preset from the library with no chat) → preview
   switches to the "Open a chat to preview" fallback; strip's "no chat" cell
   shows an em-dash.
4. Click "↻ refresh" → immediate re-assemble, no debounce wait.
5. On an older host without `spindle.assemble` → preview panel shows the
   fallback silently; the strip + variables editor still work.

## Risk & ordering

- **Phase 1 (strip) is frontend-only and zero-risk** — land it first; it's a
  pure render of existing state.
- **Phase 2 (preview) is the substantive change.** Land the shell + fallback
  first (so the panel always renders something), then wire the assemble call.
  The 800ms debounce + abort discipline is the only fiddly part.
- **Phase 3 (active-chat resolution)** can land together with Phase 2's fallback
  — even a naive `chats.list` heuristic is fine because the fallback covers the
  no-chat case.

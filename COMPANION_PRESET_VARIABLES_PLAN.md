# Companion Preset Variables — In-Tab Loom Editor Plan

Add a **"Configure companion preset"** section to the VELLUM preset editor tab that
mounts Lumiverse's native Loom block editor (`ctx.components.mountLoomBlockEditor`,
shipped in host commit `cd7c2a8`) so users can choose the companion preset's
**prompt-variable values** — and optionally edit blocks — without leaving the
VELLUM tab.

This is additive. Every new host call is probed behind `as any` + try/catch and
degrades to the current read-only tab on older hosts, matching the existing
`registerPresetEditorTab` / `presetEditor` discipline in `src/ui/app.ts`.

---

## Architecture: two surfaces, two roles (formalized)

VELLUM's "preset editor" currently renders in **two** places, both driving the
same shared builder (`presetPanelInner` at `src/ui/app.ts:311` + `bindPresetPanel`
at `:483`):

| Surface | Entry point | Today | After this plan |
|---|---|---|---|
| **Host Preset Editor tab** (inside Lumiverse's native Loom editor) | `registerPresetEditorTab` → `renderPresetEditorTab()` (`app.ts:1158`) | Six read-only diagnostic sections | **Loom editor is the primary content**; diagnostics move **below** it, secondary |
| **Actions → "Preset editor" modal** (VELLUM extension drawer) | `preset` QOL item → `openPresetPanel()` (`app.ts:752`) / `refreshPresetModal()` (`:729`) | Six read-only diagnostic sections | **Unchanged** — stays diagnostics-only |

### Why the split is required, not just chosen

`ctx.components.mountLoomBlockEditor` requires its target to be **connected inside
a live, currently-registered placement root owned by the extension**. The host
tab's `root` (`app.ts:1160`) is exactly such a root. The Actions modal is a plain
overlay appended to `document.body` (`app.ts:763`), which is **not** an extension
placement root — mounting the native Loom editor there would be **rejected by the
host**. So the editor can only live in the host tab. The modal remains the
mobile/diagnostic-only equivalent (on mobile the whole `presetEditor` /
`components` surface is absent anyway).

### Divergence mechanism (low-risk)

The two surfaces already call **separate render functions** — they merely *chose*
to share `presetPanelInner`. To diverge:

- **Modal**: leave `openPresetPanel` / `refreshPresetModal` and their
  `presetPanelInner(...)` + `bindPresetPanel(...)` calls **completely untouched**.
  It never references `mountLoomBlockEditor`, so it cannot regress.
- **Tab**: change `renderPresetEditorTab()` only. Reorder it so the editor is the
  hero and diagnostics are a secondary, collapsed-by-default column beneath it
  (see revised §1.1). `presetPanelInner` stays reusable — the tab calls it to
  render the *diagnostics portion* into a sub-container below the editor.

This keeps `presetPanelInner` / `bindPresetPanel` as the single source of truth
for the six diagnostic features, shared by both surfaces, while only the **tab**
gains the editor on top.

---

## Key domain fact that scopes this work

Prompt-variable **values** are not stored on blocks. They live in
`preset.metadata.promptVariables` as `Record<blockId, Record<varName, value>>`
(confirmed: read at `src/ui/app.ts:422`, and the host type is
`promptVariables?: Record<string, Record<string, string | number | string[]>>`).
Block **definitions** (including each variable's declaration) live in
`preset.blocks` / `prompt_order`.

The Loom editor value carries both halves:

```ts
interface SpindleLoomBlockEditorValue {
  blocks: PromptBlockDTO[]                 // structure (+ variable declarations)
  promptVariableValues: PromptVariableValuesDTO   // the chosen values
}
```

Therefore:

- **Choosing variable values** = writing `metadata.promptVariables`. A **metadata
  write only** — no block CRUD. This is the user's actual request and is Phase 1.
- **Editing block structure** = diffing `blocks` → `spindle.presets.blocks.{create,update,delete}`.
  Larger surface; deferred to Phase 2 (optional).

---

## Phase 1 — Variable configuration (primary deliverable)

### 1.1 Restructure the host tab: editor first, diagnostics below

Only `renderPresetEditorTab()` (`app.ts:1158`) changes. The tab's `root` is
reorganized into **two stacked regions**:

```
┌─ host preset editor tab (root) ─────────────┐
│  [ Configure companion preset ]   ← PRIMARY  │
│  ┌───────────────────────────────────────┐  │
│  │  native Loom editor (mountLoom…)       │  │  stable mount node,
│  │  variable pickers + block view         │  │  NEVER innerHTML-repainted
│  └───────────────────────────────────────┘  │
│                                              │
│  ▸ Diagnostics                    ← SECONDARY│  collapsed by default
│  ┌───────────────────────────────────────┐  │
│  │  (presetPanelInner output: link,       │  │  its own child container,
│  │   health, injection, status, budgets)  │  │  gets the innerHTML repaint
│  └───────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

Concrete structure for `renderPresetEditorTab()`:

1. **Build the tab shell once** (not on every repaint). On first render, set
   `root.innerHTML` to a static skeleton containing:
   - a header "Configure companion preset",
   - a **stable editor slot** `<div data-vle-loom-slot></div>`,
   - a short host-limitation note (see §Known limitation),
   - a collapsible **"Diagnostics"** `<details>` (closed by default) whose body is
     a **stable diagnostics container** `<div data-vle-diag></div>`.
   Guard with a flag (`let _ptShellBuilt = false`) so the skeleton is written once;
   subsequent calls only update the two child regions independently.

2. **Editor region** — call `mountOrUpdateLoom(root, preset)` (see §1.2). Mount
   once; on later calls, only `_loomEditor.update({ value })` when the preset id
   actually changed. Never destroy/remount on a diagnostics repaint.

3. **Diagnostics region** — repaint **only** the `[data-vle-diag]` child:
   ```ts
   const diag = root.querySelector<HTMLElement>('[data-vle-diag]');
   if (diag) {
     diag.innerHTML = presetPanelInner({
       preset, inj: _ptInjRecord, status: _ptStatus,
       chatBudget: _ptChatBudget, previewOpen: _ptPreviewOpen,
     });
     bindPresetPanel(
       diag,
       (payload) => ctx.sendToBackend(payload),
       () => { _ptPreviewOpen = !_ptPreviewOpen; renderPresetEditorTab(); },
       (_pid, link) => { writeHostDraftLink(ctx, link); },
     );
   }
   ```
   This reuses the exact shared builder + link path already in place — the
   diagnostics keep working identically, just relocated beneath the editor and
   collapsed.

> **Critical repaint discipline.** The tab repaints on every async reply
> (`vellum_injection`, `vellum_preset_tab_status`, `vellum_budget_state` →
> `renderPresetEditorTab()` at `app.ts:1514/1526/1656`). Previously that reset the
> whole `root.innerHTML`. After this change those replies must repaint **only**
> `[data-vle-diag]`, never the editor slot — otherwise the Loom editor loses focus
> and in-progress edits on every status tick. Route all the async-reply repaints
> through a `renderTabDiagnostics()` helper that touches only the diagnostics
> child, and keep `renderPresetEditorTab()` (full rebuild) for preset-change events
> only.

### 1.2 Probe + mount the editor (frontend, `src/ui/app.ts`)

Add a module-scoped handle `let _loomEditor: any = null;` and `let _loomPresetId = '';`
alongside the other per-tab state (`app.ts:1147-1155`). Because the editor slot
`[data-vle-loom-slot]` is now **stable** (written once in the shell, never
innerHTML-repainted), the helper mounts on first use and thereafter only calls
`update({ value })` — remounting solely when the open preset id changes:

```ts
function mountOrUpdateLoom(root: HTMLElement, preset: any): void {
  const slot = root.querySelector<HTMLElement>('[data-vle-loom-slot]');
  const canMount = !!(ctx as any).components?.mountLoomBlockEditor;
  const linked = preset?.metadata?.vellum_engine?.identifier === 'vellum_engine';
  // Only offer the editor for a linked companion preset with blocks.
  if (!slot || !canMount || !preset?.id || !linked || !Array.isArray(preset.blocks) || !preset.blocks.length) {
    try { _loomEditor?.destroy(); } catch { /* ignore */ }
    _loomEditor = null; _loomPresetId = '';
    return;
  }
  const value = {
    blocks: preset.blocks,
    promptVariableValues: (preset.metadata?.promptVariables ?? {}),
  };
  // Same preset already mounted → patch value in place (no focus loss).
  if (_loomEditor && _loomPresetId === preset.id) {
    try { _loomEditor.update({ value }); return; } catch { /* fall through to remount */ }
  }
  // Different preset (or first mount) → tear down any stale handle and mount fresh.
  try { _loomEditor?.destroy(); } catch { /* ignore */ }
  _loomEditor = null;
  try {
    _loomEditor = (ctx as any).components.mountLoomBlockEditor(slot, {
      value,
      compact: true,
      // Phase 1: variables only. Blocks are shown for context but structural
      // edits are not persisted yet (see Phase 2). readOnly=false so the
      // variable controls are interactive.
      onChange: (next: any) => onLoomChange(preset.id, next),
    });
  } catch (e) {
    try { console.info('[vellum] loom editor mount failed:', e); } catch { /* ignore */ }
    _loomEditor = null;
  }
}
```

> Slot is stable, so no per-repaint remount occurs (see §1.1's repaint
> discipline). The helper is called from the full-rebuild path
> (`renderPresetEditorTab`) on preset-change events; the diagnostics-only repaint
> path (`renderTabDiagnostics`) never touches it.

### 1.3 Persist variable values (the write path)

`onChange` gives a **detached snapshot** and persists nothing. Persist the
`promptVariableValues` into `metadata.promptVariables`. Debounce to avoid a write
per keystroke.

Primary path — **frontend, through the host save coordinator** (live reflection,
no manual revision handling; the coordinator rebases field-by-field and is the
same path the native editor's variable saves use):

```ts
let _loomSaveTimer: any = null;
function onLoomChange(presetId: string, next: any): void {
  const pv = next?.promptVariableValues ?? {};
  clearTimeout(_loomSaveTimer);
  _loomSaveTimer = setTimeout(() => {
    // Prefer the unscoped coordinator write (whole-draft, field-rebased).
    const editor = (ctx.ui as any).presetEditor;
    if (editor?.updatePreset) {
      try {
        editor.updatePreset(
          (p: any) => ({ ...p, metadata: { ...(p.metadata ?? {}), promptVariables: pv } }),
          { immediate: false },
        );
        return;
      } catch { /* fall through to backend */ }
    }
    // Fallback: backend revision-aware write (older hosts / mobile).
    try { ctx.sendToBackend({ type: 'vellum_preset_vars_save', presetId, promptVariables: pv }); } catch { /* ignore */ }
  }, 400);
}
```

> Scope note: `presetEditor.extension.updateMetadata` writes **only**
> `metadata[vellum_engine]`, so it cannot persist `metadata.promptVariables`.
> That is why Phase 1 uses the unscoped `updatePreset` (coordinator-serialized)
> rather than the scoped helper used by the link/unlink path.

### 1.4 Backend fallback handler (`src/backend.ts` dispatch table)

Add next to `vellum_preset_tab_get_status` (`backend.ts:2570`). Reuse the exact
revision-aware read-modify-write pattern already proven in
`src/host/presets.ts` (`stampPresetMetadata`): read the preset, merge
`metadata.promptVariables`, write with `expected_cache_revision`, retry once on
`PRESET_REVISION_CONFLICT`.

```ts
vellum_preset_vars_save: async (p, uid) => {
  const presetId = String(p?.presetId ?? '').trim();
  const pv = (p && typeof p.promptVariables === 'object' && p.promptVariables) || {};
  const done = (ok: boolean) => spindle.sendToFrontend?.({ type: 'vellum_preset_vars_saved', ok, presetId }, uid ?? currentUser());
  if (!presetId || !(await has('presets')) || !spindle.presets?.get || !spindle.presets?.update) { done(false); return; }
  // Factor the merge as a helper so the conflict retry re-reads fresh metadata.
  const write = async (revision?: number): Promise<void> => {
    const preset = await spindle.presets.get(presetId, uid);
    if (!preset) throw new Error('preset_not_found');
    const metadata = { ...(preset.metadata ?? {}), promptVariables: pv };
    await spindle.presets.update(presetId, { metadata, expected_cache_revision: revision ?? preset.cache_revision ?? 0 }, uid);
  };
  try {
    try { await write(); }
    catch (e: any) {
      if (e?.code !== 'PRESET_REVISION_CONFLICT') throw e;
      await write(e.actualCacheRevision);
    }
    done(true);
  } catch (e) { spindle.log?.warn?.('[vellum_engine] preset_vars_save: ' + ((e as Error)?.message ?? e)); done(false); }
},
```

> This mirrors `stampPresetMetadata` deliberately. If a shared metadata-merge
> helper is preferred, extract `updatePresetMetadataKey(presetId, key, value, uid)`
> in `src/host/presets.ts` and call it from both `stampPresetMetadata` and this
> handler. Optional cleanup, not required for correctness.

### 1.5 Frontend ack (optional, low priority)

Handle `vellum_preset_vars_saved` in the existing frontend message switch
(near where `vellum_preset_tab_status` is handled) to flash a small "Saved" note.
Not required — the coordinator path reflects immediately via `presetEditor.onChange`.

---

## Phase 2 — Block structural edits (optional, deferred)

If block editing (not just variable values) is desired, persist the `blocks`
half of the Loom value. This requires a diff against the current
`preset.blocks`, then:

- new block → `spindle.presets.blocks.create(presetId, input, index, uid)`
- changed block → `spindle.presets.blocks.update(presetId, blockId, input, uid)`
- removed block → `spindle.presets.blocks.delete(presetId, blockId, uid)`

(These map to `preset_blocks_*` messages already wired in the runtime,
`backend.ts:309-313` / `:2214-2247`.)

Caveats to resolve before starting Phase 2:
- Never send the six host-owned sealed/provenance fields (`sealed`, `sealedKey`,
  `sealedSource`, `sealedOriginPresetId`, `sealedOriginVersion`, `sealedSha256`);
  they are not part of the public `PromptBlockDTO` and are rejected.
- Ordering/index churn from a naive diff can reorder blocks; prefer stable-id
  matching and only emit `create`/`delete` for genuine adds/removes.

Recommendation: ship Phase 1 alone first. It satisfies "choose the variables from
the VELLUM tab." Phase 2 is a separate, heavier change.

---

## Known limitation to surface in the UI

A **public** `mountLoomBlockEditor` has no contextual preview adapter: it does not
resolve macros against the current chat/character/persona/connection, and its
macro picker shows only `core-public` macros plus VELLUM's own. So variable
controls that reference live chat macros won't preview resolved values inside the
VELLUM tab the way they do in the native preset editor.

Add one line under the section header, e.g.:
`"Values save to this preset. Live macro previews are only in the native editor."`

---

## Files touched

| File | Change |
|---|---|
| `src/ui/app.ts` | Restructure **`renderPresetEditorTab()` only**: build a one-time shell (editor slot on top, collapsible "Diagnostics" `<details>` below); add `mountOrUpdateLoom` / `onLoomChange`; split async-reply repaints into a `renderTabDiagnostics()` that touches only `[data-vle-diag]`; destroy `_loomEditor` in teardown (`app.ts:1768`). **Do not touch** `openPresetPanel` / `refreshPresetModal` (`app.ts:729-784`) — the Actions modal stays diagnostics-only. |
| `src/ui/styles.ts` | `[data-vle-loom-slot]` sizing (generous max-height, primary emphasis) and `[data-vle-diag]` inside a compact, de-emphasized `<details>` |
| `src/backend.ts` | Add `vellum_preset_vars_save` dispatch handler |
| `src/host/presets.ts` | (Optional) extract shared `updatePresetMetadataKey` helper |

**Explicitly NOT changed:** `presetPanelInner` (`app.ts:311`) and `bindPresetPanel`
(`app.ts:483`) keep their signatures and behavior — the tab's diagnostics region
and the Actions modal both still call them. The modal's entry
(`preset` QOL → `openPresetPanel`, `app.ts:937/752`) is untouched.

No `package.json` change: `lumiverse-spindle-types` is already targeted at a
version with the scoped editor surface, and the runtime uses `as any` for the new
`ctx.components` call.

---

## Teardown

In the extension teardown block (`app.ts:1768`, next to
`presetEditorTab?.destroy()`), add:

```ts
try { _loomEditor?.destroy(); } catch { /* ignore */ }
_loomEditor = null;
```

The host also auto-destroys Loom mounts on disable/unload/reload/permission-revoke,
and `update()`/`getValue()` throw `COMPONENT_DESTROYED` after teardown — so guard
any deferred `_loomEditor.update(...)` calls (the debounced save timer) with a
try/catch and null the handle on failure.

---

## Verification

```sh
bun install
bun run typecheck
bun run test
bun run build
```

Add `test/preset-vars-save.test.ts` (mirror `test/preset-stamp.test.ts`): stub
`spindle.presets.{get,update}` and assert `vellum_preset_vars_save` sends
`expected_cache_revision`, merges `metadata.promptVariables` without dropping
other metadata keys (including `vellum_engine`), and retries once on
`PRESET_REVISION_CONFLICT`.

Manual, on a host at `cd7c2a8`+:
1. Open the companion preset in the editor → VELLUM tab → the **native Loom editor
   is the primary content at the top**, "Configure companion preset". Diagnostics
   sit below in a collapsed "Diagnostics" section.
2. Change a variable value → within ~400ms it persists; reopen the preset and the
   value is retained.
3. Trigger an async tab repaint (switch chat / new injection) → the editor keeps
   focus and in-progress state; only the diagnostics region repaints (proves the
   repaint split).
4. Expand "Diagnostics" → link/health/injection/status/budget still work exactly
   as before.
5. Open VELLUM drawer → Actions → "Preset editor" modal → **unchanged**: the six
   diagnostics render as today, no editor, no regression.
6. On an older host without `ctx.components.mountLoomBlockEditor`, the tab shows
   the diagnostics (optionally without the collapsed wrapper) and the modal is
   unchanged.

## Risk & ordering

- **1.1 (mount) + repaint split** is the only structurally tricky part; land it
  first and confirm the editor survives repaints before wiring persistence.
- **1.2/1.3 (persistence)** is low risk — reuses the proven revision-aware pattern.
- Phase 2 is independent and optional; do not block Phase 1 on it.

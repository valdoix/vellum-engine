# Scoped Preset Editor API Adoption — Implementation Plan

Adopt the Lumiverse host's new **scoped preset-editor API** (staging PR #237,
`feat(spindle): add scoped preset editor foundation`, shipped in
`lumiverse-spindle-types@0.6.3`) and fix a version-drift bug uncovered while
reviewing the current integration.

The new host surface adds, all gated on the `presets` permission (which VELLUM
already holds):

- `ctx.ui.presetEditor.extension` — a helper scoped to the calling extension's
  manifest identifier: `getState()`, `onChange()`, `setMetadata()`,
  `updateMetadata(updater, { immediate })`, `activateBuiltinTab('blocks')`,
  and `flush()`. It can only read/replace `metadata[vellum_engine]`, not the
  whole preset.
- `ctx.ui.registerPresetEditorToolbarItem({ id, ariaLabel })` — one
  extension-owned root above the preset list/edit branch (max 1 per extension).
  Returns `{ root, itemId, setVisible(visible), destroy() }`.
- A process-wide **preset save coordinator** that serializes all preset writes
  (native edits, prompt-variable saves, renames, generation flushes) and rebases
  field-by-field. Per the host docs, *"direct whole-preset writes are
  unnecessary."*

All four items degrade gracefully on older hosts: every new host call is probed
behind `as any` + try/catch, exactly as the existing `registerPresetEditorTab`
and `presetEditor` calls already are.

---

## Item 4 (do first — smallest, unblocks nothing but removes a real bug)

### Fix the hardcoded stale version in the desktop link path

`src/ui/app.ts:1124` stamps `version: '2.0.0-beta.1'` into
`metadata.vellum_engine` when linking from the desktop tab. The real version is
`2.1.0-beta.2` (`src/version.ts`), and `VELLUM_VERSION` is already imported at
`src/ui/app.ts:30` and used elsewhere (e.g. line 472). This literal drifts every
release and makes `stampCompanionPreset`'s version-equality check
(`backend.ts:697`) see a mismatch, forcing a redundant re-stamp.

**Change:** in the `hostDraftUpdate` callback passed to `bindPresetPanel`
(`app.ts:1117-1129`), replace the literal `'2.0.0-beta.1'` with `VELLUM_VERSION`.

```ts
version: VELLUM_VERSION,
```

This is a one-line edit and is independent of the API migration below, so land
it even if the rest is deferred.

---

## Item 1 — Migrate link/unlink to the scoped `updateMetadata` write

### Current state
The desktop link path (`app.ts:1117-1129`) uses the **unscoped whole-preset**
API:

```ts
(ctx.ui as any).presetEditor?.updatePreset?.((preset: any) => ({
  ...preset,
  metadata: { ...preset.metadata, vellum_engine: {...} },
}), { immediate: true });
```

This is the whole-document write the coordinator was built to replace; a
concurrent prompt-variable save could clobber it (or vice versa).

### Target
Use the scoped helper, which writes only `metadata[vellum_engine]` through the
shared coordinator:

```ts
const editor = (ctx.ui as any).presetEditor?.extension;
if (editor?.updateMetadata) {
  editor.updateMetadata(
    (current: any) => (link
      ? { ...(current && typeof current === 'object' ? current : {}),
          version: VELLUM_VERSION, identifier: 'vellum_engine', linkedAt: Date.now() }
      : { ...(current && typeof current === 'object' ? current : {}),
          identifier: null }),
    { immediate: true },
  );
} else if ((ctx.ui as any).presetEditor?.updatePreset) {
  // existing unscoped fallback (older hosts), now also using VELLUM_VERSION
}
```

### Touch points
- `src/ui/app.ts` — the `hostDraftUpdate` callback (`~1117-1129`). Keep the
  existing `updatePreset` branch as the fallback; try `extension.updateMetadata`
  first.
- `renderPresetEditorTab` reads state via
  `(ctx.ui as any).presetEditor?.getState?.()` (`app.ts:1093`). Optionally switch
  the read to `presetEditor.extension.getState()` too, but note the scoped
  `getState()` exposes only `metadata[vellum_engine]`, whereas the tab's Health
  Check (Feature 2) and Preset Budget (Feature 5) need `preset.blocks` /
  `prompt_order`. **Keep the unscoped `getState()` for the full draft read**; use
  the scoped helper only for the metadata write and the change subscription.
- `openPresetPanel` (`app.ts:706`) also reads
  `presetEditor?.getState?.()?.preset` — leave as-is (needs full draft).

### Backend
No change required. `stampCompanionPreset` (`backend.ts:670`) and
`stampPresetMetadata` (`host/presets.ts:15`) already prefer
`spindle.presets.updateMetadata` and only fall back to read-modify-write. With
the coordinator now flushing before generation, the metadata-only path is the
correct one. Keep the fallback.

---

## Item 2 — Add a preset-editor toolbar item (Link / health at a glance)

### Goal
Register one extension-owned toolbar root above the preset editor's list/edit
area for a one-click **Link / Unlink** control + a small link/health badge —
more discoverable than the control living only inside the VELLUM tab.

### Touch points (all in `src/ui/app.ts`, near the existing tab registration
`~1133-1161`)
- After `registerPresetEditorTab` succeeds, probe and register:

```ts
let presetToolbarItem: any = null;
try {
  if ((ctx.ui as any).registerPresetEditorToolbarItem) {
    presetToolbarItem = (ctx.ui as any).registerPresetEditorToolbarItem({
      id: 'vellum_engine',
      ariaLabel: 'VELLUM link controls',
    });
  }
} catch { /* older host — silently skip */ }
```

- Render into `presetToolbarItem.root` (a plain host-provided element; VELLUM
  owns everything beneath it). Build a compact control: a status dot + a
  Link/Unlink button. Reuse the existing link write path (Item 1's
  `editor.updateMetadata` + `send({ type: 'vellum_preset_tab_link', ... })`) so
  the button, the tab, and the mobile modal all go through one code path.
- Subscribe to `presetEditor.extension.onChange` (or the existing
  `presetEditor.onChange`) to re-render the toolbar's linked/health state, and
  call `presetToolbarItem.setVisible(true/false)` based on whether a preset is
  open.
- On teardown, call `presetToolbarItem?.destroy()` alongside the existing
  `presetEditorTab?.destroy()` at `app.ts:1558`.

### Extract shared render/wire helper
The toolbar item and the tab both need "is this preset linked? draw a
dot + Link button". Factor a tiny `linkControlHtml(isLinked, presetId)` +
`wireLinkControl(root, ...)` out of `bindPresetPanel` so the toolbar reuses it
rather than duplicating the button wiring.

### Constraint
Max 1 toolbar item per extension. Register exactly one; do not attempt a second.

---

## Item 3 — Confirm/keep the metadata-only backend stamp path

No code change expected; this item is verification + a safety fallback audit.

- Confirm `spindle.presets.updateMetadata(presetId, { vellum_engine: meta },
  userId)` exists in `0.6.3` and is what the coordinator's
  `flushPresetForGeneration` expects. `host/presets.ts:26` already calls it when
  present and falls back to `presets.get` + `presets.update({ metadata })`.
- Keep the read-modify-write fallback (`host/presets.ts:29-33`) for hosts without
  `updateMetadata`.
- Verify the `stampCompanionPreset` throttle + version-equality check
  (`backend.ts:697`) now short-circuits correctly once Item 4 makes the desktop
  link write the same `VELLUM_VERSION` the backend stamps — previously a linked
  preset carried `2.0.0-beta.1` from the frontend and `2.1.0-beta.2` from the
  backend, so they never matched and re-stamped on a loop.

---

## Dependency bump

- `package.json:22` — raise `lumiverse-spindle-types` from `^0.5.28` to
  `^0.6.3`. This is a devDependency (types only), so it affects `typecheck`/build
  typings, not runtime. The runtime uses `declare const spindle: any` and
  `(ctx.ui as any)`, so the bump is low-risk but gives accurate types for the new
  `presetEditor.extension` / `registerPresetEditorToolbarItem` surface.
- Run `bun install` to update `bun.lock`.
- Consider replacing the `as any` casts on the newly-typed surface once the types
  are available (optional cleanup, not required).

---

## Files touched (summary)

| File | Change |
|---|---|
| `src/ui/app.ts` | Item 4 version fix; Item 1 scoped `updateMetadata` write with fallback; Item 2 toolbar registration + render/wire + teardown; extract shared link control helper |
| `src/host/presets.ts` | Item 3 — verify only; keep `updateMetadata`-preferred path + fallback |
| `src/backend.ts` | No change; verify throttle/version check behavior post-fix |
| `package.json` | Bump `lumiverse-spindle-types` to `^0.6.3` |
| `bun.lock` | Regenerated by `bun install` |

---

## Verification

Per `README.md` "For developers":

```sh
bun install
bun run typecheck   # tsc --noEmit (strict) — must pass with 0.6.3 types
bun run test        # vitest
bun run build       # → dist/backend.js + dist/frontend.js
```

Then reload the extension in Lumiverse and manually verify:

1. **Item 4 / Item 1:** Open a preset in the editor → VELLUM tab → click Link.
   Confirm `metadata.vellum_engine.version` is `2.1.0-beta.2` (not
   `2.0.0-beta.1`), and that linking no longer clobbers prompt-variable edits
   made in the same session.
2. **Item 2:** The toolbar Link/Unlink control appears above the preset editor,
   reflects linked state live, and toggles it. Hidden when no preset is open.
3. **Item 3:** After a fold, `stampCompanionPreset` does not re-stamp an
   already-linked, up-to-date preset (check the log — no repeated
   "stamped preset …" lines within the 5-min throttle).
4. **Backward compat:** On a host without the new API (or with `presets`
   revoked), the tab/toolbar silently skip and the mobile Actions → "Preset
   editor" modal still works via the backend path.

## Risk & ordering

- **Item 4** is a safe one-line fix — land first, independent of everything else.
- **Item 1** and **Item 3** are the correctness core; low risk due to fallbacks.
- **Item 2** is additive UI; if the toolbar API is absent it's a no-op.
- The only cross-cutting change is the types bump; because runtime is untyped
  (`any`), a typings regression surfaces at `typecheck`, not at runtime.

# VELLUM Preset Editor Tab — Implementation Plan

Implementation plan for upgrading the placeholder preset editor tab (registered in `src/ui/app.ts:745-760`) into a functional panel with four features:

1. **Explicit companion linking** (badge + link/unlink button)
2. **Health check** (companion prompt block detection)
3. **Injection preview** (live context sample from current chat)
4. **Structured output status** (diagnostic indicator, not a toggle)

---

## Guiding Principles

- **Compact UI**: Editor tabs are narrow (~280-360px). Use vertical stacking, small text (12-13px), and minimal chrome.
- **Read-heavy**: The tab surfaces diagnostic info more than configuration. Most interactions are read-only indicators + one-click actions.
- **Backend-frontend split**: Backend owns all writes (via dispatch handlers) and sends state back. Frontend renders and sends commands via `ctx.sendToBackend`.
- **Graceful degradation**: The tab already probes for API presence. All four features degrade individually if data is unavailable.

---

## Architecture Overview

**Frontend** (`src/ui/app.ts`, lines 745-760):
- Replace placeholder `innerHTML` with a proper render function
- Subscribe to `ctx.ui.presetEditor.onChange()` to re-render on preset switch
- Read `ctx.ui.presetEditor.getState()` for current draft preset
- Send `vellum_preset_tab_*` commands to backend via `ctx.sendToBackend`
- Listen for `vellum_preset_tab_state` broadcast to hydrate indicators

**Backend** (new dispatch handlers in `src/backend.ts:1304+`):
- `vellum_preset_tab_get_state`: read current chat state + preset health + extraction status
- `vellum_preset_tab_link`: stamp `metadata.vellum_engine` on specified preset
- `vellum_preset_tab_unlink`: remove `metadata.vellum_engine` from preset

**Shared types** (no new file needed; inline in each module):
- Frontend: `PresetTabState` interface
- Backend: payload shapes in dispatch handlers

---

## Feature 1: Explicit Companion Linking

**UI**: A status badge + one-click link/unlink button.

**Visual mockup** (compact, 280px width):
```
┌─────────────────────────────────────┐
│ Companion Preset                    │
│ ● Linked                            │
│ [Unlink]                            │
└─────────────────────────────────────┘
```

When unlinked:
```
┌─────────────────────────────────────┐
│ Companion Preset                    │
│ ○ Not linked                        │
│ [Link this preset]                  │
└─────────────────────────────────────┘
```

**Logic**:

- **Detection**: Preset carries `metadata.vellum_engine.identifier === 'vellum_engine'`
- **Link action**: Write `metadata.vellum_engine = { version: VELLUM_VERSION, identifier: 'vellum_engine', linkedAt: Date.now() }`
- **Unlink action**: Delete `metadata.vellum_engine` or set `identifier: null`

**Frontend implementation** (`src/ui/app.ts:745-760`):

1. Replace placeholder with a render function that reads `ctx.ui.presetEditor.getState().preset`
2. Check `preset?.metadata?.vellum_engine?.identifier === 'vellum_engine'`
3. Show badge: green dot + "Linked" or gray dot + "Not linked"
4. Button handler: send `{ type: 'vellum_preset_tab_link', presetId, link: true/false }` to backend
5. On response, `ctx.ui.presetEditor.onChange` fires automatically → re-render

**Backend implementation** (`src/backend.ts` dispatch table):

```typescript
vellum_preset_tab_link: async (p, uid) => {
  const presetId = p?.presetId;
  const link = !!p?.link;
  if (!presetId) return;
  
  if (link) {
    // Stamp the preset with companion metadata
    const meta = { version: VELLUM_VERSION, identifier: 'vellum_engine', linkedAt: Date.now() };
    await stampPresetMetadata(presetId, meta, uid);
  } else {
    // Unlink: remove the identifier (keep version/linkedAt for history)
    if (!(await has('presets'))) return;
    if (!spindle.presets?.get || !spindle.presets?.update) return;
    const preset = await spindle.presets.get(presetId, uid);
    if (!preset) return;
    const vellum = preset.metadata?.vellum_engine ?? {};
    const meta = { ...vellum, identifier: null };
    await stampPresetMetadata(presetId, meta, uid);
  }
  // The host will fire ctx.ui.presetEditor.onChange, no explicit broadcast needed
},
```

---

## Feature 2: Health Check (Companion Prompt Block Detection)

**UI**: A status line + optional fix button.

**Visual mockup**:
```
┌─────────────────────────────────────┐
│ Companion Instructions              │
│ ✓ Present (block "v2-state-block")  │
└─────────────────────────────────────┘
```

When missing:
```
┌─────────────────────────────────────┐
│ Companion Instructions              │
│ ✗ Missing                           │
│ [Insert canonical block]            │
└─────────────────────────────────────┘
```

When outdated (version mismatch):
```
┌─────────────────────────────────────┐
│ Companion Instructions              │
│ ⚠ Outdated (v2.0, current v2.1)     │
│ [Update block]                      │
└─────────────────────────────────────┘
```

**Detection logic**:

Scan `preset.blocks` for a block whose `content` contains the VELLUM state-block instruction signature. The canonical companion preset (`presets/vellum-ii.json`) has a block (id `v2-state-block`) with content containing:

```
[VELLUM — STATE] After EVERY response, append a hidden <vellum> JSON report
```

**Frontend implementation**:

1. Read `ctx.ui.presetEditor.getState().preset.blocks`
2. Search for a block where `content.includes('[VELLUM — STATE]')` or `content.includes('<vellum>')` (case-insensitive)
3. If found: status = "Present", show block name
4. If missing: status = "Missing", show "Insert" button
5. Optional: version check by parsing `presetVersion` from block content (future enhancement)

**Backend implementation** (optional fix action):

```typescript
vellum_preset_tab_fix_instructions: async (p, uid) => {
  const presetId = p?.presetId;
  if (!presetId || !(await has('presets'))) return;
  
  // Insert the canonical VELLUM state-block into the preset
  // Use spindle.presets.blocks.create(presetId, blockDef, { index: 0 })
  // Block def: role: 'system', position: 'post_history', enabled: true,
  //            content: (canonical instruction text from vellum-ii.json)
  
  const canonicalBlock = {
    name: 'VELLUM — State Block',
    role: 'system',
    position: 'post_history',
    enabled: true,
    content: '[VELLUM — STATE] After EVERY response...' // (full canonical text)
  };
  
  await spindle.presets.blocks.create(presetId, canonicalBlock, { index: 0 }, uid);
  // Host fires onChange → frontend re-renders
},
```

**Note**: The canonical instruction text should be extracted from `presets/vellum-ii.json` and embedded as a constant in the backend, or read lazily via `spindle.storage.read()` if the preset ships in the extension's storage.

---

## Feature 3: Injection Preview (Live Context Sample)

**UI**: A collapsible text preview showing what VELLUM injected on the last turn.

**Visual mockup**:
```
┌─────────────────────────────────────┐
│ Live Injection Preview              │
│ Turn 47 • 1,240 chars • 2 recalls   │
│ [Show ▾]                            │
└─────────────────────────────────────┘
```

When expanded:
```
┌─────────────────────────────────────┐
│ Live Injection Preview              │
│ Turn 47 • 1,240 chars • 2 recalls   │
│ [Hide ▴]                            │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ CAST: Elara (present, curious), │ │
│ │ Kael (present, tense). BONDS:   │ │
│ │ Elara↔Kael: aff 45, trust 30... │ │
│ │ [truncated]                     │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

**Data source**: The backend's injection log (`injectionLog` map in `backend.ts`), already exposed via `vellum_get_injection` and rendered in the Injection tab.

**Frontend implementation**:

1. Request injection data: `ctx.sendToBackend({ type: 'vellum_get_injection' })`
2. Listen for `vellum_injection` broadcast (already wired in `app.ts:889`)
3. Take the most recent record (`_log[0]` in `injection.ts`)
4. Render: turn number, char count, recall count, first 300 chars of `text`
5. Collapsible toggle: `<details>` element or manual toggle

**Backend**: No new handler needed. Reuse existing `vellum_get_injection` (dispatch table line ~1900+).

**Integration note**: The injection log is chat-scoped, so the preview shows data from the **current active chat**, not the preset being edited. The UI should clarify: "From current chat" or similar label.

---

## Feature 4: Structured Output Status (Diagnostic Indicator)

**UI**: A read-only status line showing whether `generation_parameters` is granted and whether extraction enforcement is active.

**Visual mockup**:
```
┌─────────────────────────────────────┐
│ Extraction (Internal Calls)         │
│ Schema enforcement: Active          │
│ Permission: generation_parameters   │
│ Provider: openai / gpt-4o-mini      │
│ Last extraction: 4/4 fields         │
└─────────────────────────────────────┘
```

When permission not granted:
```
┌─────────────────────────────────────┐
│ Extraction (Internal Calls)         │
│ Schema enforcement: Not available   │
│ Permission: not granted             │
└─────────────────────────────────────┘
```

**Data sources**:

1. **Permission status**: `has('generation_parameters')` (backend)
2. **Active provider/model**: Last connection used by `internalGenerate` (tracked via `defaultConnectionId()` cache in `generation.ts`)
3. **Last extraction result**: Track success/failure in `extractFromProse` (already tracks `_extractFails` in `backend.ts:101`)

**Frontend implementation**:

1. Request status: `ctx.sendToBackend({ type: 'vellum_preset_tab_get_status' })`
2. Receive: `{ type: 'vellum_preset_tab_status', permission: bool, provider: string, model: string, lastExtraction: { success: bool, fields: number } }`
3. Render read-only status lines

**Backend implementation**:

```typescript
vellum_preset_tab_get_status: async (_p, uid) => {
  const chatId = await activeChatId(uid);
  const permission = await has('generation_parameters');
  
  // Provider/model from the last internal generation call
  const connId = await defaultConnectionId(uid);
  let provider = 'unknown', model = 'unknown';
  if (connId && spindle.connections?.get) {
    const conn = await spindle.connections.get(connId, uid);
    if (conn) {
      provider = conn.provider ?? 'unknown';
      model = conn.model ?? 'unknown';
    }
  }
  
  // Last extraction result: read from the most recent fold
  // For now, report based on _extractFails streak (0 = success)
  const lastExtraction = { success: _extractFails === 0, fields: 4 }; // 4 = expected fields count
  
  spindle.sendToFrontend?.({
    type: 'vellum_preset_tab_status',
    permission,
    provider,
    model,
    lastExtraction,
  }, uid);
},
```

**Note**: This is diagnostic-only. No user action changes it — it just surfaces what's happening under the hood.

---

## Implementation Checklist

### Backend (`src/backend.ts`)

- [ ] Add `vellum_preset_tab_link` handler (lines ~1304+)
- [ ] Add `vellum_preset_tab_get_status` handler
- [ ] Optional: Add `vellum_preset_tab_fix_instructions` handler
- [ ] Extract canonical VELLUM state-block instruction as a constant (or lazy-load from `presets/vellum-ii.json`)
- [ ] Extend `_extractFails` tracking to expose last extraction result (already tracked, just surface it)

### Frontend (`src/ui/app.ts`)

- [ ] Replace placeholder `innerHTML` (line 755) with `renderPresetEditorTab()`
- [ ] Implement `renderPresetEditorTab()` function:
  - Read `ctx.ui.presetEditor.getState()`
  - Render Feature 1 (linking badge + button)
  - Render Feature 2 (health check status)
  - Render Feature 3 (injection preview, collapsible)
  - Render Feature 4 (extraction status, read-only)
- [ ] Subscribe to `ctx.ui.presetEditor.onChange()` to re-render on preset switch
- [ ] Wire event handlers for buttons (link/unlink, fix instructions, toggle preview)
- [ ] Request initial status on tab activation: send `vellum_preset_tab_get_status` + `vellum_get_injection`

### Styling (`src/ui/styles.ts`)

- [ ] Add `.vle-preset-tab` styles (compact vertical stack, 12-13px text)
- [ ] Add `.vle-preset-badge` (colored dot + label)
- [ ] Add `.vle-preset-preview` (monospace, scrollable, max-height 150px)
- [ ] Reuse existing `.vle-sec-top`, `.vle-add` button styles where applicable

### Testing

- [ ] Permission granted: verify "Linked" badge when `metadata.vellum_engine.identifier === 'vellum_engine'`
- [ ] Permission denied: verify graceful degradation (no link button, status shows "not available")
- [ ] Health check: verify detection of canonical block in `vellum-ii.json`
- [ ] Injection preview: verify first 300 chars of last injection are displayed
- [ ] Status indicator: verify permission, provider, model are correct

---

## Phased Rollout

**Phase 1 (MVP)**: Features 1 + 2 (linking + health check)
- Core value: explicit linking replaces heuristic auto-stamp
- Health check surfaces misconfiguration immediately

**Phase 2**: Feature 3 (injection preview)
- Diagnostic value: see live context without switching tabs

**Phase 3**: Feature 4 (extraction status)
- Power-user diagnostic: confirm schema enforcement is working

---

## Notes

1. **No settings storage**: The tab is read-only + one-click actions. No new persistent state beyond what's already in `metadata.vellum_engine`.

2. **Chat context for preview**: The injection preview pulls from the current active chat, not from the preset. This is intentional — it shows "what would VELLUM inject with this preset in the current story."

3. **Canonical block source**: The companion instruction text should be version-controlled. Either embed it as a constant in `backend.ts`, or ship `presets/vellum-ii.json` in the extension and read it via `spindle.storage.read()`.

4. **Graceful API absence**: Every feature already checks for API presence (`ctx.ui.registerPresetEditorTab`, `spindle.presets.*`, `has('presets')`). The plan preserves this discipline — each feature degrades individually.

5. **No breaking changes**: Existing `stampCompanionPreset()` auto-stamping (backend.ts:534-570) continues to work. The explicit link button is additive, not a replacement.

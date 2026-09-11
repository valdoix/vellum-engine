# ATELIER PRESET TAB — Implementation Plan

**Goal:** Transform the VELLUM preset editor tab from a minimal diagnostic panel into "The Atelier" — a writer's studio that shows the preset's prompt budget, the active chat's context budget, and eventually (future phase) live dial editing with manuscript preview.

**Scope for this phase:**
1. **Preset prompt budget** — Show the standing-prompt token estimate for all enabled blocks, with category breakdown
2. **Active chat context budget (read-only)** — Display the current chat's `vellum_budget` as diagnostic status
3. **Visual redesign** — Adopt the Atelier's rail + canvas grid layout from the mockup
4. **Ancillary cleanup:**
   - Remove `secrets` from the card-shape customizer (Secrets no longer use ornamental shapes)
   - Update README permissions table to add `presets`
   - Update onboarding guide to remove Secrets from Shapes section and reflect the new tab features

---

## Part 1: Preset Prompt Budget (Honest Token Estimate)

### 1.1 Macro-lite resolver (honest estimation)

**Problem:** Raw block `content` length lies by 2x due to unexpanded `{{var::x}}`, `{{if}}` branches, and `{{pick}}` clauses.

**Solution:** A bounded macro resolver that:
- Expands `{{var::name}}` by looking up `block.variables[].options[selected]` (the prompt variable's current value)
- Picks one `{{if::condition}}...{{else}}...{{/if}}` branch (default to the `if` branch for estimation — we don't have runtime context)
- Picks the first option from `{{pick::a::b::c}}`
- Ignores host-side advanced features (`{{and::...}}`, `{{ne::...}}`) — just pass them through as-is

**Implementation:**
- New module: `src/domain/preset-macro-lite.ts`
- Function: `expandMacros(content: string, variables: Record<string, string>): string`
- Input: block content + a map of `varName -> currentValue` built from `block.variables`
- Output: expanded text (still a character count, converted to tokens via `/4`)

**Algorithm sketch:**
```ts
export function expandMacros(content: string, vars: Record<string, string>): string {
  let out = content;
  // 1. {{var::name}} -> vars[name] ?? '{{var::name}}'
  out = out.replace(/\{\{var::(\w+)\}\}/g, (_, name) => vars[name] ?? `{{var::${name}}}`);
  // 2. {{if::X}}A{{else}}B{{/if}} -> A (default to if-branch for estimation)
  out = out.replace(/\{\{if::[^}]+\}\}(.*?)\{\{else\}\}.*?\{\{\/if\}\}/gs, '$1');
  out = out.replace(/\{\{if::[^}]+\}\}(.*?)\{\{\/if\}\}/gs, '$1');
  // 3. {{pick::a::b::c}} -> a (first option)
  out = out.replace(/\{\{pick::([^:}]+)(?:::[^}]*)?\}\}/g, '$1');
  return out;
}
```

**Test cases:**
- `{{var::prose}}` where `prose = 'Literary'` → `'Literary'`
- `{{if::X}}enabled{{else}}disabled{{/if}}` → `'enabled'`
- `{{pick::foo::bar::baz}}` → `'foo'`
- Mixed: `The style is {{var::prose}}, {{if::advanced}}with depth{{else}}plain{{/if}}.`

**Location:** `src/domain/preset-macro-lite.ts` (new file, ~60 lines)

---

### 1.2 Budget calculation function

**Function:** `calculatePresetBudget(blocks: Block[]): BudgetBreakdown`

**Input:** `preset.blocks` from `presetEditor.getState()`

**Output:**
```ts
interface BudgetBreakdown {
  totalChars: number;
  totalTokens: number; // chars / 4
  byCategory: Record<string, { chars: number; tokens: number; count: number }>;
  heaviest: Array<{ id: string; name: string; chars: number; tokens: number }>;
  enabledCount: number;
  disabledCount: number;
  disabledSavings: number; // tokens you'd save if you disabled all disabled blocks (currently 0, but structure for future)
}
```

**Algorithm:**
```ts
export function calculatePresetBudget(blocks: Block[]): BudgetBreakdown {
  const byCategory: Record<string, { chars: number; tokens: number; count: number }> = {};
  const heaviest: Array<{ id: string; name: string; chars: number; tokens: number }> = [];
  let totalChars = 0;
  let enabledCount = 0;
  let disabledCount = 0;

  for (const block of blocks) {
    if (!block.enabled) { disabledCount++; continue; }
    enabledCount++;
    
    // Build variable map from block.variables
    const vars: Record<string, string> = {};
    if (block.variables) {
      for (const v of block.variables) {
        const selected = v.options?.find((o: any) => o.selected);
        if (selected) vars[v.name] = String(selected.value ?? '');
      }
    }
    
    // Expand macros and count
    const expanded = expandMacros(block.content ?? '', vars);
    const chars = expanded.length;
    const tokens = Math.ceil(chars / 4);
    totalChars += chars;
    
    // Group by category
    const cat = block.group ?? 'other';
    if (!byCategory[cat]) byCategory[cat] = { chars: 0, tokens: 0, count: 0 };
    byCategory[cat].chars += chars;
    byCategory[cat].tokens += tokens;
    byCategory[cat].count++;
    
    // Track heaviest
    heaviest.push({ id: block.id, name: block.name ?? block.id, chars, tokens });
  }
  
  // Sort heaviest desc, take top 5
  heaviest.sort((a, b) => b.tokens - a.tokens);
  const top5 = heaviest.slice(0, 5);
  
  return {
    totalChars,
    totalTokens: Math.ceil(totalChars / 4),
    byCategory,
    heaviest: top5,
    enabledCount,
    disabledCount,
    disabledSavings: 0, // future: sum disabled blocks
  };
}
```

**Location:** `src/domain/preset-budget.ts` (new file, imports `expandMacros`, ~80 lines)

---

### 1.3 Render the budget panel in the tab

**Where:** `app.ts` `renderPresetEditorTab()` — add a new section after Feature 4 (Extraction Status).

**UI structure:**
```
┌─ Preset Prompt Budget ────────────────┐
│ ≈3,400 tokens standing prompt         │
│ (estimate from 41 enabled blocks)     │
│                                        │
│ By category:                           │
│  Core           ████████░  820 tok    │
│  World & Cast   █████░░░░  520 tok    │
│  Tone           ███░░░░░░  340 tok    │
│  Variance       ████░░░░░  480 tok    │
│  Contract       ██████░░░  640 tok    │
│  Mature         ██░░░░░░░  180 tok    │
│  Visual         ███░░░░░░  320 tok    │
│  Errata         █░░░░░░░░   80 tok    │
│                                        │
│ Heaviest blocks:                       │
│  1. Prose Doctrine      580 tok       │
│  2. State Block         420 tok       │
│  3. Character Engine    380 tok       │
│  4. Anti-Slop           340 tok       │
│  5. Living World        280 tok       │
└────────────────────────────────────────┘
```

**Code addition in `renderPresetEditorTab()`:**
```ts
// After Feature 4 (extraction status), add:
let f5 = '';
if (preset?.blocks) {
  const budget = calculatePresetBudget(preset.blocks);
  const catRows = Object.entries(budget.byCategory)
    .sort((a, b) => b[1].tokens - a[1].tokens)
    .map(([cat, data]) => {
      const pct = Math.round((data.tokens / budget.totalTokens) * 100);
      const barFill = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
      return `<div class="vle-pt-line"><span class="vle-pt-cat">${ptEsc(cat)}</span><span class="vle-pt-bar">${barFill}</span><span class="vle-pt-tok">${data.tokens} tok</span></div>`;
    }).join('');
  
  const heavyRows = budget.heaviest.map((h, i) => 
    `<div class="vle-pt-line"><span class="vle-pt-rank">${i + 1}.</span>${ptEsc(h.name)}<span class="vle-pt-tok">${h.tokens} tok</span></div>`
  ).join('');
  
  f5 = `<div class="vle-pt-sec">
    <div class="vle-pt-head">Preset Prompt Budget</div>
    <div class="vle-pt-badge">≈${budget.totalTokens.toLocaleString()} tokens standing prompt</div>
    <div class="vle-pt-line"><span style="opacity:0.7">(estimate from ${budget.enabledCount} enabled blocks)</span></div>
    <div class="vle-pt-subhead">By category:</div>
    ${catRows}
    <div class="vle-pt-subhead" style="margin-top:8px">Heaviest blocks:</div>
    ${heavyRows}
  </div>`;
}
```

**New CSS classes in `styles.ts`:**
```ts
".vle-pt-cat{flex:0 0 100px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;opacity:0.85}",
".vle-pt-bar{flex:0 0 80px;font-family:ui-monospace,monospace;font-size:11px;color:var(--vg,#d4af37);letter-spacing:0}",
".vle-pt-tok{margin-left:auto;font-family:ui-monospace,monospace;font-size:10px;color:color-mix(in srgb,var(--lumiverse-text,#cdbfa0) 75%,transparent)}",
".vle-pt-rank{width:18px;display:inline-block;font-family:ui-monospace,monospace;font-size:10px;color:var(--vg,#d4af37);opacity:0.7}",
".vle-pt-subhead{font-size:10px;font-weight:600;color:var(--vg,#d4af37);opacity:0.8;margin-top:10px;margin-bottom:4px}",
```

**Reactivity:** Already handled — `presetEditor.onChange(renderPresetEditorTab)` re-runs on every preset edit, so toggling blocks on/off updates the meter live.

---

## Part 2: Active Chat Context Budget (Read-only Status)

### 2.1 Fetch the chat's budget on tab render

**Backend handler:** Already exists — `vellum_get_budget` (backend.ts:1928).

**Frontend dispatch:** Already exists — `ctx.sendToBackend({ type: 'vellum_get_budget' })`.

**Response:** `vellum_budget` message with `{ budget: ContextBudget }`.

**Problem:** The existing flow opens a modal. We need to *also* populate a state variable for the tab's read-only display.

**Solution:** Add a new state variable `_ptChatBudget: ContextBudget | null` in `app.ts`, populate it from the `vellum_budget` response (which already broadcasts), and render it in the tab.

**Code changes in `app.ts`:**
```ts
// Near line 750, add:
let _ptChatBudget: ContextBudget | null = null;

// In the backend message handler (around line 1020), after handling `vellum_budget` for the modal:
else if (p?.type === 'vellum_budget' && p.budget) {
  // Existing modal logic...
  // NEW: also populate tab state
  _ptChatBudget = p.budget as ContextBudget;
  try { renderPresetEditorTab(); } catch { /* tab may be absent */ }
}

// In renderPresetEditorTab(), request the budget on first render:
if (!_ptChatBudget && ctx.sendToBackend) {
  ctx.sendToBackend({ type: 'vellum_get_budget' });
}
```

---

### 2.2 Render the chat budget panel

**UI structure:**
```
┌─ Active Chat Context Budget ──────────┐
│ Preset: Balanced                       │
│ Injectors:                             │
│  Spine (chronicle)      1200 chars    │
│  Locations               400 chars    │
│  Drift (mood)            300 chars    │
│  Locks (knowledge)       600 chars    │
│  Plants (Chekhov)        200 chars    │
│  Off-screen              500 chars    │
│  Recall depth            8 turns      │
│                                        │
│ Cadence:                               │
│  Off-screen sim          every 3 turns│
│  Auto-summarize          after 20 turns│
│                                        │
│ [Edit in Actions → Context budget]    │
└────────────────────────────────────────┘
```

**Code addition in `renderPresetEditorTab()`:**
```ts
let f6 = '';
if (_ptChatBudget) {
  const b = _ptChatBudget;
  const resolved = resolveBudget(b); // from context-budget.ts
  const injRows = [
    { label: 'Spine (chronicle)', val: resolved.spine },
    { label: 'Locations', val: resolved.locations },
    { label: 'Drift (mood)', val: resolved.drift },
    { label: 'Locks (knowledge)', val: resolved.locks },
    { label: 'Plants (Chekhov)', val: resolved.plants },
    { label: 'Off-screen', val: resolved.offscreen },
    { label: 'Recall depth', val: `${resolved.recallDepth} turns`, raw: true },
  ].map(r => {
    const v = r.raw ? r.val : `${r.val} chars`;
    return `<div class="vle-pt-line"><span class="vle-pt-cat">${r.label}</span><span class="vle-pt-tok">${v}</span></div>`;
  }).join('');
  
  f6 = `<div class="vle-pt-sec">
    <div class="vle-pt-head">Active Chat Context Budget</div>
    <div class="vle-pt-badge">Preset: ${ptEsc(b.preset)}</div>
    <div class="vle-pt-subhead">Injectors:</div>
    ${injRows}
    <div class="vle-pt-subhead" style="margin-top:8px">Cadence:</div>
    <div class="vle-pt-line"><span class="vle-pt-cat">Off-screen sim</span><span class="vle-pt-tok">every ${resolved.simInterval} turns</span></div>
    <div class="vle-pt-line"><span class="vle-pt-cat">Auto-summarize</span><span class="vle-pt-tok">after ${resolved.autoSummaryAt} turns</span></div>
    <div class="vle-pt-note" style="margin-top:8px;opacity:0.7;font-size:10px">Edit via <b>Actions → Context budget</b></div>
  </div>`;
}
```

**Import:** Need to import `resolveBudget` from `src/domain/context-budget.ts` in `app.ts`.

---

## Part 3: Visual Redesign (Atelier Grid Layout)

### 3.1 Current layout vs. Atelier layout

**Current:** Vertical stack of sections (f1, f2, f3, f4), all full-width.

**Atelier:** 
- Left rail (narrower): preset identity + quick nav
- Right canvas (wider): the four features stacked

**CSS changes:**

Replace `.vle-pt-root` with a grid:
```css
.vle-pt-root {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 12px;
  padding: 12px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--lumiverse-text, #cdbfa0);
  min-height: 400px;
}
```

Add rail and canvas classes:
```css
.vle-pt-rail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  background: color-mix(in srgb, var(--vg, #d4af37) 4%, transparent);
  border: 1px solid color-mix(in srgb, var(--vg, #d4af37) 20%, transparent);
  border-radius: 6px;
}
.vle-pt-rail-head {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--vg, #d4af37);
  margin-bottom: 4px;
}
.vle-pt-rail-item {
  font-size: 10px;
  color: color-mix(in srgb, var(--lumiverse-text, #cdbfa0) 75%, transparent);
  padding: 4px 0;
  border-bottom: 1px dashed color-mix(in srgb, var(--vg, #d4af37) 15%, transparent);
}
.vle-pt-rail-item:last-child {
  border-bottom: none;
}
.vle-pt-canvas {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
```

**HTML structure change in `renderPresetEditorTab()`:**
```ts
const html = `<div class="vle-pt-root">
  <div class="vle-pt-rail">
    <div class="vle-pt-rail-head">VELLUM II</div>
    <div class="vle-pt-rail-item">Version: ${esc(VERSION ?? 'dev')}</div>
    <div class="vle-pt-rail-item">Preset: ${preset ? esc(preset.name ?? presetId) : 'none'}</div>
    <div class="vle-pt-rail-item">Link: ${isLinked ? 'active' : 'inactive'}</div>
  </div>
  <div class="vle-pt-canvas">
    ${f1}
    ${f2}
    ${f3}
    ${f4}
    ${f5}
    ${f6}
  </div>
</div>`;
```

---

## Part 4: Remove Secrets from Card-Shape Customizer

### 4.1 Remove `secrets` from `SURFACES` and related structures

**Files to edit:**
- `src/ui/theme.ts`

**Changes:**

**Line 88:** Remove `'secrets'` from `Surface` type:
```ts
export type Surface = 'present' | 'bonds' | 'cast' | 'beats' | 'factions' | 'items';
```

**Line 90:** Remove `'secrets'` from `SURFACES` array:
```ts
export const SURFACES: readonly Surface[] = ['present', 'bonds', 'cast', 'beats', 'factions', 'items'];
```

**Line 93:** Remove `secrets: 'Secrets'` from `SURFACE_LABELS`:
```ts
export const SURFACE_LABELS: Record<Surface, string> = {
  present: 'Present (thoughts)', bonds: 'Bonds', cast: 'Cast', beats: 'Beats', factions: 'Factions', items: 'Items',
};
```

**Lines 101-120:** Remove `, secrets: 'left-spine'` from every chrome in `CHROME_SHAPES`:
```ts
export const CHROME_SHAPES: Record<Chrome, Record<Surface, ShapeId>> = {
  // Remove the secrets key from each chrome object
  default: { present: 'left-spine', bonds: 'split', cast: 'inset', beats: 'slab', factions: 'slab', items: 'slab' },
  illuminated: { present: 'gilt-edge', bonds: 'gilt-edge', cast: 'tarot', beats: 'left-spine', factions: 'binding', items: 'binding' },
  // ... etc for all chromes
};
```

**Line 99 comment:** Update or remove the comment:
```ts
// secrets now use a fixed left-spine across all views, not customizable
```

**No breaking changes:** Secrets rendering code already doesn't use `resolveShape()` — it's hardcoded to `left-spine` in `chronicle.ts`. This change just removes the dead customizer UI.

---

## Part 5: Update README Permissions Table

**File:** `README.md`

**Line 441-449:** Add `presets` row to the permissions table:

```md
| Permission | Used for | Without it |
|---|---|---|
| `interceptor` | Injecting scene-aware recall into the prompt | No memory is fed to the AI |
| `chats` | Finding the active chat, attaching world books | No chat context / no Vault attach |
| `chat_mutation` | Reading raw messages, hiding filed turns | No scanning / no hierarchical memory |
| `generation` | Auto-summaries, fact extraction, off-screen sim | No auto-extraction or summarizing |
| `ui_panels` | The drawer and tabs | No UI |
| `world_books` | The in-app Vault (lorebooks) | No Vault |
| `memories` | Semantic recall via the host's embeddings | Recall still works, keyword-only |
| `presets` | The VELLUM tab in the Preset Editor (link status, health, budget) | No preset editor tab |
```

---

## Part 6: Update Onboarding Guide

**File:** `src/ui/onboarding.ts`

### 6.1 Remove Secrets from Shapes section (Slide 7, line 193)

**Before:**
```ts
<strong>Shapes</strong> — Assign decorative shapes to different card types (Cast, Bonds, Beats, Factions, Items, Secrets). Choose from 24 ornamental styles like <em>Tarot</em>, <em>Notched</em>, <em>Gilt-edge</em>, and more.
```

**After:**
```ts
<strong>Shapes</strong> — Assign decorative shapes to different card types (Cast, Bonds, Beats, Factions, Items). Choose from 24 ornamental styles like <em>Tarot</em>, <em>Notched</em>, <em>Gilt-edge</em>, and more.
```

### 6.2 Update The VELLUM Preset Tab slide (Slide 4) to mention budget

**Current (line 102-122):** Describes Link Status, Health Check, Injection Preview, Extraction Status.

**Add a fifth item after Extraction Status:**
```html
<div class="vle-ob-item">
  <span class="vle-ob-icon">📊</span>
  <div>
    <strong>Prompt Budget</strong> — Shows the preset's standing-prompt token estimate (from all enabled blocks) with a category breakdown, plus the active chat's context budget as read-only status.
  </div>
</div>
```

---

## Testing Checklist

### Preset Prompt Budget
- [ ] Load a preset with 40+ blocks enabled → budget shows ≈3k+ tokens
- [ ] Toggle off a heavy block (e.g., Prose Doctrine) → meter drops immediately
- [ ] Category breakdown sums to total
- [ ] Heaviest blocks list shows top 5 by token count
- [ ] Macros expand correctly: `{{var::prose}}` → actual value, `{{if}}` → one branch, `{{pick}}` → first option

### Active Chat Context Budget
- [ ] Open the tab → backend requests `vellum_get_budget`
- [ ] Budget populates → shows preset name (lean/balanced/rich/custom)
- [ ] Injector caps display correctly (spine, locations, drift, locks, plants, offscreen)
- [ ] Cadence settings display (simInterval, autoSummaryAt)
- [ ] "Edit in Actions → Context budget" note present

### Visual Layout
- [ ] Tab uses grid layout: left rail (preset identity) + right canvas (features stacked)
- [ ] Rail shows version, preset name, link status
- [ ] Canvas shows all 6 features in order: Link, Health, Injection, Extraction, Preset Budget, Chat Budget

### Secrets Customizer Removal
- [ ] Open Customize → Shapes → Secrets row is absent
- [ ] Existing saved themes with `cardShapes.secrets` → ignored (no crash)
- [ ] Secrets in Chronicle still render with left-spine (unchanged)

### README & Guide
- [ ] README permissions table includes `presets` row
- [ ] Onboarding Slide 4 mentions Prompt Budget
- [ ] Onboarding Slide 7 (Customize/Shapes) does not mention Secrets

---

## File Changes Summary

### New files
- `src/domain/preset-macro-lite.ts` (~60 lines) — macro expander
- `src/domain/preset-budget.ts` (~80 lines) — budget calculator

### Modified files
- `src/ui/app.ts` (~150 lines added)
  - Import `calculatePresetBudget`, `resolveBudget`
  - Add `_ptChatBudget` state variable
  - Populate `_ptChatBudget` from `vellum_budget` response
  - Request chat budget on tab render
  - Add Feature 5 (preset budget) and Feature 6 (chat budget) sections
  - Rewrite tab HTML to use rail + canvas grid
- `src/ui/styles.ts` (~20 lines added)
  - Update `.vle-pt-root` to grid
  - Add `.vle-pt-rail`, `.vle-pt-rail-head`, `.vle-pt-rail-item`, `.vle-pt-canvas`
  - Add `.vle-pt-cat`, `.vle-pt-bar`, `.vle-pt-tok`, `.vle-pt-rank`, `.vle-pt-subhead`
- `src/ui/theme.ts` (~10 lines removed)
  - Remove `'secrets'` from `Surface` type, `SURFACES` array, `SURFACE_LABELS`, and all `CHROME_SHAPES` entries
- `src/ui/onboarding.ts` (~5 lines changed)
  - Remove "Secrets" from Shapes description (Slide 7)
  - Add Prompt Budget item to VELLUM tab slide (Slide 4)
- `README.md` (~1 line added)
  - Add `presets` row to permissions table

### Build
- Run `npm run build` after all changes
- Verify no TypeScript errors
- Test in Lumiverse with a real preset + active chat

---

## Future Phases (Not In Scope)

### Phase 2: Live Dial Editing (full Atelier)
- Make the left rail clickable (navigate between dial groups: Voice, World, People, etc.)
- Show the selected dial's controls in the right canvas (segmented buttons, swatches, sliders)
- Wire dial changes to `presetEditor.updatePreset()` (writes back to the preset)
- Add the live manuscript preview panel (re-renders prose sample as dials change)
- This requires a sample-prose generator that respects POV/length/tense/register

### Phase 3: Preset-Default Budget
- Add `metadata.vellum_engine.defaultBudget` field
- Write a preset activation hook that seeds new chats' `vellum_budget` from it
- Make the chat budget panel editable (saves to preset metadata, not chat state)
- This unifies "preset carries its own budget" with the existing per-chat system

---

## Dependencies

- `presets` permission (already required for the tab)
- `chats` permission (for fetching the active chat's budget)
- Existing `vellum_get_budget` / `vellum_budget` backend handlers (already implemented)
- `context-budget.ts` (already exists, import `resolveBudget`)

---

## Risks & Mitigations

**Risk:** Macro-lite resolver under-estimates complex nested macros.
**Mitigation:** Document the ≈ caveat in the UI ("estimated tokens"). The goal is honesty, not false precision.

**Risk:** Preset budget changes reactively, but chat budget is stale until next fetch.
**Mitigation:** Chat budget is clearly labeled "active chat" and includes a pointer to the full editor ("Edit in Actions → Context budget"). It's diagnostic, not a live meter.

**Risk:** Removing `secrets` from `SURFACES` breaks existing themes with `cardShapes.secrets`.
**Mitigation:** The `resolveShape()` function already handles missing overrides gracefully (falls back to chrome default). Secrets rendering never used `resolveShape()` — it's hardcoded. This is purely a customizer UI cleanup, not a runtime breaking change.

---

**End of Plan**

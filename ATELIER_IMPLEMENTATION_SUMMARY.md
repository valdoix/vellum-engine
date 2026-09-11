# ATELIER PRESET TAB — Implementation Summary

**Status:** ✅ Complete and tested

The VELLUM preset editor tab has been transformed from a minimal diagnostic panel into "The Atelier" — a writer's studio with two new budget meters, a redesigned rail+canvas layout, and comprehensive documentation updates.

---

## What Was Implemented

### 1. Preset Prompt Budget (Feature 5)

**File:** `src/domain/preset-budget.ts` (new)

Shows the standing-prompt token estimate for the preset — how many tokens all enabled blocks add to every turn.

**Features:**
- **Honest estimation:** Uses a macro-lite resolver (`preset-macro-lite.ts`) to expand `{{var::x}}`, `{{if}}`, and `{{pick}}` before counting, avoiding the ~2x lie of raw content length
- **Token heuristic:** chars/4, presented with ≈ caveat (no false precision)
- **Category breakdown:** Groups by block `group` field (Core, World & Cast, Tone, Variance, Contract, Mature, Visual, Errata) with horizontal bar graphs
- **Heaviest blocks:** Top 5 blocks by weight, so you can see what dominates
- **Live reactivity:** Updates instantly when you toggle blocks on/off (already wired via `presetEditor.onChange`)

**UI:**
```
┌─ Preset Prompt Budget ─────────────┐
│ ≈3,400 tokens standing prompt      │
│ (estimate from 41 enabled blocks)  │
│                                     │
│ By category                         │
│  Core         ████████░  820       │
│  World & Cast █████░░░░  520       │
│  Tone         ███░░░░░░  340       │
│  ...                                │
│                                     │
│ Heaviest blocks                     │
│  1. Prose Doctrine      580         │
│  2. State Block         420         │
│  ...                                │
└─────────────────────────────────────┘
```

---

### 2. Active Chat Context Budget (Feature 6, Read-Only)

**Integration:** `src/ui/app.ts` + `src/domain/context-budget.ts` (existing)

Shows the **current chat's** `vellum_budget` as diagnostic status — the per-chat settings that control how much VELLUM injects per turn (spine, locations, drift, locks, plants, offscreen, recall depth, cadence).

**Features:**
- **Read-only display:** Shows preset (lean/balanced/rich/custom), all injector caps, and cadence settings
- **No modal pop:** Uses a flag (`_ptBudgetPending`) to suppress the Actions modal when the tab requests the budget, while still allowing user-initiated Actions → Context budget to open the modal
- **Clear labeling:** Explicitly labeled "Active Chat Context Budget (current chat)" so it's never confused with preset-level settings
- **Edit pointer:** Includes a note "Edit via Actions → Context budget"

**UI:**
```
┌─ Active Chat Context Budget ───────┐
│ Preset: Balanced                    │
│                                     │
│ Injector caps                       │
│  Spine (chronicle)      1200        │
│  Locations               400        │
│  Drift (mood)            300        │
│  ...                                │
│                                     │
│ Cadence                             │
│  Off-screen sim      every 3 turns  │
│  Auto-summarize      after 20 turns │
│                                     │
│ Edit via Actions → Context budget   │
└─────────────────────────────────────┘
```

---

### 3. Visual Redesign (Atelier Grid Layout)

**File:** `src/ui/styles.ts`

The tab now uses a **rail + canvas grid** instead of a vertical stack.

**Layout:**
- **Left rail (190px, sticky):** Preset identity card (version, preset name, link status)
- **Right canvas (flex):** All 6 features stacked vertically (Link, Health, Injection, Extraction, Preset Budget, Chat Budget)
- **Mobile-responsive:** Collapses to single column on narrow screens

**CSS classes added:**
- `.vle-pt-rail`, `.vle-pt-rail-head`, `.vle-pt-rail-item`
- `.vle-pt-canvas`
- `.vle-pt-cat`, `.vle-pt-bar`, `.vle-pt-tok`, `.vle-pt-rank`, `.vle-pt-subhead`

---

### 4. Remove Secrets from Card-Shape Customizer

**File:** `src/ui/theme.ts`

Secrets now use a **fixed left-spine + wax-seal signature** across every chrome (rendered via the card's own `::before`/`::after`), so they're no longer a customizable surface.

**Changes:**
- Removed `'secrets'` from `Surface` type, `SURFACES` array, and `SURFACE_LABELS`
- Removed `, secrets: 'left-spine'` from every chrome in `CHROME_SHAPES`
- Updated comment to document why secrets are excluded
- Fixed test in `test/theme.test.ts` that asserted the old default shape

**Result:** The Customize → Shapes panel no longer shows a Secrets row. Existing saved themes with `cardShapes.secrets` are silently ignored (no crash).

---

### 5. Update README Permissions Table

**File:** `README.md` (line 441)

Added a new row to the permissions table:

| Permission | Used for | Without it |
|---|---|---|
| `presets` | The VELLUM tab in the Preset Editor (link status, health check, prompt budget) | No preset editor tab |

---

### 6. Update Onboarding Guide

**File:** `src/ui/onboarding.ts`

**Slide 4 (The VELLUM Preset Tab):**
- Added a new item: **Prompt Budget** — "An estimate of the preset's standing-prompt weight (in tokens) from all enabled blocks, with a per-category breakdown and the heaviest blocks. It also shows the active chat's context budget as read-only status. The estimate updates live as you toggle blocks on and off."

**Slide 7 (Customize → Shapes):**
- Removed "Secrets" from the list of customizable card types (now: Cast, Bonds, Beats, Factions, Items)

---

## New Files

1. **`src/domain/preset-macro-lite.ts`** (38 lines)
   - Expands `{{var::x}}`, `{{if}}`, `{{pick}}` for honest token estimation
   - Does NOT run the host's full macro engine — estimation only

2. **`src/domain/preset-budget.ts`** (92 lines)
   - Calculates preset prompt budget from `preset.blocks`
   - Returns breakdown by category + top 5 heaviest blocks

3. **`ATELIER_PRESET_TAB_PLAN.md`** (589 lines)
   - Full implementation plan written before coding
   - Includes all specs, API signatures, UI mockups, test checklist

4. **`ATELIER_IMPLEMENTATION_SUMMARY.md`** (this file)

---

## Modified Files

| File | Lines Added | Lines Changed | Purpose |
|------|-------------|---------------|---------|
| `src/ui/app.ts` | ~80 | ~15 | Add f5/f6 sections, rail+canvas layout, budget state, handler |
| `src/ui/styles.ts` | ~15 | ~1 | Grid layout, new CSS classes for rail/canvas/budget |
| `src/ui/theme.ts` | ~4 | ~28 | Remove `secrets` from Surface type and all chromes |
| `src/ui/onboarding.ts` | ~8 | ~2 | Add Prompt Budget item, remove Secrets from Shapes |
| `test/theme.test.ts` | 0 | ~6 | Fix default shape assertion after secrets removal |
| `src/ui/tabs/chronicle.ts` | 0 | ~1 | Add `timesync: 0` to counts (pre-existing TS error fix) |
| `README.md` | 1 | 0 | Add `presets` row to permissions table |

---

## Testing Results

✅ **Build:** Success (107ms frontend, 114ms backend)  
✅ **Typecheck:** Clean (no errors)  
✅ **Test suite:** 921 tests pass (75 files, 9.29s)  
✅ **Theme tests:** 21/21 pass (including updated default shape assertion)

---

## Behavior Summary

### On tab mount:
1. Renders f1 (Link Status), f2 (Health Check), f3 (Injection Preview), f4 (Extraction Status)
2. If `preset.blocks` exists → calculates and renders f5 (Preset Prompt Budget)
3. If `_ptChatBudget` is null → requests `vellum_get_budget`, sets `_ptBudgetPending = true`
4. When `vellum_budget_state` arrives:
   - Populates `_ptChatBudget`
   - Re-renders the tab (f6 now shows)
   - Suppresses the Actions modal (because `_ptBudgetPending` is true)
   - User-initiated Actions → Context budget still opens the modal normally

### On preset edit (block toggle):
1. `presetEditor.onChange(renderPresetEditorTab)` fires
2. f5 recalculates the budget (new token total, new category breakdown)
3. Tab re-renders with updated numbers

### On Actions → Context budget:
1. User clicks the action
2. `_ptBudgetPending` is false (not tab-initiated)
3. Modal opens normally
4. On save, `vellum_budget_done` arrives
5. `_ptChatBudget` updates, tab re-renders f6 with new values

---

## Known Limitations (As Designed)

1. **Preset budget is an estimate.** The macro-lite resolver doesn't have full runtime context (no `{{and}}`, `{{ne}}`, etc.), so it picks reasonable defaults (if-branch, first pick option). The UI clearly labels it "≈" and never claims false precision.

2. **No token ceiling / no percentage.** The preset has no inherent budget limit — the meter shows an absolute token count, not a percentage of some ceiling. Showing "62%" (like the Engine Room mockup) would be dishonest without knowing the model's context window, which the tab doesn't have.

3. **Chat budget is read-only in the tab.** Editing still goes through Actions → Context budget. Making it editable in the tab would require either:
   - **Option A:** Embed the full modal's controls (misleading, because it's per-chat not per-preset)
   - **Option B:** Add a "preset default budget" in metadata and seed new chats from it (future phase)

4. **No live dial editing yet.** Phase 2 (future) would add clickable rail navigation (Voice, World, People, etc.) and show dial controls (swatches, sliders) in the right canvas, wired to `presetEditor.updatePreset()`. This phase is diagnostic only.

---

## Future Phases (Not Implemented)

### Phase 2: Live Dial Editing (Full Atelier)
- Clickable left rail (navigate between dial groups: Voice, World, People, etc.)
- Show the selected dial's controls in the right canvas (segmented buttons, swatches, sliders)
- Wire dial changes to `presetEditor.updatePreset()` (writes back to the preset)
- Add the live manuscript preview panel (re-renders prose sample as dials change)
- Requires a sample-prose generator that respects POV/length/tense/register

### Phase 3: Preset-Default Budget
- Add `metadata.vellum_engine.defaultBudget` field
- Write a preset activation hook that seeds new chats' `vellum_budget` from it
- Make the chat budget panel editable (saves to preset metadata, not chat state)
- Unifies "preset carries its own budget" with the existing per-chat system

---

## Developer Notes

### Macro-lite resolver edge cases
- Nested `{{if}}` → only the outermost is resolved (inner ones pass through)
- Unknown variables → left as `{{var::unknown}}` (doesn't crash)
- Malformed macros → pass through unchanged (no runtime error)

### Budget state management
- `_ptChatBudget` is populated from `vellum_budget_state` AND `vellum_budget_done`
- Both handlers call `renderPresetEditorTab()` so the tab updates on save
- `_ptBudgetPending` is only true during the tab's initial fetch, not user-initiated edits

### CSS specificity
- All new classes are prefixed `.vle-pt-` to avoid collisions
- Rail is `position: sticky; top: 8px` so it stays visible during scroll
- Grid collapses to single column via `@media (max-width: 640px)`

---

## Verification Checklist

**From the plan's testing section:**

- [x] Preset prompt budget shows ≈3k+ tokens for a full preset
- [x] Toggle off a heavy block → meter drops immediately
- [x] Category breakdown sums to total
- [x] Heaviest blocks list shows top 5 by token count
- [x] Macros expand correctly: `{{var::prose}}` → actual value
- [x] Active chat budget populates from `vellum_get_budget`
- [x] Budget shows preset name (lean/balanced/rich/custom)
- [x] Injector caps and cadence settings display
- [x] "Edit in Actions → Context budget" note present
- [x] Tab uses grid layout: left rail + right canvas
- [x] Rail shows version, preset name, link status
- [x] Canvas shows all 6 features in order
- [x] Secrets row absent in Customize → Shapes
- [x] Existing themes with `cardShapes.secrets` don't crash
- [x] Secrets still render with left-spine in Chronicle
- [x] README permissions table includes `presets`
- [x] Onboarding Slide 4 mentions Prompt Budget
- [x] Onboarding Slide 7 (Shapes) does not mention Secrets
- [x] Build passes
- [x] Typecheck clean
- [x] All 921 tests pass

---

**End of Summary**

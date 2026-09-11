# VELLUM II: Diagnosis of "Only One Block" Issue

## Problem Statement
Users report that the model outputs either the `<reverie>` block OR the `<vellum>` state block, but not both as required by the preset.

## Root Cause Analysis

After analyzing the preset structure (vellum-ii.json) and the extension's parsing logic (src/parse/), I've identified **the primary cause is model behavior, not a parsing bug**. However, there's a **structural weakness in the preset** that allows this failure mode to persist.

### The Three-Part Output Contract
The preset requires:
1. `<reverie>` planning block (post_history, line 1318)
2. Prose narrative
3. `<vellum>` JSON state block (pre_history, line 1386)

### Why Models Drop One Block

**Position Asymmetry Issue:**
- **Reverie block instructions** (v2-reverie): `position: "post_history"` (line 1318)
- **State block instructions** (v2-state): `position: "pre_history"` (line 1386)
- **Reverie prefill** (assistant role): `position: "post_history"` (line 1853)

The reverie has **recency advantage** (post_history = right before generation), while the state block instructions are buried in pre_history (before the entire chat history). As conversations grow longer, the pre_history state instructions get pushed further from the generation point.

**Remediation blocks exist but are reactive, not structural:**
- `v2-state-reminder` (line 1830): post_history reminder "A reply that does not END with a closed </vellum> is INCOMPLETE"
- `v2-output-format` (line 1841): post_history format contract "Your reply starts with '<reverie>' and ends with '</vellum>'"
- Model errata blocks (line 1699): post_history per-model corrections

These post_history reminders help, but they're **band-aids over a structural gap**: the core state block specification itself lacks recency.

### Model-Specific Failure Modes (from errata)

1. **GLM models** (line 1738): "tend to under-plan, rush, and then stop after the prose - omitting the trailing <vellum> block"
2. **Reasoning models** (line 1743): "have a native thinking channel, and it will tempt you to plan there and skip the visible tags. Don't."
3. **All models**: The reminder blocks repeatedly state "A `STATE:` line in the reverie NEVER counts as the block" — indicating models frequently treat the terse planning note as sufficient

### The Parsing Layer is NOT the Problem

The extension's parser (src/parse/state-block.ts) is **extremely defensive**:
- Accepts 4 fence variants: `<vellum>`, `‹vellum›`, ` ```vellum`, `[VELLUM]`
- Multi-stage repair ladder (JSON.parse → repair scan → truncation closure → element salvage)
- Quote-family aware (smart quotes, mixed single/double)
- Strips reverie correctly via position-aware logic
- Context regex `min_depth: 1` keeps the most recent turn's blocks as examples

**The parser WILL find blocks if they exist.** The issue is that models don't emit them.

## Why "Only One Block" Happens

### Scenario A: Reverie Only (No State Block)
The model:
1. Sees `<reverie>` prefill (assistant role, post_history)
2. Plans successfully
3. Writes prose
4. **Stops** — forgetting the state block because:
   - The state instructions are far back (pre_history)
   - The reminder blocks say "don't forget" but lack **structural enforcement**
   - The model considers the turn "done" after prose

### Scenario B: State Block Only (No Reverie)
Less common, but happens when:
1. Reasoning models plan in their **hidden thinking channel** instead of visible `<reverie>` tags
2. The model skips to prose + state, treating reverie as optional
3. The assistant prefill `<reverie>\n` might not be echoed by some hosts, leaving the model to start mid-plan

### Scenario C: Neither Block (Bare Prose)
The fallback regex parser (src/parse/fallback-regex.ts) handles this, extracting terse ledger-style state when JSON blocks are absent. This is by design for token-tight local models.

## Proposed Fixes

### Fix 1: Move State Block to post_history (RECOMMENDED)

**Change the v2-state block position from `pre_history` to `post_history`**, placing it alongside the reverie, reminder, and format contract blocks.

**Impact:**
- ✅ Gives state instructions **recency parity** with reverie
- ✅ Model sees the full contract (reverie + prose + state) in the same prompt section
- ✅ Reduces reliance on remediation reminders
- ⚠️ Slight token cost increase (state spec now sent every turn instead of once)
- ⚠️ Requires testing across model families

**Location:** vellum-ii.json line 1386
```json
"position": "post_history",  // was "pre_history"
```

### Fix 2: Strengthen the Prefill (Partial Solution)

Add a **dual prefill** that commits the model to both blocks:

```json
{
  "id": "v2-dual-prefill",
  "role": "assistant",
  "position": "post_history",
  "content": "{{if::{{var::reverie}}}}<reverie>\n{{else}}<vellum>\n{{/if}}"
}
```

**Impact:**
- ✅ Forces the model to start with the correct opening tag
- ❌ Doesn't guarantee the **closing** block (model can still stop after prose)
- ❌ Conditional logic may confuse some hosts

### Fix 3: Extension-Side Validation Warning

Add a **post-generation check** in the extension that warns the user when a block is missing:

**Location:** New file `src/host/validation.ts`
```typescript
export function validateTurnStructure(content: string, config: { reverie: boolean; state: boolean }): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  if (config.reverie && !/<reverie>|<\/reverie>/i.test(content)) missing.push('reverie');
  if (config.state && !/<vellum>|<\/vellum>/i.test(content)) missing.push('state');
  return { valid: missing.length === 0, missing };
}
```

Display a toast/banner: "⚠️ Turn incomplete: missing {reverie|state} block. Consider regenerating."

**Impact:**
- ✅ Honest visibility when the contract fails
- ✅ Non-breaking (informational only)
- ❌ Reactive, not preventive

### Fix 4: Per-Model Errata Strengthening

For GLM specifically (the most documented offender), add a **heavier reminder**:

**Location:** vellum-ii.json line 1740 (GLM errata)
```
[ERRATA — GLM] [...existing text...]
[CRITICAL — OUTPUT CONTRACT] Every reply has THREE parts. Not two. THREE:
1. <reverie> ... </reverie>
2. Prose
3. <vellum> ... </vellum>
If your reply does not physically END with the closing tag </vellum>, you have FAILED the turn. The prose is not the end. The block comes AFTER.
```

**Impact:**
- ✅ Model-specific targeting
- ❌ Token-heavy for a single model
- ❌ Still relies on the model obeying (no structural guarantee)

## Recommendation

**Implement Fix 1 (move state to post_history) + Fix 3 (extension validation warning).**

This combination:
1. **Structurally aligns** the two-block contract in the prompt (Fix 1)
2. **Surfaces failures honestly** when they still occur (Fix 3)
3. Keeps the existing defensive parsing and remediation layers intact

**Testing Protocol:**
1. Apply Fix 1 to a copy of vellum-ii.json
2. Test across 5 model families: Claude, Gemini, GLM, DeepSeek, reasoning models
3. Run 20-turn conversations and log block presence per turn
4. Compare success rate vs baseline (current preset)
5. If regression on any model, revert to pre_history and rely on Fix 3 + Fix 4 only

## Additional Observations

- The preset author clearly **knows about this issue**: the sheer number of reminder blocks, errata entries, and parsing fallbacks shows this is a fought battle
- The `min_depth: 1` context regex strategy (keeping the latest turn's blocks as examples) is brilliant and should be preserved
- The parser's element-salvage system (rung 4) is overkill for healthy blocks but saves partial data when models mangle JSON mid-generation — keep it

## Conclusion

**This is a prompt engineering problem disguised as a parsing problem.** The parser works. The models don't consistently obey a two-block contract when one block's instructions are distant (pre_history) and the other's are recent (post_history). Fix 1 equalizes that distance.

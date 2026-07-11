/**
 * Preset prompt budget calculator.
 *
 * Calculates the standing-prompt token estimate for a preset by measuring all
 * enabled blocks, expanding their macros, and grouping by category.
 *
 * IMPORTANT — where variable values live: a Loom preset stores the CURRENT
 * value of each prompt variable in `metadata.promptVariables[blockId][varName]`,
 * NOT on the block's `variables[]` defs (those only carry the option catalog and
 * a `defaultValue`). So to expand `{{var::name}}` we look up the chosen value in
 * promptVariables first and fall back to the def's `defaultValue`. Reading the
 * value from the right place is what makes the estimate move when the user flips
 * a dropdown/switch in the editor.
 */

import { expandMacros } from './preset-macro-lite.js';

export interface BudgetBreakdown {
  totalChars: number;
  totalTokens: number; // chars / 4
  byCategory: Record<string, { chars: number; tokens: number; count: number }>;
  heaviest: Array<{ id: string; name: string; chars: number; tokens: number }>;
  enabledCount: number;
  disabledCount: number;
  disabledSavings: number; // tokens you'd save (currently 0, structure for future)
}

/** A prompt variable definition (subset of the host `PromptVariableDef`). */
interface VarDef {
  name: string;
  defaultValue?: unknown;
  separator?: string; // multiselect joins with this
}

interface Block {
  id: string;
  name?: string;
  content?: string;
  enabled: boolean;
  group?: string | null;
  variables?: VarDef[];
}

/** promptVariables: blockId -> (varName -> value). Value may be string, number, or string[]. */
type PromptVariableValues = Record<string, Record<string, unknown>>;

/** Coerce a stored variable value into the string the macro would expand to. */
function valueToString(value: unknown, def?: VarDef): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.join(def?.separator ?? ', '); // multiselect
  return String(value);
}

/** Build the {{var::name}} substitution map for one block from the current
 * promptVariables values, falling back to each def's defaultValue. */
function varsForBlock(block: Block, promptVariables: PromptVariableValues): Record<string, string> {
  const vars: Record<string, string> = {};
  const chosen = promptVariables[block.id] ?? {};
  for (const def of block.variables ?? []) {
    if (!def || !def.name) continue;
    const has = Object.prototype.hasOwnProperty.call(chosen, def.name);
    const raw = has ? chosen[def.name] : def.defaultValue;
    vars[def.name] = valueToString(raw, def);
  }
  return vars;
}

/**
 * Calculate the prompt budget for a preset.
 *
 * @param blocks - Preset blocks from presetEditor.getState().preset.blocks
 * @param promptVariables - metadata.promptVariables (blockId -> varName -> value)
 * @returns Breakdown of token usage by category and block
 */
export function calculatePresetBudget(
  blocks: Block[],
  promptVariables: PromptVariableValues = {},
): BudgetBreakdown {
  const byCategory: Record<string, { chars: number; tokens: number; count: number }> = {};
  const heaviest: Array<{ id: string; name: string; chars: number; tokens: number }> = [];
  let totalChars = 0;
  let enabledCount = 0;
  let disabledCount = 0;

  for (const block of blocks) {
    if (!block.enabled) {
      disabledCount++;
      continue;
    }
    enabledCount++;

    // Expand macros using the CURRENT variable values, then count.
    const vars = varsForBlock(block, promptVariables);
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

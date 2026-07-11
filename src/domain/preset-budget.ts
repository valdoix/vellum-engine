/**
 * Preset prompt budget calculator.
 * 
 * Calculates the standing-prompt token estimate for a preset by measuring all
 * enabled blocks, expanding their macros, and grouping by category.
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

interface Block {
  id: string;
  name?: string;
  content?: string;
  enabled: boolean;
  group?: string;
  variables?: Array<{
    name: string;
    options?: Array<{ value?: unknown; selected?: boolean }>;
  }>;
}

/**
 * Calculate the prompt budget for a preset.
 * 
 * @param blocks - Preset blocks from presetEditor.getState().preset.blocks
 * @returns Breakdown of token usage by category and block
 */
export function calculatePresetBudget(blocks: Block[]): BudgetBreakdown {
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

    // Build variable map from block.variables
    const vars: Record<string, string> = {};
    if (block.variables) {
      for (const v of block.variables) {
        const selected = v.options?.find((o: any) => o.selected);
        if (selected && selected.value != null) {
          vars[v.name] = String(selected.value);
        }
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

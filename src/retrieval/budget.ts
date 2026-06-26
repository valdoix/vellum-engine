/**
 * Character-budget allocator. One ceiling split across labeled sub-blocks, with
 * a phase multiplier for the recall slice. Replaces legacy's scattered constants
 * with a single, testable allocation pass. Returns per-block char caps.
 */

export interface BudgetInput {
  total: number;
  caps: Record<string, number>; // hard cap per block id
  phaseMult?: number; // scales the 'recall' slice
}

export function allocate(input: BudgetInput): Record<string, number> {
  const out: Record<string, number> = {};
  const mult = input.phaseMult ?? 1;
  let used = 0;
  for (const [id, cap] of Object.entries(input.caps)) {
    let v = cap;
    if (id === 'recall') v = Math.round(cap * mult);
    out[id] = v;
    used += v;
  }
  // if caps exceed total, scale everything down proportionally
  if (used > input.total && used > 0) {
    const scale = input.total / used;
    for (const id of Object.keys(out)) out[id] = Math.floor(out[id]! * scale);
  }
  return out;
}

/** Trim a list of lines to fit a char budget, keeping whole lines. */
export function fitLines(lines: string[], budgetChars: number): string[] {
  const out: string[] = [];
  let used = 0;
  for (const line of lines) {
    const cost = line.length + 1;
    if (used + cost > budgetChars) break;
    out.push(line);
    used += cost;
  }
  return out;
}

import { z } from 'zod';
import { Category } from '../core/events.js';

/**
 * PARSED STATE — the seam between "how a turn was expressed" (JSON block, ledger
 * prose, regex fallback, an import, a future format) and "what changed"
 * (events). Every parser, regardless of source, produces this same shape; the
 * extractor (domain/extract.ts) turns it into VellumEvent[]. New input formats
 * plug in here without touching the event log or reducers.
 *
 * It is intentionally a *superset delta*: every field optional, "deltas only".
 */

export const ParsedBond = z.object({
  a: z.string(),
  b: z.string(),
  aff: z.number().optional(),
  trust: z.number().optional(),
  absolute: z.boolean().optional(),
  addCats: z.array(Category).optional(),
  removeCats: z.array(Category).optional(),
  label: z.string().optional(),
  why: z.string().optional(),
});
export type ParsedBond = z.infer<typeof ParsedBond>;

export const ParsedPresent = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  mood: z.string().optional(),
  doing: z.string().optional(),
});

export const ParsedThread = z.object({
  op: z.enum(['new', 'advance', 'stall', 'resolve']),
  name: z.string(),
  note: z.string().optional(),
});

export const ParsedState = z.object({
  v: z.number().optional(),
  turn: z.number().optional(),
  day: z.number().optional(),
  scene: z.object({ loc: z.string().optional(), tension: z.number().min(0).max(10).optional() }).optional(),
  present: z.array(ParsedPresent).optional(),
  delta: z.object({
    bonds: z.array(ParsedBond).optional(),
    threads: z.array(ParsedThread).optional(),
    arcs: z.array(ParsedThread).optional(),
  }).optional(),
  // Open extension point: future blocks (e.g. inventory, factions) can land here
  // and be picked up by a registered extractor without schema churn elsewhere.
  ext: z.record(z.unknown()).optional(),
});
export type ParsedState = z.infer<typeof ParsedState>;

export interface ParseResult {
  state: ParsedState | null;
  /** how it was parsed, for diagnostics + the live feed */
  source: 'json' | 'regex' | 'none';
}

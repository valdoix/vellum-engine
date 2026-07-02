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
  aff: z.number().optional().catch(undefined),
  trust: z.number().optional().catch(undefined),
  absolute: z.boolean().optional().catch(undefined),
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
  condition: z.string().optional(), // physical state e.g. "wounded", "exhausted"
  thought: z.string().optional(), // first-person inner voice this turn
  traits: z.array(z.string()).optional().catch(undefined), // STABLE personality tags (not transient mood)
});

export const ParsedParallel = z.object({
  who: z.string().optional(),
  where: z.string().optional(),
  activity: z.string(),
  note: z.string().optional(),
});

export const ParsedThread = z.object({
  // `.catch` keeps one invented op from failing the whole block — default to the
  // benign 'advance' (upsertTrack treats it as "exists/active").
  op: z.enum(['new', 'advance', 'stall', 'resolve']).catch('advance'),
  name: z.string(),
  note: z.string().optional(),
});

export const ParsedJournal = z.object({
  who: z.string(),
  about: z.string().optional(),
  memory: z.string(),
  // invalid enum values coerce to a safe default instead of dropping the turn
  kind: z.enum(['interaction', 'promise', 'betrayal', 'gift', 'shared', 'wound', 'observation']).optional().catch(undefined),
  weight: z.enum(['trivial', 'minor', 'significant', 'defining']).optional().catch(undefined),
  sentiment: z.enum(['positive', 'negative', 'neutral', 'complex']).optional().catch(undefined),
});

export const ParsedKnowledge = z.object({
  who: z.string(),
  fact: z.string(),
  about: z.string().optional(),
  reliability: z.enum(['knows', 'believes', 'suspects', 'wrong', 'unaware']).optional().catch(undefined),
  truth: z.enum(['true', 'false', 'unknown']).optional().catch(undefined),
  source: z.string().optional(),
});

export const ParsedSecret = z.object({
  keeper: z.string(),
  secret: z.string().optional(),
  text: z.string().optional(),
  from: z.union([z.string(), z.array(z.string())]).optional(),
});

export const ParsedFaction = z.object({
  name: z.string(),
  kind: z.string().optional(),
  status: z.enum(['present', 'active', 'mentioned', 'added']).optional().catch(undefined),
  members: z.array(z.string()).optional(),
  standing: z.number().min(-100).max(100).optional().catch(undefined),
  trust: z.number().min(-100).max(100).optional().catch(undefined),
  why: z.string().optional(),
});

export const ParsedState = z.object({
  v: z.number().optional(),
  turn: z.number().optional(),
  day: z.number().optional(),
  // Every scalar tolerates an explicit JSON `null` (models emit "weather": null
  // for "no change") by coercing it to undefined via `.catch` — a stray null
  // must never fail the whole block's validation and force the regex fallback.
  scene: z.object({ loc: z.string().optional().catch(undefined), time: z.string().optional().catch(undefined), tension: z.number().min(0).max(10).optional().catch(undefined), weather: z.string().optional().catch(undefined) }).optional().catch(undefined),
  present: z.array(ParsedPresent).optional(),
  delta: z.object({
    bonds: z.array(ParsedBond).optional(),
    threads: z.array(ParsedThread).optional(),
    arcs: z.array(ParsedThread).optional(),
    journal: z.array(ParsedJournal).optional(),
    knowledge: z.array(ParsedKnowledge).optional(),
    secrets: z.array(ParsedSecret).optional(),
    factions: z.array(ParsedFaction).optional(),
    parallel: z.array(ParsedParallel).optional(),
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

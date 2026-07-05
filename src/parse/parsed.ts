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
  addCats: z.array(Category).optional().catch(undefined),
  removeCats: z.array(Category).optional().catch(undefined),
  label: z.string().optional().catch(undefined),
  why: z.string().optional().catch(undefined),
});
export type ParsedBond = z.infer<typeof ParsedBond>;

// Every optional field tolerates an explicit JSON `null` (models emit
// "thought": null / "doing": null etc. for "no change" instead of omitting the
// key) by coercing it to undefined via `.catch` — a stray null on ANY ONE
// field of ANY ONE present character must never fail the whole state block's
// validation and force the regex fallback (which has no `thought` grammar at
// all, silently dropping every character's inner voice that turn).
export const ParsedPresent = z.object({
  id: z.string().optional().catch(undefined),
  name: z.string().optional().catch(undefined),
  mood: z.string().optional().catch(undefined),
  doing: z.string().optional().catch(undefined),
  condition: z.string().optional().catch(undefined), // physical state e.g. "wounded", "exhausted"
  thought: z.string().optional().catch(undefined), // first-person inner voice this turn
  traits: z.array(z.string()).optional().catch(undefined), // STABLE personality tags (not transient mood)
});

export const ParsedParallel = z.object({
  who: z.string().optional().catch(undefined),
  where: z.string().optional().catch(undefined),
  activity: z.string(),
  note: z.string().optional().catch(undefined),
});

export const ParsedThread = z.object({
  // `.catch` keeps one invented op from failing the whole block — default to the
  // benign 'advance' (upsertTrack treats it as "exists/active").
  op: z.enum(['new', 'advance', 'stall', 'resolve']).catch('advance'),
  name: z.string(),
  note: z.string().optional().catch(undefined),
});

export const ParsedJournal = z.object({
  who: z.string(),
  about: z.string().optional().catch(undefined),
  memory: z.string(),
  // invalid enum values coerce to a safe default instead of dropping the turn
  kind: z.enum(['interaction', 'promise', 'betrayal', 'gift', 'shared', 'wound', 'observation']).optional().catch(undefined),
  weight: z.enum(['trivial', 'minor', 'significant', 'defining']).optional().catch(undefined),
  sentiment: z.enum(['positive', 'negative', 'neutral', 'complex']).optional().catch(undefined),
});

export const ParsedKnowledge = z.object({
  who: z.string(),
  fact: z.string(),
  about: z.string().optional().catch(undefined),
  reliability: z.enum(['knows', 'believes', 'suspects', 'wrong', 'unaware']).optional().catch(undefined),
  truth: z.enum(['true', 'false', 'unknown']).optional().catch(undefined),
  source: z.string().optional().catch(undefined),
});

export const ParsedSecret = z.object({
  keeper: z.string(),
  secret: z.string().optional().catch(undefined),
  text: z.string().optional().catch(undefined),
  from: z.union([z.string(), z.array(z.string())]).optional().catch(undefined),
});

export const ParsedFaction = z.object({
  name: z.string(),
  kind: z.string().optional().catch(undefined),
  status: z.enum(['present', 'active', 'mentioned', 'added']).optional().catch(undefined),
  members: z.array(z.string()).optional().catch(undefined),
  standing: z.number().min(-100).max(100).optional().catch(undefined),
  trust: z.number().min(-100).max(100).optional().catch(undefined),
  why: z.string().optional().catch(undefined),
});

export const ParsedFactionRel = z.object({
  a: z.string(),
  b: z.string(),
  kind: z.enum(['alliance', 'rivalry', 'war', 'vassal', 'trade']).optional().catch(undefined),
  standing: z.number().min(-100).max(100).optional().catch(undefined),
  absolute: z.boolean().optional().catch(undefined),
  why: z.string().optional().catch(undefined),
});

export const ParsedState = z.object({
  v: z.number().optional(),
  turn: z.number().optional(),
  day: z.number().optional(),
  // Every scalar tolerates an explicit JSON `null` (models emit "weather": null
  // for "no change") by coercing it to undefined via `.catch` — a stray null
  // must never fail the whole block's validation and force the regex fallback.
  scene: z.object({ loc: z.string().optional().catch(undefined), time: z.string().optional().catch(undefined), tension: z.number().min(0).max(10).optional().catch(undefined), weather: z.string().optional().catch(undefined) }).optional().catch(undefined),
  // `.catch(undefined)` at the ARRAY level too: a single malformed element that
  // isn't even an object (e.g. the model emits `null` for a whole present/bond
  // entry instead of a field) must not fail the entire turn's state block —
  // every element schema already tolerates a stray field-level null via its own
  // `.catch`, so this only guards against a non-object element slipping through.
  present: z.array(ParsedPresent).optional().catch(undefined),
  delta: z.object({
    bonds: z.array(ParsedBond).optional().catch(undefined),
    threads: z.array(ParsedThread).optional().catch(undefined),
    arcs: z.array(ParsedThread).optional().catch(undefined),
    journal: z.array(ParsedJournal).optional().catch(undefined),
    knowledge: z.array(ParsedKnowledge).optional().catch(undefined),
    secrets: z.array(ParsedSecret).optional().catch(undefined),
    factions: z.array(ParsedFaction).optional().catch(undefined),
    factionRelations: z.array(ParsedFactionRel).optional().catch(undefined),
    parallel: z.array(ParsedParallel).optional().catch(undefined),
  }).optional().catch(undefined),
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

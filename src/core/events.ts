import { z } from 'zod';

/**
 * The event log is the single source of truth. Every meaningful change is an
 * immutable, append-only event. Derived state = reduce(events). This module
 * defines the wire/storage schema (zod-validated) so a corrupt or
 * version-skewed log is caught at load, not deep in a reducer.
 */

export const SCHEMA_VERSION = 2 as const;

/** Where an assertion came from. Drives precedence (user wins) + weighting. */
export const Src = z.enum(['model', 'user', 'living', 'scan', 'import', 'system']);
export type Src = z.infer<typeof Src>;

/** Relationship categories — a bond holds a SET (familial + rivalry coexist). */
export const Category = z.enum(['familial', 'romantic', 'alliance', 'rivalry', 'social', 'neutral']);
export type Category = z.infer<typeof Category>;

export const CastStatus = z.enum(['present', 'active', 'mentioned', 'added']);
export type CastStatus = z.infer<typeof CastStatus>;

export const MemoryTier = z.enum(['turn', 'chapter', 'arc']);
export type MemoryTier = z.infer<typeof MemoryTier>;

const base = { seq: z.number().int().nonnegative(), turn: z.number().int().nonnegative(), day: z.number().int().nonnegative(), src: Src };

// --- individual event variants -------------------------------------------
export const EvTurnFold = z.object({ ...base, kind: z.literal('turn.fold'), sig: z.string() });
export const EvSceneSet = z.object({ ...base, kind: z.literal('scene.set'), location: z.string().optional(), tension: z.number().min(0).max(10).optional(), present: z.array(z.string()).default([]) });

export const EvCastSeen = z.object({ ...base, kind: z.literal('cast.seen'), id: z.string(), name: z.string(), status: CastStatus });
export const EvCastEdit = z.object({ ...base, kind: z.literal('cast.edit'), id: z.string(), patch: z.record(z.unknown()) });
export const EvCastDrop = z.object({ ...base, kind: z.literal('cast.drop'), id: z.string() });

export const EvBondDelta = z.object({
  ...base, kind: z.literal('bond.delta'),
  a: z.string(), b: z.string(),
  aff: z.number().min(-100).max(100).optional(),
  trust: z.number().min(-100).max(100).optional(),
  absolute: z.boolean().optional(), // true => set, false/absent => delta
  addCats: z.array(Category).optional(),
  removeCats: z.array(Category).optional(),
  label: z.string().optional(),
  why: z.string().optional(),
});
export const EvBondDrop = z.object({ ...base, kind: z.literal('bond.drop'), a: z.string(), b: z.string() });

export const EvKnowledge = z.object({ ...base, kind: z.literal('knowledge.learn'), who: z.string(), fact: z.string(), about: z.string().optional() });
export const EvSecretForm = z.object({ ...base, kind: z.literal('secret.form'), id: z.string(), keeper: z.string(), from: z.array(z.string()).default([]), text: z.string() });
export const EvSecretReveal = z.object({ ...base, kind: z.literal('secret.reveal'), id: z.string(), to: z.array(z.string()).default([]) });

export const EvMemory = z.object({ ...base, kind: z.literal('memory.record'), id: z.string(), tier: MemoryTier, text: z.string(), keys: z.array(z.string()).default([]), covers: z.tuple([z.number(), z.number()]).optional() });
export const EvMemoryDrop = z.object({ ...base, kind: z.literal('memory.drop'), id: z.string() });

export const EvThread = z.object({ ...base, kind: z.literal('thread.op'), op: z.enum(['new', 'advance', 'stall', 'resolve']), name: z.string(), note: z.string().optional() });
export const EvArc = z.object({ ...base, kind: z.literal('arc.op'), op: z.enum(['new', 'advance', 'resolve']), name: z.string(), note: z.string().optional() });

export const VellumEvent = z.discriminatedUnion('kind', [
  EvTurnFold, EvSceneSet,
  EvCastSeen, EvCastEdit, EvCastDrop,
  EvBondDelta, EvBondDrop,
  EvKnowledge, EvSecretForm, EvSecretReveal,
  EvMemory, EvMemoryDrop,
  EvThread, EvArc,
]);
export type VellumEvent = z.infer<typeof VellumEvent>;

/** The persisted log envelope. */
export const EventLog = z.object({
  version: z.number().int(),
  chatId: z.string(),
  events: z.array(VellumEvent),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type EventLog = z.infer<typeof EventLog>;

export function freshLog(chatId: string): EventLog {
  const now = Date.now();
  return { version: SCHEMA_VERSION, chatId, events: [], createdAt: now, updatedAt: now };
}

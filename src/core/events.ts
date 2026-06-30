import { z } from 'zod';

/**
 * The event log is the single source of truth. Every meaningful change is an
 * immutable, append-only event. Derived state = reduce(events). This module
 * defines the wire/storage schema (zod-validated) so a corrupt or
 * version-skewed log is caught at load, not deep in a reducer.
 */

export const SCHEMA_VERSION = 8 as const;

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

// Knowledge epistemic frame (legacy-faithful): how sure the knower is, the
// ACTUAL state regardless of belief, and how they learned it. Together they are
// the dramatic-irony signal (a flat observation can't be framed this way).
export const Reliability = z.enum(['knows', 'believes', 'suspects', 'wrong', 'unaware']);
export type Reliability = z.infer<typeof Reliability>;
export const Truth = z.enum(['true', 'false', 'unknown']);
export type Truth = z.infer<typeof Truth>;

const base = { seq: z.number().int().nonnegative(), turn: z.number().int().nonnegative(), day: z.number().int().nonnegative(), src: Src };

// --- individual event variants -------------------------------------------
export const EvTurnFold = z.object({ ...base, kind: z.literal('turn.fold'), sig: z.string() });
export const PresentDetail = z.object({ id: z.string(), name: z.string().optional(), mood: z.string().optional(), doing: z.string().optional(), condition: z.string().optional(), thought: z.string().optional() });
export const EvSceneSet = z.object({ ...base, kind: z.literal('scene.set'), location: z.string().optional(), time: z.string().optional(), tension: z.number().min(0).max(10).optional(), weather: z.string().optional(), present: z.array(z.string()).default([]), detail: z.array(PresentDetail).optional() });
export const ParallelItem = z.object({ who: z.string().optional(), where: z.string().optional(), activity: z.string(), note: z.string().optional(), src: z.literal('sim').optional() });
export const EvParallel = z.object({ ...base, kind: z.literal('parallel.set'), items: z.array(ParallelItem).default([]) });

export const JournalKind = z.enum(['interaction', 'promise', 'betrayal', 'gift', 'shared', 'wound', 'observation']);
export type JournalKind = z.infer<typeof JournalKind>;
export const JournalWeight = z.enum(['trivial', 'minor', 'significant', 'defining']);
export type JournalWeight = z.infer<typeof JournalWeight>;
export const JournalSentiment = z.enum(['positive', 'negative', 'neutral', 'complex']);
export type JournalSentiment = z.infer<typeof JournalSentiment>;
export const EvJournal = z.object({ ...base, kind: z.literal('journal.entry'), id: z.string(), who: z.string(), about: z.string().optional(), memory: z.string(), jkind: JournalKind.default('interaction'), weight: JournalWeight.default('minor'), sentiment: JournalSentiment.default('neutral') });
export const EvJournalDrop = z.object({ ...base, kind: z.literal('journal.drop'), id: z.string() });
export const JournalPatch = z.object({ memory: z.string().optional(), about: z.string().optional(), jkind: JournalKind.optional(), weight: JournalWeight.optional(), sentiment: JournalSentiment.optional() });
export const EvJournalEdit = z.object({ ...base, kind: z.literal('journal.edit'), id: z.string(), patch: JournalPatch });

// --- Palimpsest scars: a belief proven WRONG that left a mark. Held by a cast
// member; resurfaces under stress as doubt, never as fact. Distinct from
// knowledge (which is current belief) — a scar is a SUPERSEDED one, kept on
// purpose. Carried in the <vellum> block's `ext.scars`.
export const EvScarForm = z.object({ ...base, kind: z.literal('scar.form'), id: z.string(), who: z.string(), was: z.string(), about: z.string().optional(), knowledgeId: z.string().optional() });
export const EvScarDrop = z.object({ ...base, kind: z.literal('scar.drop'), id: z.string() });

// --- Codex / Lore: a fact that is TRUE OF THE WORLD, not a character's belief
// (geography, custom, history the engine minted via the preset's Codex). Kept
// separate from per-character knowledge so canon never reads as someone's
// opinion and never mints a "World" cast card. Carried in `ext.codex` (and the
// legacy who:"world" knowledge path is rerouted here).
export const EvLoreNote = z.object({ ...base, kind: z.literal('lore.note'), id: z.string(), fact: z.string(), tag: z.string().optional() });
export const EvLoreDrop = z.object({ ...base, kind: z.literal('lore.drop'), id: z.string() });

export const EvCastSeen = z.object({ ...base, kind: z.literal('cast.seen'), id: z.string(), name: z.string(), status: CastStatus });
export const CastPatch = z.object({ name: z.string().optional(), role: z.string().optional(), age: z.union([z.string(), z.number()]).optional(), appearance: z.string().optional(), note: z.string().optional(), aka: z.array(z.string()).optional(), status: CastStatus.optional(), color: z.string().optional(), colorTo: z.string().optional() });
export const EvCastEdit = z.object({ ...base, kind: z.literal('cast.edit'), id: z.string(), patch: CastPatch });
export const EvCastDrop = z.object({ ...base, kind: z.literal('cast.drop'), id: z.string() });

// --- factions: "cast for groups". ids live in a SEPARATE namespace (fac:<canon>)
// and never cross the cast id-space. Membership is edges (faction.member), so a
// character in many factions / a standalone faction are the same code path.
export const EvFactionSeen = z.object({ ...base, kind: z.literal('faction.seen'), id: z.string(), name: z.string(), status: CastStatus });
export const FactionPatch = z.object({ name: z.string().optional(), kind: z.string().optional(), note: z.string().optional(), aka: z.array(z.string()).optional(), status: CastStatus.optional() });
export const EvFactionEdit = z.object({ ...base, kind: z.literal('faction.edit'), id: z.string(), patch: FactionPatch });
export const EvFactionDrop = z.object({ ...base, kind: z.literal('faction.drop'), id: z.string() });
export const EvFactionMember = z.object({ ...base, kind: z.literal('faction.member'), char: z.string(), faction: z.string(), op: z.enum(['add', 'remove']).default('add'), role: z.string().optional() });
export const EvFactionStanding = z.object({ ...base, kind: z.literal('faction.standing'), faction: z.string(), standing: z.number().min(-100).max(100).optional(), trust: z.number().min(-100).max(100).optional(), absolute: z.boolean().optional(), why: z.string().optional() });

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
export const EvBondDrop = z.object({ ...base, kind: z.literal('bond.drop'), a: z.string(), b: z.string(), both: z.boolean().optional() });

export const EvKnowledge = z.object({ ...base, kind: z.literal('knowledge.learn'), who: z.string(), fact: z.string(), about: z.string().optional(), reliability: Reliability.optional(), truth: Truth.optional(), source: z.string().optional() });
export const EvKnowledgeDrop = z.object({ ...base, kind: z.literal('knowledge.drop'), id: z.string() });
// Tidy: fold near-duplicate knowledge facts (by id) into one. The richer text +
// firmest epistemic frame is kept on `into`; the `from` ids are removed.
export const EvKnowledgeMerge = z.object({ ...base, kind: z.literal('knowledge.merge'), into: z.string(), from: z.array(z.string()) });
export const EvSecretForm = z.object({ ...base, kind: z.literal('secret.form'), id: z.string(), keeper: z.string(), from: z.array(z.string()).default([]), text: z.string() });
export const EvSecretReveal = z.object({ ...base, kind: z.literal('secret.reveal'), id: z.string(), to: z.array(z.string()).default([]) });
export const EvSecretDrop = z.object({ ...base, kind: z.literal('secret.drop'), id: z.string() });
// Tidy: fold near-duplicate secrets (by id) into one — union the `from`/revealedTo
// lists, keep the richer text on `into`; the `from` ids are removed.
export const EvSecretMerge = z.object({ ...base, kind: z.literal('secret.merge'), into: z.string(), from: z.array(z.string()) });

const SubsumedMem = z.object({ id: z.string(), turn: z.number(), text: z.string(), keys: z.array(z.string()).default([]), tier: MemoryTier.optional(), detail: z.string().optional(), covers: z.tuple([z.number(), z.number()]).optional() });
export const EvMemory = z.object({ ...base, kind: z.literal('memory.record'), id: z.string(), tier: MemoryTier, text: z.string(), detail: z.string().optional(), keys: z.array(z.string()).default([]), covers: z.tuple([z.number(), z.number()]).optional(), subsumed: z.array(SubsumedMem).optional() });
// Links a chapter/arc memory to its detailed VAULT projection (world-book entry).
// Append-only so the log stays the source of truth; reduce sets vaultEntryId.
// `keys` carries back the (possibly user-edited) entry keywords for round-trip sync.
export const EvMemoryLink = z.object({ ...base, kind: z.literal('memory.link'), id: z.string(), vaultEntryId: z.string(), keys: z.array(z.string()).optional() });
export const EvMemoryDrop = z.object({ ...base, kind: z.literal('memory.drop'), id: z.string() });
// User edit of a memory's gist text and/or detail (the vault-mirrored body).
export const EvMemoryEdit = z.object({ ...base, kind: z.literal('memory.edit'), id: z.string(), text: z.string().optional(), detail: z.string().optional() });

export const EvThread = z.object({ ...base, kind: z.literal('thread.op'), op: z.enum(['new', 'advance', 'stall', 'resolve']), name: z.string(), note: z.string().optional() });
export const EvArc = z.object({ ...base, kind: z.literal('arc.op'), op: z.enum(['new', 'advance', 'resolve']), name: z.string(), note: z.string().optional() });
// Layer 3 — semantic reconcile: fold near-duplicate tracks (different words,
// same ongoing thread, e.g. "Jaime's Arrival" + "Jaime at Harrenhal") into one.
// Append-only → auditable + undoable. `from`/`into` are track names.
export const EvThreadMerge = z.object({ ...base, kind: z.literal('thread.merge'), from: z.array(z.string()), into: z.string() });
export const EvArcMerge = z.object({ ...base, kind: z.literal('arc.merge'), from: z.array(z.string()), into: z.string() });
// off-screen subplot: a living "meanwhile" thread the off-screen sim advances —
// accumulates beats, can resolve, round-trips to the prompt like a plot thread.
export const EvOffscreen = z.object({ ...base, kind: z.literal('offscreen.op'), op: z.enum(['new', 'advance', 'resolve']), id: z.string(), name: z.string().optional(), who: z.string().optional(), where: z.string().optional(), gist: z.string().optional() });

export const VellumEvent = z.discriminatedUnion('kind', [
  EvTurnFold, EvSceneSet,
  EvCastSeen, EvCastEdit, EvCastDrop,
  EvFactionSeen, EvFactionEdit, EvFactionDrop, EvFactionMember, EvFactionStanding,
  EvBondDelta, EvBondDrop,
  EvKnowledge, EvKnowledgeDrop, EvKnowledgeMerge, EvSecretForm, EvSecretReveal, EvSecretDrop, EvSecretMerge,
  EvMemory, EvMemoryDrop, EvMemoryLink, EvMemoryEdit,
  EvThread, EvArc, EvThreadMerge, EvArcMerge,
  EvJournal, EvJournalDrop, EvJournalEdit,
  EvScarForm, EvScarDrop, EvLoreNote, EvLoreDrop,
  EvParallel, EvOffscreen,
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

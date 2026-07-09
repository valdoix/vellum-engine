import { z } from 'zod';

/**
 * The event log is the single source of truth. Every meaningful change is an
 * immutable, append-only event. Derived state = reduce(events). This module
 * defines the wire/storage schema (zod-validated) so a corrupt or
 * version-skewed log is caught at load, not deep in a reducer.
 */

export const SCHEMA_VERSION = 18 as const;

/** Where an assertion came from. Drives precedence (user wins) + weighting. */
export const Src = z.enum(['model', 'user', 'living', 'scan', 'import', 'system']);
export type Src = z.infer<typeof Src>;

/** Relationship categories — a bond holds a SET (familial + rivalry coexist). */
export const Category = z.enum(['familial', 'romantic', 'alliance', 'rivalry', 'social', 'neutral']);
export type Category = z.infer<typeof Category>;

export const CastStatus = z.enum(['present', 'active', 'mentioned', 'added']);
export type CastStatus = z.infer<typeof CastStatus>;

// 'beat' = a user-curated Story Beat: an authorial landmark index card, not an
// auto-compression. Beats are never folded/subsumed; they double as the recall
// "spine" (a compact chronological through-line injected cheaply each turn).
export const MemoryTier = z.enum(['turn', 'chapter', 'arc', 'beat']);
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
// --- chronicle config: user preferences that live in the log so they persist +
// flow to every reduce() consumer (UI, injections, export). Currently the
// date-display format (day-count vs. calendar). Additive/optional.
export const DateFormat = z.enum(['day', 'month-day-year', 'month-day', 'month', 'week', 'month-year', 'year']);
export type DateFormat = z.infer<typeof DateFormat>;
export const EvConfigSet = z.object({ ...base, kind: z.literal('config.set'), dateFormat: DateFormat.optional(), dateEpoch: z.string().optional(), monthNames: z.array(z.string()).optional(), monthNamesShort: z.array(z.string()).optional(), yearPrefix: z.string().optional(), yearSuffix: z.string().optional() });
// --- Tone dials: the user's romance/disposition/social/politics preferences,
// persisted in the log (like config.set) so they survive regen/chat-switch/
// reload and flow to every reduce() consumer, instead of a flaky host chat var.
// Each field optional so a set can move one dial; reduce keeps the last value.
// Enums mirror domain/tone.ts (kept inline so events.ts imports no domain code).
export const ToneRomance = z.enum(['off', 'slow_burn', 'medium', 'fast', 'erotic']);
export const ToneDisposition = z.enum(['kind', 'warm', 'fair', 'harsh', 'brutal']);
export const ToneSocial = z.enum(['off', 'reactive', 'living', 'autonomous']);
export const TonePolitics = z.enum(['off', 'living', 'autonomous']);
export const EvToneSet = z.object({ ...base, kind: z.literal('tone.set'), romance: ToneRomance.optional(), disposition: ToneDisposition.optional(), social: ToneSocial.optional(), politics: TonePolitics.optional() });
export const PresentDetail = z.object({ id: z.string(), name: z.string().optional(), mood: z.string().optional(), doing: z.string().optional(), condition: z.string().optional(), thought: z.string().optional() });
// `mergeDetail` = a NON-authoritative scene event (from the prose extractor): it
// only FILLS GAPS in the current scene's present list + per-character detail
// (mood/doing/condition/thought) and never demotes cast or replaces the block's
// authored detail. Used to recover inner thoughts when the model's <vellum>
// block was dropped or truncated mid-`present`.
export const EvSceneSet = z.object({ ...base, kind: z.literal('scene.set'), location: z.string().optional(), time: z.string().optional(), clock: z.number().int().min(0).max(1439).optional(), tension: z.number().min(0).max(10).optional(), weather: z.string().optional(), present: z.array(z.string()).default([]), detail: z.array(PresentDetail).optional(), mergeDetail: z.boolean().optional() });
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

// --- Possession tracker: a NARRATIVE record of who carries what (named, notable
// possessions + scene/location items), never a quantity/weight ledger. `who` is
// a cast id or the 'world' sentinel (scene items). op gain/scene adds, lose/give
// removes (give re-adds under `to`), note updates. Carried in `ext.inventory`.
export const EvItemChange = z.object({ ...base, kind: z.literal('item.change'), id: z.string(), who: z.string(), item: z.string(), op: z.enum(['gain', 'lose', 'give', 'scene', 'note']), to: z.string().optional(), note: z.string().optional(), scene: z.boolean().optional() });
export const EvItemDrop = z.object({ ...base, kind: z.literal('item.drop'), id: z.string() });

// --- Locations: a canonical gazetteer of established places, so the model
// reuses names instead of inventing/renaming. Auto-collected from visited
// scenes (auto:true) or user-pinned. Dedupe by normalized name.
export const EvLocationSet = z.object({ ...base, kind: z.literal('location.set'), id: z.string(), name: z.string(), note: z.string().optional(), auto: z.boolean().optional(), parent: z.string().optional() });
export const EvLocationDrop = z.object({ ...base, kind: z.literal('location.drop'), id: z.string() });

// --- Continuity flags: the passive alarm's advisory findings, persisted as a
// small ring buffer so the Director Log can show them (never blocks anything).
export const EvContinuityFlag = z.object({ ...base, kind: z.literal('continuity.flag'), code: z.string(), detail: z.string() });

// --- Day correction: the ONE sanctioned way to walk back the model-supplied,
// monotonic day counter. `absolute:true` SETS the day (overriding the Math.max
// forward-only rule intentionally, to fix a spurious high day); otherwise it
// advances like a normal report (Math.max). SCHEMA 17. Additive.
export const EvDaySet = z.object({ ...base, kind: z.literal('day.set'), day: z.number().int().nonnegative(), absolute: z.boolean().optional() });

// --- Personality drift: a versioned, cause-linked record of how a character's
// TRAITS change over time (self memory). The model only emits trait tags; the
// engine DERIVES the op by diffing the trait set, so this is deterministic.
// causeId links the driving journal/scar/bond; `from` is the trait it replaced.
export const EvTraitDrift = z.object({ ...base, kind: z.literal('trait.drift'), who: z.string(), trait: z.string(), op: z.enum(['emerge', 'fade', 'reverse', 'resurface', 'harden']), from: z.string().optional(), cause: z.string().optional(), causeId: z.string().optional() });

// --- Foreshadow / Chekhov plants: a detail seeded now that should pay off later
// (a locked drawer, an omen, a stranger's ring). Stays 'planted' until resolved;
// surfaced in the Director so it never quietly vanishes. Model emits via ext.plant.
export const EvPlantSet = z.object({ ...base, kind: z.literal('plant.set'), id: z.string(), what: z.string(), subject: z.string().optional() });
// NOTE: EvPlantSet's narrative day is carried on the base `day` field (stamped at
// the fold); the reducer records it as Plant.plantedDay for the living-clock aging.
export const EvPlantPay = z.object({ ...base, kind: z.literal('plant.pay'), id: z.string(), note: z.string().optional() });
// abandon: the seed is deliberately let go (subverted/dropped) — distinct from pay
// (it never lands) and from drop (which erases the record entirely).
export const EvPlantAbandon = z.object({ ...base, kind: z.literal('plant.abandon'), id: z.string(), note: z.string().optional() });
export const EvPlantDrop = z.object({ ...base, kind: z.literal('plant.drop'), id: z.string() });

export const EvCastSeen = z.object({ ...base, kind: z.literal('cast.seen'), id: z.string(), name: z.string(), status: CastStatus });
export const CastPatch = z.object({ name: z.string().optional(), role: z.string().optional(), age: z.union([z.string(), z.number()]).optional(), appearance: z.string().optional(), note: z.string().optional(), disposition: z.string().optional(), traits: z.array(z.string()).optional(), aka: z.array(z.string()).optional(), status: CastStatus.optional(), color: z.string().optional(), colorTo: z.string().optional(), imageUrl: z.string().optional(), deceased: z.boolean().optional() });
export const EvCastEdit = z.object({ ...base, kind: z.literal('cast.edit'), id: z.string(), patch: CastPatch });
export const EvCastDrop = z.object({ ...base, kind: z.literal('cast.drop'), id: z.string() });

// --- factions: "cast for groups". ids live in a SEPARATE namespace (fac:<canon>)
// and never cross the cast id-space. Membership is edges (faction.member), so a
// character in many factions / a standalone faction are the same code path.
export const EvFactionSeen = z.object({ ...base, kind: z.literal('faction.seen'), id: z.string(), name: z.string(), status: CastStatus });
export const FactionPatch = z.object({ name: z.string().optional(), kind: z.string().optional(), note: z.string().optional(), aka: z.array(z.string()).optional(), status: CastStatus.optional(), seat: z.string().optional() });
export const EvFactionEdit = z.object({ ...base, kind: z.literal('faction.edit'), id: z.string(), patch: FactionPatch });
export const EvFactionDrop = z.object({ ...base, kind: z.literal('faction.drop'), id: z.string() });
export const EvFactionMember = z.object({ ...base, kind: z.literal('faction.member'), char: z.string(), faction: z.string(), op: z.enum(['add', 'remove']).default('add'), role: z.string().optional() });
export const EvFactionStanding = z.object({ ...base, kind: z.literal('faction.standing'), faction: z.string(), standing: z.number().min(-100).max(100).optional(), trust: z.number().min(-100).max(100).optional(), absolute: z.boolean().optional(), why: z.string().optional() });
// inter-faction relation (directed, a→b). `relkind` sets the group-relation
// category; `standing` moves a's regard toward b (delta unless absolute).
export const FactionRelKind = z.enum(['alliance', 'rivalry', 'war', 'vassal', 'trade']);
export type FactionRelKind = z.infer<typeof FactionRelKind>;
export const EvFactionRel = z.object({ ...base, kind: z.literal('factionrel.op'), a: z.string(), b: z.string(), relkind: FactionRelKind.optional(), standing: z.number().min(-100).max(100).optional(), absolute: z.boolean().optional(), note: z.string().optional(), why: z.string().optional() });
export const EvFactionRelDrop = z.object({ ...base, kind: z.literal('factionrel.drop'), a: z.string(), b: z.string(), both: z.boolean().optional() });

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
export const EvMemory = z.object({ ...base, kind: z.literal('memory.record'), id: z.string(), tier: MemoryTier, text: z.string(), detail: z.string().optional(), keys: z.array(z.string()).default([]), covers: z.tuple([z.number(), z.number()]).optional(), subsumed: z.array(SubsumedMem).optional(), beatDay: z.number().optional(), beatTime: z.string().optional(), spine: z.boolean().optional(), act: z.string().optional(), ord: z.number().optional() });
// Links a chapter/arc memory to its detailed VAULT projection (world-book entry).
// Append-only so the log stays the source of truth; reduce sets vaultEntryId.
// `keys` carries back the (possibly user-edited) entry keywords for round-trip sync.
export const EvMemoryLink = z.object({ ...base, kind: z.literal('memory.link'), id: z.string(), vaultEntryId: z.string(), keys: z.array(z.string()).optional() });
export const EvMemoryDrop = z.object({ ...base, kind: z.literal('memory.drop'), id: z.string(), folded: z.boolean().optional() });
// User edit of a memory's gist text and/or detail (the vault-mirrored body).
export const EvMemoryEdit = z.object({ ...base, kind: z.literal('memory.edit'), id: z.string(), text: z.string().optional(), detail: z.string().optional() });

export const EvThread = z.object({ ...base, kind: z.literal('thread.op'), op: z.enum(['new', 'advance', 'stall', 'resolve']), name: z.string(), note: z.string().optional() });
export const EvArc = z.object({ ...base, kind: z.literal('arc.op'), op: z.enum(['new', 'advance', 'resolve']), name: z.string(), note: z.string().optional() });
// user CRUD on plot threads/arcs — targets the STABLE id when known (edit), else
// creates by name. Distinct from the model's thread.op so a user intent is clear.
export const EvThreadSet = z.object({ ...base, kind: z.literal('thread.set'), id: z.string().optional(), name: z.string(), status: z.string().optional(), note: z.string().optional(), kindArc: z.boolean().optional() });
export const EvThreadDrop = z.object({ ...base, kind: z.literal('thread.drop'), id: z.string() });
export const EvArcDrop = z.object({ ...base, kind: z.literal('arc.drop'), id: z.string() });
// Layer 3 — semantic reconcile: fold near-duplicate tracks (different words,
// same ongoing thread, e.g. "Jaime's Arrival" + "Jaime at Harrenhal") into one.
// Append-only → auditable + undoable. `from`/`into` are track names.
export const EvThreadMerge = z.object({ ...base, kind: z.literal('thread.merge'), from: z.array(z.string()), into: z.string() });
export const EvArcMerge = z.object({ ...base, kind: z.literal('arc.merge'), from: z.array(z.string()), into: z.string() });
// off-screen subplot: a living "meanwhile" thread the off-screen sim advances —
// accumulates beats, can resolve, round-trips to the prompt like a plot thread.
export const EvOffscreen = z.object({ ...base, kind: z.literal('offscreen.op'), op: z.enum(['new', 'advance', 'resolve']), id: z.string(), name: z.string().optional(), who: z.string().optional(), where: z.string().optional(), gist: z.string().optional(), thread: z.string().optional() });
// user link/unlink of an off-screen subplot to a plot Track id ('' clears).
export const EvOffscreenLink = z.object({ ...base, kind: z.literal('offscreen.link'), id: z.string(), thread: z.string() });
export const EvOffscreenDrop = z.object({ ...base, kind: z.literal('offscreen.drop'), id: z.string() });

export const VellumEvent = z.discriminatedUnion('kind', [
  EvTurnFold, EvConfigSet, EvToneSet, EvSceneSet,
  EvCastSeen, EvCastEdit, EvCastDrop,
  EvFactionSeen, EvFactionEdit, EvFactionDrop, EvFactionMember, EvFactionStanding, EvFactionRel, EvFactionRelDrop,
  EvBondDelta, EvBondDrop,
  EvKnowledge, EvKnowledgeDrop, EvKnowledgeMerge, EvSecretForm, EvSecretReveal, EvSecretDrop, EvSecretMerge,
  EvMemory, EvMemoryDrop, EvMemoryLink, EvMemoryEdit,
  EvThread, EvArc, EvThreadMerge, EvArcMerge, EvThreadSet, EvThreadDrop, EvArcDrop,
  EvJournal, EvJournalDrop, EvJournalEdit,
  EvScarForm, EvScarDrop, EvLoreNote, EvLoreDrop,
  EvItemChange, EvItemDrop,
  EvLocationSet, EvLocationDrop, EvContinuityFlag, EvDaySet,
  EvTraitDrift,
  EvPlantSet, EvPlantPay, EvPlantAbandon, EvPlantDrop,
  EvParallel, EvOffscreen, EvOffscreenDrop, EvOffscreenLink,
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

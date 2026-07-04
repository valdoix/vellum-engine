import type { Category } from '../core/events.js';

/**
 * Derived state shapes. These are what reduce(events) produces and what the UI
 * renders. Nothing here is persisted directly — it is always recomputed from
 * the event log, so it can never drift from the source of truth.
 */

export interface CastCard {
  id: string;
  name: string;
  aka: string[];
  status: 'present' | 'active' | 'mentioned' | 'added';
  age?: string;
  appearance?: string;
  role?: string;
  note?: string;
  disposition?: string; // one-line stable temperament, distinct from freeform `note`
  traits?: string[];    // 3-6 short emergent personality tags ("guarded", "dry wit")
  source: 'auto' | 'user';
  firstTurn: number;
  lastTurn: number;
  userEdited: boolean;
  color?: string;   // optional name color (#hex); absent = inherited skin ink
  colorTo?: string; // optional gradient end (#hex); absent = solid `color`
  imageUrl?: string; // optional portrait image URL; absent = initials avatar
  deceased?: boolean; // life-state; ORTHOGONAL to presence status (a dead character can still be
                      // mentioned/present as a corpse/flashback). Excludes from off-screen life.
}

/** A group/organization — "cast for groups". Standing is the group's regard
 * toward {{user}} (same shape as relation affection); membership lives in edges
 * (Membership[]), not nested here, so multi-faction + standalone are one path. */
export interface Faction {
  id: string; // 'fac:<canon>' — a SEPARATE namespace from cast ids
  name: string;
  aka: string[];
  kind?: string; // household | house | guild | order | ...
  note?: string;
  seat?: string; // id of a controlled/home Location (the group's territory)
  status: 'present' | 'active' | 'mentioned' | 'added';
  standing: number; // -100..100 toward {{user}}
  trust: number; // -100..100
  source: 'auto' | 'user';
  firstTurn: number;
  lastTurn: number;
  userEdited: boolean;
}

export interface Membership {
  char: string; // cast id
  faction: string; // faction id
  role?: string;
}

/** A directed relation between two factions (the group analogue of Relation).
 * `a`→`b` is distinct from `b`→`a`. `standing` is a's regard toward b. */
export interface FactionRelation {
  a: string; // faction id
  b: string; // faction id
  kind: 'alliance' | 'rivalry' | 'war' | 'vassal' | 'trade';
  standing: number; // -100..100 (a toward b)
  note?: string;
  firstTurn: number;
  lastTurn: number;
}

export interface CategoryStep {
  turn: number;
  day: number;
  op: 'add' | 'remove';
  category: Category;
  categories: Category[];
  reason: string;
}

export interface ScoreSample {
  turn: number;
  day: number;
  affection: number;
  trust: number;
  reason?: string;
}

export type Sentiment = 'warm' | 'strained' | 'hostile' | 'complex' | 'neutral';

export interface Relation {
  a: string; // canonical cast id
  b: string;
  label: string;
  categories: Category[]; // active set; never empty (falls back to ['neutral'])
  category: Category; // synced primary (highest rank) for back-compat/UI accent
  affection: number; // -100..100
  trust: number; // -100..100
  sentiment: Sentiment;
  status: 'active' | 'past' | 'broken' | 'secret';
  source: 'auto' | 'user';
  userEdited: boolean;
  firstTurn: number;
  lastTurn: number;
  firstDay: number;
  history: ScoreSample[];
  categoryHistory: CategoryStep[];
}

export interface KnowledgeFact {
  id: string;
  who: string; // who knows it
  fact: string;
  about?: string;
  turn: number;
  reliability: 'knows' | 'believes' | 'suspects' | 'wrong' | 'unaware'; // the knower's stance
  truth: 'true' | 'false' | 'unknown'; // actual state, regardless of belief
  source?: string; // how they learned it
}

export interface Secret {
  id: string;
  keeper: string;
  from: string[]; // who is kept in the dark
  text: string;
  revealed: boolean;
  revealedTo: string[];
  formedTurn: number;
}

export interface Memory {
  id: string;
  tier: 'turn' | 'chapter' | 'arc' | 'beat';
  text: string; // LEAN gist — what chronicle recall/traversal inject + hide-on-file uses
  detail?: string; // DETAILED summary — mirrored to the vault entry; lives in the log, not chronicle recall
  keys: string[];
  vaultEntryId?: string; // world-book entry holding `detail` (the hybrid-memory projection)
  covers?: [number, number];
  subsumed?: Array<{ id: string; turn: number; text: string; keys: string[]; tier?: 'turn' | 'chapter' | 'arc' | 'beat'; detail?: string; covers?: [number, number] }>;
  turn: number;
  // --- Story Beat (tier 'beat') fields ---
  beatDay?: number;   // narrative day the landmark happened (for chronological sort/display)
  beatTime?: string;  // time-of-day label ("dusk", "9:47 PM")
  spine?: boolean;    // inject into the always-on chronological spine (vs keyword-recall only)
  act?: string;       // optional act/part grouping for timeline dividers
  ord?: number;       // manual sort key for beats (author reordering); when set, dominates chronological sort
}

export interface Track {
  id: string;          // stable engine-assigned id (slug of the first title); the
                       // model keeps speaking in titles, the engine owns the id
  name: string;
  status: string;
  beats: string[];     // running history of what happened (newest last, capped) —
                       // mirrors OffscreenThread so threads & subplots share a shape
  firstTurn: number;
  lastTurn: number;
}

export interface PresentChar {
  id: string;
  mood?: string;
  doing?: string;
  condition?: string;
  thought?: string;
}

export interface Scene {
  location: string;
  time: string;
  tension: number;
  weather: string;
  present: string[];
  detail: PresentChar[];
}

export interface ParallelEvent {
  who?: string;
  where?: string;
  activity: string;
  note?: string;
  src?: 'sim'; // tagged when authored by the off-screen simulation (vs model-narrated)
  turn: number;
  day: number;
}

export interface JournalEntry {
  id: string;
  who: string; // canonical id of the character who holds the memory
  about?: string;
  memory: string;
  kind: 'interaction' | 'promise' | 'betrayal' | 'gift' | 'shared' | 'wound' | 'observation';
  weight: 'trivial' | 'minor' | 'significant' | 'defining';
  sentiment: 'positive' | 'negative' | 'neutral' | 'complex';
  turn: number;
  day: number;
}

/** A Palimpsest scar: a belief a character once held that was proven wrong. The
 * old belief is kept on purpose — it resurfaces under stress as doubt, never as
 * fact. `who` is the holder; `knowledgeId` optionally links the knowledge row
 * that superseded it. */
export interface Scar {
  id: string;
  who: string; // canonical cast id
  was: string; // the belief that was proven wrong
  about?: string;
  knowledgeId?: string;
  turn: number;
}

/** A Codex/Lore note: a fact TRUE OF THE WORLD (canon), not a character's
 * belief. Lives apart from knowledge so canon never reads as opinion and never
 * mints a pseudo-character. */
export interface LoreNote {
  id: string;
  fact: string;
  tag?: string;
  turn: number;
}

/** A possession: a named, notable item held by a character (`who` = cast id) or
 * present in the scene (`scene: true`, `who` = 'world'). Narrative, not a
 * quantity ledger — no counts, weight, or slots. */
/** A canonical place in the story. Auto-collected from visited scenes
 * (`auto: true`) or user-pinned. The gazetteer is injected (capped) so the model
 * reuses names instead of inventing or renaming locations. */
export interface Location {
  id: string;
  name: string;
  note?: string;
  auto?: boolean;       // engine-collected from a visited scene (vs user-pinned)
  parent?: string;      // id of the containing location (tavern ⊂ town ⊂ region)
  firstTurn: number;
  lastTurn: number;
}

/** A foreshadow/Chekhov plant: a detail seeded now that should pay off later.
 * Stays 'planted' until resolved; surfaced in the Director so it never vanishes. */
export interface Plant {
  id: string;
  what: string;
  status: 'planted' | 'paid' | 'abandoned';
  subject?: string; // optional cast/location/item id this plant concerns (scene-salience)
  plantedTurn: number;
  paidTurn?: number;
  payNote?: string;
}

/** A persisted continuity-alarm finding (advisory; shown in the Director Log). */
export interface ContinuityFlag {
  turn: number;
  code: string;
  detail: string;
}

/** One entry in a character's personality-drift ledger — how a trait changed,
 * when, and why. `op` is derived deterministically by the engine (the model only
 * emits trait tags). `causeId` links the driving journal/scar. */
export interface TraitEvent {
  who: string;
  trait: string;
  op: 'emerge' | 'fade' | 'reverse' | 'resurface' | 'harden';
  from?: string;    // the trait this replaced (on reverse)
  cause?: string;   // short human reason
  causeId?: string; // linked journal/scar id
  turn: number;
}

export interface Item {
  id: string;
  who: string;   // cast id, or 'world' for scene/location items
  item: string;  // the named possession ("the forged letter")
  note?: string;
  scene?: boolean; // true = a scene/location item, not carried by a person
  turn: number;
}

export interface ChronicleState {
  cast: Record<string, CastCard>;
  factions: Record<string, Faction>;
  memberships: Membership[];
  factionRelations: FactionRelation[];
  relations: Relation[];
  knowledge: KnowledgeFact[];
  secrets: Secret[];
  memories: Memory[];
  journal: JournalEntry[];
  scars: Scar[];
  lore: LoreNote[];
  items: Item[];
  locations: Location[];
  continuityFlags: ContinuityFlag[];
  traitHistory: TraitEvent[];
  plants: Plant[];
  threads: Track[];
  arcs: Track[];
  parallel: ParallelEvent[];
  offscreen: OffscreenThread[];
  scene: Scene;
  day: number;
  turns: number;
  dateFormat: 'day' | 'month-day-year' | 'month-day' | 'month' | 'week' | 'month-year' | 'year';
  dateEpoch?: Date; // Optional: reference date for calendar conversion
  // Fantasy calendar naming (Tier 1): rename the display labels while keeping the
  // underlying Gregorian structure. All optional; empty ⇒ default names.
  monthNames?: string[];      // custom long month names (wraps if <12 given)
  monthNamesShort?: string[]; // custom short month names (falls back to long)
  yearPrefix?: string;        // era text before the year ("Year ")
  yearSuffix?: string;        // era text after the year (" A.R.")
}

/** A living off-screen subplot the off-screen sim advances over turns. Mirrors
 * a plot thread but tracks its own running `beats` log + who/where. */
export interface OffscreenThread {
  id: string;
  name: string;
  who?: string;   // canonical cast id, when it concerns a known character
  where?: string;
  status: 'active' | 'resolved';
  gist: string;   // latest one-line state
  beats: string[]; // running history of what happened off-screen (newest last, capped)
  thread?: string; // OPTIONAL explicit link to a plot Track id — the user-set
                   // bridge that overrides the soft text match; rewritten on merge
  firstTurn: number;
  lastTurn: number;
}

export function freshState(): ChronicleState {
  return {
    cast: {},
    factions: {},
    memberships: [],
    factionRelations: [],
    relations: [],
    knowledge: [],
    secrets: [],
    memories: [],
    journal: [],
    scars: [],
    lore: [],
    items: [],
    locations: [],
    continuityFlags: [],
    traitHistory: [],
    plants: [],
    threads: [],
    arcs: [],
    parallel: [],
    offscreen: [],
    scene: { location: '', time: '', tension: 0, weather: '', present: [], detail: [] },
    day: 0,
    turns: 0,
    dateFormat: 'day',
  };
}

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
  name: string;
  status: string;
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
  relations: Relation[];
  knowledge: KnowledgeFact[];
  secrets: Secret[];
  memories: Memory[];
  journal: JournalEntry[];
  scars: Scar[];
  lore: LoreNote[];
  items: Item[];
  threads: Track[];
  arcs: Track[];
  parallel: ParallelEvent[];
  offscreen: OffscreenThread[];
  scene: Scene;
  day: number;
  turns: number;
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
  firstTurn: number;
  lastTurn: number;
}

export function freshState(): ChronicleState {
  return {
    cast: {},
    factions: {},
    memberships: [],
    relations: [],
    knowledge: [],
    secrets: [],
    memories: [],
    journal: [],
    scars: [],
    lore: [],
    items: [],
    threads: [],
    arcs: [],
    parallel: [],
    offscreen: [],
    scene: { location: '', time: '', tension: 0, weather: '', present: [], detail: [] },
    day: 0,
    turns: 0,
  };
}

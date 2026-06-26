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
  source: 'auto' | 'user';
  firstTurn: number;
  lastTurn: number;
  userEdited: boolean;
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
  tier: 'turn' | 'chapter' | 'arc';
  text: string;
  keys: string[];
  covers?: [number, number];
  subsumed?: Array<{ id: string; turn: number; text: string; keys: string[] }>;
  turn: number;
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

export interface ChronicleState {
  cast: Record<string, CastCard>;
  relations: Relation[];
  knowledge: KnowledgeFact[];
  secrets: Secret[];
  memories: Memory[];
  journal: JournalEntry[];
  threads: Track[];
  arcs: Track[];
  parallel: ParallelEvent[];
  scene: Scene;
  day: number;
  turns: number;
}

export function freshState(): ChronicleState {
  return {
    cast: {},
    relations: [],
    knowledge: [],
    secrets: [],
    memories: [],
    journal: [],
    threads: [],
    arcs: [],
    parallel: [],
    scene: { location: '', time: '', tension: 0, weather: '', present: [], detail: [] },
    day: 0,
    turns: 0,
  };
}

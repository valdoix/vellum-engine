import type { ChronicleState } from '../domain/types.js';
import { tokenize } from './tokenize.js';

/**
 * A RetrievableItem is a piece of PROSE CONTEXT recall may surface — knowledge,
 * secrets, chapter/arc memories. It deliberately EXCLUDES structured facts
 * (bond scores, cast identity, the day counter, who-knows-what): those are
 * authoritative and injected verbatim elsewhere, NEVER retrieved by score.
 * This is the continuity guardrail, enforced at the type/collection boundary.
 */
export interface RetrievableItem {
  id: string;
  kind: 'knowledge' | 'secret' | 'memory';
  text: string;
  turn: number;
  tokens: string[];
  /** memory tier, when kind==='memory' — lets recall prioritize compressed
   * chapter/arc summaries (the long-term backbone) over raw turn-memories. */
  tier?: 'turn' | 'chapter' | 'arc';
}

/** Collect retrievable prose items from derived state. */
export function collectItems(state: ChronicleState): RetrievableItem[] {
  const items: RetrievableItem[] = [];
  for (const k of state.knowledge) {
    // surface the epistemic frame so recall reads the STANCE, not a bare fact:
    // "Cersei believes: the children are Robert's" + a false-belief marker.
    const stance = k.reliability && k.reliability !== 'knows' ? `${k.reliability}${k.truth === 'false' ? ' (false)' : ''}: ` : '';
    const text = stance + k.fact;
    items.push({ id: k.id, kind: 'knowledge', text, turn: k.turn, tokens: tokenize(text) });
  }
  for (const s of state.secrets) {
    items.push({ id: s.id, kind: 'secret', text: s.text, turn: s.formedTurn, tokens: tokenize(s.text) });
  }
  for (const m of state.memories) {
    const t = m.text + ' ' + (m.keys || []).join(' ');
    items.push({ id: m.id, kind: 'memory', text: m.text, turn: m.turn, tokens: tokenize(t), tier: m.tier });
  }
  return items;
}

/**
 * Inverted index: token → item ids, plus document frequency for IDF weighting.
 * Built from a collection; rebuilt when the item set changes (cheap for the
 * sizes involved). This replaces legacy's O(entries × query) per-turn
 * re-tokenization of every entry in multiple places.
 */
export interface InvertedIndex {
  postings: Map<string, Set<string>>; // token -> item ids
  df: Map<string, number>; // document frequency
  byId: Map<string, RetrievableItem>;
  n: number; // doc count
  avgLen: number; // average token length (for BM25)
}

export function buildIndex(items: RetrievableItem[]): InvertedIndex {
  const postings = new Map<string, Set<string>>();
  const df = new Map<string, number>();
  const byId = new Map<string, RetrievableItem>();
  let totalLen = 0;
  for (const it of items) {
    byId.set(it.id, it);
    totalLen += it.tokens.length;
    const seen = new Set<string>();
    for (const tok of it.tokens) {
      let set = postings.get(tok);
      if (!set) { set = new Set(); postings.set(tok, set); }
      set.add(it.id);
      if (!seen.has(tok)) { df.set(tok, (df.get(tok) ?? 0) + 1); seen.add(tok); }
    }
  }
  return { postings, df, byId, n: items.length, avgLen: items.length ? totalLen / items.length : 0 };
}

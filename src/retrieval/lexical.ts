import type { InvertedIndex } from './invindex.js';
import { tokenize } from './tokenize.js';

/**
 * BM25 lexical scoring over the inverted index. BM25 weights rare tokens (high
 * IDF) far above common ones and saturates term frequency — so a shared proper
 * noun ("Selene") dominates a shared filler word. This exact-token precision is
 * what makes lexical the continuity-protecting tier of the hybrid recall: it
 * never confuses "Selene" with "Celeste" the way pure vectors can.
 */

const K1 = 1.4;
const B = 0.75;

export interface ScoredHit {
  id: string;
  score: number;
}

export function lexicalSearch(index: InvertedIndex, query: string, topK = 12): ScoredHit[] {
  if (!index.n) return [];
  const qTokens = Array.from(new Set(tokenize(query)));
  if (!qTokens.length) return [];

  // term frequency per candidate, gathered via postings (only touches docs that
  // actually contain a query token — not every entry).
  const tf = new Map<string, Map<string, number>>(); // id -> token -> count
  const candidates = new Set<string>();
  for (const tok of qTokens) {
    const ids = index.postings.get(tok);
    if (!ids) continue;
    for (const id of ids) {
      candidates.add(id);
      let m = tf.get(id);
      if (!m) { m = new Map(); tf.set(id, m); }
      // recompute term count from the item's tokens (cheap; items are short)
      if (!m.has(tok)) {
        const item = index.byId.get(id)!;
        let c = 0;
        for (const t of item.tokens) if (t === tok) c++;
        m.set(tok, c);
      }
    }
  }

  const scores: ScoredHit[] = [];
  for (const id of candidates) {
    const item = index.byId.get(id)!;
    const len = item.tokens.length || 1;
    let s = 0;
    const counts = tf.get(id)!;
    for (const tok of qTokens) {
      const f = counts.get(tok) ?? 0;
      if (!f) continue;
      const df = index.df.get(tok) ?? 1;
      const idf = Math.log(1 + (index.n - df + 0.5) / (df + 0.5));
      const denom = f + K1 * (1 - B + (B * len) / (index.avgLen || 1));
      s += idf * ((f * (K1 + 1)) / denom);
    }
    if (s > 0) scores.push({ id, score: s });
  }
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, topK);
}

/**
 * Reciprocal Rank Fusion. Combines several ranked lists into one without
 * needing comparable score scales — each list contributes 1/(k + rank). This is
 * how we fuse lexical (BM25), vector (host embeddings), and structured recall so
 * neither dominates: lexical guarantees exact-name precision (continuity),
 * vectors add paraphrase recall, and the fusion is robust to either being noisy.
 *
 * k dampens the contribution of low ranks; 60 is the standard default.
 */

export interface RankedList {
  /** ordered best-first; each entry is an item id */
  ids: string[];
  /** optional weight for this whole list (default 1) */
  weight?: number;
}

export function rrf(lists: RankedList[], k = 60): Array<{ id: string; score: number }> {
  const score = new Map<string, number>();
  for (const list of lists) {
    const w = list.weight ?? 1;
    list.ids.forEach((id, rank) => {
      score.set(id, (score.get(id) ?? 0) + w * (1 / (k + rank)));
    });
  }
  return [...score.entries()]
    .map(([id, s]) => ({ id, score: s }))
    .sort((a, b) => b.score - a.score);
}

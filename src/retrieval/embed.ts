import { embeddingsEnabled } from '../host/capability.js';

declare const spindle: any;

/**
 * Host-embeddings adapter. VELLUM does NOT run its own vector store — Lumiverse
 * ships a LanceDB hybrid cortex. We query it and map results back to OUR item
 * ids via a content map, then hand a ranked id list to the fuser.
 *
 * Capability-gated: returns null when vectorization is disabled or the API is
 * absent, so the fuser simply drops the vector list and lexical+structured
 * carry on unchanged (model-agnostic, degrades cleanly).
 */

export interface VectorHit {
  id: string;
  score: number;
}

/**
 * @param contentToId  map from a host memory's text/comment back to our item id
 *                     (so a cortex hit can be rendered with our metadata).
 */
export async function vectorSearch(
  chatId: string,
  query: string,
  userId: string | null,
  contentToId: (text: string) => string | null,
  topK = 12,
): Promise<VectorHit[] | null> {
  if (!chatId || !query) return null;
  if (!(await embeddingsEnabled(chatId, userId))) return null;
  try {
    const cortex = spindle.memories?.cortex;
    if (!cortex?.query) return null;
    const res = await cortex.query({ chatId, queryText: query, topK, includeRelationships: false, userId });
    const mems: any[] = Array.isArray(res?.memories) ? res.memories : Array.isArray(res) ? res : [];
    const hits: VectorHit[] = [];
    for (const m of mems) {
      const text = String(m?.content ?? m?.text ?? '');
      const id = contentToId(text);
      if (id) hits.push({ id, score: typeof m?.finalScore === 'number' ? m.finalScore : 1 });
    }
    return hits;
  } catch {
    return null; // any failure → fall back to lexical-only
  }
}

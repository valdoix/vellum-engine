import type { ChronicleState } from '../domain/types.js';
import { collectItems, buildIndex, type InvertedIndex } from './invindex.js';
import { lexicalSearch } from './lexical.js';
import { allocate, fitLines } from './budget.js';
import { rrf } from './fuse.js';
import { vectorSearch } from './embed.js';

/**
 * Recall assembler. Produces the text VELLUM injects into the prompt, in two
 * distinct kinds of block:
 *
 *  1. STRUCTURED (authoritative) — cast + active relations, injected VERBATIM.
 *     Never scored, never similarity-retrieved. This is the continuity
 *     guardrail: facts the engine owns deterministically are stated as fact.
 *
 *  2. RECALL (retrieved) — prose context (knowledge/secrets/memories) selected
 *     by lexical relevance to the current scene, recency-weighted. Advisory.
 *
 * Phase 3 will fuse host embeddings into (2) via RRF; (1) never changes.
 */

export interface InjectionResult {
  text: string;
  recallIds: string[];
  source: 'lexical' | 'hybrid';
}

const CAPS = { structured: 1400, knowledge: 900, recall: 1400 };
const TOTAL = 3600;

// cache the index per chat so we don't rebuild every interceptor call
interface IndexCache { sig: number; index: InvertedIndex }
const _idx = new Map<string, IndexCache>();

function indexFor(chatId: string, state: ChronicleState): InvertedIndex {
  const sig = state.knowledge.length + state.secrets.length * 1e3 + state.memories.length * 1e6;
  const cached = _idx.get(chatId);
  if (cached && cached.sig === sig) return cached.index;
  const index = buildIndex(collectItems(state));
  _idx.set(chatId, { sig, index });
  return index;
}

export function invalidateIndex(chatId?: string): void {
  if (chatId) _idx.delete(chatId);
  else _idx.clear();
}

/** Authoritative structured block: present/active cast + their bonds, verbatim. */
function structuredBlock(state: ChronicleState, budget: number): string {
  const present = new Set(state.scene.present);
  const cast = Object.values(state.cast)
    .filter((c) => present.has(c.id) || c.status === 'present' || c.status === 'active')
    .sort((a, b) => (b.lastTurn || 0) - (a.lastTurn || 0));
  const castLines = cast.map((c) => {
    const bits = [c.role, c.age, c.appearance].filter(Boolean).join('; ');
    return '- ' + c.name + (bits ? ' (' + bits + ')' : '');
  });
  const nameOf = (id: string): string => state.cast[id]?.name ?? id;
  const relLines = state.relations
    .filter((r) => present.has(r.a) || present.has(r.b))
    .slice(0, 12)
    .map((r) => {
      const cats = (r.categories.length ? r.categories : [r.category]).join('+');
      return '- ' + nameOf(r.a) + ' \u2192 ' + nameOf(r.b) + ': ' + cats + ' (' + r.sentiment + ', aff ' + r.affection + '/trust ' + r.trust + ')';
    });
  const lines = fitLines([...castLines, ...relLines], budget);
  if (!lines.length) return '';
  return '[CAST & BONDS \u2014 established, authoritative. Keep consistent; do not contradict.]\n' + lines.join('\n');
}

/** Render the final injection text from a ranked, deduped recall id list. */
function assemble(
  state: ChronicleState,
  index: InvertedIndex,
  rankedIds: string[],
  budgets: Record<string, number>,
  source: 'lexical' | 'hybrid',
): InjectionResult {
  const structured = structuredBlock(state, budgets.structured ?? 1200);
  const lines: string[] = [];
  for (const id of rankedIds) {
    const it = index.byId.get(id);
    if (it) lines.push('- ' + it.text);
  }
  const recallLines = fitLines(lines, budgets.recall ?? 1200);
  const recallIds = rankedIds.slice(0, recallLines.length);
  const recall = recallLines.length
    ? '[CHRONICLE RECALL \u2014 relevant established history. Honor it; do not recite.]\n' + recallLines.join('\n')
    : '';
  const text = [structured, recall].filter(Boolean).join('\n\n');
  return { text, recallIds, source };
}

/** Lexical-only ranking with a gentle recency lift. Pure + synchronous. */
function lexicalRanked(index: InvertedIndex, state: ChronicleState, query: string): string[] {
  const hits = lexicalSearch(index, query, 20);
  const maxTurn = state.turns || 1;
  return hits
    .map((h) => {
      const it = index.byId.get(h.id)!;
      const recency = 1 + 0.4 * (it.turn / maxTurn);
      return { id: h.id, score: h.score * recency };
    })
    .sort((a, b) => b.score - a.score)
    .map((r) => r.id);
}

/** Synchronous, lexical-only injection. Used in tests and as the always-on base. */
export function buildInjection(chatId: string, state: ChronicleState, query: string, phaseMult = 1): InjectionResult {
  const budgets = allocate({ total: TOTAL, caps: CAPS, phaseMult });
  const index = indexFor(chatId, state);
  return assemble(state, index, lexicalRanked(index, state, query), budgets, 'lexical');
}

/**
 * Hybrid injection: fuse lexical + host-embedding rankings via RRF. Falls back
 * to pure lexical when vectorization is unavailable (vectorSearch → null), so
 * continuity precision is never lost and the path is fully model-agnostic.
 */
export async function buildInjectionHybrid(
  chatId: string,
  state: ChronicleState,
  query: string,
  userId: string | null,
  phaseMult = 1,
): Promise<InjectionResult> {
  const budgets = allocate({ total: TOTAL, caps: CAPS, phaseMult });
  const index = indexFor(chatId, state);
  const lexIds = lexicalRanked(index, state, query);

  const contentToId = (text: string): string | null => {
    const t = text.trim().toLowerCase();
    for (const it of index.byId.values()) {
      if (it.text.trim().toLowerCase() === t || it.text.toLowerCase().includes(t.slice(0, 40))) return it.id;
    }
    return null;
  };
  const vec = await vectorSearch(chatId, query, userId, contentToId, 20);
  if (!vec || !vec.length) {
    return assemble(state, index, lexIds, budgets, 'lexical');
  }
  // fuse: lexical weighted slightly higher to keep exact-name precision dominant
  const fused = rrf([
    { ids: lexIds, weight: 1.1 },
    { ids: vec.map((v) => v.id), weight: 1.0 },
  ]).map((r) => r.id);
  return assemble(state, index, fused, budgets, 'hybrid');
}

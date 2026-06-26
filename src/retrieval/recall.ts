import type { ChronicleState } from '../domain/types.js';
import { collectItems, buildIndex, type InvertedIndex } from './invindex.js';
import { lexicalSearch } from './lexical.js';
import { allocate, fitLines } from './budget.js';

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
  source: 'lexical';
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

export function buildInjection(chatId: string, state: ChronicleState, query: string, phaseMult = 1): InjectionResult {
  const budgets = allocate({ total: TOTAL, caps: CAPS, phaseMult });
  const index = indexFor(chatId, state);

  const structured = structuredBlock(state, budgets.structured ?? 1200);

  // recall: lexical hits, recency-boosted, fit to budget
  const hits = lexicalSearch(index, query, 20);
  const maxTurn = state.turns || 1;
  const ranked = hits
    .map((h) => {
      const it = index.byId.get(h.id)!;
      const recency = 1 + 0.4 * (it.turn / maxTurn); // gentle recency lift
      return { id: h.id, text: it.text, score: h.score * recency };
    })
    .sort((a, b) => b.score - a.score);
  const recallLines = fitLines(ranked.map((r) => '- ' + r.text), budgets.recall ?? 1200);
  const recallIds = ranked.slice(0, recallLines.length).map((r) => r.id);
  const recall = recallLines.length
    ? '[CHRONICLE RECALL \u2014 relevant established history. Honor it; do not recite.]\n' + recallLines.join('\n')
    : '';

  const text = [structured, recall].filter(Boolean).join('\n\n');
  return { text, recallIds, source: 'lexical' };
}

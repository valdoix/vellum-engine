import type { Category } from '../core/events.js';
import type { Relation, Sentiment, CategoryStep } from './types.js';
import { catRank, primaryCategory, normalizeCategorySet } from './category.js';

const clamp = (v: number): number => Math.max(-100, Math.min(100, Math.round(v || 0)));

/**
 * Derive a qualitative sentiment from the two numeric axes. This is the single
 * authoritative definition — the UI mirrors it, but this is the source. Keep
 * thresholds here and nowhere else.
 */
export function deriveSentiment(affection: number, trust: number): Sentiment {
  const a = clamp(affection);
  const t = clamp(trust);
  const mag = Math.max(Math.abs(a), Math.abs(t));
  if (mag < 12) return 'neutral';
  if (Math.abs(a - t) >= 70) return 'complex';
  const avg = (a + t) / 2;
  if (avg >= 45) return 'warm';
  if (avg <= -45) return 'hostile';
  if (avg < 0) return 'strained';
  if (a >= 25 && t >= 25) return 'warm';
  return 'complex';
}

/** Seed numeric axes from a sentiment word (used when only a word is known). */
export function sentimentToScores(s: string): { affection: number; trust: number } {
  switch (s) {
    case 'warm': return { affection: 55, trust: 50 };
    case 'hostile': return { affection: -60, trust: -55 };
    case 'strained': return { affection: -25, trust: -20 };
    case 'complex': return { affection: 30, trust: -30 };
    default: return { affection: 0, trust: 0 };
  }
}

export function freshRelation(a: string, b: string, turn: number, day: number, src: 'auto' | 'user'): Relation {
  return {
    a, b, label: '',
    categories: ['neutral'], category: 'neutral',
    affection: 0, trust: 0, sentiment: 'neutral',
    status: 'active', source: src, userEdited: src === 'user',
    firstTurn: turn, lastTurn: turn, firstDay: day,
    history: [], categoryHistory: [{ turn, day, op: 'add', category: 'neutral', categories: ['neutral'], reason: '' }],
  };
}

/** Apply a signed (or absolute) score change, recording a history sample. */
export function applyScore(r: Relation, dAff: number, dTrust: number, absolute: boolean, turn: number, day: number, reason?: string): void {
  if (absolute) {
    r.affection = clamp(dAff);
    r.trust = clamp(dTrust);
  } else {
    r.affection = clamp(r.affection + dAff);
    r.trust = clamp(r.trust + dTrust);
  }
  r.sentiment = deriveSentiment(r.affection, r.trust);
  r.lastTurn = turn;
  r.history.push({ turn, day, affection: r.affection, trust: r.trust, ...(reason ? { reason } : {}) });
  if (r.history.length > 80) r.history.shift();
}

function pushCatStep(r: Relation, op: 'add' | 'remove', cat: Category, turn: number, day: number, reason: string): void {
  r.categoryHistory.push({ turn, day, op, category: cat, categories: r.categories.slice(), reason: reason.slice(0, 120) });
  if (r.categoryHistory.length > 40) r.categoryHistory.shift();
}

/**
 * Add a category facet. Auto sources add freely; re-adding is a no-op.
 * Returns the facets actually added (for pulse messaging).
 */
export function addCategories(r: Relation, cats: Category[], turn: number, day: number, reason: string): Category[] {
  const added: Category[] = [];
  for (const c of cats) {
    if (c === 'neutral' || r.categories.includes(c)) continue;
    r.categories = normalizeCategorySet([...r.categories, c]);
    pushCatStep(r, 'add', c, turn, day, reason);
    added.push(c);
  }
  if (added.length) r.category = primaryCategory(r.categories);
  return added;
}

/**
 * Remove a category facet. Auto sources may only remove when allowRemove is set
 * (a quiet turn must never silently strip an established bond); user always may.
 */
export function removeCategories(r: Relation, cats: Category[], turn: number, day: number, reason: string, allow: boolean): Category[] {
  if (!allow) return [];
  const removed: Category[] = [];
  for (const c of cats) {
    if (!r.categories.includes(c)) continue;
    r.categories = normalizeCategorySet(r.categories.filter((x) => x !== c));
    pushCatStep(r, 'remove', c, turn, day, reason);
    removed.push(c);
  }
  if (removed.length) r.category = primaryCategory(r.categories);
  return removed;
}

export { catRank, primaryCategory, normalizeCategorySet };

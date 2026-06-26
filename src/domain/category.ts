import type { Category } from '../core/events.js';

/**
 * Category "maturity" rank. An automatic source may ADD a more-defined facet
 * freely but only REMOVE one when explicitly told; rank also picks the synced
 * PRIMARY category (drives the UI accent + the legacy single-category field).
 */
export const CAT_RANK: Record<Category, number> = {
  neutral: 0,
  social: 1,
  alliance: 2,
  rivalry: 2,
  romantic: 3,
  familial: 3,
};

export function catRank(c: Category): number {
  return CAT_RANK[c] ?? 0;
}

const VALID = new Set<Category>(['familial', 'romantic', 'alliance', 'rivalry', 'social', 'neutral']);

export function isCategory(s: unknown): s is Category {
  return typeof s === 'string' && VALID.has(s as Category);
}

/**
 * Clean a category set: keep valid + de-duped, drop "neutral" once any real
 * bond exists, never return empty (falls back to ['neutral']), rank-desc order
 * so the primary reads first and the UI is stable.
 */
export function normalizeCategorySet(cats: readonly string[]): Category[] {
  let list = Array.from(new Set(cats.map((c) => String(c || '').trim().toLowerCase()).filter(isCategory))) as Category[];
  const meaningful = list.filter((c) => c !== 'neutral');
  if (meaningful.length) list = meaningful;
  if (!list.length) list = ['neutral'];
  return list.sort((a, b) => catRank(b) - catRank(a) || a.localeCompare(b));
}

/** The primary (single) category = highest-rank meaningful member. */
export function primaryCategory(cats: readonly Category[]): Category {
  const list = cats.filter(isCategory);
  const meaningful = list.filter((c) => c !== 'neutral');
  const pool = meaningful.length ? meaningful : list.length ? list : (['neutral'] as Category[]);
  return [...pool].sort((a, b) => catRank(b) - catRank(a))[0] ?? 'neutral';
}

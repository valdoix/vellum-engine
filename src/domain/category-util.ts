import type { Relation } from './types.js';
import type { Category } from '../core/events.js';

/** The active category set of a relation (back-compat single-category fallback). */
export function catsOf(r: Relation): Category[] {
  return r.categories.length ? r.categories : [r.category];
}

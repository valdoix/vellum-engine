import type { Category } from '../core/events.js';

/**
 * Relation locks (Plot Director, Phase 1) — hard, output-side narrative
 * constraints on a specific pair. Unlike directives (which only *suggest* to the
 * model), a lock acts on the fold's OUTPUT: forbidden categories are stripped
 * before they ever become a bond.delta, so the graph can never record them
 * ("Jaime and Cersei will not become lovers"). Pinned categories can't be
 * removed. Pure + deterministic; the backend persists the list, the fold applies
 * it at the single bond chokepoint (core-feature.ts), mirroring the tone strip.
 */

export interface RelationLock {
  /** normalized pair key (sorted canonical ids joined by '|') */
  key: string;
  a: string;
  b: string;
  /** categories this pair may NEVER hold (stripped from addCats) */
  forbid: Category[];
  /** categories this pair must KEEP (protected from removeCats) */
  pin: Category[];
}

/** Order-independent key for a pair, so a lock matches A→B and B→A alike. */
export function lockKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

/** Find the lock governing a pair, regardless of endpoint order. */
export function findLock(locks: readonly RelationLock[] | undefined, a: string, b: string): RelationLock | undefined {
  if (!locks?.length) return undefined;
  const k = lockKey(a, b);
  return locks.find((l) => l.key === k);
}

export interface LockableBond {
  addCats?: Category[];
  removeCats?: Category[];
}

/**
 * Apply a lock to one bond delta: drop forbidden categories from `addCats`, drop
 * pinned categories from `removeCats` (you can't remove what's pinned). Returns a
 * shallow-adjusted copy; arrays that become empty are removed. No lock / no
 * effect → returns the input unchanged (referentially, so no-lock is identity).
 */
export function applyLockToBond<T extends LockableBond>(bond: T, lock: RelationLock | undefined): T {
  if (!lock) return bond;
  let changed = false;
  const out: T = { ...bond };
  if (out.addCats?.length && lock.forbid.length) {
    const kept = out.addCats.filter((c) => !lock.forbid.includes(c));
    if (kept.length !== out.addCats.length) { changed = true; if (kept.length) out.addCats = kept; else delete out.addCats; }
  }
  if (out.removeCats?.length && lock.pin.length) {
    const kept = out.removeCats.filter((c) => !lock.pin.includes(c));
    if (kept.length !== out.removeCats.length) { changed = true; if (kept.length) out.removeCats = kept; else delete out.removeCats; }
  }
  return changed ? out : bond;
}

/** Validate/normalize a raw locks blob (from a chat var) into clean RelationLocks. */
export function sanitizeLocks(raw: unknown): RelationLock[] {
  if (!Array.isArray(raw)) return [];
  const VALID = new Set<Category>(['familial', 'romantic', 'alliance', 'rivalry', 'social', 'neutral']);
  const clean = (arr: unknown): Category[] => Array.isArray(arr) ? Array.from(new Set(arr.filter((c): c is Category => VALID.has(c as Category)))) : [];
  const out: RelationLock[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const a = String(o.a ?? '').trim(); const b = String(o.b ?? '').trim();
    if (!a || !b || a === b) continue;
    const forbid = clean(o.forbid); const pin = clean(o.pin);
    if (!forbid.length && !pin.length) continue; // empty lock = no lock
    out.push({ key: lockKey(a, b), a, b, forbid, pin });
  }
  return out;
}

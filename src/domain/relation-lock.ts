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

// how a pinned category reads as a positive "keep them ___" phrase
const PIN_PHRASE: Record<string, string> = {
  familial: 'family', romantic: 'romantically bonded', alliance: 'allied',
  rivalry: 'rivals', social: 'social acquaintances', neutral: 'on neutral terms',
};
// how a forbidden category reads as a positive nature-statement (never raw "NEVER
// romantic" — that primes the banned token; state what the bond IS/stays instead)
const FORBID_PHRASE: Record<string, string> = {
  romantic: 'stays platonic and does not turn romantic',
  familial: 'is not family and is not treated as kin',
  alliance: 'does not become a true alliance',
  rivalry: 'does not curdle into rivalry',
  social: 'does not become a social/friendly tie',
  neutral: 'does not settle into indifference',
};

/**
 * Injectable guidance for relation locks (Plot Director). PURE. This is the
 * PREVENTION half of a lock — it steers the PROSE away from a forbidden/pinned
 * dynamic up front, while the fold's strip stays as the hard guarantee. Only
 * locks whose BOTH endpoints are PRESENT this turn are injected (off-scene pairs
 * are noise), capped, and phrased POSITIVELY to dodge negation-priming.
 * `nameOf` resolves an id → display name. Returns '' when nothing to say.
 */
export function lockInjection(
  locks: readonly RelationLock[] | undefined,
  presentIds: readonly string[],
  nameOf: (id: string) => string,
  cap = 6,
): string {
  if (!locks?.length || !presentIds.length) return '';
  const present = new Set(presentIds);
  const lines: string[] = [];
  for (const l of locks) {
    if (!present.has(l.a) || !present.has(l.b)) continue; // both endpoints on-scene
    const pair = `${nameOf(l.a)} and ${nameOf(l.b)}`;
    const clauses: string[] = [];
    if (l.pin.length) clauses.push('keep them ' + l.pin.map((c) => PIN_PHRASE[c] ?? c).join(' and '));
    for (const f of l.forbid) clauses.push('their bond ' + (FORBID_PHRASE[f] ?? ('does not become ' + f)));
    if (!clauses.length) continue;
    lines.push(`- ${pair}: ${clauses.join('; ')}.`);
    if (lines.length >= cap) break;
  }
  if (!lines.length) return '';
  return '[RELATIONSHIP GUARDRAILS \u2014 hold these bonds to their set nature; steer the scene accordingly. Do not narrate these as rules]\n' + lines.join('\n');
}


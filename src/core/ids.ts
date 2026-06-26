/**
 * Deterministic ids + hashing. No randomness in the domain layer: the same
 * inputs must always produce the same id/hash so layouts, dedup, and tests are
 * reproducible across runs and worker reloads.
 */

/** 32-bit FNV-1a → 0..1 float. Deterministic, fast, dependency-free. */
export function hash01(input: string): number {
  let h = 2166136261;
  const s = String(input ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** 32-bit FNV-1a → unsigned base36 string. Stable content hash. */
export function hashStr(input: string): string {
  let h = 2166136261;
  const s = String(input ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * Canonical id for a person/thing referenced by name. Strips honorifics, lowers,
 * collapses non-alphanumerics. Must stay in lockstep between backend and UI
 * (legacy had two drifting copies — here it lives once and both import it).
 */
export function canonId(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/^(ser|lord|lady|king|queen|prince|princess|maester|septa|septon|dr|mr|mrs|ms)\.?\s+/i, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

/** Unordered-pair key for a relation edge (identity = the pair, not pair+category). */
export function pairKey(a: string, b: string): string {
  return [String(a ?? ''), String(b ?? '')].sort().join('|').toLowerCase().slice(0, 160);
}

let _seq = 0;
/**
 * Monotonic local sequence for event ordering within a single worker session.
 * Events also carry `turn`; this disambiguates multiple events in one turn.
 */
export function nextSeq(): number {
  return ++_seq;
}

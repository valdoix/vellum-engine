/**
 * Tokenization + stoplist shared by the lexical index and scorer. Kept tiny and
 * dependency-free. The stoplist removes high-frequency words that would
 * otherwise dominate token-overlap scoring; rare tokens (names, lore) are what
 * we want to weight, which is exactly what protects continuity.
 */

const STOP = new Set<string>([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with',
  'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'this', 'that', 'these', 'those',
  'he', 'she', 'they', 'them', 'his', 'her', 'their', 'you', 'your', 'i', 'me', 'my', 'we', 'us', 'our',
  'not', 'no', 'so', 'do', 'did', 'does', 'has', 'had', 'have', 'will', 'would', 'can', 'could', 'should',
  'from', 'up', 'down', 'out', 'into', 'over', 'than', 'too', 'very', 'just', 'now', 'who', 'what', 'when',
  'where', 'how', 'all', 'any', 'some', 'one', 'more', 'most', 'about', 'there', 'here', 'which', 'while',
]);

export function tokenize(text: string): string[] {
  const key = String(text || '');
  if (!key) return [];
  const hit = _memo.get(key);
  if (hit) { _memoHitBump(key); return hit; }
  const toks = key
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
  _memoSet(key, toks);
  return toks;
}

/**
 * Bounded memo for tokenize(). The recall index is rebuilt whenever the log
 * grows (its cache key is the monotonic log version, which is correctness-safe:
 * it also bumps on in-place edits). Most item texts (knowledge facts, memories,
 * journal entries) are STABLE across turns, so without a memo every rebuild
 * re-ran the regex+split+filter over the whole corpus — the dominant per-turn
 * CPU cost that scaled with story length. Memoizing by exact input string keeps
 * output byte-identical while making a rebuild a cheap set of map lookups.
 *
 * The result arrays are treated as immutable by callers; do NOT mutate them.
 */
const _memo = new Map<string, string[]>();
const MEMO_MAX = 20000; // ample for a long chronicle's distinct item texts + queries
function _memoSet(key: string, toks: string[]): void {
  if (_memo.size >= MEMO_MAX) {
    // evict the oldest ~10% (Map preserves insertion order) to cap memory
    const drop = Math.max(1, Math.floor(MEMO_MAX * 0.1));
    let i = 0;
    for (const k of _memo.keys()) { _memo.delete(k); if (++i >= drop) break; }
  }
  _memo.set(key, toks);
}
/** Refresh recency on a hit so hot strings survive eviction (move to newest). */
function _memoHitBump(key: string): void {
  const v = _memo.get(key);
  if (v !== undefined) { _memo.delete(key); _memo.set(key, v); }
}

/** Test/maintenance hook: clear the tokenization memo. */
export function clearTokenizeMemo(): void { _memo.clear(); }

/** Unique token set (for index building + Jaccard-style overlap). */
export function tokenSet(text: string): Set<string> {
  return new Set(tokenize(text));
}

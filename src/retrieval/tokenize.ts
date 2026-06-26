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
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

/** Unique token set (for index building + Jaccard-style overlap). */
export function tokenSet(text: string): Set<string> {
  return new Set(tokenize(text));
}

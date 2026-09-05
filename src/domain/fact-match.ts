/** Conservative near-duplicate matcher shared by reducers and extraction
 * reconciliation. Unicode-aware so names and facts in non-Latin scripts work. */
const STOP = new Set([
  'the', 'a', 'an', 'of', 'and', 'to', 'in', 'on', 'at', 'with', 'for', 'is', 'as', 'by', 's',
  'has', 'have', 'had', 'not', 'yet', 'said', 'words', 'her', 'his', 'their', 'them', 'they',
  'she', 'he', 'it', 'that', 'this', 'who', 'whom', 'been', 'will', 'would', 'about', 'into',
  'from', 'but', 'or', 'so', 'than', 'then', 'now',
]);

export function factTokens(text: string): Set<string> {
  return new Set(String(text || '').normalize('NFKC').toLocaleLowerCase()
    .replace(/['\u2019]s\b/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/u)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)));
}

export function similarFact(a: string, b: string): boolean {
  if (a.normalize('NFKC').toLocaleLowerCase().trim() === b.normalize('NFKC').toLocaleLowerCase().trim()) return true;
  const ta = factTokens(a), tb = factTokens(b);
  if (ta.size < 2 || tb.size < 2) return false;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  let shared = 0;
  for (const token of small) if (big.has(token)) shared++;
  if (shared === small.size) return true;
  const union = ta.size + tb.size - shared;
  return union > 0 && shared / union >= 0.6;
}

import { factTokens } from './fact-match.js';

export interface LorebookCanonEntry {
  id: string;
  bookId: string;
  title?: string;
  keys?: string[];
  content: string;
  constant?: boolean;
  priority?: number;
}

/** Fit attached lore into a bounded model context. Constant entries lead;
 * otherwise exact keys and shared content tokens rank against the live story. */
export function selectLorebookCanon(
  entries: readonly LorebookCanonEntry[],
  query: string,
  maxEntries = 24,
  maxChars = 20_000,
): LorebookCanonEntry[] {
  const queryText = String(query ?? '').normalize('NFKC').toLocaleLowerCase();
  const queryTokens = factTokens(queryText);
  const score = (entry: LorebookCanonEntry): number => {
    let value = entry.constant ? 100_000 : 0;
    value += Math.max(-1000, Math.min(1000, entry.priority ?? 0));
    for (const key of entry.keys ?? []) if (key.trim() && queryText.includes(key.normalize('NFKC').toLocaleLowerCase().trim())) value += 500;
    for (const token of factTokens(`${entry.title ?? ''} ${(entry.keys ?? []).join(' ')} ${entry.content}`)) if (queryTokens.has(token)) value += 12;
    return value;
  };
  const ranked = entries.filter(entry => !!entry.content.trim()).map((entry, index) => ({ entry, index, score: score(entry) }))
    .sort((a, b) => b.score - a.score || Number(!!b.entry.constant) - Number(!!a.entry.constant) || a.index - b.index);
  const out: LorebookCanonEntry[] = [];
  let used = 0;
  for (const { entry } of ranked) {
    if (out.length >= maxEntries || used >= maxChars) break;
    const overhead = (entry.title?.length ?? 0) + (entry.keys?.join(' ').length ?? 0) + 32;
    const room = maxChars - used - overhead;
    if (room < 80) break;
    const content = entry.content.trim().slice(0, Math.min(2400, room));
    if (!content) continue;
    out.push({ ...entry, content });
    used += content.length + overhead;
  }
  return out;
}

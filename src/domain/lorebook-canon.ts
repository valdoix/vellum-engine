import { factTokens } from './fact-match.js';
import { hashStr } from '../core/ids.js';

export interface LorebookCanonEntry {
  id: string;
  bookId: string;
  title?: string;
  keys?: string[];
  secondaryKeys?: string[];
  content: string;
  constant?: boolean;
  priority?: number;
  category?: string;
  group?: string;
}

export interface OpeningLorebookScan {
  situations: Array<{ id: string; fact: string; tag: string }>;
  characters: Array<{ id: string; name: string }>;
  sourceIds: string[];
}

function normalized(value: unknown): string {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}'\s-]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function entryLabels(entry: LorebookCanonEntry): string[] {
  return [entry.title ?? '', ...(entry.keys ?? []), ...(entry.secondaryKeys ?? [])].map(value => String(value).trim()).filter(Boolean);
}

/** True only for lore entries that explicitly describe the opening baseline,
 * not generic biography/history. */
export function isCurrentSituationLore(entry: LorebookCanonEntry): boolean {
  const meta = normalized(`${entry.title ?? ''} ${entry.category ?? ''} ${entry.group ?? ''}`);
  if (/\b(current|opening|initial|starting|scenario|situation|premise|status|plot|subplot)\b/.test(meta)) return true;
  return /\b(currently|at present|right now|as of now|today|tonight|this morning|this evening|has just|have just|ongoing|in progress)\b/i.test(entry.content.slice(0, 2400));
}

function characterName(entry: LorebookCanonEntry): string | undefined {
  const meta = normalized(`${entry.category ?? ''} ${entry.group ?? ''}`);
  const explicit = /\b(character|characters|person|people|npc|npcs|cast|protagonist|antagonist)\b/.test(meta);
  if (isCurrentSituationLore(entry) && !explicit) return undefined;
  const label = entryLabels(entry)[0]?.replace(/^(?:character|npc|profile)\s*[:\-]\s*/i, '').trim();
  if (!label || label.length > 100 || /[.!?;=<>\[\]{}]/.test(label)) return undefined;
  const words = label.split(/\s+/).filter(Boolean);
  const nameLike = words.length >= 1 && words.length <= 6 && words.every(word => /^[\p{Lu}\p{Lt}][\p{L}'’-]*$/u.test(word));
  const bodyLooksPersonal = /\b(?:he|she|they|his|her|their|born|aged?|personality|appearance)\b/i.test(entry.content.slice(0, 1600));
  return explicit || (nameLike && bodyLooksPersonal) ? label : undefined;
}

/** Deterministically scan active lore before turn one. Explicitly current
 * situation entries become confirmed Chronicle canon. Character entries are
 * admitted when the opening query or one of those situations names them. */
export function scanOpeningLorebook(entries: readonly LorebookCanonEntry[], query: string, maxRows = 24): OpeningLorebookScan {
  const usable = entries.filter(entry => entry.content.trim());
  const situations = usable.filter(isCurrentSituationLore).slice(0, Math.max(1, Math.min(12, maxRows)));
  const relevanceText = normalized(`${query}\n${situations.map(entry => `${entryLabels(entry).join(' ')} ${entry.content}`).join('\n')}`);
  const related = (entry: LorebookCanonEntry): boolean => entryLabels(entry).some(label => {
    const phrase = normalized(label);
    return phrase.length >= 3 && (` ${relevanceText} `).includes(` ${phrase} `);
  });
  const characters = usable.map(entry => ({ entry, name: characterName(entry) }))
    .filter((row): row is { entry: LorebookCanonEntry; name: string } => !!row.name && related(row.entry))
    .slice(0, Math.max(0, maxRows - situations.length));
  const sourceIds = [...new Set([...situations, ...characters.map(row => row.entry)].map(entry => `lorebook:${entry.bookId}:${entry.id}`))];
  return {
    situations: situations.map(entry => ({
      id: `lorebook_seed_${hashStr(`${entry.bookId}\u0000${entry.id}`).slice(0, 16)}`,
      fact: entry.content.trim().slice(0, 4000),
      tag: (entry.title || entry.keys?.[0] || 'Opening situation').trim().slice(0, 120),
    })),
    characters: characters.map(({ name }) => ({
      id: normalized(name).replace(/[^\p{L}\p{N}]+/gu, '_'),
      name,
    })).filter((row, index, rows) => row.id && rows.findIndex(other => other.id === row.id) === index),
    sourceIds,
  };
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
    for (const key of [...(entry.keys ?? []), ...(entry.secondaryKeys ?? [])]) if (key.trim() && queryText.includes(key.normalize('NFKC').toLocaleLowerCase().trim())) value += 500;
    for (const token of factTokens(`${entry.title ?? ''} ${(entry.keys ?? []).join(' ')} ${(entry.secondaryKeys ?? []).join(' ')} ${entry.content}`)) if (queryTokens.has(token)) value += 12;
    return value;
  };
  const ranked = entries.filter(entry => !!entry.content.trim()).map((entry, index) => ({ entry, index, score: score(entry) }))
    .sort((a, b) => b.score - a.score || Number(!!b.entry.constant) - Number(!!a.entry.constant) || a.index - b.index);
  const out: LorebookCanonEntry[] = [];
  let used = 0;
  for (const { entry } of ranked) {
    if (out.length >= maxEntries || used >= maxChars) break;
    const overhead = (entry.title?.length ?? 0) + (entry.keys?.join(' ').length ?? 0) + (entry.secondaryKeys?.join(' ').length ?? 0) + 32;
    const room = maxChars - used - overhead;
    if (room < 80) break;
    const content = entry.content.trim().slice(0, Math.min(2400, room));
    if (!content) continue;
    out.push({ ...entry, content });
    used += content.length + overhead;
  }
  return out;
}

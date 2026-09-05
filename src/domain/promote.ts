import type { ChronicleState, CastCard, Relation, Memory } from './types.js';
import type { SyncSource } from './vault.js';
import { hashStr } from '../core/ids.js';
import { catsOf } from './category-util.js';
import { dedupeKeys } from './chapter-vault.js';

/** Typed adapters from canonical Chronicle records to optional host lorebook
 * projections. Restricted information stays in VELLUM recall and is never
 * keyword-injected by the host. */
export type PromoteKind = 'cast' | 'relation' | 'faction' | 'location' | 'item' | 'knowledge' | 'secret'
  | 'memory' | 'thread' | 'journal' | 'scar' | 'lore' | 'timeline';

export interface Promotion {
  category: string; key: string[]; keysecondary: string[]; content: string; comment: string;
  link: string; hash: string; audience: 'public' | 'restricted'; source: SyncSource;
}

const sig = (s: string): string => hashStr(s.trim());
const nameOf = (s: ChronicleState, id?: string): string => id ? (s.cast[id]?.name ?? id) : '';
const aliases = (s: ChronicleState, id?: string): string[] => id && s.cast[id] ? [s.cast[id]!.name, ...(s.cast[id]!.aka ?? [])] : id ? [id] : [];
const promotion = (p: Omit<Promotion, 'hash'>): Promotion => ({ ...p, key: dedupeKeys(p.key), keysecondary: dedupeKeys(p.keysecondary), hash: sig(p.content) });

export function castContent(c: CastCard): string {
  const bits = [c.role, c.age, c.appearance].filter(Boolean).join('; ');
  const aka = (c.aka ?? []).length ? ` Also known as ${(c.aka ?? []).join(', ')}.` : '';
  const traits = (c.traits ?? []).length ? ` Traits: ${(c.traits ?? []).join(', ')}.` : '';
  return `${c.name}${bits ? ' — ' + bits + '.' : '.'}${aka}${c.disposition ? ' ' + c.disposition : ''}${traits}${c.note ? ' ' + c.note : ''}`.trim();
}

function relationAt(s: ChronicleState, id: string): Relation | null {
  return s.relations.find((x) => `${x.a}|${x.b}` === id) ?? s.relations[Number(id)] ?? null;
}

export function buildPromotion(s: ChronicleState, kind: PromoteKind, id: string): Promotion | null {
  if (kind === 'cast') {
    const c = s.cast[id]; if (!c) return null; const content = castContent(c);
    return promotion({ category: 'characters', key: [c.name, ...(c.aka ?? [])], keysecondary: [], content, comment: 'VELLUM cast: ' + c.name, link: 'cast:' + c.id, audience: 'public', source: 'cast' });
  }
  if (kind === 'relation') {
    const r = relationAt(s, id); if (!r) return null; const an = nameOf(s, r.a), bn = nameOf(s, r.b);
    const content = `${an} and ${bn}: ${catsOf(r).join(', ')} (${r.sentiment}).${r.label ? ' ' + r.label + '.' : ''} Affection ${r.affection}, trust ${r.trust}.`;
    return promotion({ category: 'relationships', key: [...aliases(s, r.a), ...aliases(s, r.b)], keysecondary: [], content, comment: `${an} ↔ ${bn}`, link: `rel:${r.a}|${r.b}`, audience: r.status === 'secret' ? 'restricted' : 'public', source: 'relations' });
  }
  if (kind === 'faction') {
    const f = s.factions[id]; if (!f) return null;
    const members = s.memberships.filter((m) => m.faction === f.id).map((m) => `${nameOf(s, m.char)}${m.role ? ` (${m.role})` : ''}`);
    const seat = f.seat ? (s.locations.find((l) => l.id === f.seat)?.name ?? f.seat) : '';
    const rels = s.factionRelations.filter((r) => r.a === f.id).map((r) => `${r.kind} with ${s.factions[r.b]?.name ?? r.b}`);
    const content = [f.kind ? `Kind: ${f.kind}.` : '', seat ? `Seat: ${seat}.` : '', `Standing ${f.standing}; trust ${f.trust}.`, rels.length ? `Relations: ${rels.join('; ')}.` : '', members.length ? `Members: ${members.join(', ')}.` : '', f.note ?? ''].filter(Boolean).join('\n');
    return promotion({ category: 'factions', key: [f.name, ...(f.aka ?? []), ...members.map((m) => m.replace(/\s*\(.*/, ''))], keysecondary: [], content, comment: `Faction · ${f.name}`, link: `faction:${f.id}`, audience: 'public', source: 'factions' });
  }
  if (kind === 'location') {
    const l = s.locations.find((x) => x.id === id); if (!l) return null;
    const parent = l.parent ? s.locations.find((x) => x.id === l.parent)?.name ?? l.parent : '';
    const content = `${l.name}.${parent ? ` Within ${parent}.` : ''}${l.note ? ' ' + l.note : ''}`;
    return promotion({ category: 'locations', key: [l.name, ...(parent ? [parent] : [])], keysecondary: [], content, comment: `Location · ${l.name}`, link: `location:${l.id}`, audience: 'public', source: 'locations' });
  }
  if (kind === 'item') {
    const it = s.items.find((x) => x.id === id); if (!it) return null; const holder = it.who === 'world' ? 'the scene/world' : nameOf(s, it.who);
    const history = s.itemHistory.filter((x) => x.itemId === it.id).slice(-6).map((x) => `${x.op}${x.from ? ` from ${nameOf(s, x.from)}` : ''}${x.to ? ` to ${nameOf(s, x.to)}` : ''}${x.note ? ` (${x.note})` : ''}`);
    const content = `${it.item} is currently held by ${holder}.${it.note ? ` ${it.note}` : ''}${history.length ? `\nRecent history: ${history.join('; ')}.` : ''}`;
    return promotion({ category: 'items', key: [it.item, ...aliases(s, it.who)], keysecondary: [], content, comment: `Item · ${it.item}`, link: `item:${it.id}`, audience: 'public', source: 'items' });
  }
  if (kind === 'lore') {
    const l = s.lore.find((x) => x.id === id); if (!l || l.status === 'rejected') return null;
    const content = `${l.status === 'provisional' ? 'PROVISIONAL' : 'CONFIRMED'}${l.tag ? ` [${l.tag}]` : ''}: ${l.fact}`;
    return promotion({ category: 'concepts', key: [l.tag ?? '', ...l.fact.split(/\s+/).filter((x) => /^[A-Z][\p{L}\p{N}'’-]{2,}$/u.test(x)).slice(0, 8)], keysecondary: [], content, comment: `Codex · ${l.tag || l.id}`, link: `lore:${l.id}`, audience: 'public', source: 'lore' });
  }
  if (kind === 'thread') {
    const t = [...s.threads, ...s.arcs].find((x) => x.id === id); if (!t) return null;
    const content = `${t.name}: ${t.status}.${t.beats.length ? `\nHistory: ${t.beats.join('; ')}` : ''}`;
    return promotion({ category: 'threads', key: [t.name], keysecondary: [], content, comment: `Thread · ${t.name}`, link: `thread:${t.id}`, audience: 'public', source: 'threads' });
  }
  if (kind === 'memory' || kind === 'timeline') {
    const m = s.memories.find((x) => x.id === id) as Memory | undefined; if (!m) return null;
    if (kind === 'timeline' && m.tier !== 'beat') return null;
    const category = m.tier === 'beat' ? 'events' : 'summary';
    const prefix = m.tier === 'beat' ? 'timeline' : m.tier === 'chapter' || m.tier === 'arc' || m.tier === 'book' ? m.tier : 'memory';
    return promotion({ category, key: m.keys ?? [], keysecondary: [], content: m.detail || m.text, comment: `${m.tier} · turn ${m.turn}`, link: `${prefix}:${m.id}`, audience: 'public', source: m.tier === 'beat' ? 'timeline' : 'memories' });
  }
  if (kind === 'secret') {
    const sec = s.secrets.find((x) => x.id === id); if (!sec) return null;
    const known = [...new Set([sec.keeper, ...(sec.revealedTo ?? [])])]; const hidden = (sec.from ?? []).filter((x) => !known.includes(x));
    const audience = sec.revealed && hidden.length === 0 ? 'public' : 'restricted';
    const content = `Secret: ${sec.text}. Known by ${known.map((x) => nameOf(s, x)).join(', ') || 'none'}.`;
    return promotion({ category: 'secrets', key: [...known.flatMap((x) => aliases(s, x))], keysecondary: [], content, comment: `Secret · ${sec.id}`, link: `secret:${sec.id}`, audience, source: 'secrets' });
  }
  if (kind === 'knowledge') {
    const k = s.knowledge.find((x) => x.id === id); if (!k) return null;
    const content = `${nameOf(s, k.who)} ${k.reliability}: ${k.fact}. Actual truth: ${k.truth}.${k.source ? ` Source: ${k.source}.` : ''}`;
    return promotion({ category: 'knowledge', key: [...aliases(s, k.who), ...aliases(s, k.about)], keysecondary: [], content, comment: `Knowledge · ${nameOf(s, k.who)}`, link: `knowledge:${k.id}`, audience: 'restricted', source: 'knowledge' });
  }
  if (kind === 'journal') {
    const j = s.journal.find((x) => x.id === id); if (!j) return null;
    const content = `${nameOf(s, j.who)} remembers (${j.weight}, ${j.sentiment}): ${j.memory}.`;
    return promotion({ category: 'journal', key: [...aliases(s, j.who), ...aliases(s, j.about)], keysecondary: [], content, comment: `Memory · ${nameOf(s, j.who)}`, link: `journal:${j.id}`, audience: 'restricted', source: 'journal' });
  }
  if (kind === 'scar') {
    const x = s.scars.find((v) => v.id === id); if (!x) return null;
    const content = `${nameOf(s, x.who)} once believed “${x.was}”. This was disproven and may resurface only as doubt, never fact.`;
    return promotion({ category: 'scars', key: [...aliases(s, x.who), ...aliases(s, x.about)], keysecondary: [], content, comment: `Scar · ${nameOf(s, x.who)}`, link: `scar:${x.id}`, audience: 'restricted', source: 'scars' });
  }
  return null;
}

const sourceKinds: Record<SyncSource, PromoteKind> = {
  cast: 'cast', relations: 'relation', factions: 'faction', locations: 'location', items: 'item', knowledge: 'knowledge',
  secrets: 'secret', memories: 'memory', threads: 'thread', journal: 'journal', scars: 'scar', lore: 'lore', timeline: 'timeline',
};

export function sourceIds(s: ChronicleState, source: SyncSource): string[] {
  if (source === 'cast') return Object.keys(s.cast);
  if (source === 'relations') return s.relations.map((r) => `${r.a}|${r.b}`);
  if (source === 'factions') return Object.keys(s.factions);
  if (source === 'locations') return s.locations.map((x) => x.id);
  if (source === 'items') return s.items.map((x) => x.id);
  if (source === 'knowledge') return s.knowledge.map((x) => x.id);
  if (source === 'secrets') return s.secrets.map((x) => x.id);
  if (source === 'memories') return s.memories.filter((x) => x.tier !== 'beat').map((x) => x.id);
  if (source === 'timeline') return s.memories.filter((x) => x.tier === 'beat').map((x) => x.id);
  if (source === 'threads') return [...s.threads, ...s.arcs].map((x) => x.id);
  if (source === 'journal') return s.journal.map((x) => x.id);
  if (source === 'scars') return s.scars.map((x) => x.id);
  return s.lore.map((x) => x.id);
}

export function promotionsForSource(s: ChronicleState, source: SyncSource): Promotion[] {
  return sourceIds(s, source).map((id) => buildPromotion(s, sourceKinds[source], id)).filter((p): p is Promotion => !!p && p.audience === 'public');
}

export interface ManagedEntry {
  id: string; link: string; hash?: string; content?: string; disabled?: boolean;
  bodyState?: 'clean' | 'override' | 'conflict' | 'legacy'; overrideFields?: string[];
}
export interface ReconcilePlan {
  update: Array<{ entryId: string; promotion: Promotion; enable: boolean }>;
  disable: string[];
  conflicts: Array<{ entryId: string; link: string; reason: 'body_changed' | 'user_override' }>;
}

export function reconcileCategory(s: ChronicleState, source: SyncSource, managed: ManagedEntry[]): ReconcilePlan {
  const plan: ReconcilePlan = { update: [], disable: [], conflicts: [] }; const kind = sourceKinds[source];
  const allowedPrefix: Record<SyncSource, string[]> = {
    cast: ['cast'], relations: ['rel'], factions: ['faction'], locations: ['location'], items: ['item'], knowledge: ['knowledge'],
    secrets: ['secret'], memories: ['memory', 'chapter', 'arc', 'book'], threads: ['thread'], journal: ['journal'], scars: ['scar'], lore: ['lore'], timeline: ['timeline'],
  };
  for (const m of managed) {
    const colon = m.link.indexOf(':'); if (colon < 0) continue;
    if (!allowedPrefix[source].includes(m.link.slice(0, colon))) continue;
    const promo = buildPromotion(s, kind, m.link.slice(colon + 1));
    if (!promo || promo.audience !== 'public') { if (!m.disabled) plan.disable.push(m.id); continue; }
    if (promo.hash === m.hash && !m.disabled) continue;
    if (m.overrideFields?.includes('content') || m.bodyState === 'override') plan.conflicts.push({ entryId: m.id, link: m.link, reason: 'user_override' });
    else if (m.bodyState === 'conflict' || (m.bodyState === 'legacy' && m.content?.trim() !== promo.content.trim())) plan.conflicts.push({ entryId: m.id, link: m.link, reason: 'body_changed' });
    else plan.update.push({ entryId: m.id, promotion: promo, enable: !!m.disabled });
  }
  return plan;
}

import type { ChronicleState, CastCard, Relation, Secret, Memory } from './types.js';
import { hashStr } from '../core/ids.js';
import { catsOf } from './category-util.js';

/**
 * Promotion + reconciliation: turn chronicle records (cast, relations, secrets,
 * memories) into world-book entry payloads, and decide when an auto-synced entry
 * needs updating. PURE + tested — the backend does the host I/O.
 *
 * Every produced entry carries a `link` (the chronicle id it mirrors) and a
 * content `hash`, so Tier-B sync can detect "source changed → update" vs
 * "unchanged → noop", and never touches entries it doesn't own.
 */

export type PromoteKind = 'cast' | 'relation' | 'secret' | 'memory';

export interface Promotion {
  category: string;
  key: string[];
  keysecondary: string[];
  content: string;
  comment: string;
  link: string;     // chronicle id this entry mirrors
  hash: string;     // content signature for change detection
}

const sig = (s: string): string => hashStr(s);

export function castContent(c: CastCard): string {
  const bits = [c.role, c.age, c.appearance].filter(Boolean).join('; ');
  const aka = (c.aka ?? []).length ? ` Also known as ${(c.aka ?? []).join(', ')}.` : '';
  return `${c.name}${bits ? ' — ' + bits + '.' : '.'}${aka}${c.note ? ' ' + c.note : ''}`.trim();
}

function nameOf(s: ChronicleState, id: string): string { return s.cast[id]?.name ?? id; }

/** Build a promotion payload for one chronicle record. Returns null if missing. */
export function buildPromotion(s: ChronicleState, kind: PromoteKind, id: string): Promotion | null {
  if (kind === 'cast') {
    const c = s.cast[id]; if (!c) return null;
    const content = castContent(c);
    return { category: 'characters', key: [c.name, ...(c.aka ?? [])].filter(Boolean), keysecondary: [], content, comment: 'VELLUM cast: ' + c.name, link: 'cast:' + c.id, hash: sig(content) };
  }
  if (kind === 'relation') {
    const r = s.relations.find((x) => `${x.a}|${x.b}` === id) ?? s.relations[Number(id)] ?? null;
    const rel = (r as Relation | null); if (!rel) return null;
    const an = nameOf(s, rel.a), bn = nameOf(s, rel.b);
    const cats = catsOf(rel).join(', ');
    const content = `${an} and ${bn}: ${cats} (${rel.sentiment}).${rel.label ? ' ' + rel.label + '.' : ''} Affection ${rel.affection}, trust ${rel.trust}.`;
    return { category: 'relationships', key: [an, bn], keysecondary: [], content, comment: `${an} \u2194 ${bn}`, link: `rel:${rel.a}|${rel.b}`, hash: sig(content) };
  }
  if (kind === 'secret') {
    const sec = s.secrets.find((x) => x.id === id); if (!sec) return null;
    const keeper = nameOf(s, sec.keeper);
    const content = `${keeper} keeps a secret: ${sec.text}${sec.from.length ? ' (hidden from ' + sec.from.map((f) => nameOf(s, f)).join(', ') + ')' : ''}.`;
    return { category: 'characters', key: [keeper], keysecondary: [], content, comment: 'Secret: ' + sec.text.slice(0, 40), link: 'secret:' + sec.id, hash: sig(content) };
  }
  if (kind === 'memory') {
    const m = s.memories.find((x) => x.id === id) as Memory | undefined; if (!m) return null;
    const content = m.text;
    return { category: 'events', key: m.keys.length ? m.keys.slice(0, 8) : [], keysecondary: [], content, comment: 'Memory (turn ' + m.turn + ')', link: 'memory:' + m.id, hash: sig(content) };
  }
  return null;
}

export interface ManagedEntry { id: string; link: string; hash?: string }

export interface ReconcilePlan {
  update: Array<{ entryId: string; promotion: Promotion }>; // source changed
  // (create/delete are Tier C; Tier B only refreshes existing linked entries)
}

/**
 * Tier-B reconcile: for a category bound to a chronicle source, refresh the
 * CONTENT of Vault-owned entries whose linked source changed. Pure: given the
 * current state + the set of managed (vellum-owned, linked) entries, return the
 * updates to apply. Never creates/deletes; never references untagged entries.
 */
export function reconcileCategory(
  s: ChronicleState,
  source: 'cast' | 'relations' | 'secrets' | 'memories' | 'threads',
  managed: ManagedEntry[],
): ReconcilePlan {
  const plan: ReconcilePlan = { update: [] };
  const kind: PromoteKind | null = source === 'cast' ? 'cast' : source === 'relations' ? 'relation' : source === 'secrets' ? 'secret' : source === 'memories' ? 'memory' : null;
  if (!kind) return plan;
  for (const m of managed) {
    // link form is "<kind-prefix>:<id>"; extract the chronicle id
    const colon = m.link.indexOf(':');
    if (colon < 0) continue;
    const cid = m.link.slice(colon + 1);
    const promo = buildPromotion(s, kind, cid);
    if (!promo) continue; // source gone — Tier C would handle deletion; leave as-is
    if (promo.hash !== m.hash) plan.update.push({ entryId: m.id, promotion: promo });
  }
  return plan;
}

import type { VellumEvent, Category } from '../core/events.js';
import { canonId } from '../core/ids.js';
import { isCategory } from '../domain/category.js';

/**
 * Legacy importer: replays a vellum-tracker (1.x) chronicle blob into a
 * VellumEvent[] with src:'import', so existing users keep their history on the
 * new event-log engine. Pure + tested: takes the parsed legacy object, returns
 * events; the backend persists them.
 *
 * Legacy shape (freshChronicle): { turns, lastDay, cast:{id->card}, relations:[],
 * knowledge:[], secrets:[], memories:[], threads:{}, arcs:{}, ... }
 */

interface LegacyCard { id?: string; name?: string; aka?: string[]; age?: string; role?: string; appearance?: string; note?: string; status?: string; firstTurn?: number; lastTurn?: number; source?: string }
interface LegacyRel { a?: string; b?: string; label?: string; categories?: string[]; category?: string; affection?: number; trust?: number; sentiment?: string; status?: string; source?: string }
interface LegacyChronicle {
  turns?: number; lastDay?: number;
  cast?: Record<string, LegacyCard>;
  relations?: LegacyRel[];
  knowledge?: Array<{ who?: string; keeper?: string; fact?: string; text?: string; about?: string; turn?: number }>;
  secrets?: Array<{ id?: string; keeper?: string; from?: string[]; secret?: string; text?: string; revealed?: boolean; turn?: number }>;
  memories?: Array<{ id?: string; title?: string; gist?: string; text?: string; summary?: string; keywords?: string[]; turn?: number }>;
  threads?: Record<string, { title?: string; status?: string; lastTurn?: number }>;
  arcs?: Record<string, { title?: string; status?: string; lastTurn?: number }>;
}

export function importLegacy(raw: unknown): VellumEvent[] {
  const ch = (raw && typeof raw === 'object' ? raw : {}) as LegacyChronicle;
  const events: VellumEvent[] = [];
  let seq = 0;
  const day = ch.lastDay ?? 1;
  const turn = ch.turns ?? 0;
  const base = () => ({ seq: ++seq, turn, day, src: 'import' as const });

  // cast
  for (const c of Object.values(ch.cast ?? {})) {
    const name = c.name ?? c.id;
    if (!name) continue;
    const id = canonId(name);
    const status = (c.status === 'present' || c.status === 'active' || c.status === 'mentioned' || c.status === 'added') ? c.status : 'active';
    events.push({ ...base(), kind: 'cast.seen', id, name, status });
    const patch: Record<string, unknown> = {};
    if (c.aka?.length) patch.aka = c.aka;
    if (c.age) patch.age = c.age;
    if (c.role) patch.role = c.role;
    if (c.appearance) patch.appearance = c.appearance;
    if (c.note) patch.note = c.note;
    if (Object.keys(patch).length) events.push({ ...base(), kind: 'cast.edit', id, patch });
  }

  // relations → set absolute scores + add category facets
  for (const r of ch.relations ?? []) {
    if (!r.a || !r.b) continue;
    const a = canonId(r.a), b = canonId(r.b);
    if (a === b) continue;
    const cats = (r.categories?.length ? r.categories : r.category ? [r.category] : [])
      .map((c) => String(c).toLowerCase()).filter(isCategory) as Category[];
    events.push({
      ...base(), kind: 'bond.delta', a, b,
      aff: typeof r.affection === 'number' ? r.affection : 0,
      trust: typeof r.trust === 'number' ? r.trust : 0,
      absolute: true,
      ...(cats.length ? { addCats: cats } : {}),
      ...(r.label ? { label: r.label } : {}),
    });
  }

  // knowledge
  let ki = 0;
  for (const k of ch.knowledge ?? []) {
    const who = k.who ?? k.keeper;
    const fact = k.fact ?? k.text;
    if (!who || !fact) continue;
    events.push({ ...base(), kind: 'knowledge.learn', who: canonId(who), fact, ...(k.about ? { about: canonId(k.about) } : {}) });
    ki++;
  }

  // secrets
  let si = 0;
  for (const s of ch.secrets ?? []) {
    const text = s.secret ?? s.text;
    if (!s.keeper || !text) continue;
    const id = s.id ?? 'sec_import_' + si++;
    events.push({ ...base(), kind: 'secret.form', id, keeper: canonId(s.keeper), from: (s.from ?? []).map(canonId), text });
    if (s.revealed) events.push({ ...base(), kind: 'secret.reveal', id, to: [] });
  }

  // memories
  let mi = 0;
  for (const m of ch.memories ?? []) {
    const text = m.gist ?? m.text ?? m.summary;
    if (!text) continue;
    events.push({ ...base(), kind: 'memory.record', id: m.id ?? 'mem_import_' + mi++, tier: 'chapter', text, keys: m.keywords ?? (m.title ? [m.title] : []) });
  }

  // threads + arcs
  for (const t of Object.values(ch.threads ?? {})) {
    if (t.title) events.push({ ...base(), kind: 'thread.op', op: t.status === 'resolved' ? 'resolve' : 'advance', name: t.title, ...(t.status ? { note: t.status } : {}) });
  }
  for (const a of Object.values(ch.arcs ?? {})) {
    if (a.title) events.push({ ...base(), kind: 'arc.op', op: a.status === 'resolved' ? 'resolve' : 'advance', name: a.title, ...(a.status ? { note: a.status } : {}) });
  }

  // a fold marker so turns/day land
  events.unshift({ seq: 0, turn, day, src: 'import', kind: 'turn.fold', sig: 'legacy-import' });
  return events;
}

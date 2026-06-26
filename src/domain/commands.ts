import type { VellumEvent, Category } from '../core/events.js';
import type { ChronicleState } from './types.js';
import { canonId, nextSeq, pairKey } from '../core/ids.js';
import { isCategory, normalizeCategorySet } from './category.js';

/**
 * Command layer: turn a UI CRUD intent into VellumEvent[] (src:'user', so user
 * edits win over auto in the reducer). One small mapper per entity; the backend
 * appends whatever this returns. Pure + testable.
 */

interface Ctx { turn: number; day: number }
const base = (c: Ctx) => ({ seq: nextSeq(), turn: c.turn, day: c.day, src: 'user' as const });

export function cmdEvents(type: string, payload: Record<string, any>, state: ChronicleState, ctx: Ctx): VellumEvent[] {
  const e = payload.entry ?? payload;
  switch (type) {
    case 'cast_upsert': {
      const name = String(e.name ?? '').trim();
      if (!name) return [];
      const id = e.id ? String(e.id) : canonId(name);
      const patch: Record<string, unknown> = {};
      for (const k of ['name', 'role', 'age', 'appearance', 'note']) if (e[k] !== undefined) patch[k] = e[k];
      if (Array.isArray(e.aka)) patch.aka = e.aka;
      else if (typeof e.aka === 'string') patch.aka = e.aka.split(',').map((s: string) => s.trim()).filter(Boolean);
      const out: VellumEvent[] = [];
      if (!state.cast[id]) out.push({ ...base(ctx), kind: 'cast.seen', id, name, status: (e.status ?? 'active') } as VellumEvent);
      out.push({ ...base(ctx), kind: 'cast.edit', id, patch } as VellumEvent);
      return out;
    }
    case 'cast_delete':
      return e.id ? [{ ...base(ctx), kind: 'cast.drop', id: String(e.id) } as VellumEvent] : [];
    case 'relation_upsert': {
      const a = canonId(e.a ?? ''), b = canonId(e.b ?? '');
      if (!a || !b || a === b) return [];
      const cats = normalizeCategorySet(
        (Array.isArray(e.categories) ? e.categories : typeof e.categories === 'string' ? e.categories.split(',') : [])
          .map((c: string) => String(c).trim().toLowerCase()).filter(isCategory),
      ) as Category[];
      const existing = state.relations.find((r) => pairKey(r.a, r.b) === pairKey(a, b));
      const ev: any = { ...base(ctx), kind: 'bond.delta', a, b, absolute: true };
      if (e.aff !== undefined || e.affection !== undefined) ev.aff = Number(e.aff ?? e.affection) || 0;
      if (e.trust !== undefined) ev.trust = Number(e.trust) || 0;
      if (e.label !== undefined) ev.label = String(e.label);
      // replace the whole set: add the new, drop the ones removed
      if (cats.length) {
        ev.addCats = cats;
        if (existing) { const rm = (existing.categories || []).filter((c) => !cats.includes(c) && c !== 'neutral'); if (rm.length) ev.removeCats = rm; }
      }
      return [ev as VellumEvent];
    }
    case 'relation_delete': {
      const a = canonId(e.a ?? ''), b = canonId(e.b ?? '');
      if (e.id) { const r = state.relations.find((x) => pairKey(x.a, x.b) === e.id || `${x.a}|${x.b}` === e.id); if (r) return [{ ...base(ctx), kind: 'bond.drop', a: r.a, b: r.b } as VellumEvent]; }
      return (a && b) ? [{ ...base(ctx), kind: 'bond.drop', a, b } as VellumEvent] : [];
    }
    case 'knowledge_add': {
      const who = canonId(e.who ?? ''); const fact = String(e.fact ?? '').trim();
      if (!who || !fact) return [];
      return [{ ...base(ctx), kind: 'knowledge.learn', who, fact, ...(e.about ? { about: canonId(e.about) } : {}) } as VellumEvent];
    }
    case 'secret_add': {
      const keeper = canonId(e.keeper ?? ''); const text = String(e.text ?? e.secret ?? '').trim();
      if (!keeper || !text) return [];
      const id = e.id ? String(e.id) : 'sec_' + nextSeq();
      const from = (Array.isArray(e.from) ? e.from : String(e.from ?? '').split(',')).map((s: string) => canonId(s)).filter(Boolean);
      return [{ ...base(ctx), kind: 'secret.form', id, keeper, from, text } as VellumEvent];
    }
    case 'secret_reveal':
      return e.id ? [{ ...base(ctx), kind: 'secret.reveal', id: String(e.id), to: (Array.isArray(e.to) ? e.to : []).map((s: string) => canonId(s)) } as VellumEvent] : [];
    case 'memory_add': {
      const text = String(e.text ?? '').trim(); if (!text) return [];
      const keys = Array.isArray(e.keys) ? e.keys : String(e.keys ?? '').split(',').map((s: string) => s.trim()).filter(Boolean);
      return [{ ...base(ctx), kind: 'memory.record', id: 'mem_' + nextSeq(), tier: (e.tier ?? 'chapter'), text, keys } as VellumEvent];
    }
    case 'memory_delete':
      return e.id ? [{ ...base(ctx), kind: 'memory.drop', id: String(e.id) } as VellumEvent] : [];
    case 'thread_op':
      return e.name ? [{ ...base(ctx), kind: 'thread.op', op: (e.op ?? 'advance'), name: String(e.name), ...(e.note ? { note: String(e.note) } : {}) } as VellumEvent] : [];
    case 'arc_op':
      return e.name ? [{ ...base(ctx), kind: 'arc.op', op: (e.op ?? 'advance'), name: String(e.name), ...(e.note ? { note: String(e.note) } : {}) } as VellumEvent] : [];
    default:
      return [];
  }
}

export const CMD_TYPES = new Set([
  'cast_upsert', 'cast_delete', 'relation_upsert', 'relation_delete',
  'knowledge_add', 'secret_add', 'secret_reveal', 'memory_add', 'memory_delete',
  'thread_op', 'arc_op',
]);

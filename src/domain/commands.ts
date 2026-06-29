import type { VellumEvent, Category } from '../core/events.js';
import type { ChronicleState } from './types.js';
import { canonId, nextSeq } from '../core/ids.js';
import { resolveFactionId } from './identity.js';
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
      // name color: accept #hex; '' clears; anything else is dropped (no junk stored)
      const hex = (v: unknown): string | undefined => { const s = String(v ?? '').trim(); return s === '' ? '' : (/^#[0-9a-fA-F]{6}$/.test(s) ? s : undefined); };
      if (e.color !== undefined) { const c = hex(e.color); if (c !== undefined) patch.color = c; }
      if (e.colorTo !== undefined) { const c = hex(e.colorTo); if (c !== undefined) patch.colorTo = c; }
      if (Array.isArray(e.aka)) patch.aka = e.aka;
      else if (typeof e.aka === 'string') patch.aka = e.aka.split(',').map((s: string) => s.trim()).filter(Boolean);
      const out: VellumEvent[] = [];
      if (!state.cast[id]) out.push({ ...base(ctx), kind: 'cast.seen', id, name, status: (e.status ?? 'active') } as VellumEvent);
      out.push({ ...base(ctx), kind: 'cast.edit', id, patch } as VellumEvent);
      return out;
    }
    case 'cast_delete':
      return e.id ? [{ ...base(ctx), kind: 'cast.drop', id: String(e.id) } as VellumEvent] : [];
    case 'faction_upsert': {
      const name = String(e.name ?? '').trim();
      if (!name) return [];
      const id = e.id ? String(e.id) : (resolveFactionId(state, name) || ('fac:' + canonId(name)));
      if (!id) return [];
      const patch: Record<string, unknown> = {};
      for (const k of ['name', 'kind', 'note']) if (e[k] !== undefined) patch[k] = e[k];
      if (Array.isArray(e.aka)) patch.aka = e.aka;
      else if (typeof e.aka === 'string') patch.aka = e.aka.split(',').map((s: string) => s.trim()).filter(Boolean);
      const out: VellumEvent[] = [];
      if (!state.factions[id]) out.push({ ...base(ctx), kind: 'faction.seen', id, name, status: (e.status ?? 'active') } as VellumEvent);
      out.push({ ...base(ctx), kind: 'faction.edit', id, patch } as VellumEvent);
      if (e.standing !== undefined || e.trust !== undefined) {
        out.push({ ...base(ctx), kind: 'faction.standing', faction: id, ...(e.standing !== undefined ? { standing: Number(e.standing) || 0 } : {}), ...(e.trust !== undefined ? { trust: Number(e.trust) || 0 } : {}), absolute: true } as VellumEvent);
      }
      return out;
    }
    case 'faction_delete':
      return e.id ? [{ ...base(ctx), kind: 'faction.drop', id: String(e.id) } as VellumEvent] : [];
    case 'faction_member': {
      const char = canonId(e.char ?? '');
      const faction = e.faction ? String(e.faction) : resolveFactionId(state, e.factionName ?? '');
      if (!char || !faction) return [];
      const op = e.op === 'remove' ? 'remove' : 'add';
      return [{ ...base(ctx), kind: 'faction.member', char, faction, op, ...(e.role ? { role: String(e.role) } : {}) } as VellumEvent];
    }
    case 'faction_standing_set': {
      const faction = e.faction ? String(e.faction) : resolveFactionId(state, e.factionName ?? '');
      if (!faction) return [];
      return [{ ...base(ctx), kind: 'faction.standing', faction, ...(e.standing !== undefined ? { standing: Number(e.standing) || 0 } : {}), ...(e.trust !== undefined ? { trust: Number(e.trust) || 0 } : {}), absolute: true } as VellumEvent];
    }
    case 'relation_upsert': {
      const a = canonId(e.a ?? ''), b = canonId(e.b ?? '');
      if (!a || !b || a === b) return [];
      const cats = normalizeCategorySet(
        (Array.isArray(e.categories) ? e.categories : typeof e.categories === 'string' ? e.categories.split(',') : [])
          .map((c: string) => String(c).trim().toLowerCase()).filter(isCategory),
      ) as Category[];
      const existing = state.relations.find((r) => r.a === a && r.b === b);
      const ev: any = { ...base(ctx), kind: 'bond.delta', a, b, absolute: true };
      if (e.aff !== undefined || e.affection !== undefined) ev.aff = Number(e.aff ?? e.affection) || 0;
      if (e.trust !== undefined) ev.trust = Number(e.trust) || 0;
      if (e.label !== undefined) ev.label = String(e.label);
      // replace the whole set: add the new, drop the ones removed
      if (cats.length) {
        ev.addCats = cats;
        if (existing) { const rm = (existing.categories || []).filter((c) => !cats.includes(c) && c !== 'neutral'); if (rm.length) ev.removeCats = rm; }
      }
      const out: VellumEvent[] = [ev as VellumEvent];
      // optional reciprocal B→A edge (its own label/categories/aff/trust). Only
      // when explicitly requested AND it carries content, so we never mint a blank
      // reverse. Each edge is independent in the directed model.
      if (String(e.both) === 'yes' || e.both === true) {
        const bcatsRaw = normalizeCategorySet(
          (Array.isArray(e.bcategories) ? e.bcategories : typeof e.bcategories === 'string' ? e.bcategories.split(',') : [])
            .map((c: string) => String(c).trim().toLowerCase()).filter(isCategory),
        ) as Category[];
        // normalizeCategorySet defaults [] → ['neutral']; treat a neutral-only set
        // as "no categories" so an empty reciprocal doesn't count as content.
        const bcats = (bcatsRaw.length === 1 && bcatsRaw[0] === 'neutral') ? [] : bcatsRaw;
        const baff = (e.baff !== undefined) ? Number(e.baff) || 0 : 0;
        const btrust = (e.btrust !== undefined) ? Number(e.btrust) || 0 : 0;
        const blabel = e.blabel !== undefined ? String(e.blabel) : '';
        if (bcats.length || baff || btrust || blabel.trim()) {
          const rev = state.relations.find((r) => r.a === b && r.b === a);
          const ev2: any = { ...base(ctx), kind: 'bond.delta', a: b, b: a, absolute: true };
          if (baff) ev2.aff = baff;
          if (btrust) ev2.trust = btrust;
          if (blabel) ev2.label = blabel;
          if (bcats.length) { ev2.addCats = bcats; if (rev) { const rm = (rev.categories || []).filter((c) => !bcats.includes(c) && c !== 'neutral'); if (rm.length) ev2.removeCats = rm; } }
          out.push(ev2 as VellumEvent);
        }
      }
      return out;
    }
    case 'relation_delete': {
      const a = canonId(e.a ?? ''), b = canonId(e.b ?? '');
      // deleting a card removes both directions by default
      if (e.id) { const r = state.relations.find((x) => `${x.a}|${x.b}` === e.id); if (r) return [{ ...base(ctx), kind: 'bond.drop', a: r.a, b: r.b, both: true } as VellumEvent]; }
      return (a && b) ? [{ ...base(ctx), kind: 'bond.drop', a, b, both: true } as VellumEvent] : [];
    }
    case 'knowledge_add': {
      const who = canonId(e.who ?? ''); const fact = String(e.fact ?? '').trim();
      if (!who || !fact) return [];
      const reliability = ['knows', 'believes', 'suspects', 'wrong', 'unaware'].includes(String(e.reliability)) ? e.reliability : undefined;
      const truth = ['true', 'false', 'unknown'].includes(String(e.truth)) ? e.truth : undefined;
      const source = String(e.source ?? '').trim().slice(0, 120) || undefined;
      return [{ ...base(ctx), kind: 'knowledge.learn', who, fact, ...(e.about ? { about: canonId(e.about) } : {}), ...(reliability ? { reliability } : {}), ...(truth ? { truth } : {}), ...(source ? { source } : {}) } as VellumEvent];
    }
    case 'knowledge_delete':
      return e.id ? [{ ...base(ctx), kind: 'knowledge.drop', id: String(e.id) } as VellumEvent] : [];
    case 'secret_add': {
      const keeper = canonId(e.keeper ?? ''); const text = String(e.text ?? e.secret ?? '').trim();
      if (!keeper || !text) return [];
      const id = e.id ? String(e.id) : 'sec_' + nextSeq();
      const from = (Array.isArray(e.from) ? e.from : String(e.from ?? '').split(',')).map((s: string) => canonId(s)).filter(Boolean);
      return [{ ...base(ctx), kind: 'secret.form', id, keeper, from, text } as VellumEvent];
    }
    case 'secret_reveal':
      return e.id ? [{ ...base(ctx), kind: 'secret.reveal', id: String(e.id), to: (Array.isArray(e.to) ? e.to : []).map((s: string) => canonId(s)) } as VellumEvent] : [];
    case 'secret_delete':
      return e.id ? [{ ...base(ctx), kind: 'secret.drop', id: String(e.id) } as VellumEvent] : [];
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
    case 'journal_add': {
      const who = canonId(e.who ?? ''); const memory = String(e.memory ?? '').trim();
      if (!who || !memory) return [];
      return [{ ...base(ctx), kind: 'journal.entry', id: 'mj_' + nextSeq(), who, ...(e.about ? { about: canonId(e.about) } : {}), memory, jkind: (e.kind ?? 'interaction'), weight: (e.weight ?? 'minor'), sentiment: (e.sentiment ?? 'neutral') } as VellumEvent];
    }
    case 'journal_delete':
      return e.id ? [{ ...base(ctx), kind: 'journal.drop', id: String(e.id) } as VellumEvent] : [];
    case 'journal_edit': {
      if (!e.id) return [];
      const patch: Record<string, unknown> = {};
      if (e.memory !== undefined) { const m = String(e.memory).trim(); if (m) patch.memory = m; }
      if (e.about !== undefined) patch.about = canonId(e.about);
      if (e.kind !== undefined) patch.jkind = e.kind;
      if (e.weight !== undefined) patch.weight = e.weight;
      if (e.sentiment !== undefined) patch.sentiment = e.sentiment;
      if (!Object.keys(patch).length) return [];
      return [{ ...base(ctx), kind: 'journal.edit', id: String(e.id), patch } as VellumEvent];
    }
    case 'parallel_set':
      return [{ ...base(ctx), kind: 'parallel.set', items: (Array.isArray(e.items) ? e.items : []).map((it: any) => ({ ...(it.who ? { who: canonId(it.who) } : {}), ...(it.where ? { where: String(it.where) } : {}), activity: String(it.activity || '').trim(), ...(it.note ? { note: String(it.note) } : {}) })).filter((it: any) => it.activity) } as VellumEvent];
    default:
      return [];
  }
}

export const CMD_TYPES = new Set([
  'cast_upsert', 'cast_delete', 'relation_upsert', 'relation_delete',
  'faction_upsert', 'faction_delete', 'faction_member', 'faction_standing_set',
  'knowledge_add', 'knowledge_delete', 'secret_add', 'secret_reveal', 'secret_delete',
  'memory_add', 'memory_delete',
  'thread_op', 'arc_op', 'journal_add', 'journal_delete', 'journal_edit', 'parallel_set',
]);

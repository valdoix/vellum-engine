import type { Feature, ExtractCtx } from '../bus/registry.js';
import type { ParsedState } from '../parse/parsed.js';
import type { VellumEvent } from '../core/events.js';
import { canonId } from '../core/ids.js';

/**
 * The core narrative feature: maps a parsed turn's scene / present / bonds /
 * threads / arcs into events. This is also the reference implementation every
 * future Feature mirrors — keep it small and pure.
 */
export const coreFeature: Feature = {
  id: 'core',
  extract(parsed: ParsedState, ctx: ExtractCtx): VellumEvent[] {
    const out: VellumEvent[] = [];
    const base = (src: 'model' = 'model') => ({ seq: ctx.seq(), turn: ctx.turn, day: ctx.day, src });

    // scene + presence
    const present = (parsed.present ?? [])
      .map((p) => (p.id ? canonId(p.id) : p.name ? canonId(p.name) : ''))
      .filter(Boolean);
    if (parsed.scene || present.length) {
      out.push({
        ...base(), kind: 'scene.set',
        ...(parsed.scene?.loc ? { location: parsed.scene.loc } : {}),
        ...(typeof parsed.scene?.tension === 'number' ? { tension: parsed.scene.tension } : {}),
        ...(parsed.scene?.weather ? { weather: parsed.scene.weather } : {}),
        present,
      } as VellumEvent);
    }
    // mark present characters as cast (present status); names seed cards
    for (const p of parsed.present ?? []) {
      const name = p.name ?? p.id;
      if (!name) continue;
      out.push({ ...base(), kind: 'cast.seen', id: canonId(name), name, status: 'present' } as VellumEvent);
    }

    // bonds
    for (const b of parsed.delta?.bonds ?? []) {
      const a = canonId(b.a), bb = canonId(b.b);
      if (!a || !bb || a === bb) continue;
      out.push({
        ...base(), kind: 'bond.delta', a, b: bb,
        ...(typeof b.aff === 'number' ? { aff: b.aff } : {}),
        ...(typeof b.trust === 'number' ? { trust: b.trust } : {}),
        ...(b.absolute ? { absolute: true } : {}),
        ...(b.addCats?.length ? { addCats: b.addCats } : {}),
        ...(b.removeCats?.length ? { removeCats: b.removeCats } : {}),
        ...(b.label ? { label: b.label } : {}),
        ...(b.why ? { why: b.why } : {}),
      } as VellumEvent);
    }

    // threads + arcs
    for (const t of parsed.delta?.threads ?? []) {
      out.push({ ...base(), kind: 'thread.op', op: t.op, name: t.name, ...(t.note ? { note: t.note } : {}) } as VellumEvent);
    }
    for (const a of parsed.delta?.arcs ?? []) {
      const op = a.op === 'stall' ? 'advance' : a.op; // arcs have no stall
      out.push({ ...base(), kind: 'arc.op', op, name: a.name, ...(a.note ? { note: a.note } : {}) } as VellumEvent);
    }

    // per-character memory journal entries
    for (const j of parsed.delta?.journal ?? []) {
      const who = canonId(j.who); const memory = String(j.memory || '').trim();
      if (!who || !memory) continue;
      out.push({
        ...base(), kind: 'journal.entry', id: 'mj_' + who + '_' + ctx.turn + '_' + (out.length),
        who, ...(j.about ? { about: canonId(j.about) } : {}), memory,
        jkind: (j.kind ?? 'interaction'), weight: (j.weight ?? 'minor'), sentiment: (j.sentiment ?? 'neutral'),
      } as VellumEvent);
    }

    return out;
  },
};

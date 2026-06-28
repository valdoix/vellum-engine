import type { Feature, ExtractCtx } from '../bus/registry.js';
import type { ParsedState } from '../parse/parsed.js';
import type { VellumEvent } from '../core/events.js';
import { canonId } from '../core/ids.js';
import { resolveCastId, notAName } from './identity.js';
import { adjustBond, DEFAULT_TONE } from './tone.js';

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
    // Names introduced THIS turn (the present list) seed the id universe so a
    // bond/journal using a SHORT name ("cersei") in the same turn merges onto the
    // full present name ("Cersei Lannister" → cersei_lannister) — those cast.seen
    // events aren't reduced into ctx.state yet, so prior-state-only resolution
    // would split them. Built from raw canonId of present names (the full forms).
    const turnIds = new Set<string>();
    for (const p of parsed.present ?? []) {
      const n = p.id ?? p.name;
      if (n && !notAName(n)) { const c = canonId(n); if (c) turnIds.add(c); }
    }
    // resolve a raw name onto an existing-or-this-turn cast id (merges variants).
    const rid = (name: string): string => resolveCastId(ctx.state, name, turnIds);

    // scene + presence — a pronoun/generic in `present` ("she") must not seed a card
    const presentName = (p: { id?: string; name?: string }): string => p.id ?? p.name ?? '';
    const presentId = (p: { id?: string; name?: string }): string => {
      const n = presentName(p);
      return n && !notAName(n) ? rid(n) : '';
    };
    const present = (parsed.present ?? [])
      .map(presentId)
      .filter(Boolean);
    if (parsed.scene || present.length) {
      const detail = (parsed.present ?? []).map((p) => {
        const id = presentId(p);
        return id ? { id, ...(p.mood ? { mood: p.mood } : {}), ...(p.doing ? { doing: p.doing } : {}), ...(p.condition ? { condition: p.condition } : {}), ...(p.thought ? { thought: p.thought } : {}) } : null;
      }).filter(Boolean);
      out.push({
        ...base(), kind: 'scene.set',
        ...(parsed.scene?.loc ? { location: parsed.scene.loc } : {}),
        ...(parsed.scene?.time ? { time: parsed.scene.time } : {}),
        ...(typeof parsed.scene?.tension === 'number' ? { tension: parsed.scene.tension } : {}),
        ...(parsed.scene?.weather ? { weather: parsed.scene.weather } : {}),
        present,
        ...(detail.length ? { detail } : {}),
      } as VellumEvent);
    }
    // mark present characters as cast (present status); names seed cards
    for (const p of parsed.present ?? []) {
      const name = p.name ?? p.id;
      if (!name || notAName(name)) continue; // never seed a card from a pronoun/generic
      out.push({ ...base(), kind: 'cast.seen', id: rid(name), name, status: 'present' } as VellumEvent);
    }

    // bonds — tone dials (romance pace clamp / off-strip, disposition seed)
    // are applied here so the graph reflects them, not just the prose.
    const tone = ctx.tone ?? DEFAULT_TONE;
    const userCanon = ctx.userCanon ?? '';
    for (const b of parsed.delta?.bonds ?? []) {
      if (notAName(b.a) || notAName(b.b)) continue; // reject pronoun/generic endpoints ("she → Daeron")
      const a = rid(b.a), bb = rid(b.b);
      if (!a || !bb || a === bb) continue;
      const existing = ctx.state.relations.find((r) => r.a === a && r.b === bb);
      const romantic = !!(b.addCats?.includes('romantic')) || !!(existing?.categories?.includes('romantic'));
      // tone (seed/clamp) only applies to DELTAS; an absolute set is a direct
      // value the model chose — leave it untouched (off-strip still handled below).
      const adj = b.absolute
        ? { a, b: bb, ...(typeof b.aff === 'number' ? { aff: b.aff } : {}), ...(typeof b.trust === 'number' ? { trust: b.trust } : {}), ...(tone.romance === 'off' ? { addCats: (b.addCats ?? []).filter((c) => c !== 'romantic') } : (b.addCats?.length ? { addCats: b.addCats } : {})) }
        : adjustBond(
          { a, b: bb, ...(typeof b.aff === 'number' ? { aff: b.aff } : {}), ...(typeof b.trust === 'number' ? { trust: b.trust } : {}), ...(b.addCats?.length ? { addCats: b.addCats } : {}) },
          tone,
          { userId: userCanon, relExists: !!existing, romantic },
        );
      if (!adj) continue; // romance-off stripped the only (romantic) content
      // an absolute bond whose only content was a stripped romantic cat → skip
      if (b.absolute && adj.aff === undefined && adj.trust === undefined && !adj.addCats?.length) continue;
      out.push({
        ...base(), kind: 'bond.delta', a, b: bb,
        ...(typeof adj.aff === 'number' ? { aff: adj.aff } : {}),
        ...(typeof adj.trust === 'number' ? { trust: adj.trust } : {}),
        ...(b.absolute ? { absolute: true } : {}),
        ...(adj.addCats?.length ? { addCats: adj.addCats } : {}),
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
      const who = rid(j.who); const memory = String(j.memory || '').trim();
      if (!who || !memory) continue;
      out.push({
        ...base(), kind: 'journal.entry', id: 'mj_' + who + '_' + ctx.turn + '_' + (out.length),
        who, ...(j.about ? { about: rid(j.about) } : {}), memory,
        jkind: (j.kind ?? 'interaction'), weight: (j.weight ?? 'minor'), sentiment: (j.sentiment ?? 'neutral'),
      } as VellumEvent);
    }

    // knowledge written inline in the block (deterministic; the prose extractor
    // is a separate best-effort backup). Reject pronoun/generic holders.
    for (const k of parsed.delta?.knowledge ?? []) {
      const fact = String(k.fact || '').trim();
      if (!fact || notAName(k.who)) continue;
      const who = rid(k.who);
      out.push({
        ...base(), kind: 'knowledge.learn', who, fact,
        ...(k.about && !notAName(k.about) ? { about: rid(k.about) } : {}),
        ...(k.reliability ? { reliability: k.reliability } : {}),
        ...(k.truth ? { truth: k.truth } : {}),
        ...(k.source ? { source: String(k.source).slice(0, 120) } : {}),
      } as VellumEvent);
    }
    // secrets written inline in the block
    let si = 0;
    for (const s of parsed.delta?.secrets ?? []) {
      const text = String(s.secret || s.text || '').trim();
      if (!text || notAName(s.keeper)) continue;
      const fromRaw = Array.isArray(s.from) ? s.from : String(s.from || '').split(',');
      const from = fromRaw.map((x) => String(x).trim()).filter((x) => x && !notAName(x)).map(rid);
      out.push({ ...base(), kind: 'secret.form', id: 'sec_' + ctx.turn + '_' + (si++), keeper: rid(s.keeper), from, text } as VellumEvent);
    }

    // off-screen parallel events
    const par = parsed.delta?.parallel ?? [];
    if (par.length) {
      out.push({
        ...base(), kind: 'parallel.set',
        items: par.map((p) => ({ ...(p.who ? { who: rid(p.who) } : {}), ...(p.where ? { where: p.where } : {}), activity: String(p.activity || '').trim(), ...(p.note ? { note: p.note } : {}) })).filter((p) => p.activity),
      } as VellumEvent);
    }

    return out;
  },
};

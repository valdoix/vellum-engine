import type { Feature, ExtractCtx } from '../bus/registry.js';
import type { ParsedState } from '../parse/parsed.js';
import type { VellumEvent } from '../core/events.js';
import { canonId } from '../core/ids.js';
import { resolveCastId, notAName, resolveFactionId, isNameMash } from './identity.js';
import { adjustBond, DEFAULT_TONE, seedFactionStanding } from './tone.js';
import { findLock, applyLockToBond } from './relation-lock.js';

/**
 * The core narrative feature: maps a parsed turn's scene / present / bonds /
 * threads / arcs into events. This is also the reference implementation every
 * future Feature mirrors — keep it small and pure.
 */

// canon sentinels: a knowledge `who` of "world"/"lore"/"codex"/"canon" is not a
// character — it names a fact TRUE OF THE WORLD, which we store as a Codex lore
// note instead of a person's belief (and never let it mint a pseudo-cast card).
const CANON_SENTINEL = new Set(['world', 'lore', 'codex', 'canon', 'setting']);
function isCanonSentinel(raw?: string): boolean {
  return CANON_SENTINEL.has(canonId(raw ?? ''));
}

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
      if (n && !notAName(n) && !isNameMash(n, Object.keys(ctx.state.cast))) { const c = canonId(n); if (c) turnIds.add(c); }
    }
    // resolve a raw name onto an existing-or-this-turn cast id (merges variants).
    const rid = (name: string): string => resolveCastId(ctx.state, name, turnIds);
    // the known-people universe (existing cast ∪ this-turn present ids), used to
    // recognize a two-name MASH ("Daeron Cersei") that the model jammed together.
    const knownPeople = new Set<string>([...Object.keys(ctx.state.cast), ...turnIds]);
    // a name is unusable as a CHARACTER if it's junk (pronoun/group/abstraction)
    // OR a mash of two already-known people — drop it before it mints a junk card.
    const badName = (n: string): boolean => notAName(n) || isNameMash(n, knownPeople);

    // scene + presence — a pronoun/generic in `present` ("she") must not seed a card
    const presentName = (p: { id?: string; name?: string }): string => p.id ?? p.name ?? '';
    const presentId = (p: { id?: string; name?: string }): string => {
      const n = presentName(p);
      return n && !badName(n) ? rid(n) : '';
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
      if (!name || badName(name)) continue; // never seed a card from a pronoun/generic/mash
      const id = rid(name);
      out.push({ ...base(), kind: 'cast.seen', id, name, status: 'present' } as VellumEvent);
      // STABLE personality tags the model surfaced — fold into the card as a
      // cast.edit (src 'model', so user edits still win in the reducer). Trim,
      // dedupe (case-insensitive), cap at 6; the reducer re-caps defensively.
      if (Array.isArray(p.traits) && p.traits.length) {
        const seen = new Set<string>();
        const traits: string[] = [];
        for (const t of p.traits) {
          const v = String(t).trim();
          const k = v.toLowerCase();
          if (!v || seen.has(k)) continue;
          seen.add(k); traits.push(v);
          if (traits.length >= 6) break;
        }
        if (traits.length) out.push({ ...base(), kind: 'cast.edit', id, patch: { traits } } as VellumEvent);
      }
    }

    // bonds — tone dials (romance pace clamp / off-strip, disposition seed)
    // are applied here so the graph reflects them, not just the prose.
    const tone = ctx.tone ?? DEFAULT_TONE;
    const userCanon = ctx.userCanon ?? '';
    for (const b of parsed.delta?.bonds ?? []) {
      if (badName(b.a) || badName(b.b)) continue; // reject pronoun/generic/mash endpoints ("she → Daeron", "Daeron Cersei")
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
      // relation lock (Plot Director): strip forbidden addCats / protect pinned
      // removeCats for this pair, at the same chokepoint as the tone strip.
      const locked = applyLockToBond(
        { addCats: adj.addCats as import('../core/events.js').Category[] | undefined, removeCats: b.removeCats as import('../core/events.js').Category[] | undefined },
        findLock(ctx.locks, a, bb),
      );
      // a bond whose ONLY content was a forbidden cat (now stripped) → skip
      if (adj.aff === undefined && adj.trust === undefined && !locked.addCats?.length && !locked.removeCats?.length && !b.label) continue;
      out.push({
        ...base(), kind: 'bond.delta', a, b: bb,
        ...(typeof adj.aff === 'number' ? { aff: adj.aff } : {}),
        ...(typeof adj.trust === 'number' ? { trust: adj.trust } : {}),
        ...(b.absolute ? { absolute: true } : {}),
        ...(locked.addCats?.length ? { addCats: locked.addCats } : {}),
        ...(locked.removeCats?.length ? { removeCats: locked.removeCats } : {}),
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
      const memory = String(j.memory || '').trim();
      if (!memory || badName(j.who)) continue; // reject pronoun/generic/mash holders
      const who = rid(j.who);
      if (!who) continue;
      out.push({
        ...base(), kind: 'journal.entry', id: 'mj_' + who + '_' + ctx.turn + '_' + (out.length),
        who, ...(j.about && !badName(j.about) ? { about: rid(j.about) } : {}), memory,
        jkind: (j.kind ?? 'interaction'), weight: (j.weight ?? 'minor'), sentiment: (j.sentiment ?? 'neutral'),
      } as VellumEvent);
    }

    // knowledge written inline in the block (deterministic; the prose extractor
    // is a separate best-effort backup). Reject pronoun/generic holders.
    // A `who:"world"` (or other canon sentinel) is NOT a character — reroute it
    // to a Codex lore note so canon never reads as someone's belief or mints a
    // pseudo-cast card.
    let li = 0;
    for (const k of parsed.delta?.knowledge ?? []) {
      const fact = String(k.fact || '').trim();
      if (!fact) continue;
      if (isCanonSentinel(k.who)) {
        out.push({ ...base(), kind: 'lore.note', id: 'lore_' + ctx.turn + '_' + (li++), fact } as VellumEvent);
        continue;
      }
      if (badName(k.who)) continue;
      const who = rid(k.who);
      out.push({
        ...base(), kind: 'knowledge.learn', who, fact,
        ...(k.about && !badName(k.about) ? { about: rid(k.about) } : {}),
        ...(k.reliability ? { reliability: k.reliability } : {}),
        ...(k.truth ? { truth: k.truth } : {}),
        ...(k.source ? { source: String(k.source).slice(0, 120) } : {}),
      } as VellumEvent);
    }
    // secrets written inline in the block
    let si = 0;
    for (const s of parsed.delta?.secrets ?? []) {
      const text = String(s.secret || s.text || '').trim();
      if (!text || badName(s.keeper)) continue;
      const fromRaw = Array.isArray(s.from) ? s.from : String(s.from || '').split(',');
      const from = fromRaw.map((x) => String(x).trim()).filter((x) => x && !badName(x)).map(rid);
      out.push({ ...base(), kind: 'secret.form', id: 'sec_' + ctx.turn + '_' + (si++), keeper: rid(s.keeper), from, text } as VellumEvent);
    }

    // factions written inline: group + members (edges) + standing. A NEW faction's
    // opening standing is seeded from World Disposition (per-group granular dial).
    for (const fx of parsed.delta?.factions ?? []) {
      const fid = resolveFactionId(ctx.state, fx.name);
      if (!fid) continue;
      const isNew = !ctx.state.factions[fid];
      out.push({ ...base(), kind: 'faction.seen', id: fid, name: String(fx.name).trim(), status: (fx.status ?? 'active') } as VellumEvent);
      if (fx.kind) out.push({ ...base(), kind: 'faction.edit', id: fid, patch: { kind: String(fx.kind) } } as VellumEvent);
      for (const mn of fx.members ?? []) {
        if (badName(mn)) continue;
        out.push({ ...base(), kind: 'faction.member', char: rid(mn), faction: fid, op: 'add' } as VellumEvent);
      }
      // seed once on creation; an explicit standing delta still applies on top
      const seed = isNew ? seedFactionStanding(tone) : 0;
      const delta = (typeof fx.standing === 'number' ? fx.standing : 0) + seed;
      if (delta || (isNew && typeof fx.trust === 'number')) {
        out.push({ ...base(), kind: 'faction.standing', faction: fid, ...(delta ? { standing: delta } : {}), ...(typeof fx.trust === 'number' ? { trust: fx.trust } : {}) } as VellumEvent);
      }
    }

    // off-screen parallel events
    const par = parsed.delta?.parallel ?? [];
    if (par.length) {
      out.push({
        ...base(), kind: 'parallel.set',
        items: par.map((p) => ({ ...(p.who ? { who: rid(p.who) } : {}), ...(p.where ? { where: p.where } : {}), activity: String(p.activity || '').trim(), ...(p.note ? { note: p.note } : {}) })).filter((p) => p.activity),
      } as VellumEvent);
    }

    // ext: engine-reserved blocks the preset emits outside `delta`.
    const ext = (parsed.ext ?? {}) as { scars?: Array<{ who?: string; was?: string; about?: string }>; codex?: Array<{ fact?: string; tag?: string } | string> };
    // Palimpsest scars — a belief proven wrong, held by a real character. Same
    // rid()/notAName gate as everything else, so scar attribution inherits the
    // same-surname misattribution protection.
    let xi = 0;
    for (const sc of Array.isArray(ext.scars) ? ext.scars : []) {
      const was = String(sc?.was || '').trim();
      if (!was || badName(sc?.who ?? '')) continue;
      const who = rid(String(sc!.who));
      out.push({ ...base(), kind: 'scar.form', id: 'scar_' + who + '_' + ctx.turn + '_' + (xi++), who, was, ...(sc?.about && !badName(sc.about) ? { about: rid(sc.about) } : {}) } as VellumEvent);
    }
    // Codex — minted canon (true of the world, not a belief). Stored as lore.
    let ci = 0;
    for (const c of Array.isArray(ext.codex) ? ext.codex : []) {
      const fact = String((typeof c === 'string' ? c : c?.fact) || '').trim();
      if (!fact) continue;
      const tag = typeof c === 'string' ? undefined : (c?.tag ? String(c.tag) : undefined);
      out.push({ ...base(), kind: 'lore.note', id: 'lore_' + ctx.turn + '_x' + (ci++), fact, ...(tag ? { tag } : {}) } as VellumEvent);
    }

    return out;
  },
};

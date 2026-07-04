import type { ChronicleState } from './types.js';
import type { VellumEvent, Category } from '../core/events.js';
import { type RelationLock, findLock, applyLockToBond } from './relation-lock.js';
import type { Directive } from './directive.js';
import { type Social, type Politics, offscreenBondPolicy, factionPolicy } from './tone.js';
import { canonId } from '../core/ids.js';

/**
 * Off-screen simulation (Plot Director) — tick the world forward while it's
 * off-stage. PURE core: decide who's plausibly elsewhere, build a guardrailed
 * controller prompt, parse the reply tolerantly, and map to events. All I/O
 * (the LLM call, persistence, cadence) lives in the backend (maybeSimulate),
 * mirroring maybeTidyThreads.
 *
 * Hard scope for v1: off-screen characters get ONE small activity beat each
 * (parallel.set) and a thread may be nudged advance/stall. NO bond/affection/
 * secret mutation off-screen — that would let the sim rewrite canon unseen.
 */

/** Characters plausibly "elsewhere": known but not in the current scene. Widened
 * beyond `active` (the old filter that left the cast empty) to include recently-
 * seen `mentioned` characters, so a known-but-offstage person still qualifies. */
export function offscreenCast(state: ChronicleState): ChronicleState['cast'][string][] {
  const present = new Set(state.scene.present);
  const recent = (state.turns || 0) - 6;
  return Object.values(state.cast)
    .filter((c) => !c.deceased && !present.has(c.id) && (c.status === 'active' || (c.status === 'mentioned' && (c.lastTurn || 0) >= recent)))
    .sort((a, b) => (b.lastTurn || 0) - (a.lastTurn || 0))
    .slice(0, 5);
}

export interface SimCtx {
  locks?: readonly RelationLock[];
  directives?: readonly Directive[];
  tone?: { disposition: string; social?: Social };
  focusId?: string; // when set, advance ONLY this subplot (per-thread advance)
  /** narrative days elapsed since the last sim tick. >1 = a time-skip: the
   * off-screen world & its subplots should advance PROPORTIONALLY, not by the
   * usual single small beat. 0/undefined = an ordinary same-day tick. */
  skipDays?: number;
}

/** How much off-screen life a tick should cover, given the days elapsed. A time-
 * skip (>=2 days) turns each "small beat" into a period the subplots live
 * through — so we license the model to jump further and resolve threads that
 * would naturally have run their course. PURE. */
export function timeSkipNote(skipDays?: number): string {
  const d = Math.floor(skipDays ?? 0);
  if (d < 2) return '';
  const span = d >= 30 ? `${Math.round(d / 30)} month(s)` : d >= 14 ? `${Math.round(d / 7)} week(s)` : `${d} days`;
  return `TIME-SKIP: about ${span} have passed off-screen since the last update. The same time passed for everyone — advance each subplot by that WHOLE span, not a single beat: let journeys arrive, plans mature or fail, waits end, and RESOLVE any subplot that would plausibly have concluded over ${span}. Report the net result of the elapsed time, not one small step.`;
}

const SIM_SYS_BASE = [
  'You advance OFF-SCREEN life in a roleplay world: small subplots unfolding elsewhere while the main scene plays out.',
  'You are given OFF-SCREEN CHARACTERS (not in the current scene) and the CURRENT OFF-SCREEN SUBPLOTS already in motion.',
  'For each, decide a small next beat: ADVANCE an existing subplot (reuse its id), RESOLVE one that has run its course, or open a NEW one.',
  'Keep beats SMALL and plausible (a clause, not a plot twist). Do NOT kill anyone or resolve a major on-screen arc.',
];
// what the sim may do to NPC↔NPC relationships, by Social autonomy level.
const SIM_SOCIAL_RULE: Record<Social, string> = {
  off: 'Do NOT change any relationships or secrets.',
  reactive: 'Do NOT change any relationships or secrets off-screen (relationships only shift in scenes the player witnesses).',
  living: 'Two off-screen characters MAY grow a little closer or a little more strained through their subplot — report it as a small "bonds" entry (a gentle aff/trust nudge). Do NOT start a new romance, marry, break up, or otherwise flip the KIND of a relationship off-screen. Never change a relationship the FORBIDDEN list rules out.',
  autonomous: 'Two off-screen characters MAY meaningfully shift their bond — grow close, drift apart, fall out, reconcile, or begin a friendship/rivalry — reported as a "bonds" entry with a small aff/trust step and optionally a new cat (friendship=social, rivalry). Take SMALL steps (no instant marriages). Never form a romance the FORBIDDEN list rules out, and never change a relationship any FORBIDDEN entry rules out.',
};
const SIM_JSON_BONDS = ' You MAY also include a "bonds" array of NPC↔NPC relationship shifts: [{"a":"Name","b":"Name","aff":small +/- int,"trust":small +/- int,"cat":"social|rivalry|alliance or omit","why":"one clause"}]. Never involve the player in a bond.';
const SIM_JSON_FACTIONS = ' You MAY also include a "factions" array of FACTION↔FACTION shifts: [{"a":"Faction","b":"Faction","kind":"alliance|rivalry|war|vassal|trade or omit","standing":small +/- int,"why":"one clause"}]. Never involve the player.';
const SIM_JSON = 'Reply STRICT JSON only: {"offscreen":[{"op":"new|advance|resolve","id":"short_id","name":"subplot name","who":"Character or omit","where":"place or omit","gist":"one clause of what just happened"}]BONDSFACTIONS}. Use the SAME id to advance/resolve an existing subplot; pick a fresh short snake_case id for a new one. At most 4 offscreen entries.';
// what the sim may do to FACTION↔FACTION relations, by Politics autonomy level.
const SIM_POLITICS_RULE: Record<Politics, string> = {
  off: '',
  living: ' Two factions MAY drift a little in standing toward each other through events — report it as a small "factions" entry (a gentle standing nudge). Do NOT declare a new war, alliance, or otherwise flip the KIND of a faction relation off-screen.',
  autonomous: ' Two factions MAY meaningfully shift — forge or break an alliance, open a rivalry, go to war, strike trade — reported as a "factions" entry with a small standing step and optionally a new kind. Take SMALL steps (no overnight empires).',
};

/** Build the sim system prompt for a given Social level. `off`/`reactive` keep the
 * historical blanket "no relationship changes" ban; `living`/`autonomous` open a
 * bounded, lock-respecting NPC↔NPC bond channel. */
export function simSys(social: Social = 'off', politics: Politics = 'off'): string {
  const rule = SIM_SOCIAL_RULE[social] ?? SIM_SOCIAL_RULE.off;
  const wantsBonds = offscreenBondPolicy(social).enabled;
  const wantsFactions = factionPolicy(politics).enabled;
  const json = SIM_JSON
    .replace('BONDS', wantsBonds ? SIM_JSON_BONDS : '')
    .replace('FACTIONS', wantsFactions ? SIM_JSON_FACTIONS : '');
  const politicsRule = wantsFactions ? (SIM_POLITICS_RULE[politics] ?? '') : '';
  return [...SIM_SYS_BASE, rule + politicsRule, json].join(' ');
}

/** Back-compat default (off = today's behavior) for callers/tests that want the
 * constant form. */
export const SIM_SYS = simSys('off');

/** Build the user prompt: off-screen cast + the OPEN subplots to advance/resolve
 * + world guardrails (locks, armed directives, tone). */
export function buildSimPrompt(state: ChronicleState, cast: ReadonlyArray<{ name: string; role?: string }>, ctx: SimCtx = {}): string {
  const lines: string[] = [];
  // per-thread advance: narrow the whole prompt to the one focused subplot
  const focus = ctx.focusId ? (state.offscreen ?? []).find((o) => o.id === ctx.focusId && o.status === 'active') : undefined;
  if (focus) {
    lines.push('ADVANCE THIS ONE OFF-SCREEN SUBPLOT by a single small beat (reuse its id):');
    lines.push(`- [${focus.id}] ${focus.name}${focus.who ? ` (${focus.who})` : ''}${focus.where ? ` @${focus.where}` : ''}: ${focus.gist || focus.beats[focus.beats.length - 1] || ''}`);
    if (focus.beats.length) { lines.push('', 'RECENT BEATS:'); for (const b of focus.beats.slice(-4)) lines.push(`- ${b}`); }
    lines.push('', 'Reply with exactly one entry: op "advance" (or "resolve" if it has run its course), same id.');
    const skipF = timeSkipNote(ctx.skipDays);
    if (skipF) lines.push('', skipF);
    if (ctx.tone?.disposition && ctx.tone.disposition !== 'fair') lines.push('', `WORLD TONE: ${ctx.tone.disposition}.`);
    lines.push('', `Current scene: ${state.scene.location || 'unknown'}${state.scene.time ? ', ' + state.scene.time : ''}.`);
    return lines.join('\n');
  }
  lines.push('OFF-SCREEN CHARACTERS:');
  for (const c of cast) lines.push(`- ${c.name}${c.role ? ` (${c.role})` : ''}`);
  const open = (state.offscreen ?? []).filter((o) => o.status === 'active').slice(0, 8);
  if (open.length) {
    lines.push('', 'CURRENT OFF-SCREEN SUBPLOTS (advance with the same id, or resolve):');
    for (const o of open) lines.push(`- [${o.id}] ${o.name}${o.who ? ` (${o.who})` : ''}: ${o.gist || o.beats[o.beats.length - 1] || ''}`);
  } else {
    lines.push('', 'No off-screen subplots yet — open one or two NEW ones.');
  }
  const skip = timeSkipNote(ctx.skipDays);
  if (skip) lines.push('', skip);
  if (ctx.tone?.disposition && ctx.tone.disposition !== 'fair') lines.push('', `WORLD TONE: ${ctx.tone.disposition} — let off-screen life lean this way.`);
  const armed = (ctx.directives ?? []).filter((d) => d.status === 'armed');
  if (armed.length) { lines.push('', 'DIRECTOR INTENT (honor if it fits):'); for (const d of armed) lines.push(`- ${d.text}`); }
  if (ctx.locks?.length) {
    const f = ctx.locks.filter((l) => l.forbid.length);
    if (f.length) { lines.push('', 'FORBIDDEN (never form these off-screen):'); for (const l of f) lines.push(`- ${l.a} \u2194 ${l.b}: ${l.forbid.join(', ')}`); }
  }
  lines.push('', `Current scene: ${state.scene.location || 'unknown'}${state.scene.time ? ', ' + state.scene.time : ''}.`);
  return lines.join('\n');
}

export interface ParsedSimBond { a: string; b: string; aff?: number; trust?: number; cat?: string; why?: string }
export interface ParsedSimFactionRel { a: string; b: string; kind?: string; standing?: number; why?: string }
export interface ParsedSim {
  offscreen: Array<{ op: 'new' | 'advance' | 'resolve'; id: string; name?: string; who?: string; where?: string; gist?: string }>;
  bonds?: ParsedSimBond[];
  factions?: ParsedSimFactionRel[];
}

/** Tolerant parse of the controller reply. Returns null on garbage / nothing. */
export function parseSim(text: string): ParsedSim | null {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let obj: unknown;
  try { obj = JSON.parse(m[0]); } catch { return null; }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  const offscreen = (Array.isArray(o.offscreen) ? o.offscreen : [])
    .map((p) => (p && typeof p === 'object') ? p as Record<string, unknown> : {})
    .map((p) => {
      const op = (p.op === 'resolve' ? 'resolve' : p.op === 'new' ? 'new' : 'advance') as 'new' | 'advance' | 'resolve';
      const name = p.name ? String(p.name).trim() : '';
      const id = p.id ? slug(String(p.id)) : slug(name);
      const gist = String(p.gist ?? '').trim();
      return { op, id, ...(name ? { name } : {}), ...(p.who ? { who: String(p.who).trim() } : {}), ...(p.where ? { where: String(p.where).trim() } : {}), ...(gist ? { gist } : {}) };
    })
    .filter((p) => p.id && (p.gist || p.op === 'resolve'))
    .slice(0, 4);
  const num = (v: unknown): number | undefined => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };
  const bonds = (Array.isArray(o.bonds) ? o.bonds : [])
    .map((p) => (p && typeof p === 'object') ? p as Record<string, unknown> : {})
    .map((p) => {
      const a = String(p.a ?? '').trim(); const b = String(p.b ?? '').trim();
      const cat = p.cat ? String(p.cat).trim().toLowerCase() : '';
      const why = String(p.why ?? '').trim();
      return { a, b, ...(num(p.aff) !== undefined ? { aff: num(p.aff) } : {}), ...(num(p.trust) !== undefined ? { trust: num(p.trust) } : {}), ...(cat ? { cat } : {}), ...(why ? { why } : {}) } as ParsedSimBond;
    })
    .filter((p) => p.a && p.b && p.a.toLowerCase() !== p.b.toLowerCase() && (p.aff !== undefined || p.trust !== undefined || p.cat))
    .slice(0, 4);
  const factions = (Array.isArray(o.factions) ? o.factions : [])
    .map((p) => (p && typeof p === 'object') ? p as Record<string, unknown> : {})
    .map((p) => {
      const a = String(p.a ?? '').trim(); const b = String(p.b ?? '').trim();
      const kind = p.kind ? String(p.kind).trim().toLowerCase() : '';
      const why = String(p.why ?? '').trim();
      return { a, b, ...(num(p.standing) !== undefined ? { standing: num(p.standing) } : {}), ...(kind ? { kind } : {}), ...(why ? { why } : {}) } as ParsedSimFactionRel;
    })
    .filter((p) => p.a && p.b && p.a.toLowerCase() !== p.b.toLowerCase() && (p.standing !== undefined || p.kind))
    .slice(0, 4);
  if (!offscreen.length && !bonds.length && !factions.length) return null;
  return { offscreen, ...(bonds.length ? { bonds } : {}), ...(factions.length ? { factions } : {}) };
}

/**
 * Map a parsed sim to `offscreen.op` events — first-class subplots that
 * accumulate beats and round-trip to the prompt (vs the old ephemeral
 * parallel.set snapshot). `who` resolves to a known cast id when it matches,
 * else stays as the raw name (an off-screen subplot may name a not-present
 * character without minting a scene presence). Still NO bond/secret mutation.
 */
export interface SimEventsOpts {
  /** relation locks — off-screen bonds pass the SAME filter as on-screen ones */
  locks?: readonly RelationLock[];
  /** Social autonomy level — gates & clamps the off-screen bond channel */
  social?: Social;
  /** Politics autonomy level — gates & clamps the off-screen faction-relation channel */
  politics?: Politics;
  /** canonical {{user}} id — so the sim never authors a bond involving the player */
  userId?: string;
}

// map a loose sim `cat` string to a real bond Category (only the ones a sim may
// form off-screen; romantic/familial are never minted off-screen).
const SIM_CAT: Record<string, Category> = { social: 'social', friendship: 'social', friend: 'social', rivalry: 'rivalry', rival: 'rivalry', alliance: 'alliance', ally: 'alliance' };
// map a loose sim faction `kind` string to a real FactionRelation kind.
const SIM_FACREL: Record<string, 'alliance' | 'rivalry' | 'war' | 'vassal' | 'trade'> = { alliance: 'alliance', ally: 'alliance', allied: 'alliance', rivalry: 'rivalry', rival: 'rivalry', war: 'war', vassal: 'vassal', trade: 'trade' };

export function simEvents(parsed: ParsedSim, state: ChronicleState, turn: number, day: number, seq: () => number, opts: SimEventsOpts = {}): VellumEvent[] {
  const castByName = new Map(Object.values(state.cast).map((c) => [c.name.toLowerCase(), c.id]));
  const resolve = (who?: string): string | undefined => who ? (castByName.get(who.toLowerCase()) ?? canonId(who)) : undefined;
  const known = new Set((state.offscreen ?? []).map((o) => o.id));
  const events: VellumEvent[] = parsed.offscreen.map((p) => {
    // a "new" that collides with a known id becomes an advance; an "advance" on
    // an unknown id becomes a new — so the model can't fork or orphan a subplot.
    const op = p.op === 'resolve' ? 'resolve' : (known.has(p.id) ? 'advance' : 'new');
    return { seq: seq(), turn, day, src: 'system', kind: 'offscreen.op', op, id: p.id, ...(p.name ? { name: p.name } : {}), ...(p.who ? { who: resolve(p.who) } : {}), ...(p.where ? { where: p.where } : {}), ...(p.gist ? { gist: p.gist } : {}) } as VellumEvent;
  });

  // Off-screen NPC↔NPC bond channel (Social autonomy). Gated by level, clamped by
  // magnitude, category-limited, and — crucially — run through the SAME relation-
  // lock filter as the on-screen bond chokepoint, so a user's forbid can never be
  // rewritten off-screen. Each surviving bond also emits a companion offscreen.op
  // beat so the change surfaces as NEWS on re-entry, not silently in the graph.
  const policy = offscreenBondPolicy(opts.social ?? 'off');
  if (policy.enabled && parsed.bonds?.length) {
    const clamp = (n?: number): number | undefined => (typeof n === 'number' && n !== 0) ? Math.max(-policy.maxDelta, Math.min(policy.maxDelta, Math.round(n))) : undefined;
    const userId = opts.userId || '';
    for (const bd of parsed.bonds) {
      const a = resolve(bd.a); const b = resolve(bd.b);
      if (!a || !b || a === b) continue;
      if (userId && (a === userId || b === userId)) continue; // never author a user bond off-screen
      if (state.cast[a]?.deceased || state.cast[b]?.deceased) continue; // the dead don't form bonds off-screen
      const aff = clamp(bd.aff); const trust = clamp(bd.trust);
      const rawCat = policy.allowCategory && bd.cat ? SIM_CAT[bd.cat] : undefined;
      // apply the relation lock exactly as the fold does: strip forbidden addCats
      const locked = applyLockToBond({ ...(rawCat ? { addCats: [rawCat] } : {}) }, findLock(opts.locks, a, b));
      const addCats = locked.addCats;
      if (aff === undefined && trust === undefined && !addCats?.length) continue; // nothing survived
      events.push({ seq: seq(), turn, day, src: 'system', kind: 'bond.delta', a, b,
        ...(aff !== undefined ? { aff } : {}), ...(trust !== undefined ? { trust } : {}),
        ...(addCats?.length ? { addCats } : {}), ...(bd.why ? { why: bd.why } : {}) } as VellumEvent);
      // surface it as off-screen news so re-entry shows the shift
      const nm = (id: string): string => state.cast[id]?.name ?? id;
      const gist = bd.why || `${nm(a)} and ${nm(b)} ${aff !== undefined && aff < 0 ? 'have grown apart' : 'have grown closer'} off-screen`;
      events.push({ seq: seq(), turn, day, src: 'system', kind: 'offscreen.op', op: 'new', id: `bond_${a}_${b}`.slice(0, 40), name: `${nm(a)} & ${nm(b)}`, gist } as VellumEvent);
    }
  }

  // Off-screen FACTION↔FACTION channel (Politics autonomy). Same discipline as the
  // bond channel: gated by level, clamped by magnitude, kind-limited (living may
  // only nudge standing; autonomous may set/flip the kind). Each surviving move
  // emits a companion offscreen.op beat so it surfaces as NEWS on re-entry.
  const fpolicy = factionPolicy(opts.politics ?? 'off');
  if (fpolicy.enabled && parsed.factions?.length) {
    const facByName = new Map(Object.values(state.factions).map((f) => [f.name.toLowerCase(), f.id]));
    const resolveFac = (nm2: string): string | undefined => nm2 ? (facByName.get(nm2.toLowerCase()) ?? ('fac:' + canonId(nm2))) : undefined;
    const clampF = (n?: number): number | undefined => (typeof n === 'number' && n !== 0) ? Math.max(-fpolicy.maxDelta, Math.min(fpolicy.maxDelta, Math.round(n))) : undefined;
    const facName = (id: string): string => state.factions[id]?.name ?? id.replace(/^fac:/, '');
    for (const fr of parsed.factions) {
      const a = resolveFac(fr.a); const b = resolveFac(fr.b);
      if (!a || !b || a === b) continue;
      const standing = clampF(fr.standing);
      const relkind = fpolicy.allowKind && fr.kind ? SIM_FACREL[fr.kind] : undefined;
      if (standing === undefined && !relkind) continue; // nothing survived the gate
      events.push({ seq: seq(), turn, day, src: 'system', kind: 'factionrel.op', a, b,
        ...(relkind ? { relkind } : {}), ...(standing !== undefined ? { standing } : {}), ...(fr.why ? { why: fr.why } : {}) } as VellumEvent);
      const gist = fr.why || `${facName(a)} and ${facName(b)} ${standing !== undefined && standing < 0 ? 'are at odds' : 'draw closer'} off-screen`;
      events.push({ seq: seq(), turn, day, src: 'system', kind: 'offscreen.op', op: 'new', id: `facrel_${a}_${b}`.slice(0, 40), name: `${facName(a)} & ${facName(b)}`, gist } as VellumEvent);
    }
  }
  return events;
}

/** An off-screen thread is "ripe to intersect" when it has built enough (>= 3
 * beats) OR its `where` matches the current scene location — i.e. it's ready to
 * walk back on-stage. PURE. */
export function readyToIntersect(state: ChronicleState, o: ChronicleState['offscreen'][number]): boolean {
  if (o.status !== 'active') return false;
  if ((o.beats?.length ?? 0) >= 3) return true;
  const loc = (state.scene.location ?? '').trim().toLowerCase();
  return !!loc && !!o.where && o.where.trim().toLowerCase() === loc;
}

/** Convergence injection: the top ripe off-screen threads, nudged to re-enter the
 * scene when the moment fits. Capped; empty when none are ripe. */
export function offscreenInjection(state: ChronicleState, cap = 3): string {
  const ripe = (state.offscreen ?? []).filter((o) => readyToIntersect(state, o))
    .sort((a, b) => (b.beats?.length ?? 0) - (a.beats?.length ?? 0)).slice(0, cap);
  if (!ripe.length) return '';
  const lines = ripe.map((o) => `- ${o.name}${o.who ? ` (${o.who})` : ''}: ${o.gist || o.beats[o.beats.length - 1] || ''} — ready to intersect the scene.`);
  return '[OFF-SCREEN — these subplots have built off-stage and are ready to walk into the scene when the moment fits; let one surface naturally, never force it]\n' + lines.join('\n');
}

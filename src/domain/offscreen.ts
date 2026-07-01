import type { ChronicleState } from './types.js';
import type { VellumEvent } from '../core/events.js';
import type { RelationLock } from './relation-lock.js';
import type { Directive } from './directive.js';
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
    .filter((c) => !present.has(c.id) && (c.status === 'active' || (c.status === 'mentioned' && (c.lastTurn || 0) >= recent)))
    .sort((a, b) => (b.lastTurn || 0) - (a.lastTurn || 0))
    .slice(0, 5);
}

export interface SimCtx {
  locks?: readonly RelationLock[];
  directives?: readonly Directive[];
  tone?: { disposition: string };
}

export const SIM_SYS = [
  'You advance OFF-SCREEN life in a roleplay world: small subplots unfolding elsewhere while the main scene plays out.',
  'You are given OFF-SCREEN CHARACTERS (not in the current scene) and the CURRENT OFF-SCREEN SUBPLOTS already in motion.',
  'For each, decide a small next beat: ADVANCE an existing subplot (reuse its id), RESOLVE one that has run its course, or open a NEW one.',
  'Keep beats SMALL and plausible (a clause, not a plot twist). Do NOT kill anyone, resolve a major on-screen arc, or change relationships/secrets.',
  'Reply STRICT JSON only: {"offscreen":[{"op":"new|advance|resolve","id":"short_id","name":"subplot name","who":"Character or omit","where":"place or omit","gist":"one clause of what just happened"}]}',
  'Use the SAME id to advance/resolve an existing subplot; pick a fresh short snake_case id for a new one. At most 4 entries.',
].join(' ');

/** Build the user prompt: off-screen cast + the OPEN subplots to advance/resolve
 * + world guardrails (locks, armed directives, tone). */
export function buildSimPrompt(state: ChronicleState, cast: ReadonlyArray<{ name: string; role?: string }>, ctx: SimCtx = {}): string {
  const lines: string[] = [];
  lines.push('OFF-SCREEN CHARACTERS:');
  for (const c of cast) lines.push(`- ${c.name}${c.role ? ` (${c.role})` : ''}`);
  const open = (state.offscreen ?? []).filter((o) => o.status === 'active').slice(0, 8);
  if (open.length) {
    lines.push('', 'CURRENT OFF-SCREEN SUBPLOTS (advance with the same id, or resolve):');
    for (const o of open) lines.push(`- [${o.id}] ${o.name}${o.who ? ` (${o.who})` : ''}: ${o.gist || o.beats[o.beats.length - 1] || ''}`);
  } else {
    lines.push('', 'No off-screen subplots yet — open one or two NEW ones.');
  }
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

export interface ParsedSim { offscreen: Array<{ op: 'new' | 'advance' | 'resolve'; id: string; name?: string; who?: string; where?: string; gist?: string }> }

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
  if (!offscreen.length) return null;
  return { offscreen };
}

/**
 * Map a parsed sim to `offscreen.op` events — first-class subplots that
 * accumulate beats and round-trip to the prompt (vs the old ephemeral
 * parallel.set snapshot). `who` resolves to a known cast id when it matches,
 * else stays as the raw name (an off-screen subplot may name a not-present
 * character without minting a scene presence). Still NO bond/secret mutation.
 */
export function simEvents(parsed: ParsedSim, state: ChronicleState, turn: number, day: number, seq: () => number): VellumEvent[] {
  const castByName = new Map(Object.values(state.cast).map((c) => [c.name.toLowerCase(), c.id]));
  const resolve = (who?: string): string | undefined => who ? (castByName.get(who.toLowerCase()) ?? canonId(who)) : undefined;
  const known = new Set((state.offscreen ?? []).map((o) => o.id));
  return parsed.offscreen.map((p) => {
    // a "new" that collides with a known id becomes an advance; an "advance" on
    // an unknown id becomes a new — so the model can't fork or orphan a subplot.
    const op = p.op === 'resolve' ? 'resolve' : (known.has(p.id) ? 'advance' : 'new');
    return { seq: seq(), turn, day, src: 'system', kind: 'offscreen.op', op, id: p.id, ...(p.name ? { name: p.name } : {}), ...(p.who ? { who: resolve(p.who) } : {}), ...(p.where ? { where: p.where } : {}), ...(p.gist ? { gist: p.gist } : {}) } as VellumEvent;
  });
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

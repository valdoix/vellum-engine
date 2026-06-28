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

const MAX_BEATS = 4;

/** Characters plausibly "elsewhere": active (known) but not in the current scene. */
export function offscreenCast(state: ChronicleState): ChronicleState['cast'][string][] {
  const present = new Set(state.scene.present);
  return Object.values(state.cast)
    .filter((c) => c.status === 'active' && !present.has(c.id))
    .sort((a, b) => (b.lastTurn || 0) - (a.lastTurn || 0))
    .slice(0, 5);
}

export interface SimCtx {
  locks?: readonly RelationLock[];
  directives?: readonly Directive[];
  tone?: { disposition: string };
}

export const SIM_SYS = [
  'You advance OFF-SCREEN life in a roleplay world. Given characters who are NOT in the current scene,',
  'invent ONE small, plausible beat each: what they are quietly doing elsewhere right now.',
  'Rules: keep beats SMALL (a clause, not a plot twist). Do not resolve major arcs, kill anyone, or',
  'change relationships. Stay consistent with each character and the world\u2019s tone.',
  'Reply STRICT JSON only: {"parallel":[{"who":"Name","where":"place","activity":"...","note":"..."}],"threads":[{"op":"advance|stall","name":"thread name"}]}',
  'At most ' + MAX_BEATS + ' parallel beats. Omit threads if none fit.',
].join(' ');

/** Build the user prompt: who's off-screen + the world guardrails (locks, armed
 * directives, tone) so the sim can't, e.g., advance a forbidden romance. */
export function buildSimPrompt(state: ChronicleState, cast: ReadonlyArray<{ name: string; role?: string }>, ctx: SimCtx = {}): string {
  const lines: string[] = [];
  lines.push('OFF-SCREEN CHARACTERS (advance one small beat each):');
  for (const c of cast) lines.push(`- ${c.name}${c.role ? ` (${c.role})` : ''}`);
  const openThreads = state.threads.filter((t) => !/resolv/i.test(t.status || '')).slice(0, 6);
  if (openThreads.length) { lines.push('', 'OPEN THREADS (you may nudge one):'); for (const t of openThreads) lines.push(`- ${t.name}`); }
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

export interface ParsedSim { parallel: Array<{ who?: string; where?: string; activity: string; note?: string }>; threads: Array<{ op: 'advance' | 'stall'; name: string }> }

/** Tolerant JSON parse of the controller reply (mirrors parseMergeReply): strip
 * fences/prose, take the first object, validate + cap. Returns null on garbage. */
export function parseSim(text: string): ParsedSim | null {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let obj: unknown;
  try { obj = JSON.parse(m[0]); } catch { return null; }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const parallel = (Array.isArray(o.parallel) ? o.parallel : [])
    .map((p) => (p && typeof p === 'object') ? p as Record<string, unknown> : {})
    .map((p) => ({ ...(p.who ? { who: String(p.who) } : {}), ...(p.where ? { where: String(p.where) } : {}), activity: String(p.activity ?? '').trim(), ...(p.note ? { note: String(p.note) } : {}) }))
    .filter((p) => p.activity)
    .slice(0, MAX_BEATS);
  const threads = (Array.isArray(o.threads) ? o.threads : [])
    .map((t) => (t && typeof t === 'object') ? t as Record<string, unknown> : {})
    .map((t) => ({ op: (t.op === 'stall' ? 'stall' : 'advance') as 'advance' | 'stall', name: String(t.name ?? '').trim() }))
    .filter((t) => t.name)
    .slice(0, 3);
  if (!parallel.length && !threads.length) return null;
  return { parallel, threads };
}

/**
 * Map a parsed sim to events. parallel.set REPLACES the whole list in the
 * reducer, so we MERGE the new sim beats with the existing parallel state (the
 * model-narrated ones), tagging the new ones src:'sim'. Thread nudges only touch
 * threads that already exist (the sim can't invent threads). Resolves who-names
 * to canonical cast ids when they match a known character.
 */
export function simEvents(parsed: ParsedSim, state: ChronicleState, turn: number, day: number, seq: () => number): VellumEvent[] {
  const out: VellumEvent[] = [];
  const knownThread = new Set(state.threads.map((t) => t.name.toLowerCase()));
  const castByName = new Map(Object.values(state.cast).map((c) => [c.name.toLowerCase(), c.id]));
  const resolve = (who?: string): string | undefined => who ? (castByName.get(who.toLowerCase()) ?? canonId(who)) : undefined;

  const existing = (state.parallel ?? []).map((p) => ({ ...(p.who ? { who: p.who } : {}), ...(p.where ? { where: p.where } : {}), activity: p.activity, ...(p.note ? { note: p.note } : {}), ...(p.src ? { src: p.src } : {}) }));
  const fresh = parsed.parallel.map((p) => ({ ...(p.who ? { who: resolve(p.who) } : {}), ...(p.where ? { where: p.where } : {}), activity: p.activity, ...(p.note ? { note: p.note } : {}), src: 'sim' as const }));
  // keep recent existing + the new sim beats, capped so parallel doesn't grow forever
  const items = [...fresh, ...existing].slice(0, 8);
  out.push({ seq: seq(), turn, day, src: 'system', kind: 'parallel.set', items } as VellumEvent);

  for (const t of parsed.threads) {
    if (!knownThread.has(t.name.toLowerCase())) continue; // sim can't invent threads
    out.push({ seq: seq(), turn, day, src: 'system', kind: 'thread.op', op: t.op, name: t.name, note: 'off-screen' } as VellumEvent);
  }
  return out;
}

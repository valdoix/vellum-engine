import type { ChronicleState, Track } from './types.js';
import { spanLabel } from './date-format.js';

/**
 * Thread catch-up authoring (Time Sync). PURE core: given the plot threads that a
 * time-skip left behind, build a canon-locked controller prompt asking the model
 * to author the ONE beat that most plausibly closes each thread's day-gap, parse
 * the reply tolerantly, and map it back to `thread.set` fill events. All I/O (the
 * LLM call, persistence) lives in the backend, mirroring thread-merge/offscreen.
 *
 * Two kinds of catch-up beat live on a thread:
 *   - a MARKER ("caught up: Day 9 → Day 12") — a bare day-stamp with no story,
 *     emitted when generation is unavailable. It records that a gap exists.
 *   - an AUTHORED beat — real content the model wrote to cover that gap, which
 *     REPLACES the marker (thread.set with `fill: true`).
 *
 * CANON DISCIPLINE (the whole point): every authored beat must be grounded ONLY
 * in what THIS story has established — its cast, their life-state, the thread's
 * own prior beats, and recorded facts. The model is explicitly forbidden from
 * importing anything from source books/adaptations/prior knowledge, so an AU
 * where "Cersei has no children" stays that way: the sim cannot invent a child
 * just because canon-Cersei has them.
 */

/** The prefix the backend writes for a bare (unauthored) catch-up marker. Kept
 * here so detection and emission never drift apart. */
export const CATCHUP_MARKER = 'caught up';
/** Matches both marker phrasings: "caught up: Day 9 → Day 12" and the day-0
 * fallback "caught up to Day 12". Case-insensitive, tolerant of arrow glyphs. */
const MARKER_RE = /^caught up(?::| to)\s+(?:day\s+)?\d/i;
const MARKER_SPAN_RE = /^caught up:\s*day\s+(\d+)\s*(?:\u2192|->|to)\s*day\s+(\d+)/i;
const MARKER_TO_RE = /^caught up to\s+day\s+(\d+)/i;

/** Is this beat a bare catch-up marker (a placeholder awaiting real content)? PURE. */
export function isCatchupMarker(beat: string | undefined): boolean {
  return !!beat && MARKER_RE.test(beat.trim());
}

/** Recover the day-span a marker recorded ("caught up: Day 9 → Day 12" → {from:9,
 * to:12}). Once a thread is stamped its lastDay == the target, so the marker text
 * is the only surviving record of the ORIGINAL gap — parse it so an authored beat
 * covers the real span, not a zero-length one. Returns null for a non-marker. PURE. */
export function markerDays(beat: string | undefined): { from?: number; to: number } | null {
  const b = String(beat || '').trim();
  const span = b.match(MARKER_SPAN_RE);
  if (span) return { from: Number(span[1]), to: Number(span[2]) };
  const to = b.match(MARKER_TO_RE);
  if (to) return { to: Number(to[1]) };
  return null;
}

/** Does a thread still need authored content? True when its LATEST beat is an
 * unfilled marker — i.e. its day was stamped forward but no story was written for
 * the gap yet. This is what keeps the Time Sync "generate" action reachable after
 * a stamp-only catch-up. PURE. */
export function threadAwaitsFill(t: Track): boolean {
  return isCatchupMarker(t.beats[t.beats.length - 1]);
}

/** An open (non-resolved) plot thread the Time Sync view should offer to author:
 * either it lags the current day, or it already carries an unfilled marker. PURE. */
export function threadsAwaitingCatchup(state: ChronicleState, nowDay: number): Track[] {
  const open = (t: Track): boolean => !/resolv/i.test(t.status || '');
  return state.threads.filter(open).filter((t) => {
    if (threadAwaitsFill(t)) return true;
    return nowDay > 0 && t.lastDay !== undefined && t.lastDay < nowDay;
  });
}

/** A thread the model is being asked to author a catch-up beat for, with the
 * span it must cover and its own recent history (the local canon it builds on). */
export interface CatchupTarget {
  id: string;
  name: string;
  status: string;
  fromDay: number;
  toDay: number;
  /** the thread's recent beats, marker excluded — the story so far to continue */
  recentBeats: string[];
}

/** Build the targets for a set of thread ids, resolving each thread's real gap and
 * stripping any trailing marker from the beats we feed back to the model (so it
 * continues the STORY, not the placeholder). Threads already at/past `nowDay` with
 * no marker are skipped. PURE. */
export function catchupTargets(state: ChronicleState, ids: readonly string[], nowDay: number): CatchupTarget[] {
  const out: CatchupTarget[] = [];
  for (const id of ids) {
    const t = state.threads.find((x) => x.id === id);
    if (!t) continue;
    const marker = t.beats[t.beats.length - 1];
    const trailingMarker = isCatchupMarker(marker);
    const lastReal = trailingMarker ? t.beats.slice(0, -1) : t.beats;
    // prefer the span the marker recorded (survives the stamp); else the thread's
    // own lastDay, else its first-seen day.
    const span = trailingMarker ? markerDays(marker) : null;
    const toDay = nowDay > 0 ? nowDay : (span?.to ?? t.lastDay ?? 0);
    const fromDay = span?.from ?? t.lastDay ?? t.firstDay ?? 0;
    // nothing to cover: already current AND no placeholder to replace
    if (!trailingMarker && (t.lastDay === undefined || t.lastDay >= toDay)) continue;
    out.push({ id: t.id, name: t.name, status: t.status, fromDay, toDay, recentBeats: lastReal.slice(-4) });
  }
  return out;
}

/** A short, deceased-aware line per known cast member — the canon roster the beat
 * must respect. Deceased characters are flagged so the model never revives them
 * off-screen. PURE. */
function castRoster(state: ChronicleState): string[] {
  return Object.values(state.cast)
    .filter((c) => c.status !== 'added')
    .sort((a, b) => (b.lastTurn || 0) - (a.lastTurn || 0))
    .slice(0, 16)
    .map((c) => `- ${c.name}${c.role ? ` (${c.role})` : ''}${c.deceased ? ' [DECEASED — cannot act]' : ''}`);
}

/** A handful of established facts (knowledge + secrets) that anchor the world's
 * truth, newest first. These are the "what is true here" the model may not
 * contradict. PURE. */
function establishedFacts(state: ChronicleState, limit = 10): string[] {
  const nm = (id: string): string => state.cast[id]?.name ?? id;
  const facts: Array<{ turn: number; text: string }> = [];
  for (const k of state.knowledge) facts.push({ turn: k.turn, text: `${nm(k.who)}: ${k.fact}` });
  for (const s of state.secrets) facts.push({ turn: s.formedTurn, text: `${nm(s.keeper)} (secret): ${s.text}` });
  return facts.sort((a, b) => b.turn - a.turn).slice(0, limit).map((f) => `- ${f.text}`);
}

export const THREAD_CATCHUP_SYS = [
  'You are a story continuity assistant for a roleplay. A time-skip jumped the clock forward and left some PLOT THREADS on an earlier day. For each thread, author the SINGLE most plausible beat that brings it from its last known day up to the current day — what quietly happened to it during the gap.',
  'Keep each beat to ONE grounded clause or sentence: a concrete development, not a montage and not a dramatic twist. Do NOT kill or revive anyone, resolve a major on-screen arc, or introduce a brand-new named character.',
  'CANON LOCK — this is the hard rule: this story is its OWN continuity, possibly an alternate universe. Ground every beat ONLY in what THIS story has established — the roster, life-states, established facts, and the thread\u2019s own prior beats given below. NEVER import a detail from a source book, show, film, game, or any outside knowledge about these names. If the story has not established something (a character\u2019s child, title, death, allegiance, whereabouts), it is NOT true here and you must not assert it. When unsure, keep the beat small and safe rather than inventing.',
  'Reply STRICT JSON only: {"beats":[{"id":"<thread id exactly as given>","beat":"one grounded clause of what happened over the gap"}]}. Include only the ids you were given. Omit any thread you cannot advance without inventing. An empty beats array is acceptable.',
].join(' ');

/** Build the user prompt: the canon roster + established facts + each lagging
 * thread with its own recent beats and the day-span to cover. */
export function buildCatchupPrompt(state: ChronicleState, targets: readonly CatchupTarget[]): string {
  const lines: string[] = [];
  const roster = castRoster(state);
  if (roster.length) { lines.push('CANON ROSTER (only these people exist here; respect DECEASED):'); lines.push(...roster); lines.push(''); }
  const facts = establishedFacts(state);
  if (facts.length) { lines.push('ESTABLISHED FACTS (must not be contradicted):'); lines.push(...facts); lines.push(''); }
  if (state.scene.location) { lines.push(`CURRENT SCENE: ${state.scene.location}${state.scene.time ? ', ' + state.scene.time : ''} (narrative day ${state.day || 0}).`); lines.push(''); }
  lines.push('THREADS TO CATCH UP (author one beat each for the day-gap shown):');
  for (const t of targets) {
    const span = spanLabel(Math.max(0, t.toDay - t.fromDay));
    lines.push(`- [${t.id}] "${t.name}"${t.status && !/^(new|advance)$/i.test(t.status) ? ` (${t.status})` : ''} \u2014 Day ${t.fromDay} \u2192 Day ${t.toDay}${span ? ` (~${span})` : ''}`);
    if (t.recentBeats.length) for (const b of t.recentBeats) lines.push(`    \u00b7 so far: ${b}`);
  }
  lines.push('', 'Return the JSON now. Stay inside this story\u2019s established canon.');
  return lines.join('\n');
}

export interface ParsedCatchupBeat { id: string; beat: string }

/** Tolerant parse of the controller reply: {beats:[{id,beat}]} or a bare [...].
 * Drops empties; trims; caps a beat to a sane length. PURE. */
export function parseCatchupReply(text: string): ParsedCatchupBeat[] | null {
  const t = String(text || '').replace(/```[a-z]*\n?|```/gi, '').trim();
  const tryParse = (s: string): unknown => { try { return JSON.parse(s); } catch { return null; } };
  let v = tryParse(t);
  if (v == null) { const m = t.match(/\{[\s\S]*\}|\[[\s\S]*\]/); if (m) v = tryParse(m[0]); }
  const arr = Array.isArray(v) ? v : (v && typeof v === 'object' && Array.isArray((v as { beats?: unknown }).beats) ? (v as { beats: unknown[] }).beats : null);
  if (!arr) return null;
  const out: ParsedCatchupBeat[] = [];
  for (const b of arr) {
    if (!b || typeof b !== 'object') continue;
    const id = String((b as { id?: unknown }).id ?? '').trim();
    const beat = String((b as { beat?: unknown }).beat ?? (b as { text?: unknown }).text ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
    if (id && beat) out.push({ id, beat });
  }
  return out;
}

/** Keep only beats whose id is a real target and whose text isn't itself a marker
 * echo; dedupe by id (first wins). Returns beats ready to become fill events. PURE. */
export function validateCatchupBeats(beats: ParsedCatchupBeat[] | null, targets: readonly CatchupTarget[]): ParsedCatchupBeat[] {
  if (!beats) return [];
  const byId = new Map(targets.map((t) => [t.id, t] as const));
  const seen = new Set<string>();
  const out: ParsedCatchupBeat[] = [];
  for (const b of beats) {
    if (!byId.has(b.id) || seen.has(b.id)) continue;
    if (isCatchupMarker(b.beat)) continue; // never accept a marker as "content"
    seen.add(b.id);
    out.push(b);
  }
  return out;
}

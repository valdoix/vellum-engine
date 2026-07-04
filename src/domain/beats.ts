import type { ChronicleState, Memory } from './types.js';
import type { VellumEvent } from '../core/events.js';
import { formatDate } from './date-format.js';

/**
 * Story Beats (tier 'beat') — author-curated landmark index cards. Distinct from
 * auto chapters/arcs (compression of turns) and the Codex (canon facts): a beat
 * is the author's objective "this is what mattered" bookmark. Beats are never
 * folded or subsumed. PURE helpers; the backend owns I/O.
 *
 * Two recall paths:
 *   - SPINE  (beat.spine === true): a compact chronological through-line injected
 *     cheaply EVERY turn, so the model never loses the plot's shape.
 *   - keyword recall: full beat text flows through the normal hybrid index like
 *     any other memory (handled by the recall layer via tier).
 */

export function beats(state: ChronicleState): Memory[] {
  return state.memories.filter((m) => m.tier === 'beat');
}

/** Chronological sort key: prefer the authored day/time, fall back to turn. */
function beatOrder(m: Memory): number {
  // day dominates; turn breaks ties and covers beats with no authored day
  return (m.beatDay ?? 0) * 100000 + m.turn;
}

/** Beats in display order: manual `ord` (author reordering) wins when present;
 * otherwise chronological. Mixed lists keep ord-beats in their slot and slot the
 * rest chronologically around them via a stable comparison. */
export function sortedBeats(state: ChronicleState): Memory[] {
  const key = (m: Memory): number => m.ord !== undefined ? m.ord : beatOrder(m);
  return beats(state).slice().sort((a, b) => key(a) - key(b) || beatOrder(a) - beatOrder(b));
}

/**
 * Reorder one beat by swapping it with its neighbour in the current display
 * order (dir -1 = up/earlier, +1 = down/later). Returns drop+record event pairs
 * (same ids) that re-emit ALL beats with a dense `ord`, so the new order is
 * durable in the append-only log. [] if the move is a no-op.
 */
export function beatReorderEvents(state: ChronicleState, id: string, dir: -1 | 1, seq: () => number): VellumEvent[] {
  const list = sortedBeats(state);
  const i = list.findIndex((m) => m.id === id);
  if (i < 0) return [];
  const j = i + dir;
  if (j < 0 || j >= list.length) return [];
  // swap the two neighbours in the display order, then re-emit EVERY beat with a
  // dense ord = its new index. Re-emitting all (not just the pair) is required:
  // an ord on only two beats would sort them against the others' chronological
  // keys and jump them out of place. reduce's memory.record is push-only (ignores
  // an existing id), so each beat is dropped then re-recorded (like beatEditEvents).
  const order = list.map((m) => m.id);
  [order[i], order[j]] = [order[j]!, order[i]!];
  const out: VellumEvent[] = [];
  order.forEach((bid, idx) => {
    const m = list.find((x) => x.id === bid)!;
    out.push({ seq: seq(), turn: m.turn, day: 0, src: 'user', kind: 'memory.drop', id: m.id } as VellumEvent);
    out.push({
      seq: seq(), turn: m.turn, day: m.beatDay ?? 0, src: 'user', kind: 'memory.record', id: m.id, tier: 'beat', text: m.text, keys: m.keys ?? [], ord: idx,
      ...(m.beatDay !== undefined ? { beatDay: m.beatDay } : {}),
      ...(m.beatTime ? { beatTime: m.beatTime } : {}),
      ...(m.spine ? { spine: true } : {}),
      ...(m.act ? { act: m.act } : {}),
    } as VellumEvent);
  });
  return out;
}

/** A short "[Day N · time] text" label for one beat (display + spine line). */
export function beatLabel(m: Memory, state?: ChronicleState): string {
  const day = m.beatDay !== undefined
    ? (state ? formatDate(m.beatDay, state.dateFormat || 'day', state) : `Day ${m.beatDay}`)
    : '';
  const time = m.beatTime ? (day ? ', ' + m.beatTime : m.beatTime) : '';
  const anchor = day || time ? `[${day}${time}] ` : '';
  return anchor + m.text;
}

/**
 * The always-on recall SPINE: the chronological through-line of spine-flagged
 * beats, capped so it stays a light skeleton (most-recent kept when over cap).
 * Returns '' when there's nothing to inject. `cap` bounds the line count.
 */
export function beatSpine(state: ChronicleState, cap = 14): string {
  let spine = sortedBeats(state).filter((m) => m.spine);
  if (!spine.length) return '';
  if (spine.length > cap) spine = spine.slice(spine.length - cap); // keep the most recent
  const lines = spine.map((m) => '- ' + beatLabel(m, state));
  return '[STORY SPINE — the author-marked landmarks of this story, in order. Treat as established ground truth; honor and build on them, never contradict or re-tell them as if new]\n' + lines.join('\n');
}

/**
 * Edit an existing beat: emit a drop of the old id + a fresh record reusing the
 * SAME id (memory.record dedups by id, so we must drop first). Returns [] when
 * the beat doesn't exist or text is empty.
 */
export function beatEditEvents(
  state: ChronicleState,
  id: string,
  o: { text: string; day?: number; time?: string; spine?: boolean; act?: string },
  seq: () => number,
): VellumEvent[] {
  const cur = state.memories.find((m) => m.id === id && m.tier === 'beat');
  if (!cur) return [];
  const text = String(o.text || '').trim();
  if (!text) return [];
  const rec: VellumEvent = {
    seq: seq(), turn: cur.turn, day: o.day ?? cur.beatDay ?? 0, src: 'user', kind: 'memory.record', id, tier: 'beat', text, keys: cur.keys ?? [],
    ...(o.day !== undefined ? { beatDay: o.day } : (cur.beatDay !== undefined ? { beatDay: cur.beatDay } : {})),
    ...(o.time !== undefined ? (o.time ? { beatTime: o.time } : {}) : (cur.beatTime ? { beatTime: cur.beatTime } : {})),
    ...(o.spine !== false ? { spine: true } : {}),
    ...(o.act ? { act: o.act } : (cur.act ? { act: cur.act } : {})),
    ...(cur.ord !== undefined ? { ord: cur.ord } : {}),
  } as VellumEvent;
  return [{ seq: seq(), turn: cur.turn, day: 0, src: 'user', kind: 'memory.drop', id } as VellumEvent, rec];
}

/** Build a memory.record event for a user-authored beat. */
export function beatEvent(
  o: { text: string; day?: number; time?: string; spine?: boolean; act?: string; keys?: string[] },
  turn: number,
  seq: () => number,
): VellumEvent | null {
  const text = String(o.text || '').trim();
  if (!text) return null;
  const id = 'beat_' + turn + '_' + Math.random().toString(36).slice(2, 8);
  return {
    seq: seq(), turn, day: o.day ?? 0, src: 'user', kind: 'memory.record', id, tier: 'beat', text, keys: o.keys ?? [],
    ...(o.day !== undefined ? { beatDay: o.day } : {}),
    ...(o.time ? { beatTime: o.time } : {}),
    ...(o.spine !== false ? { spine: true } : {}), // default ON — a beat is a spine landmark unless told otherwise
    ...(o.act ? { act: o.act } : {}),
  } as VellumEvent;
}

/**
 * Suggest turns worth promoting to Story Beats, so the feature doesn't die of
 * manual neglect. Heuristic, PURE: high-tension scene memories, defining-weight
 * journal moments, and resolved threads — anything the author likely considers a
 * landmark. Returns compact candidates; the UI offers one-click accept. Excludes
 * turns already covered by an existing beat (same turn).
 */
export interface BeatSuggestion { turn: number; day?: number; text: string; source: 'journal' | 'thread' | 'tension'; }

export function suggestBeats(state: ChronicleState, limit = 8): BeatSuggestion[] {
  const haveTurn = new Set(beats(state).map((m) => m.turn));
  const out: BeatSuggestion[] = [];
  // defining / significant journal moments
  for (const j of state.journal) {
    if (j.weight === 'defining' || j.weight === 'significant') {
      out.push({ turn: j.turn, day: j.day, text: j.memory, source: 'journal' });
    }
  }
  // resolved plot threads (a thread resolving is almost always a landmark)
  for (const t of state.threads) {
    if (t.status === 'resolved') out.push({ turn: t.lastTurn, text: 'Resolved: ' + t.name, source: 'thread' });
  }
  // dedupe by turn+text, drop ones already beaten, newest first, cap
  const seen = new Set<string>();
  return out
    .filter((s) => { const k = s.turn + '|' + s.text.slice(0, 40); if (haveTurn.has(s.turn) || seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.turn - a.turn)
    .slice(0, limit);
}

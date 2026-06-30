import type { ChronicleState } from './types.js';
import type { VellumEvent } from '../core/events.js';
import { hashStr } from '../core/ids.js';

/**
 * Hierarchical memory — the long-arc compression that keeps the deep past
 * recall-able instead of growing linearly forever. Unlike legacy's memTree
 * (which was built but never fed back into recall), these are `memory.record`
 * events of tier 'chapter'/'arc', so they flow through the SAME index + hybrid
 * fuser as everything else (see retrieval/invindex.ts collectItems).
 *
 * This runs as a maintenance pass (not per-turn), driven by the backend when a
 * chat accrues enough turn-memories. It's intentionally summarizer-agnostic:
 * the caller supplies the summarize() (host generation) so this module stays
 * pure + testable; we only decide WHAT to compress and emit the events.
 */

export interface CompressPlan {
  /** source memory ids to fold (turn-tier for a chapter, chapter-tier for an arc) */
  sourceIds: string[];
  /** the full source memories, kept so deletion can restore them. tier/detail/
   * covers are carried for chapter sources (so an arc can restore real chapters). */
  source: Array<{ id: string; turn: number; text: string; keys: string[]; tier?: 'turn' | 'chapter' | 'arc'; detail?: string; covers?: [number, number] }>;
  /** inclusive turn range covered */
  covers: [number, number];
}

/**
 * Decide which turn-tier memories to compress. Compress the oldest contiguous
 * window of >= `windowSize` turn-memories that isn't already covered by a
 * chapter. Returns null when there's nothing worth compressing yet.
 */
export function planChapter(state: ChronicleState, windowSize = 8): CompressPlan | null {
  const turnMems = state.memories.filter((m) => m.tier === 'turn').sort((a, b) => a.turn - b.turn);
  if (turnMems.length < windowSize) return null;
  const window = turnMems.slice(0, windowSize);
  const covers: [number, number] = [window[0]!.turn, window[window.length - 1]!.turn];
  return { sourceIds: window.map((m) => m.id), source: window.map((m) => ({ id: m.id, turn: m.turn, text: m.text, keys: m.keys ?? [] })), covers };
}

/**
 * Plan a chapter from an EXPLICIT set of turn-memory ids (a manual pick). Keeps
 * only ids that are real, turn-tier memories; sorts by turn; allows a
 * non-contiguous pick but records the true [min,max] span. Returns null when
 * fewer than `minWindow` valid sources remain (so a stray click can't fold one
 * turn). The chapter is otherwise identical to an auto one (restorable via
 * `subsumed`).
 */
export function planChapterFrom(state: ChronicleState, ids: readonly string[], minWindow = 2): CompressPlan | null {
  const want = new Set(ids.map(String));
  const picked = state.memories
    .filter((m) => m.tier === 'turn' && want.has(m.id))
    .sort((a, b) => a.turn - b.turn);
  if (picked.length < Math.max(2, minWindow)) return null;
  const covers: [number, number] = [picked[0]!.turn, picked[picked.length - 1]!.turn];
  return {
    sourceIds: picked.map((m) => m.id),
    source: picked.map((m) => ({ id: m.id, turn: m.turn, text: m.text, keys: m.keys ?? [] })),
    covers,
  };
}

/**
 * Build the events for a completed compression: record the new chapter memory
 * and drop the source turn-memories it subsumes (kept retrievable via the
 * chapter). `gist` is the lean chronicle text; `detail` the dense body mirrored
 * to the vault; `keys` the retrieval keywords (shared by both).
 */
export function chapterEvents(
  plan: CompressPlan,
  summary: { gist: string; detail: string; keys: string[] },
  turn: number,
  day: number,
  seq: () => number,
): VellumEvent[] {
  const id = 'chap_' + hashStr(plan.sourceIds.join(',')).slice(0, 8);
  const events: VellumEvent[] = [
    { seq: seq(), turn, day, src: 'system', kind: 'memory.record', id, tier: 'chapter', text: summary.gist, detail: summary.detail, keys: summary.keys, covers: plan.covers, subsumed: plan.source } as VellumEvent,
  ];
  for (const sid of plan.sourceIds) {
    events.push({ seq: seq(), turn, day, src: 'system', kind: 'memory.drop', id: sid });
  }
  return events;
}

/** Snapshot a chapter memory as a restorable arc-source entry. */
function chapterSource(m: { id: string; turn: number; text: string; keys?: string[]; detail?: string; covers?: [number, number] }): CompressPlan['source'][number] {
  return { id: m.id, turn: m.covers ? m.covers[1] : m.turn, text: m.text, keys: m.keys ?? [], tier: 'chapter', ...(m.detail ? { detail: m.detail } : {}), ...(m.covers ? { covers: m.covers } : {}) };
}

/**
 * Decide which CHAPTER memories to consolidate into an arc: the oldest
 * contiguous run of >= `minChapters` chapters, keeping the most recent
 * `lagChapters` un-bound (so recent chapters stay individually visible). Returns
 * null when there aren't enough old chapters yet.
 */
export function planArc(state: ChronicleState, minChapters = 3, lagChapters = 4): CompressPlan | null {
  const chapters = state.memories.filter((m) => m.tier === 'chapter').sort((a, b) => (a.covers ? a.covers[1] : a.turn) - (b.covers ? b.covers[1] : b.turn));
  const eligible = Math.max(0, chapters.length - Math.max(0, lagChapters));
  if (eligible < Math.max(2, minChapters)) return null;
  const window = chapters.slice(0, Math.min(eligible, Math.max(minChapters, eligible)));
  return arcPlanFrom(window);
}

/** Plan an arc from an EXPLICIT set of chapter-memory ids (a manual pick). */
export function planArcFrom(state: ChronicleState, ids: readonly string[], minChapters = 2): CompressPlan | null {
  const want = new Set(ids.map(String));
  const picked = state.memories
    .filter((m) => m.tier === 'chapter' && want.has(m.id))
    .sort((a, b) => (a.covers ? a.covers[1] : a.turn) - (b.covers ? b.covers[1] : b.turn));
  if (picked.length < Math.max(2, minChapters)) return null;
  return arcPlanFrom(picked);
}

function arcPlanFrom(chapters: Array<{ id: string; turn: number; text: string; keys?: string[]; detail?: string; covers?: [number, number] }>): CompressPlan {
  const lo = Math.min(...chapters.map((m) => m.covers ? m.covers[0] : m.turn));
  const hi = Math.max(...chapters.map((m) => m.covers ? m.covers[1] : m.turn));
  return { sourceIds: chapters.map((m) => m.id), source: chapters.map(chapterSource), covers: [lo, hi] };
}

/**
 * Build the events for a completed ARC consolidation: record the arc memory and
 * drop the source chapters it subsumes (restored on the arc's deletion, since
 * `subsumed` carries each chapter's tier/detail/covers).
 */
export function arcEvents(
  plan: CompressPlan,
  summary: { gist: string; detail: string; keys: string[] },
  turn: number,
  day: number,
  seq: () => number,
): VellumEvent[] {
  const id = 'arc_' + hashStr(plan.sourceIds.join(',')).slice(0, 8);
  const events: VellumEvent[] = [
    { seq: seq(), turn, day, src: 'system', kind: 'memory.record', id, tier: 'arc', text: summary.gist, detail: summary.detail, keys: summary.keys, covers: plan.covers, subsumed: plan.source } as VellumEvent,
  ];
  for (const sid of plan.sourceIds) {
    events.push({ seq: seq(), turn, day, src: 'system', kind: 'memory.drop', id: sid });
  }
  return events;
}

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
  /** turn-tier memory ids to fold into one chapter */
  sourceIds: string[];
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
  return { sourceIds: window.map((m) => m.id), covers };
}

/**
 * Build the events for a completed compression: record the new chapter memory
 * and drop the source turn-memories it subsumes (kept retrievable via the
 * chapter). Caller provides the produced summary text + keywords.
 */
export function chapterEvents(
  plan: CompressPlan,
  summary: string,
  keys: string[],
  turn: number,
  day: number,
  seq: () => number,
): VellumEvent[] {
  const id = 'chap_' + hashStr(plan.sourceIds.join(',')).slice(0, 8);
  const events: VellumEvent[] = [
    { seq: seq(), turn, day, src: 'system', kind: 'memory.record', id, tier: 'chapter', text: summary, keys, covers: plan.covers },
  ];
  for (const sid of plan.sourceIds) {
    events.push({ seq: seq(), turn, day, src: 'system', kind: 'memory.drop', id: sid });
  }
  return events;
}

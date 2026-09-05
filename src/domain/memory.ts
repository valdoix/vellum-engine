import type { ChronicleState, Memory, MemorySnapshot } from './types.js';
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
  source: MemorySnapshot[];
  /** inclusive turn range covered */
  covers: [number, number];
  /** Integrity proof over the exact ordered source snapshots. */
  coverageHash: string;
}

/** Stable hash of a restorable memory snapshot. `sourceHash` is deliberately
 * excluded so validation never hashes the hash itself. */
export function memorySnapshotHash(m: MemorySnapshot): string {
  return hashStr(JSON.stringify({
    id: m.id, turn: m.turn, text: m.text, keys: m.keys ?? [], tier: m.tier,
    detail: m.detail, covers: m.covers, subsumed: m.subsumed,
    coverageHash: m.coverageHash, status: m.status,
  }));
}

export function archiveCoverageHash(source: readonly MemorySnapshot[]): string {
  return hashStr(source.map((m) => `${m.id}:${m.sourceHash ?? memorySnapshotHash(m)}`).join('|'));
}

/** Copy the complete archive ancestry. This is the crucial arc-undo contract:
 * an arc stores chapters and each chapter still stores its original turns. */
function snapshotMemory(m: Memory): MemorySnapshot {
  const snap: MemorySnapshot = {
    id: m.id, turn: m.turn, text: m.text, keys: [...(m.keys ?? [])], tier: m.tier,
    ...(m.detail ? { detail: m.detail } : {}),
    ...(m.covers ? { covers: [...m.covers] as [number, number] } : {}),
    ...(m.subsumed?.length ? { subsumed: structuredClone(m.subsumed) } : {}),
    ...(m.coverageHash ? { coverageHash: m.coverageHash } : {}),
    ...(m.status ? { status: m.status } : {}),
  };
  snap.sourceHash = memorySnapshotHash(snap);
  return snap;
}

function planFromMemories(memories: Memory[]): CompressPlan {
  const source = memories.map(snapshotMemory);
  const lo = Math.min(...memories.map((m) => m.covers ? m.covers[0] : m.turn));
  const hi = Math.max(...memories.map((m) => m.covers ? m.covers[1] : m.turn));
  return { sourceIds: source.map((m) => m.id), source, covers: [lo, hi], coverageHash: archiveCoverageHash(source) };
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
  return planFromMemories(window);
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
  return planFromMemories(picked);
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
    { seq: seq(), turn, day, src: 'system', kind: 'memory.record', id, tier: 'chapter', text: summary.gist, detail: summary.detail, keys: summary.keys, covers: plan.covers, subsumed: plan.source, coverageHash: plan.coverageHash, status: 'ready' } as VellumEvent,
  ];
  for (const sid of plan.sourceIds) {
    events.push({ seq: seq(), turn, day, src: 'system', kind: 'memory.drop', id: sid, folded: true });
  }
  return events;
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

function arcPlanFrom(chapters: Memory[]): CompressPlan {
  return planFromMemories(chapters);
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
    { seq: seq(), turn, day, src: 'system', kind: 'memory.record', id, tier: 'arc', text: summary.gist, detail: summary.detail, keys: summary.keys, covers: plan.covers, subsumed: plan.source, coverageHash: plan.coverageHash, status: 'ready' } as VellumEvent,
  ];
  for (const sid of plan.sourceIds) {
    events.push({ seq: seq(), turn, day, src: 'system', kind: 'memory.drop', id: sid, folded: true });
  }
  return events;
}

/** Exact assistant-turn numbers safely represented by ready chapter/arc
 * archives. A corrupt hash, degraded archive, or range-only record contributes
 * nothing. Legacy records with exact `subsumed` ancestry remain eligible. */
export function archivedTurnNumbers(state: ChronicleState): Set<number> {
  const out = new Set<number>();
  const visit = (m: MemorySnapshot): boolean => {
    if (m.status === 'degraded' || m.status === 'stale') return false;
    if (m.sourceHash && m.sourceHash !== memorySnapshotHash(m)) return false;
    if (m.subsumed?.length) {
      if (m.coverageHash && m.coverageHash !== archiveCoverageHash(m.subsumed)) return false;
      let ok = true;
      for (const child of m.subsumed) if (!visit(child)) ok = false;
      return ok;
    }
    if ((m.tier ?? 'turn') !== 'turn' || !Number.isInteger(m.turn) || m.turn <= 0) return false;
    out.add(m.turn);
    return true;
  };
  for (const m of state.memories) {
    if (m.tier !== 'chapter' && m.tier !== 'arc') continue;
    // Do not leave partial coverage behind if any descendant fails validation.
    const before = new Set(out);
    if (!visit(m)) { out.clear(); for (const n of before) out.add(n); }
  }
  return out;
}

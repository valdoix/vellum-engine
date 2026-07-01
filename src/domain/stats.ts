import type { ChronicleState } from './types.js';

/**
 * Story stats — PURE read over existing state. A light "story so far" readout:
 * turns/days, cast size, most-active characters (by present-count in scene
 * history isn't stored, so use lastTurn recency + relation degree), biggest
 * relationship swings, and longest-held traits. Cheap and satisfying.
 */

export interface StoryStats {
  turns: number;
  days: number;
  cast: number;
  bonds: number;
  chapters: number;
  topCharacters: Array<{ name: string; bonds: number }>;
  biggestSwings: Array<{ pair: string; delta: number }>;
}

export function storyStats(s: ChronicleState): StoryStats {
  const nm = (id: string): string => s.cast[id]?.name ?? id;
  // "most connected" characters by bond degree (a cheap proxy for centrality)
  const degree = new Map<string, number>();
  for (const r of s.relations) { degree.set(r.a, (degree.get(r.a) ?? 0) + 1); degree.set(r.b, (degree.get(r.b) ?? 0) + 1); }
  const topCharacters = [...degree.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, n]) => ({ name: nm(id), bonds: n }));
  // biggest affection swings, from each relation's score history
  const biggestSwings = s.relations.map((r) => {
    const h = r.history ?? [];
    if (h.length < 2) return null;
    let lo = h[0]!.affection, hi = h[0]!.affection;
    for (const x of h) { if (x.affection < lo) lo = x.affection; if (x.affection > hi) hi = x.affection; }
    return { pair: `${nm(r.a)} \u2192 ${nm(r.b)}`, delta: hi - lo };
  }).filter((x): x is { pair: string; delta: number } => !!x && x.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5);
  return {
    turns: s.turns ?? 0,
    days: s.day ?? 0,
    cast: Object.keys(s.cast).length,
    bonds: s.relations.length,
    chapters: s.memories.filter((m) => m.tier === 'chapter' || m.tier === 'arc').length,
    topCharacters,
    biggestSwings,
  };
}

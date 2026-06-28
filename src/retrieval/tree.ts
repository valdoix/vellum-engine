import type { ChronicleState } from '../domain/types.js';
import { collectItems, type RetrievableItem } from './invindex.js';

/**
 * Derived memory TREE for tiered traversal — arc → chapter → leaf.
 *
 * VELLUM already produces the hierarchy: arc/chapter summaries carry `covers`
 * turn-ranges, and every leaf (knowledge/secret/journal/turn-memory) has a
 * `turn`. We nest by range containment — no LLM build, no authored tree. Pure +
 * deterministic. Loose chapters/leaves (under no arc) hang at ROOT.
 *
 * A node's `gist` is the compact text shown to the controller while drilling;
 * selecting a chapter/arc node later yields its DETAILED summary (resolved by
 * the caller from memory.detail / the vault), which is the continuity payload.
 */

export type MemNodeKind = 'arc' | 'chapter' | 'leaf';

export interface MemNode {
  id: string;
  kind: MemNodeKind;
  gist: string; // compact label shown while drilling
  childrenIds: string[];
  covers?: [number, number];
}

export interface MemTree {
  rootIds: string[]; // top-level nodes (arcs + loose chapters/leaves)
  nodes: Map<string, MemNode>;
}

function inRange(turn: number, covers?: [number, number]): boolean {
  return !!covers && turn >= covers[0] && turn <= covers[1];
}
function within(inner: [number, number] | undefined, outer: [number, number] | undefined): boolean {
  return !!inner && !!outer && inner[0] >= outer[0] && inner[1] <= outer[1];
}

/** Build the arc→chapter→leaf tree from derived state + the retrieval index. */
export function buildMemoryTree(state: ChronicleState, items?: RetrievableItem[]): MemTree {
  const leaves = (items ?? collectItems(state));
  const arcs = state.memories.filter((m) => m.tier === 'arc');
  const chapters = state.memories.filter((m) => m.tier === 'chapter');
  const nodes = new Map<string, MemNode>();

  const leafNode = (it: RetrievableItem): MemNode => ({
    id: it.id, kind: 'leaf', gist: clip(it.text, 200), childrenIds: [],
  });
  for (const it of leaves) nodes.set(it.id, leafNode(it));

  // assign each leaf to the most specific chapter whose covers contains its turn
  const chapterLeaves = new Map<string, string[]>();
  const claimedLeaves = new Set<string>();
  // narrowest chapter first so a leaf lands in the tightest range
  const chaptersByRange = chapters.slice().sort((a, b) => span(a.covers) - span(b.covers));
  for (const it of leaves) {
    if (nodes.get(it.id)!.kind !== 'leaf') continue;
    const ch = chaptersByRange.find((c) => inRange(it.turn, c.covers));
    if (ch) { (chapterLeaves.get(ch.id) ?? chapterLeaves.set(ch.id, []).get(ch.id)!).push(it.id); claimedLeaves.add(it.id); }
  }

  for (const ch of chapters) {
    nodes.set(ch.id, { id: ch.id, kind: 'chapter', gist: clip(ch.text, 200), childrenIds: chapterLeaves.get(ch.id) ?? [], covers: ch.covers });
  }

  // nest chapters under arcs by range containment
  const arcChapters = new Map<string, string[]>();
  const claimedChapters = new Set<string>();
  const arcsByRange = arcs.slice().sort((a, b) => span(a.covers) - span(b.covers));
  for (const ch of chapters) {
    const arc = arcsByRange.find((a) => within(ch.covers, a.covers));
    if (arc) { (arcChapters.get(arc.id) ?? arcChapters.set(arc.id, []).get(arc.id)!).push(ch.id); claimedChapters.add(ch.id); }
  }
  for (const arc of arcs) {
    nodes.set(arc.id, { id: arc.id, kind: 'arc', gist: clip(arc.text, 200), childrenIds: arcChapters.get(arc.id) ?? [], covers: arc.covers });
  }

  // ROOT = arcs + chapters not under an arc + leaves under no chapter
  const rootIds: string[] = [
    ...arcs.map((a) => a.id),
    ...chapters.filter((c) => !claimedChapters.has(c.id)).map((c) => c.id),
    ...leaves.filter((l) => !claimedLeaves.has(l.id)).map((l) => l.id),
  ];
  return { rootIds, nodes };
}

function span(c?: [number, number]): number { return c ? c[1] - c[0] : Number.MAX_SAFE_INTEGER; }
function clip(s: string, n: number): string { const t = (s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '\u2026' : t; }

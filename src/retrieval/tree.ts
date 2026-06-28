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
  sourceId?: string; // underlying memory id when `id` is namespaced (hybrid scoped nodes)
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

/**
 * Character-scoped tree (PR2): cast → that character's facts/secrets/journal.
 * The other tree axis — instead of WHEN something happened (arc→chapter→leaf),
 * organize by WHO it concerns. Top level is the cast (present/active first, then
 * mentioned); each character node's children are the knowledge they hold, the
 * secrets they keep, and the journal entries from their POV. Lets the controller
 * drill "this scene is about Cersei → pull what Cersei knows/feels."
 *
 * Leaf ids are the same RetrievableItem ids, so selection feeds the same
 * assemble() path. Pure + deterministic.
 */
export function buildCharacterTree(state: ChronicleState, items?: RetrievableItem[]): MemTree {
  const leaves = (items ?? collectItems(state));
  const nodes = new Map<string, MemNode>();
  for (const it of leaves) nodes.set(it.id, { id: it.id, kind: 'leaf', gist: clip(it.text, 200), childrenIds: [] });

  // map each character → leaf ids that concern them (knowledge they hold,
  // secrets they keep, journal entries from their POV — all retrievable leaves).
  const byChar = new Map<string, string[]>();
  const push = (cid: string, id: string): void => { if (!cid || !nodes.has(id)) return; (byChar.get(cid) ?? byChar.set(cid, []).get(cid)!).push(id); };
  for (const k of state.knowledge) { push(k.who, k.id); if (k.about) push(k.about, k.id); }
  for (const s of state.secrets) { push(s.keeper, s.id); }
  for (const j of state.journal) { push(j.who, j.id); if (j.about) push(j.about, j.id); }

  const rank = (c: { status: string }): number => (c.status === 'present' ? 0 : c.status === 'active' ? 1 : c.status === 'mentioned' ? 2 : 3);
  const cast = Object.values(state.cast).slice().sort((a, b) => rank(a) - rank(b) || (b.lastTurn || 0) - (a.lastTurn || 0));

  const rootIds: string[] = [];
  const claimed = new Set<string>();
  for (const c of cast) {
    const childIds = Array.from(new Set(byChar.get(c.id) ?? []));
    if (!childIds.length) continue; // skip characters with nothing to drill into
    const nodeId = 'char:' + c.id;
    nodes.set(nodeId, { id: nodeId, kind: 'arc', gist: clip(c.name + (c.role ? ' \u2014 ' + c.role : ''), 120), childrenIds: childIds });
    rootIds.push(nodeId);
    for (const id of childIds) claimed.add(id);
  }
  // leaves concerning no tracked character → root (so nothing is unreachable)
  for (const it of leaves) if (!claimed.has(it.id)) rootIds.push(it.id);
  return { rootIds, nodes };
}

/**
 * Hybrid tree (PR3): character → arc → chapter → leaf. The WHO of the character
 * axis with the WHEN structure of the temporal axis — "this is a Cersei scene →
 * walk Cersei's history in order." Built by computing the per-character leaf map
 * (like buildCharacterTree), then, for each character, keeping only the temporal
 * branches (from buildMemoryTree) that contain at least one of that character's
 * leaves. Scoped arc/chapter nodes are namespaced `h:<charId>:<memId>` so the
 * same arc can sit under several characters; `sourceId` carries the bare memory
 * id so the caller still resolves DETAIL + assembles by it. Leaf ids stay bare
 * (selection dedups on bare id). Pure + deterministic.
 */
export function buildHybridTree(state: ChronicleState, items?: RetrievableItem[]): MemTree {
  const leaves = items ?? collectItems(state);
  const temporal = buildMemoryTree(state, leaves);
  const nodes = new Map<string, MemNode>();
  for (const it of leaves) nodes.set(it.id, { id: it.id, kind: 'leaf', gist: clip(it.text, 200), childrenIds: [] });

  // per-character leaf map (same sources as buildCharacterTree)
  const byChar = new Map<string, Set<string>>();
  const push = (cid: string, id: string): void => { if (!cid || !nodes.has(id)) return; (byChar.get(cid) ?? byChar.set(cid, new Set()).get(cid)!).add(id); };
  for (const k of state.knowledge) { push(k.who, k.id); if (k.about) push(k.about, k.id); }
  for (const sec of state.secrets) push(sec.keeper, sec.id);
  for (const j of state.journal) { push(j.who, j.id); if (j.about) push(j.about, j.id); }

  const rank = (c: { status: string }): number => (c.status === 'present' ? 0 : c.status === 'active' ? 1 : c.status === 'mentioned' ? 2 : 3);
  const cast = Object.values(state.cast).slice().sort((a, b) => rank(a) - rank(b) || (b.lastTurn || 0) - (a.lastTurn || 0));

  // clone a temporal node's subtree, scoped to one character: keep only branches
  // that reach ≥1 of `keep`. Returns the scoped node id, or '' if nothing kept.
  // `path` breaks cycles (a summary memory can also be a leaf nested back under a
  // chapter whose range contains its turn — buildMemoryTree relies on the
  // traverse-time expandedSeen guard; here we guard structurally).
  const cloneScoped = (tid: string, cid: string, keep: Set<string>, path: Set<string>): string => {
    const tn = temporal.nodes.get(tid); if (!tn) return '';
    if (tn.kind === 'leaf') return keep.has(tid) ? tid : ''; // leaves stay bare
    if (path.has(tid)) return ''; // cycle — already on this branch
    path.add(tid);
    const kids = tn.childrenIds.map((c) => cloneScoped(c, cid, keep, path)).filter(Boolean);
    path.delete(tid);
    if (!kids.length) return '';
    const sid = `h:${cid}:${tid}`;
    nodes.set(sid, { id: sid, kind: tn.kind, gist: tn.gist, childrenIds: kids, covers: tn.covers, sourceId: tid });
    return sid;
  };

  const rootIds: string[] = [];
  const claimed = new Set<string>();
  for (const c of cast) {
    const keep = byChar.get(c.id); if (!keep || !keep.size) continue;
    // scoped temporal branches reachable from root that touch this character
    const branches = temporal.rootIds.map((rid) => cloneScoped(rid, c.id, keep, new Set())).filter(Boolean);
    if (!branches.length) continue;
    const nodeId = 'char:' + c.id;
    nodes.set(nodeId, { id: nodeId, kind: 'arc', gist: clip(c.name + (c.role ? ' \u2014 ' + c.role : ''), 120), childrenIds: branches });
    rootIds.push(nodeId);
    for (const id of keep) claimed.add(id);
  }
  // leaves concerning no tracked character → root (nothing unreachable)
  for (const it of leaves) if (!claimed.has(it.id)) rootIds.push(it.id);
  return { rootIds, nodes };
}

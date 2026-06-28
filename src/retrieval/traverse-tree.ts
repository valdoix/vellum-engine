import type { ChronicleState } from '../domain/types.js';
import type { InvertedIndex } from './invindex.js';
import { type Result } from '../core/result.js';
import { buildScene, type CallModel } from './traverse.js';
import { buildMemoryTree, buildCharacterTree, type MemTree, type MemNode } from './tree.js';

/**
 * Tiered TREE traversal (variant B) — the controller drills the derived memory
 * tree arc → chapter → leaf, branch by branch, instead of one flat pick.
 *
 * Each step it sees the CURRENT SCENE + the current frontier (node gists) and
 * returns {expand:[ids], select:[ids]}. Expanded nodes push their children onto
 * the next frontier (bounded by depth); selected ids accumulate. Selecting a
 * chapter/arc node marks it for DETAILED injection (the continuity payload);
 * selecting a leaf marks the item. Hard-bounded by step + depth + select caps so
 * it can never run away on the synchronous interceptor path.
 *
 * PURE except the injected `callModel`. Returns null on any miss so the caller
 * falls back to flat traversal / deterministic ranking.
 */

export interface TreeTraversalTrace {
  scene: string;
  steps: Array<{ frontier: string[]; expand: string[]; select: string[] }>;
  selectedIds: string[];
}
export interface TreeTraversalResult {
  ids: string[];
  /** ids the controller chose that are chapter/arc nodes → inject their detail */
  summaryIds: string[];
  trace: TreeTraversalTrace;
}

export interface TreeTraverseOpts {
  stepLimit?: number; // max controller calls per turn
  depthLimit?: number; // max tree depth to drill (arc=1, chapter=2, leaf=3)
  selectLimit?: number; // max accumulated selections
  frontierMax?: number; // max nodes shown per step
  axis?: 'temporal' | 'character'; // which tree to walk (PR2 adds character)
}

const SYS =
  'You are a retrieval controller navigating a STORY MEMORY TREE (arcs contain chapters; chapters contain '
  + 'facts/journal/turn notes). Given the CURRENT SCENE and the current FRONTIER of numbered nodes, decide what to '
  + 'open and what to keep. EXPAND nodes whose contents likely matter to THIS scene; SELECT nodes (summaries or leaf '
  + 'facts) to inject now. Output STRICT JSON only: {"expand":["<id>",...],"select":["<id>",...]} using exact ids '
  + 'shown. Expand narrowly (follow the thread of the scene), select what continuity needs. Empty arrays are allowed.';

function parseStep(text: string): { expand: string[]; select: string[] } | null {
  const t = String(text || '').replace(/```[a-z]*\n?|```/gi, '').trim();
  const tryParse = (s: string): unknown => { try { return JSON.parse(s); } catch { return null; } };
  let v = tryParse(t);
  if (v == null) { const m = t.match(/\{[\s\S]*\}/); if (m) v = tryParse(m[0]); }
  if (!v || typeof v !== 'object') return null;
  const obj = v as Record<string, unknown>;
  const arr = (k: string): string[] => Array.isArray(obj[k]) ? (obj[k] as unknown[]).map(String) : [];
  return { expand: arr('expand'), select: arr('select') };
}

function depthOf(node: MemNode): number { return node.kind === 'arc' ? 1 : node.kind === 'chapter' ? 2 : 3; }

export async function traverseTree(
  index: InvertedIndex,
  state: ChronicleState,
  callModel: CallModel,
  opts: TreeTraverseOpts = {},
): Promise<TreeTraversalResult | null> {
  const stepLimit = opts.stepLimit ?? 4;
  const depthLimit = opts.depthLimit ?? 3;
  const selectLimit = opts.selectLimit ?? 10;
  const frontierMax = opts.frontierMax ?? 24;

  const tree = opts.axis === 'character' ? buildCharacterTree(state) : buildMemoryTree(state);
  if (!tree.rootIds.length) return null;
  const scene = buildScene(state);

  let frontier: string[] = tree.rootIds.slice(0, frontierMax);
  const expandedSeen = new Set<string>();
  const selected: string[] = [];
  const selectedSet = new Set<string>();
  const steps: TreeTraversalTrace['steps'] = [];
  let anyCall = false;

  for (let step = 0; step < stepLimit && frontier.length; step++) {
    const list = frontier.map((id) => { const n = tree.nodes.get(id)!; return `${id} [${n.kind}]: ${n.gist}`; }).join('\n');
    const res: Result<string, string> = await callModel({ system: SYS, user: `CURRENT SCENE:\n${scene}\n\nFRONTIER:\n${list}` });
    if (!res.ok) break;
    anyCall = true;
    const parsed = parseStep(res.value);
    if (!parsed) break;
    const front = new Set(frontier);
    const expand = parsed.expand.filter((id) => front.has(id) && tree.nodes.has(id));
    const select = parsed.select.filter((id) => front.has(id) && tree.nodes.has(id));
    steps.push({ frontier: frontier.slice(), expand, select });

    for (const id of select) {
      if (!selectedSet.has(id) && selected.length < selectLimit) { selected.push(id); selectedSet.add(id); }
    }
    if (selected.length >= selectLimit) break;

    // build next frontier from expanded nodes' children (respecting depth cap)
    const next: string[] = [];
    for (const id of expand) {
      if (expandedSeen.has(id)) continue;
      expandedSeen.add(id);
      const node = tree.nodes.get(id)!;
      if (depthOf(node) >= depthLimit) continue; // can't drill past the cap
      for (const cid of node.childrenIds) if (!selectedSet.has(cid)) next.push(cid);
    }
    if (!next.length) break; // nothing left to open → stop
    frontier = next.slice(0, frontierMax);
  }

  if (!anyCall || !selected.length) return null;
  const summaryIds = selected.filter((id) => { const k = tree.nodes.get(id)?.kind; return k === 'arc' || k === 'chapter'; });
  return { ids: selected, summaryIds, trace: { scene, steps, selectedIds: selected } };
}

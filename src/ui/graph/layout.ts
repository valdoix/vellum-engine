import type { ChronicleState, Relation } from '../../domain/types.js';
import type { Category } from '../../core/events.js';
import { hash01 } from '../../core/ids.js';
import { catRank } from '../../domain/category.js';

/**
 * Pure graph layout engine. Builds a node/edge model from the chronicle and
 * runs a deterministic force-directed layout with faction gravity. No DOM, no
 * randomness — same cast always lays out the same way, so it never reshuffles
 * on a chronicle update (the component caches positions by signature).
 */

export interface GraphNode {
  id: string;
  name: string;
  degree: number;
  present: boolean;
  status: string;
  user: boolean;
  faction: number; // -1 = none
}
export interface GraphEdge {
  id: string;
  a: string;
  b: string;
  cat: Category;
  categories: Category[];
  sentiment: string;
  intensity: number; // 0..100 = max(|aff|,|trust|)
  affection: number;
  trust: number;
  label: string;
  status: string;
}
export interface Faction {
  members: string[];
  label: string;
  color: string;
}
export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
  factions: Faction[];
  sig: string;
}
export interface Pos { x: number; y: number; vx: number; vy: number }
export interface Layout {
  pos: Record<string, Pos>;
  W: number;
  H: number;
}

export const W = 1000;
export const H = 720;

const FACTION_COLORS = ['#cda84e', '#8fa67e', '#7ea6b0', '#b48ed0', '#c97a9a', '#d8a05a', '#6fb0a6', '#c98a6a'];

function primaryCat(cats: Category[]): Category {
  return cats.slice().sort((a, b) => catRank(b) - catRank(a))[0] ?? 'neutral';
}

/** Build the node/edge/faction model from derived state. */
export function buildModel(state: ChronicleState): GraphModel {
  const rels = state.relations;
  const deg: Record<string, number> = {};
  const edges: GraphEdge[] = rels
    .filter((r) => state.cast[r.a] && state.cast[r.b] && r.a !== r.b)
    .map((r: Relation) => {
      deg[r.a] = (deg[r.a] ?? 0) + 1;
      deg[r.b] = (deg[r.b] ?? 0) + 1;
      const cats = r.categories.length ? r.categories : [r.category];
      return {
        id: r.a + '>' + r.b, a: r.a, b: r.b,
        cat: primaryCat(cats), categories: cats, sentiment: r.sentiment,
        intensity: Math.max(Math.abs(r.affection), Math.abs(r.trust)),
        affection: r.affection, trust: r.trust, label: r.label, status: r.status,
      };
    });
  const present = new Set(state.scene.present);
  // Fix 9: include manual / on-stage / active cast even with no bonds, so they
  // aren't invisible. Layout already centers + repels isolated nodes.
  const ids = Object.keys(state.cast).filter((id) => {
    const c = state.cast[id]!;
    return deg[id] || present.has(id) || c.status === 'present' || c.status === 'active' || c.source === 'user';
  });
  const factions = detectFactions(ids, edges, state);
  const facOf: Record<string, number> = {};
  factions.forEach((f, i) => f.members.forEach((m) => { facOf[m] = i; }));
  const nodes: GraphNode[] = ids.map((id) => {
    const c = state.cast[id]!;
    return { id, name: c.name, degree: deg[id] ?? 0, present: present.has(id) || c.status === 'present', status: c.status, user: c.source === 'user', faction: facOf[id] ?? -1 };
  });
  const sig = ids.slice().sort().join(',') + '|' + edges.map((e) => e.id).sort().join(',');
  return { nodes, edges, factions, sig };
}

/** Union-find clustering over familial + alliance bonds → named factions. */
function detectFactions(ids: string[], edges: GraphEdge[], state: ChronicleState): Faction[] {
  const parent: Record<string, string> = {};
  ids.forEach((id) => { parent[id] = id; });
  const find = (x: string): string => { while (parent[x] !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]!; } return x; };
  const union = (a: string, b: string): void => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  for (const e of edges) {
    if (e.categories.includes('familial') || e.categories.includes('alliance')) union(e.a, e.b);
  }
  const groups: Record<string, string[]> = {};
  ids.forEach((id) => { const r = find(id); (groups[r] ??= []).push(id); });
  const out: Faction[] = [];
  let i = 0;
  for (const members of Object.values(groups)) {
    if (members.length < 2) continue;
    out.push({ members, label: factionLabel(members, state), color: FACTION_COLORS[i % FACTION_COLORS.length]! });
    i++;
  }
  return out;
}

function factionLabel(members: string[], state: ChronicleState): string {
  const freq: Record<string, number> = {};
  for (const id of members) {
    const toks = (state.cast[id]?.name ?? '').split(/\s+/).filter((w) => w.length >= 3);
    if (toks.length > 1) { const s = toks[toks.length - 1]!.toLowerCase(); freq[s] = (freq[s] ?? 0) + 1; }
  }
  let best = '', n = 1;
  for (const [k, v] of Object.entries(freq)) if (v > n) { best = k; n = v; }
  if (best && n >= 2) return best.charAt(0).toUpperCase() + best.slice(1);
  let top = members[0]!;
  for (const id of members) if ((state.cast[id]?.lastTurn ?? 0) > (state.cast[top]?.lastTurn ?? 0)) top = id;
  return (state.cast[top]?.name ?? 'Circle') + "\u2019s circle";
}

/** Deterministic force-directed layout (Fruchterman-Reingold + faction wells). */
export function layout(model: GraphModel): Layout {
  const n = model.nodes.length;
  const pos: Record<string, Pos> = {};
  if (!n) return { pos, W, H };
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.36;
  model.nodes.forEach((node, i) => {
    const a = (i / n) * Math.PI * 2 + hash01(node.id) * 0.7;
    const rr = R * (0.55 + 0.45 * hash01(node.id + 'r'));
    pos[node.id] = { x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr, vx: 0, vy: 0 };
  });
  const facAnchor: Record<number, { x: number; y: number }> = {};
  const nf = model.factions.length;
  for (let f = 0; f < nf; f++) { const a = (f / Math.max(1, nf)) * Math.PI * 2; facAnchor[f] = { x: cx + Math.cos(a) * R * 0.5, y: cy + Math.sin(a) * R * 0.5 }; }
  const k = Math.sqrt((W * H) / Math.max(1, n)) * 0.62;
  const ITER = n > 40 ? 160 : 300;
  for (let it = 0; it < ITER; it++) {
    const t = 1 - it / ITER;
    for (let i = 0; i < n; i++) {
      const pi = pos[model.nodes[i]!.id]!;
      for (let j = i + 1; j < n; j++) {
        const pj = pos[model.nodes[j]!.id]!;
        let dx = pi.x - pj.x, dy = pi.y - pj.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = hash01(i + '' + j) - 0.5; dy = hash01(j + '' + i) - 0.5; d2 = dx * dx + dy * dy + 0.01; }
        const f = (k * k) / d2, d = Math.sqrt(d2);
        pi.vx += (dx / d) * f; pi.vy += (dy / d) * f;
        pj.vx -= (dx / d) * f; pj.vy -= (dy / d) * f;
      }
    }
    for (const e of model.edges) {
      const pa = pos[e.a], pb = pos[e.b]; if (!pa || !pb) continue;
      const dx = pa.x - pb.x, dy = pa.y - pb.y, d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f = (d * d) / k * 0.012 * (0.6 + (e.intensity / 100) * 0.8);
      pa.vx -= (dx / d) * f; pa.vy -= (dy / d) * f;
      pb.vx += (dx / d) * f; pb.vy += (dy / d) * f;
    }
    for (const nd of model.nodes) {
      const p = pos[nd.id]!;
      p.vx += (cx - p.x) * 0.006; p.vy += (cy - p.y) * 0.006;
      if (nd.faction >= 0 && facAnchor[nd.faction]) { p.vx += (facAnchor[nd.faction]!.x - p.x) * 0.02; p.vy += (facAnchor[nd.faction]!.y - p.y) * 0.02; }
      p.x += Math.max(-30, Math.min(30, p.vx)) * t;
      p.y += Math.max(-30, Math.min(30, p.vy)) * t;
      p.vx *= 0.85; p.vy *= 0.85;
      p.x = Math.max(40, Math.min(W - 40, p.x));
      p.y = Math.max(40, Math.min(H - 40, p.y));
    }
  }
  return { pos, W, H };
}

export { primaryCat };

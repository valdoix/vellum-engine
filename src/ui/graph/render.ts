import type { GraphModel, Layout, GraphEdge } from './layout.js';
import { hash01 } from '../../core/ids.js';
import { initials, CAT_COLORS } from '../format.js';

/**
 * Pure SVG render for the relationship graph. Beautiful by construction:
 * gradient-stroked curved edges tinted by category, glowing presence-ringed
 * nodes, soft faction hulls behind, an illuminated-manuscript palette. The
 * interaction layer (graph.ts) only patches attributes on what this builds.
 */

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const SENT_DASH: Record<string, string> = { hostile: '2 6', strained: '8 5' };

export function nodeRadius(degree: number, present: boolean): number {
  return 13 + Math.min(16, degree * 2.2) + (present ? 3 : 0);
}

/** Quadratic-bezier path with a deterministic bow so reciprocal edges fan apart. */
export function edgePath(ax: number, ay: number, bx: number, by: number, id: string): string {
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  const dx = bx - ax, dy = by - ay, len = Math.sqrt(dx * dx + dy * dy) || 1;
  const bow = Math.min(60, len * 0.12) * (hash01(id) - 0.5) * 2;
  const cx = mx + (-dy / len) * bow, cy = my + (dx / len) * bow;
  return `M${ax.toFixed(1)},${ay.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}`;
}

/** Andrew's monotone-chain convex hull → smoothed, padded faction blob. */
function hullPath(memberIds: string[], pos: Layout['pos'], pad: number): string | null {
  const pts: Array<[number, number]> = [];
  for (const id of memberIds) {
    const p = pos[id]; if (!p) continue;
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; pts.push([p.x + Math.cos(a) * pad, p.y + Math.sin(a) * pad]); }
  }
  if (pts.length < 3) return null;
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]): number => (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);
  const lower: Array<[number, number]> = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop(); lower.push(p); }
  const upper: Array<[number, number]> = [];
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]!; while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop(); upper.push(p); }
  lower.pop(); upper.pop();
  const hull = lower.concat(upper);
  if (hull.length < 3) return null;
  let d = '';
  for (let i = 0; i < hull.length; i++) {
    const cur = hull[i]!, next = hull[(i + 1) % hull.length]!;
    const mx = (cur[0] + next[0]) / 2, my = (cur[1] + next[1]) / 2;
    if (i === 0) { const prev = hull[hull.length - 1]!; d = `M${((prev[0] + cur[0]) / 2).toFixed(1)},${((prev[1] + cur[1]) / 2).toFixed(1)}`; }
    d += ` Q${cur[0].toFixed(1)},${cur[1].toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
  }
  return d + ' Z';
}

function defs(): string {
  // gradient + soft glow filter, defined once
  return '<defs>'
    + '<filter id="vlgGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
    + '<radialGradient id="vlgNode" cx="38%" cy="32%" r="75%"><stop offset="0%" stop-color="#3a3220"/><stop offset="100%" stop-color="#181410"/></radialGradient>'
    + '<radialGradient id="vlgVignette" cx="50%" cy="0%" r="100%"><stop offset="0%" stop-color="rgba(205,168,78,.10)"/><stop offset="60%" stop-color="rgba(205,168,78,0)"/></radialGradient>'
    + '</defs>';
}

export function renderGraph(model: GraphModel, lay: Layout): string {
  const { pos } = lay;

  const hulls = model.factions.map((f, fi) => {
    const d = hullPath(f.members, pos, 46);
    if (!d) return '';
    const lx = f.members.reduce((s, id) => s + (pos[id]?.x ?? 0), 0) / f.members.length;
    let ty = Infinity; for (const id of f.members) ty = Math.min(ty, pos[id]?.y ?? Infinity);
    return `<g class="vlg-hull" data-hull="${fi}"><path class="vlg-hull-fill" d="${d}" fill="${f.color}"/>`
      + `<text class="vlg-hull-label" x="${lx.toFixed(1)}" y="${(ty - 24).toFixed(1)}" text-anchor="middle" fill="${f.color}">${esc(f.label)}</text></g>`;
  }).join('');

  const edges = model.edges.map((e: GraphEdge) => {
    const pa = pos[e.a], pb = pos[e.b]; if (!pa || !pb) return '';
    const col = CAT_COLORS[e.cat] ?? CAT_COLORS.neutral;
    const w = (1.4 + (e.intensity / 100) * 4.2).toFixed(2);
    const d = edgePath(pa.x, pa.y, pb.x, pb.y, e.id);
    const dash = SENT_DASH[e.sentiment] ? ` stroke-dasharray="${SENT_DASH[e.sentiment]}"` : '';
    const multi = e.categories.length > 1
      ? `<path class="vlg-edge-multi" d="${d}" fill="none" stroke="${CAT_COLORS[e.categories[1]!] ?? '#fff'}" stroke-width="${(Number(w) * 0.5).toFixed(2)}" stroke-dasharray="1 10" stroke-linecap="round" opacity=".85"/>`
      : '';
    return `<g class="vlg-edge" data-edge="${esc(e.id)}" data-a="${esc(e.a)}" data-b="${esc(e.b)}">`
      + `<path class="vlg-edge-hit" d="${d}" fill="none" stroke="transparent" stroke-width="16"/>`
      + `<path class="vlg-edge-line" d="${d}" fill="none" stroke="${col}" stroke-width="${w}"${dash} stroke-linecap="round"/>`
      + multi + '</g>';
  }).join('');

  const nodes = model.nodes.map((nd) => {
    const p = pos[nd.id]; if (!p) return '';
    const r = nodeRadius(nd.degree, nd.present);
    const cls = 'vlg-node' + (nd.present ? ' is-present' : '') + (nd.user ? ' is-user' : '') + (nd.status === 'mentioned' ? ' is-mention' : '');
    const short = nd.name.length > 16 ? nd.name.slice(0, 15) + '\u2026' : nd.name;
    return `<g class="${cls}" data-node="${esc(nd.id)}" data-r="${r}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">`
      + `<circle class="vlg-node-glow" r="${r + 7}"/>`
      + `<circle class="vlg-node-c" r="${r}"/>`
      + `<text class="vlg-node-i" text-anchor="middle" dy="0.34em">${esc(initials(nd.name))}</text>`
      + `<text class="vlg-node-l" text-anchor="middle" y="${r + 14}">${esc(short)}</text>`
      + '</g>';
  }).join('');

  const cats = Array.from(new Set(model.edges.map((e) => e.cat)));
  const legend = ['all', ...cats].map((c) =>
    `<button class="vlg-leg${c === 'all' ? ' on' : ''}" data-graph-cat="${c}">`
    + (c === 'all' ? 'all' : `<span class="vlg-leg-dot" style="background:${CAT_COLORS[c] ?? '#888'}"></span>${esc(c)}`) + '</button>'
  ).join('');
  const facBtn = model.factions.length ? `<button class="vlg-tool wide on" data-graph-factions>\u25C7 ${model.factions.length} faction${model.factions.length === 1 ? '' : 's'}</button>` : '';

  return '<div class="vlg-wrap" data-graph data-factions="on">'
    + `<div class="vlg-toolbar"><div class="vlg-legend">${legend}</div>`
    + `<div class="vlg-tools">${facBtn}<button class="vlg-tool" data-graph-fit title="Reset view">\u26F6</button>`
    + '<button class="vlg-tool" data-graph-zoom="1">+</button><button class="vlg-tool" data-graph-zoom="-1">\u2212</button></div></div>'
    + '<div class="vlg-stage" data-graph-stage>'
    + `<svg class="vlg-svg" viewBox="0 0 ${lay.W} ${lay.H}" preserveAspectRatio="xMidYMid meet" data-graph-svg>`
    + defs()
    + `<rect x="0" y="0" width="${lay.W}" height="${lay.H}" fill="url(#vlgVignette)" pointer-events="none"/>`
    + `<g data-graph-pan><g class="vlg-hulls">${hulls}</g><g class="vlg-edges">${edges}</g><g class="vlg-nodes">${nodes}</g></g>`
    + '</svg><div class="vlg-tip" data-graph-tip hidden></div></div>'
    + '<div class="vlg-hint">hover to focus \u00b7 click a node to isolate \u00b7 drag a node to arrange \u00b7 scroll to zoom</div>'
    + '</div>';
}

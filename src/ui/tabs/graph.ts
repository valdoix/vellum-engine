import type { Component } from '../component.js';
import type { ChronicleState } from '../../domain/types.js';
import { buildModel, layout, type GraphModel, type GraphNode, type GraphEdge, type Layout } from '../graph/layout.js';
import { renderGraph, edgePath } from '../graph/render.js';
import { esc } from '../format.js';

/**
 * The Relationship Graph tab â€” a beautiful, interactive force-directed node
 * graph. Layout is cached by model signature so score-only updates never
 * reshuffle the arrangement. All interaction patches SVG attributes in place
 * (no re-render), so dragging is smooth and focus survives chronicle updates.
 */

let _cache: { sig: string; model: GraphModel; lay: Layout } | null = null;

function modelFor(state: ChronicleState): { model: GraphModel; lay: Layout } {
  const model = buildModel(state);
  if (_cache && _cache.sig === model.sig) return { model: _cache.model, lay: _cache.lay };
  const lay = layout(model);
  _cache = { sig: model.sig, model, lay };
  return { model, lay };
}

export const graphTab: Component<ChronicleState> = {
  // re-render only when the node/edge SET changes; score/category tweaks patch live
  version: (s) => buildModel(s).sig,
  render(s) {
    const { model } = modelFor(s);
    if (!model.nodes.length) {
      return '<div class="vle-empty">No relationship graph yet.<br><span>Bonds appear here once characters relate. Play a few turns.</span></div>';
    }
    const graph = renderGraph(model, _cache!.lay);
    // Fix 9: nodes can exist with no bonds (manual / on-stage cast) — show them
    // with a gentle hint instead of an empty state.
    if (!model.edges.length) return '<div class="vlg-hint">No bonds yet \u2014 characters appear here; relationships draw in as they form.</div>' + graph;
    return graph;
  },
  mount(host) {
    const A = (el: Element | null, n: string): string => el?.getAttribute(n) ?? '';
    const wrap = (): HTMLElement | null => host.querySelector('[data-graph]');
    const panG = (): SVGGElement | null => host.querySelector('[data-graph-pan]');
    const svgEl = (): SVGSVGElement | null => host.querySelector('[data-graph-svg]');
    const stage = (): HTMLElement | null => host.querySelector('[data-graph-stage]');

    const view = { z: 1, x: 0, y: 0 };
    let focus: string | null = null;
    let dragMoved = false;

    const applyView = (): void => { const g = panG(); if (g) g.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.z})`); };

    const setHighlight = (hoverId: string | null): void => {
      const w = wrap(); if (!w) return;
      const active = hoverId ?? focus;
      if (!active) { w.classList.remove('vlg-focusing'); w.querySelectorAll('.vlg-dim,.vlg-hot').forEach((e) => e.classList.remove('vlg-dim', 'vlg-hot')); return; }
      w.classList.add('vlg-focusing');
      const near = new Set([active]);
      w.querySelectorAll('.vlg-edge').forEach((g) => {
        const on = A(g, 'data-a') === active || A(g, 'data-b') === active;
        g.classList.toggle('vlg-hot', on); g.classList.toggle('vlg-dim', !on);
        if (on) { near.add(A(g, 'data-a')); near.add(A(g, 'data-b')); }
      });
      w.querySelectorAll('.vlg-node').forEach((g) => {
        const on = near.has(A(g, 'data-node'));
        g.classList.toggle('vlg-hot', on); g.classList.toggle('vlg-dim', !on);
      });
    };

    const tip = (html: string, cx: number, cy: number): void => {
      const t = host.querySelector('[data-graph-tip]') as HTMLElement | null; if (!t) return;
      t.innerHTML = html; t.hidden = false;
      const r = stage()?.getBoundingClientRect(); t.style.left = `${cx - (r?.left ?? 0) + 12}px`; t.style.top = `${cy - (r?.top ?? 0) + 12}px`;
    };
    const hideTip = (): void => { const t = host.querySelector('[data-graph-tip]') as HTMLElement | null; if (t) t.hidden = true; };

    host.addEventListener('mouseover', (e) => {
      const node = (e.target as Element).closest('.vlg-node');
      if (node && !focus) setHighlight(A(node, 'data-node'));
      const m = _cache?.model;
      if (node && m) { const id = A(node, 'data-node'); const nd = m.nodes.find((x: GraphNode) => x.id === id); if (nd) tip(`<b>${esc(nd.name)}</b><br><span>${nd.degree} bond${nd.degree === 1 ? '' : 's'}${nd.present ? ' \u00b7 present' : ''}</span>`, (e as MouseEvent).clientX, (e as MouseEvent).clientY); }
      const edge = (e.target as Element).closest('.vlg-edge');
      if (edge && m) { const ed = m.edges.find((x: GraphEdge) => x.id === A(edge, 'data-edge')); if (ed) { const an = m.nodes.find((x: GraphNode) => x.id === ed.a)?.name ?? ed.a, bn = m.nodes.find((x: GraphNode) => x.id === ed.b)?.name ?? ed.b; tip(`<b>${esc(an)} \u2192 ${esc(bn)}</b><br><span>${esc(ed.categories.join(' + '))} \u00b7 ${esc(ed.sentiment)}</span>${ed.label ? `<br>\u201c${esc(ed.label)}\u201d` : ''}`, (e as MouseEvent).clientX, (e as MouseEvent).clientY); } }
    });
    host.addEventListener('mouseout', (e) => { if ((e.target as Element).closest('.vlg-node') || (e.target as Element).closest('.vlg-edge')) { hideTip(); if (!focus) setHighlight(null); } });

    host.addEventListener('click', (e) => {
      const t = e.target as Element;
      const zoom = t.closest('[data-graph-zoom]'); if (zoom) { view.z = Math.max(0.4, Math.min(3, view.z * (Number(A(zoom, 'data-graph-zoom')) > 0 ? 1.2 : 1 / 1.2))); applyView(); return; }
      if (t.closest('[data-graph-fit]')) { view.z = 1; view.x = 0; view.y = 0; applyView(); return; }
      const fac = t.closest('[data-graph-factions]'); if (fac) { const w = wrap(); if (w) { const on = w.getAttribute('data-factions') !== 'on'; w.setAttribute('data-factions', on ? 'on' : 'off'); fac.classList.toggle('on', on); } return; }
      const leg = t.closest('.vlg-leg'); if (leg) { const w = wrap(); if (!w) return; w.querySelectorAll('.vlg-leg').forEach((x) => x.classList.remove('on')); leg.classList.add('on'); const cat = A(leg, 'data-graph-cat'); w.querySelectorAll('.vlg-edge').forEach((g) => { const ed = _cache?.model.edges.find((x: GraphEdge) => x.id === A(g, 'data-edge')); (g as HTMLElement).style.display = (cat === 'all' || (ed && ed.categories.includes(cat as never))) ? '' : 'none'; }); return; }
      const node = t.closest('.vlg-node'); if (node) { if (dragMoved) { dragMoved = false; return; } const id = A(node, 'data-node'); focus = focus === id ? null : id; setHighlight(null); return; }
      if (t.closest('[data-graph-svg]')) { focus = null; setHighlight(null); }
    });

    // drag a node or pan the canvas
    const scale = (): number => { const svg = svgEl(); const r = svg?.getBoundingClientRect(); return r?.width ? (_cache!.lay.W / r.width) : 1; };
    const repath = (id: string): void => {
      const w = wrap(); const p = _cache?.lay.pos[id]; if (!w || !p) return;
      const sel = (window.CSS && CSS.escape) ? CSS.escape(id) : id;
      const g = w.querySelector(`.vlg-node[data-node="${sel}"]`); if (g) g.setAttribute('transform', `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
      _cache!.model.edges.forEach((e: GraphEdge) => {
        if (e.a !== id && e.b !== id) return;
        const pa = _cache!.lay.pos[e.a], pb = _cache!.lay.pos[e.b]; if (!pa || !pb) return;
        const d = edgePath(pa.x, pa.y, pb.x, pb.y, e.id);
        const eg = w.querySelector(`.vlg-edge[data-edge="${(window.CSS && CSS.escape) ? CSS.escape(e.id) : e.id}"]`);
        eg?.querySelectorAll('path').forEach((pth) => pth.setAttribute('d', d));
      });
    };

    let dragId: string | null = null, panning = false, sx = 0, sy = 0, ox = 0, oy = 0;
    host.addEventListener('pointerdown', (e) => {
      const svg = (e.target as Element).closest('[data-graph-svg]'); if (!svg) return;
      const node = (e.target as Element).closest('.vlg-node');
      if (node) { dragId = A(node, 'data-node'); dragMoved = false; sx = e.clientX; sy = e.clientY; node.classList.add('vlg-dragging'); (svg as Element).setPointerCapture?.(e.pointerId); e.preventDefault(); return; }
      if ((e.target as Element).closest('.vlg-edge')) return;
      panning = true; sx = e.clientX; sy = e.clientY; ox = view.x; oy = view.y; (svg as Element).setPointerCapture?.(e.pointerId); e.preventDefault();
    });
    host.addEventListener('pointermove', (e) => {
      if (dragId && _cache) {
        if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 3) dragMoved = true;
        const sc = scale() / (view.z || 1); const p = _cache.lay.pos[dragId];
        if (p) { p.x = Math.max(20, Math.min(_cache.lay.W - 20, p.x + (e.clientX - sx) * sc)); p.y = Math.max(20, Math.min(_cache.lay.H - 20, p.y + (e.clientY - sy) * sc)); }
        sx = e.clientX; sy = e.clientY; repath(dragId); return;
      }
      if (panning) { view.x = ox + (e.clientX - sx); view.y = oy + (e.clientY - sy); applyView(); }
    });
    const end = (): void => { if (dragId) { const g = wrap()?.querySelector('.vlg-dragging'); g?.classList.remove('vlg-dragging'); } dragId = null; panning = false; };
    host.addEventListener('pointerup', end);
    host.addEventListener('pointercancel', end);
    host.addEventListener('wheel', (e) => { const svg = (e.target as Element).closest('[data-graph-svg]'); if (!svg) return; e.preventDefault(); view.z = Math.max(0.4, Math.min(3, view.z * (e.deltaY < 0 ? 1.1 : 1 / 1.1))); applyView(); }, { passive: false });
  },
};

/** Allow the shell to drop the layout cache on chat switch. */
export function resetGraphCache(): void { _cache = null; }

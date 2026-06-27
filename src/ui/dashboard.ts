import type { ChronicleState, PresentChar, Relation } from '../domain/types.js';
import { esc, nameOf, catsOf, CAT_COLORS, SENT_LABEL, byRecent } from './format.js';

/**
 * The floating-window DASHBOARD — a single at-a-glance scene panel (distinct
 * from the drawer's tabbed browser). Shows the live now: turn/time/place/
 * weather/tension, each present character's state + emotion + inner thought,
 * relations, threads, parallel offscreen events, and the latest journal /
 * knowledge / secret / relation changes. Pure render(state) → html.
 */

import { getLayout, type LayoutDef, type SectionId } from './layout-defs.js';
import { getTheme } from './theme.js';

/** Section registry — each block is a pure (state) → html function. Layouts
 * compose these by id; the functions never change, the layout owns structure. */
const SECTIONS: Record<SectionId, (s: ChronicleState) => string> = {
  status: statusBar,
  present: presentBlock,
  tension: tensionBar,
  relations: relationsBlock,
  threads: threadsBlock,
  parallel: parallelBlock,
  recent: recentBlock,
};

const SECTION_LABEL: Record<SectionId, string> = {
  status: 'Status', present: 'Present', tension: 'Tension', relations: 'Relations',
  threads: 'Threads', parallel: 'Parallel', recent: 'Latest',
};

/**
 * Render the dashboard for the active LAYOUT (separate from skin). The layout
 * decides which sections show, their order, density, columns, and which are
 * collapsed into <details>. Skin/scale handle look/size independently.
 */
export function dashboardHtml(s: ChronicleState): string {
  let lay: LayoutDef;
  try { lay = getLayout(); } catch { lay = { id: 'dashboard', name: '', blurb: '', glyph: '', order: ['status', 'present', 'tension', 'relations', 'threads', 'parallel', 'recent'], hidden: [], collapsed: [], density: 'comfortable', columns: 1 }; }
  const parts = lay.order
    .filter((id) => !lay.hidden.includes(id))
    .map((id) => {
      let html = '';
      try { html = SECTIONS[id](s); } catch (e) { try { console.warn('[vellum] dashboard section ' + id + ' failed:', e); } catch { /* ignore */ } }
      if (!html) return '';
      if (lay.collapsed.includes(id)) {
        return `<details class="vld-fold"><summary>${SECTION_LABEL[id]}</summary><div class="vld-fold-b">${html}</div></details>`;
      }
      return html;
    })
    .filter(Boolean)
    .join('');
  const inner = parts || `<div class="vle-empty sm">Nothing recorded for this scene yet.<br><span>Play a turn — the chronicle fills as the model emits its &lt;vellum&gt; state block.</span></div>`;
  return `<div class="vld-inner" data-layout="${lay.id}" data-density="${lay.density}" data-cols="${lay.columns}">${inner}</div>`;
}

function statusBar(s: ChronicleState): string {
  const bits = [
    `<span class="vld-stat"><b>Turn</b>${s.turns ?? 0}</span>`,
    s.day ? `<span class="vld-stat"><b>Day</b>${s.day}</span>` : '',
    s.scene.time ? `<span class="vld-stat"><b>Time</b>${esc(s.scene.time)}</span>` : '',
    s.scene.weather ? `<span class="vld-stat"><b>\u2601</b>${esc(s.scene.weather)}</span>` : '',
  ].filter(Boolean).join('');
  const loc = s.scene.location ? `<div class="vld-loc">\u25C8 ${esc(s.scene.location)}</div>` : '';
  return `<div class="vld-sec"><div class="vld-statbar">${bits}</div>${loc}</div>`;
}

function tensionBar(s: ChronicleState): string {
  const t = Math.max(0, Math.min(10, s.scene.tension || 0));
  if (!t) return '';
  const hue = 120 - t * 12; // green→red
  const style = getTheme().tensionStyle;
  const bar = `<div class="vld-tension"><span class="vld-tension-f" style="width:${t * 10}%;background:hsl(${hue},55%,50%)"></span></div>`;
  const num = `<span class="vld-tension-n">${t}/10</span>`;
  const inner = style === 'bar' ? bar : style === 'num' ? `<span class="vld-tension-n" style="min-width:auto">${t}/10</span>` : bar + num;
  return `<div class="vld-sec"><div class="vld-h">Tension</div><div class="vld-tension-row">${inner}</div></div>`;
}

function presentBlock(s: ChronicleState): string {
  const detail = s.scene.detail?.length ? s.scene.detail : s.scene.present.map((id) => ({ id } as PresentChar));
  if (!detail.length) return '';
  const rows = detail.map((d) => {
    const tags = [d.mood ? `<span class="vld-mood">${esc(d.mood)}</span>` : '', d.condition ? `<span class="vld-cond">${esc(d.condition)}</span>` : ''].filter(Boolean).join('');
    const doing = d.doing ? `<div class="vld-doing">${esc(d.doing)}</div>` : '';
    const thought = d.thought ? `<div class="vld-thought">\u300C${esc(d.thought)}\u300D</div>` : '';
    return `<div class="vld-pc"><div class="vld-pc-top"><span class="vld-pc-n">${esc(nameOf(s, d.id))}</span>${tags}</div>${doing}${thought}</div>`;
  }).join('');
  return `<div class="vld-sec"><div class="vld-h">Present <span class="vld-n">${detail.length}</span></div>${rows}</div>`;
}

function relationsBlock(s: ChronicleState): string {
  if (!s.relations.length) return '';
  const present = new Set(s.scene.present);
  const rels = s.relations.filter((r) => !present.size || present.has(r.a) || present.has(r.b)).sort(byRecent).slice(0, 6);
  if (!rels.length) return '';
  const rows = rels.map((r) => {
    const cats = catsOf(r).map((c) => `<span class="vld-cat" style="--c:${CAT_COLORS[c] || '#888'}">${esc(c)}</span>`).join('');
    return `<div class="vld-rel"><span class="vld-rel-p">${esc(nameOf(s, r.a))} \u2192 ${esc(nameOf(s, r.b))}</span>${cats}<span class="vld-rel-s">${esc(SENT_LABEL[r.sentiment] || r.sentiment)}</span></div>`;
  }).join('');
  return `<div class="vld-sec"><div class="vld-h">Relations</div>${rows}</div>`;
}

function threadsBlock(s: ChronicleState): string {
  const open = s.threads.filter((t) => t.status !== 'resolved').sort(byRecent).slice(0, 6);
  if (!open.length) return '';
  const rows = open.map((t) => `<div class="vld-thread"><span class="vld-thread-n">${esc(t.name)}</span><span class="vld-thread-s">${esc(t.status)}</span></div>`).join('');
  return `<div class="vld-sec"><div class="vld-h">Threads <span class="vld-n">${open.length}</span></div>${rows}</div>`;
}

function parallelBlock(s: ChronicleState): string {
  if (!s.parallel?.length) return '';
  const rows = s.parallel.slice(0, 6).map((p) => {
    const who = p.who ? esc(nameOf(s, p.who)) : '';
    const where = p.where ? ` <span class="vld-par-w">@${esc(p.where)}</span>` : '';
    return `<div class="vld-par"><span class="vld-par-who">${who}</span>${where}<div class="vld-par-act">${esc(p.activity)}${p.note ? ` <em>${esc(p.note)}</em>` : ''}</div></div>`;
  }).join('');
  return `<div class="vld-sec"><div class="vld-h">\u22C8 Parallel (offscreen) <span class="vld-n">${s.parallel.length}</span></div>${rows}</div>`;
}

function recentBlock(s: ChronicleState): string {
  // newest journal / knowledge / secret + the latest relation change
  const parts: string[] = [];
  const j = s.journal.slice().sort((a, b) => b.turn - a.turn)[0];
  if (j) parts.push(`<div class="vld-rec"><span class="vld-rec-k">journal</span>${esc(nameOf(s, j.who))}: \u201C${esc(j.memory)}\u201D</div>`);
  const k = latestKnowledge(s);
  if (k) parts.push(`<div class="vld-rec"><span class="vld-rec-k">knew</span>${esc(nameOf(s, k.who))}: ${esc(k.fact)}</div>`);
  const sec = latestSecret(s);
  if (sec) parts.push(`<div class="vld-rec"><span class="vld-rec-k">secret</span>${esc(nameOf(s, sec.keeper))}: ${esc(sec.text)}</div>`);
  const ch = latestRelChange(s);
  if (ch) parts.push(`<div class="vld-rec"><span class="vld-rec-k">shift</span>${ch}</div>`);
  if (!parts.length) return '';
  return `<div class="vld-sec"><div class="vld-h">Latest</div>${parts.join('')}</div>`;
}

/** Fix 23: newest by turn, not array tail (folds can append out of turn order). */
export function latestKnowledge(s: ChronicleState): ChronicleState['knowledge'][number] | undefined {
  return s.knowledge.reduce<ChronicleState['knowledge'][number] | undefined>((best, k) => (!best || k.turn > best.turn ? k : best), undefined);
}
export function latestSecret(s: ChronicleState): ChronicleState['secrets'][number] | undefined {
  return s.secrets.reduce<ChronicleState['secrets'][number] | undefined>((best, x) => (!best || x.formedTurn > best.formedTurn ? x : best), undefined);
}

function latestRelChange(s: ChronicleState): string {
  let best: { turn: number; html: string } | null = null;
  for (const r of s.relations) {
    const cat = (r.categoryHistory ?? []).filter((h) => h.op === 'add' || h.op === 'remove');
    const last = cat[cat.length - 1];
    if (last && (!best || last.turn > best.turn)) {
      const sign = last.op === 'remove' ? '\u2212' : '+';
      best = { turn: last.turn, html: `${esc(nameOf(s, r.a))} \u2192 ${esc(nameOf(s, r.b))}: ${sign}${esc(last.category)}` };
    }
  }
  return best ? best.html : '';
}

import type { Component } from '../component.js';
import type { ChronicleState, Memory } from '../../domain/types.js';
import { esc, byRecent, nameOf, emptyState, sectionHeader } from '../format.js';
import { cmd, paginate, pagerHtml, filterBar, applyFilter, refreshUI } from '../bridge.js';
import { formModal, confirmModal } from '../modal.js';

/**
 * Chronicle tab. Split into sub-views so it stops being a 6-deep heterogeneous
 * scroll: World (scene + arcs + threads), Memory, Knowledge, Secrets. One view
 * at a time via a sub-nav; each keeps its own filter/pager wiring. CRUD flows
 * through the bridge → vellum_cmd.
 */

type CView = 'world' | 'timeline' | 'memory' | 'knowledge' | 'secrets';
const VIEWS: Array<{ id: CView; label: string }> = [
  { id: 'world', label: 'World' }, { id: 'timeline', label: 'Timeline' }, { id: 'memory', label: 'Memory' },
  { id: 'knowledge', label: 'Knowledge' }, { id: 'secrets', label: 'Secrets' },
];
let _view: CView = 'world';

export const chronicleTab: Component<ChronicleState> = {
  version: (s) => `${_view}:${s.arcs.length}:${s.threads.length}:${s.memories.length}:${s.knowledge.length}:${s.secrets.length}:${s.turns}:${s.knowledge.map((k) => k.reliability[0] + (k.truth === 'false' ? 'F' : '')).join('')}`,
  render(s) {
    const counts: Record<CView, number> = { world: s.arcs.length + s.threads.length, timeline: s.memories.length, memory: s.memories.length, knowledge: s.knowledge.length, secrets: s.secrets.length };
    const nav = '<div class="vle-subnav">' + VIEWS.map((v) =>
      `<button class="vle-subnav-b${_view === v.id ? ' on' : ''}" data-cview="${v.id}">${v.label}${counts[v.id] ? ` <span class="vle-n">${counts[v.id]}</span>` : ''}</button>`).join('') + '</div>';
    let body = '';
    if (_view === 'world') body = scene(s) + tracks('\u2746 Arcs', s.arcs) + tracks('\u269C Threads', s.threads) || '';
    else if (_view === 'timeline') body = timeline(s);
    else if (_view === 'memory') body = memories(s);
    else if (_view === 'knowledge') body = knowledge(s);
    else body = secrets(s);
    if (_view === 'world' && !s.scene.location && !s.scene.tension && !s.arcs.length && !s.threads.length) body = emptyState('No world state yet.', 'Scene, arcs, and threads fill in as the story unfolds.');
    return nav + body;
  },
  mount(host) {
    host.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const nv = t.closest('[data-cview]');
      if (nv) { _view = nv.getAttribute('data-cview') as CView; refreshUI(); return; }
      if (t.closest('[data-mem-add]')) { formModal('New Memory', [
        { key: 'text', label: 'Memory', type: 'textarea', placeholder: 'What happened, in detail.' },
        { key: 'keys', label: 'Keywords (comma-separated)', type: 'text' },
        { key: 'tier', label: 'Tier', type: 'select', value: 'chapter', options: [{ value: 'chapter', label: 'chapter' }, { value: 'arc', label: 'arc' }] },
      ], (o) => { if (o.text?.trim()) cmd('memory_add', o); }); return; }
      if (t.closest('[data-know-add]')) { formModal('New Knowledge', [
        { key: 'who', label: 'Who knows it', type: 'text', placeholder: 'Cersei' },
        { key: 'fact', label: 'Fact', type: 'textarea' },
        { key: 'about', label: 'About (optional)', type: 'text' },
        { key: 'reliability', label: 'Reliability', type: 'select', value: 'knows', options: [
          { value: 'knows', label: 'knows' }, { value: 'believes', label: 'believes' },
          { value: 'suspects', label: 'suspects' }, { value: 'wrong', label: 'wrong (false belief)' },
          { value: 'unaware', label: 'unaware' },
        ] },
        { key: 'truth', label: 'Actually true?', type: 'select', value: 'unknown', options: [
          { value: 'unknown', label: 'unknown' }, { value: 'true', label: 'true' }, { value: 'false', label: 'false' },
        ] },
        { key: 'source', label: 'Source (optional)', type: 'text', placeholder: 'overheard at court' },
      ], (o) => { if (o.who?.trim() && o.fact?.trim()) cmd('knowledge_add', o); }); return; }
      if (t.closest('[data-sec-add]')) { formModal('New Secret', [
        { key: 'keeper', label: 'Keeper', type: 'text', placeholder: 'Cersei' },
        { key: 'text', label: 'Secret', type: 'textarea' },
        { key: 'from', label: 'Hidden from (comma-separated)', type: 'text' },
      ], (o) => { if (o.keeper?.trim() && o.text?.trim()) cmd('secret_add', o); }); return; }
      const md = t.closest('[data-mem-del]');
      if (md) { confirmModal('Delete this memory?', () => cmd('memory_delete', { id: md.getAttribute('data-id') })); return; }
      const kd = t.closest('[data-know-del]');
      if (kd) { confirmModal('Delete this knowledge?', () => cmd('knowledge_delete', { id: kd.getAttribute('data-id') })); return; }
      const sd = t.closest('[data-sec-del]');
      if (sd) { confirmModal('Delete this secret?', () => cmd('secret_delete', { id: sd.getAttribute('data-id') })); return; }
      const sr = t.closest('[data-sec-reveal]');
      if (sr) { cmd('secret_reveal', { id: sr.getAttribute('data-id'), to: [] }); return; }
    });
  },
};

function scene(s: ChronicleState): string {
  if (!s.scene.location && !s.scene.tension) return '';
  return '<div class="vle-scene">' + esc(s.scene.location || '\u2014')
    + (s.scene.tension ? ' <span class="vle-tension">tension ' + esc(s.scene.tension) + '/10</span>' : '') + '</div>';
}

function tracks(title: string, list: ChronicleState['arcs']): string {
  if (!list.length) return '';
  const rows = list.slice().sort(byRecent).slice(0, 12).map((t) =>
    '<div class="vle-track"><span class="vle-track-n">' + esc(t.name) + '</span><span class="vle-track-s">' + esc(t.status) + '</span></div>'
  ).join('');
  return sectionHeader(title, { sub: true, count: list.length }) + rows;
}

/**
 * Timeline — a vertical rail keyed on the reliable TURN axis, with model-emitted
 * `day` labels overlaid where present (day is sparse, so it's a label, never the
 * spine). Arc/chapter summaries render as covers-spans; their turn ranges place
 * them on the rail. Pure view over existing state — no schema change.
 */
function timeline(s: ChronicleState): string {
  const head = sectionHeader('\u2637 Timeline', { sub: true, count: s.memories.length });
  // collect dated entries: arcs+chapters (by covers end), knowledge/secrets/journal (by turn)
  type Row = { turn: number; day?: number; kind: string; text: string; span?: [number, number] };
  const rows: Row[] = [];
  for (const m of s.memories) {
    if (m.tier === 'turn') continue; // turn-notes are noise on the timeline
    rows.push({ turn: m.covers?.[1] ?? m.turn, kind: m.tier, text: m.text, ...(m.covers ? { span: m.covers } : {}) });
  }
  for (const k of s.knowledge) rows.push({ turn: k.turn, kind: 'knew', text: nameOf(s, k.who) + ': ' + k.fact });
  for (const sec of s.secrets) rows.push({ turn: sec.formedTurn, kind: 'secret', text: nameOf(s, sec.keeper) + ': ' + sec.text });
  for (const j of s.journal) rows.push({ turn: j.turn, day: j.day, kind: 'journal', text: nameOf(s, j.who) + ': ' + j.memory });
  if (!rows.length) return head + emptyState('Nothing on the timeline yet.', 'Arcs, chapters, knowledge and secrets appear here as the story advances.');
  rows.sort((a, b) => b.turn - a.turn); // newest first
  const items = rows.slice(0, 60).map((r) => {
    const label = r.span ? `t${r.span[0]}\u2013${r.span[1]}` : `t${r.turn}`;
    const day = r.day ? `<span class="vle-tl-day">d${r.day}</span>` : '';
    return `<div class="vle-tl-row"><span class="vle-tl-t">${esc(label)}</span><span class="vle-tl-dot vle-tl-${esc(r.kind)}"></span><div class="vle-tl-body"><span class="vle-tl-k">${esc(r.kind)}</span>${day}<span class="vle-tl-x">${esc(r.text)}</span></div></div>`;
  }).join('');
  return head + `<div class="vle-tl">${items}</div>`;
}

function memories(s: ChronicleState): string {
  const head = sectionHeader('\uD83D\uDCD6 Memory', { sub: true, count: s.memories.length, action: '<button class="vle-add sm" data-mem-add>+</button>' });
  if (!s.memories.length) return head + emptyState('No memories yet.', 'Summaries of what happened accrue here as you play and summarize.');
  const bar = filterBar('memories', { cats: ['turn', 'chapter', 'arc'] });
  const filtered = applyFilter('memories', s.memories, { cat: (m) => m.tier });
  const { slice, page, pages } = paginate('memories', filtered);
  const rows = slice.map((m: Memory) =>
    '<div class="vle-mem"><span class="vle-mem-tier t-' + m.tier + '">' + m.tier + '</span>'
    + '<span class="vle-mem-t">' + esc(m.text) + '</span>'
    + `<button class="vle-mini del" data-mem-del data-id="${esc(m.id)}" title="Delete">\u2715</button></div>`
  ).join('');
  if (!slice.length) return head + bar + emptyState('No memories match this filter.');
  return head + bar + rows + pagerHtml('memories', page, pages);
}

/** Small certainty chip before a fact. 'knows' is the neutral default and shows
 * nothing; the others read at a glance (the dramatic-irony tells). */
function relChip(r: string): string {
  if (!r || r === 'knows') return '';
  return `<span class="vle-krel vle-krel-${esc(r)}">${esc(r)}</span>`;
}

function knowledge(s: ChronicleState): string {
  const head = sectionHeader('\u25C8 Knowledge', { sub: true, count: s.knowledge.length, action: '<button class="vle-add sm" data-know-add>+</button>' });
  if (!s.knowledge.length) return head + emptyState('Nothing known yet.', 'Who-knows-what fills in as the story reveals it.');
  const whos = Array.from(new Set(s.knowledge.map((k) => k.who))).map((id) => ({ id, name: nameOf(s, id) }));
  const bar = filterBar('knowledge', { whos });
  const filtered = applyFilter('knowledge', s.knowledge, { who: (k) => k.who });
  const { slice, page, pages } = paginate('knowledge', filtered);
  const rows = slice.map((k) => '<div class="vle-mem"><span class="vle-mem-tier t-chapter">' + esc(nameOf(s, k.who)) + '</span>'
    + `<span class="vle-mem-t"${k.source ? ` title="source: ${esc(k.source)}"` : ''}>` + relChip(k.reliability) + (k.truth === 'false' ? '<span class="vle-kfalse" title="actually false — dramatic irony">\u2717 false</span>' : '') + esc(k.fact) + '</span>'
    + `<button class="vle-mini del" data-know-del data-id="${esc(k.id)}" title="Delete">\u2715</button></div>`).join('');
  if (!slice.length) return head + bar + emptyState('No knowledge matches this filter.');
  return head + bar + rows + pagerHtml('knowledge', page, pages);
}

function secrets(s: ChronicleState): string {
  const head = sectionHeader('\u26C0 Secrets', { sub: true, count: s.secrets.length, action: '<button class="vle-add sm" data-sec-add>+</button>' });
  if (!s.secrets.length) return head + emptyState('No secrets yet.', 'Hidden knowledge appears here as characters keep things from each other.');
  const whos = Array.from(new Set(s.secrets.map((x) => x.keeper))).map((id) => ({ id, name: nameOf(s, id) }));
  const bar = filterBar('secrets', { whos });
  const filtered = applyFilter('secrets', s.secrets.map((x) => ({ ...x, turn: x.formedTurn })), { who: (x) => x.keeper });
  const { slice, page, pages } = paginate('secrets', filtered);
  const rows = slice.map((sec) => '<div class="vle-mem"><span class="vle-mem-tier t-turn">' + esc(nameOf(s, sec.keeper)) + (sec.revealed ? ' \u00b7 out' : '') + '</span><span class="vle-mem-t">' + esc(sec.text) + (sec.from.length ? ' <em>(from ' + esc(sec.from.map((f) => nameOf(s, f)).join(', ')) + ')</em>' : '') + '</span>'
    + (sec.revealed ? '' : `<button class="vle-mini" data-sec-reveal data-id="${esc(sec.id)}" title="Reveal">\u25D0</button>`)
    + `<button class="vle-mini del" data-sec-del data-id="${esc(sec.id)}" title="Delete">\u2715</button></div>`).join('');
  if (!slice.length) return head + bar + emptyState('No secrets match this filter.');
  return head + bar + rows + pagerHtml('secrets', page, pages);
}

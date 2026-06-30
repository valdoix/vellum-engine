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

type CView = 'world' | 'timeline' | 'memory' | 'knowledge' | 'secrets' | 'scars' | 'codex';
const VIEWS: Array<{ id: CView; label: string }> = [
  { id: 'world', label: 'World' }, { id: 'timeline', label: 'Timeline' }, { id: 'memory', label: 'Memory' },
  { id: 'knowledge', label: 'Knowledge' }, { id: 'secrets', label: 'Secrets' },
  { id: 'scars', label: 'Scars' }, { id: 'codex', label: 'Codex' },
];
let _view: CView = 'world';
// Timeline filters: by kind (all/memory/knew/secret/journal) and by day (all/<n>).
let _tlKind = 'all';
let _tlDay = 'all';

export const chronicleTab: Component<ChronicleState> = {
  version: (s) => `${_view}:${_tlKind}:${_tlDay}:${s.arcs.length}:${s.threads.length}:${s.memories.length}:${s.knowledge.length}:${s.secrets.length}:${(s.scars ?? []).length}:${(s.lore ?? []).length}:${s.turns}:${(s.offscreen ?? []).map((o) => o.id + o.status + o.beats.length).join(',')}:${(s.parallel ?? []).length}:${s.knowledge.map((k) => k.reliability[0] + (k.truth === 'false' ? 'F' : '')).join('')}`,
  render(s) {
    const openOff = (s.offscreen ?? []).filter((o) => o.status === 'active').length + (s.parallel ?? []).filter((p) => p.src !== 'sim').length;
    const counts: Record<CView, number> = { world: s.arcs.length + s.threads.length + openOff, timeline: s.memories.length, memory: s.memories.length, knowledge: s.knowledge.length, secrets: s.secrets.length, scars: (s.scars ?? []).length, codex: (s.lore ?? []).length };
    const nav = '<div class="vle-subnav">' + VIEWS.map((v) =>
      `<button class="vle-subnav-b${_view === v.id ? ' on' : ''}" data-cview="${v.id}">${v.label}${counts[v.id] ? ` <span class="vle-n">${counts[v.id]}</span>` : ''}</button>`).join('') + '</div>';
    let body = '';
    if (_view === 'world') body = scene(s) + tracks('\u2746 Arcs', s.arcs) + tracks('\u269C Threads', s.threads) + offscreenSection(s) || '';
    else if (_view === 'timeline') body = timeline(s);
    else if (_view === 'memory') body = memories(s);
    else if (_view === 'knowledge') body = knowledge(s);
    else if (_view === 'secrets') body = secrets(s);
    else if (_view === 'scars') body = scars(s);
    else body = codex(s);
    if (_view === 'world' && !s.scene.location && !s.scene.tension && !s.arcs.length && !s.threads.length && !(s.offscreen ?? []).length && !(s.parallel ?? []).length) body = emptyState('No world state yet.', 'Scene, arcs, and threads fill in as the story unfolds.');
    return nav + body;
  },
  mount(host) {
    host.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const nv = t.closest('[data-cview]');
      if (nv) { _view = nv.getAttribute('data-cview') as CView; refreshUI(); return; }
      const tk = t.closest('[data-tl-kind]');
      if (tk) { _tlKind = tk.getAttribute('data-tl-kind')!; refreshUI(); return; }
      const td = t.closest('[data-tl-day]');
      if (td) { _tlDay = td.getAttribute('data-tl-day')!; refreshUI(); return; }
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
      if (t.closest('[data-scar-add]')) { formModal('New Scar', [
        { key: 'who', label: 'Who holds it', type: 'text', placeholder: 'Cersei' },
        { key: 'was', label: 'The belief proven wrong', type: 'textarea', placeholder: 'believed Jaime had betrayed her' },
        { key: 'about', label: 'About (optional)', type: 'text' },
      ], (o) => { if (o.who?.trim() && o.was?.trim()) cmd('scar_add', o); }); return; }
      if (t.closest('[data-lore-add]')) { formModal('New Codex Note', [
        { key: 'fact', label: 'Canon fact', type: 'textarea', placeholder: 'The Salt Guild brands initiates on the wrist.' },
        { key: 'tag', label: 'Tag (optional)', type: 'text', placeholder: 'custom / geography / history' },
      ], (o) => { if (o.fact?.trim()) cmd('lore_add', o); }); return; }
      const md = t.closest('[data-mem-del]');
      if (md) { confirmModal('Delete this memory?', () => cmd('memory_delete', { id: md.getAttribute('data-id') })); return; }
      const me = t.closest('[data-mem-edit]');
      if (me) {
        const id = me.getAttribute('data-id'); const hasDetail = !!me.getAttribute('data-detail');
        formModal('Edit summary', [
          { key: 'text', label: 'Summary (chronicle)', type: 'textarea', value: me.getAttribute('data-text') ?? '' },
          ...(hasDetail ? [{ key: 'detail', label: 'Detailed record (vault)', type: 'textarea' as const, value: me.getAttribute('data-detail') ?? '' }] : []),
        ], (o) => { if (o.text?.trim()) cmd('memory_edit', { id, text: o.text, ...(hasDetail ? { detail: o.detail ?? '' } : {}) }); });
        return;
      }
      const kd = t.closest('[data-know-del]');
      if (kd) { confirmModal('Delete this knowledge?', () => cmd('knowledge_delete', { id: kd.getAttribute('data-id') })); return; }
      const sd = t.closest('[data-sec-del]');
      if (sd) { confirmModal('Delete this secret?', () => cmd('secret_delete', { id: sd.getAttribute('data-id') })); return; }
      const sr = t.closest('[data-sec-reveal]');
      if (sr) { cmd('secret_reveal', { id: sr.getAttribute('data-id'), to: [] }); return; }
      const scd = t.closest('[data-scar-del]');
      if (scd) { confirmModal('Delete this scar?', () => cmd('scar_delete', { id: scd.getAttribute('data-id') })); return; }
      const ld = t.closest('[data-lore-del]');
      if (ld) { confirmModal('Delete this codex note?', () => cmd('lore_delete', { id: ld.getAttribute('data-id') })); return; }
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

/** Off-screen subplots (the sim) + any model-narrated meanwhile lines, so all
 * off-stage life is visible in one place in the World view. */
function offscreenSection(s: ChronicleState): string {
  const open = (s.offscreen ?? []).filter((o) => o.status === 'active').sort(byRecent);
  const narrated = (s.parallel ?? []).filter((p) => p.src !== 'sim'); // model-written meanwhile
  if (!open.length && !narrated.length) return '';
  const shownNarr = narrated.slice(0, 4);
  let html = sectionHeader('\u2748 Off-screen', { sub: true, count: open.length + shownNarr.length });
  html += open.map((o) => {
    const who = o.who ? esc(s.cast[o.who]?.name ?? o.who) : '';
    const where = o.where ? ` <span class="vle-os-w">@${esc(o.where)}</span>` : '';
    const hist = o.beats.length > 1 ? `<details class="vle-os-h"><summary>${o.beats.length} beats</summary>${o.beats.map((b) => '<div>\u00b7 ' + esc(b) + '</div>').join('')}</details>` : '';
    return `<div class="vle-os"><div class="vle-os-top"><span class="vle-os-n">${esc(o.name)}</span>${who ? `<span class="vle-os-who">${who}</span>` : ''}${where}</div><div class="vle-os-gist">${esc(o.gist || o.beats[o.beats.length - 1] || '')}</div>${hist}</div>`;
  }).join('');
  if (shownNarr.length) {
    html += shownNarr.map((p) => `<div class="vle-os vle-os--narr"><div class="vle-os-gist">${p.who ? '<b>' + esc(s.cast[p.who]?.name ?? p.who) + '</b>: ' : ''}${esc(p.activity)}${p.where ? ` <span class="vle-os-w">@${esc(p.where)}</span>` : ''}</div></div>`).join('');
  }
  return html;
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
  type Row = { turn: number; day?: number; kind: string; group: string; text: string; span?: [number, number] };
  const rows: Row[] = [];
  for (const m of s.memories) {
    if (m.tier === 'turn') continue; // turn-notes are noise on the timeline
    rows.push({ turn: m.covers?.[1] ?? m.turn, kind: m.tier, group: 'memory', text: m.text, ...(m.covers ? { span: m.covers } : {}) });
  }
  for (const k of s.knowledge) rows.push({ turn: k.turn, kind: 'knew', group: 'knew', text: nameOf(s, k.who) + ': ' + k.fact });
  for (const sec of s.secrets) rows.push({ turn: sec.formedTurn, kind: 'secret', group: 'secret', text: nameOf(s, sec.keeper) + ': ' + sec.text });
  for (const j of s.journal) rows.push({ turn: j.turn, day: j.day, kind: 'journal', group: 'journal', text: nameOf(s, j.who) + ': ' + j.memory });
  for (const x of s.scars ?? []) rows.push({ turn: x.turn, kind: 'scar', group: 'scar', text: nameOf(s, x.who) + ' (scar): ' + x.was });
  for (const x of s.lore ?? []) rows.push({ turn: x.turn, kind: 'lore', group: 'lore', text: 'Codex: ' + x.fact });
  if (!rows.length) return head + emptyState('Nothing on the timeline yet.', 'Arcs, chapters, knowledge and secrets appear here as the story advances.');

  // filter bars: kind (group) + day. Days are sparse, so only offer ones present.
  const KINDS: Array<[string, string]> = [['all', 'all'], ['memory', '\u25C9 memory'], ['knew', '\u25C8 knowledge'], ['secret', '\u26C0 secrets'], ['journal', '\u270E journal'], ['scar', '\u2620 scars'], ['lore', '\u2756 codex']];
  const days = Array.from(new Set(rows.map((r) => r.day).filter((d): d is number => typeof d === 'number'))).sort((a, b) => a - b);
  const gCount = (g: string): number => g === 'all' ? rows.length : rows.filter((r) => r.group === g).length;
  const kindBar = '<div class="vle-fbar">' + KINDS.map(([v, l]) =>
    `<button class="vle-fb-btn${_tlKind === v ? ' on' : ''}" data-tl-kind="${v}">${l} <span class="vle-n">${gCount(v)}</span></button>`).join('') + '</div>';
  const dayCount = (d: number): number => rows.filter((r) => r.day === d).length;
  const dayBar = days.length ? '<div class="vle-fbar"><button class="vle-fb-btn' + (_tlDay === 'all' ? ' on' : '') + '" data-tl-day="all">all days</button>'
    + days.map((d) => `<button class="vle-fb-btn${_tlDay === String(d) ? ' on' : ''}" data-tl-day="${d}">d${d} <span class="vle-n">${dayCount(d)}</span></button>`).join('') + '</div>' : '';

  let shown = rows;
  if (_tlKind !== 'all') shown = shown.filter((r) => r.group === _tlKind);
  if (_tlDay !== 'all') shown = shown.filter((r) => String(r.day ?? '') === _tlDay);
  shown = shown.slice().sort((a, b) => b.turn - a.turn); // newest first
  if (!shown.length) return head + kindBar + dayBar + emptyState('Nothing matches this filter.');
  const items = shown.slice(0, 80).map((r) => {
    const label = r.span ? `t${r.span[0]}\u2013${r.span[1]}` : `t${r.turn}`;
    const day = r.day ? `<span class="vle-tl-day">d${r.day}</span>` : '';
    return `<div class="vle-tl-row"><span class="vle-tl-t">${esc(label)}</span><span class="vle-tl-dot vle-tl-${esc(r.kind)}"></span><div class="vle-tl-body"><span class="vle-tl-k">${esc(r.kind)}</span>${day}<span class="vle-tl-x">${esc(r.text)}</span></div></div>`;
  }).join('');
  return head + kindBar + dayBar + `<div class="vle-tl">${items}</div>`;
}

function memories(s: ChronicleState): string {
  const head = sectionHeader('\uD83D\uDCD6 Memory', { sub: true, count: s.memories.length, action: '<button class="vle-add sm" data-mem-add>+</button>' });
  if (!s.memories.length) return head + emptyState('No memories yet.', 'Summaries of what happened accrue here as you play and summarize.');
  const bar = filterBar('memories', { cats: ['turn', 'chapter', 'arc'], counts: { turn: s.memories.filter((m) => m.tier === 'turn').length, chapter: s.memories.filter((m) => m.tier === 'chapter').length, arc: s.memories.filter((m) => m.tier === 'arc').length } });
  const filtered = applyFilter('memories', s.memories, { cat: (m) => m.tier });
  const { slice, page, pages } = paginate('memories', filtered);
  const rows = slice.map((m: Memory) =>
    '<div class="vle-mem"><span class="vle-mem-tier t-' + m.tier + '">' + m.tier + '</span>'
    + '<span class="vle-mem-t">' + esc(m.text) + '</span>'
    + `<span class="vle-mem-ctl"><button class="vle-mini" data-mem-edit data-id="${esc(m.id)}" data-text="${esc(m.text)}" data-detail="${esc(m.detail ?? '')}" title="Edit summary">\u270E</button>`
    + `<button class="vle-mini del" data-mem-del data-id="${esc(m.id)}" title="Delete">\u2715</button></span></div>`
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
  const whoCounts: Record<string, number> = {};
  for (const k of s.knowledge) whoCounts[k.who] = (whoCounts[k.who] ?? 0) + 1;
  const bar = filterBar('knowledge', { whos, whoCounts });
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
  const whoCounts: Record<string, number> = {};
  for (const x of s.secrets) whoCounts[x.keeper] = (whoCounts[x.keeper] ?? 0) + 1;
  const bar = filterBar('secrets', { whos, whoCounts });
  const filtered = applyFilter('secrets', s.secrets.map((x) => ({ ...x, turn: x.formedTurn })), { who: (x) => x.keeper });
  const { slice, page, pages } = paginate('secrets', filtered);
  const rows = slice.map((sec) => '<div class="vle-mem"><span class="vle-mem-tier t-turn">' + esc(nameOf(s, sec.keeper)) + (sec.revealed ? ' \u00b7 out' : '') + '</span><span class="vle-mem-t">' + esc(sec.text) + (sec.from.length ? ' <em>(from ' + esc(sec.from.map((f) => nameOf(s, f)).join(', ')) + ')</em>' : '') + '</span>'
    + (sec.revealed ? '' : `<button class="vle-mini" data-sec-reveal data-id="${esc(sec.id)}" title="Reveal">\u25D0</button>`)
    + `<button class="vle-mini del" data-sec-del data-id="${esc(sec.id)}" title="Delete">\u2715</button></div>`).join('');
  if (!slice.length) return head + bar + emptyState('No secrets match this filter.');
  return head + bar + rows + pagerHtml('secrets', page, pages);
}

/** Palimpsest scars — beliefs once held, proven wrong, kept as a mark. The
 * superseded belief renders struck through; grouped by holder via the filter. */
function scars(s: ChronicleState): string {
  const list = s.scars ?? [];
  const head = sectionHeader('\u2620 Scars', { sub: true, count: list.length, action: '<button class="vle-add sm" data-scar-add>+</button>' });
  if (!list.length) return head + emptyState('No scars yet.', 'When a belief is proven wrong, the old belief is kept here \u2014 it resurfaces under stress as doubt.');
  const whos = Array.from(new Set(list.map((x) => x.who))).map((id) => ({ id, name: nameOf(s, id) }));
  const whoCounts: Record<string, number> = {};
  for (const x of list) whoCounts[x.who] = (whoCounts[x.who] ?? 0) + 1;
  const bar = filterBar('scars', { whos, whoCounts });
  const filtered = applyFilter('scars', list, { who: (x) => x.who });
  const { slice, page, pages } = paginate('scars', filtered);
  const rows = slice.map((x) => '<div class="vle-mem"><span class="vle-mem-tier t-turn">' + esc(nameOf(s, x.who)) + '</span>'
    + '<span class="vle-mem-t"><span class="vle-scar-was">' + esc(x.was) + '</span>' + (x.about ? ' <em>(about ' + esc(nameOf(s, x.about)) + ')</em>' : '') + '</span>'
    + `<button class="vle-mini del" data-scar-del data-id="${esc(x.id)}" title="Delete">\u2715</button></div>`).join('');
  if (!slice.length) return head + bar + emptyState('No scars match this filter.');
  return head + bar + rows + pagerHtml('scars', page, pages);
}

/** Codex \u2014 minted canon (facts true of the world, not a character's belief). */
function codex(s: ChronicleState): string {
  const list = s.lore ?? [];
  const head = sectionHeader('\u2756 Codex', { sub: true, count: list.length, action: '<button class="vle-add sm" data-lore-add>+</button>' });
  if (!list.length) return head + emptyState('The Codex is empty.', 'World-facts the engine establishes (custom, geography, history) are recorded here as canon.');
  const sorted = list.slice().sort((a, b) => b.turn - a.turn);
  const rows = sorted.map((x) => '<div class="vle-mem"><span class="vle-mem-tier t-chapter">' + esc(x.tag || 'canon') + '</span>'
    + '<span class="vle-mem-t">' + esc(x.fact) + '</span>'
    + `<button class="vle-mini del" data-lore-del data-id="${esc(x.id)}" title="Delete">\u2715</button></div>`).join('');
  return head + rows;
}

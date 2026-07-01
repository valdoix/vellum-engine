import type { Component } from '../component.js';
import type { ChronicleState, Memory } from '../../domain/types.js';
import { esc, byRecent, nameOf, emptyState, sectionHeader } from '../format.js';
import { cmd, send, paginate, pagerHtml, filterBar, applyFilter, refreshUI } from '../bridge.js';
import { formModal, confirmModal } from '../modal.js';

/**
 * Chronicle tab. Split into sub-views so it stops being a 6-deep heterogeneous
 * scroll: World (scene + arcs + threads), Memory, Knowledge, Secrets. One view
 * at a time via a sub-nav; each keeps its own filter/pager wiring. CRUD flows
 * through the bridge → vellum_cmd.
 */

type CView = 'world' | 'timeline' | 'turns' | 'beats' | 'memory' | 'knowledge' | 'secrets' | 'scars' | 'codex' | 'items';
const VIEWS: Array<{ id: CView; label: string }> = [
  { id: 'world', label: 'World' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'turns', label: 'Turns' },
  { id: 'beats', label: 'Beats' },
  { id: 'memory', label: 'Memory' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'secrets', label: 'Secrets' },
  { id: 'scars', label: 'Scars' },
  { id: 'codex', label: 'Codex' },
  { id: 'items', label: 'Items' },
];
let _view: CView = 'timeline';
// Timeline filters: by kind (all/memory/knew/secret/journal) and by day (all/<n>).
let _tlKind = 'all';
let _tlDay = 'all';
// Manual pick: selection mode, the tier being picked ('turn'→chapter, 'chapter'
// →arc), the chosen ids, and a shift-range anchor.
let _pickMode = false;
let _pickTier: 'turn' | 'chapter' = 'turn';
let _pickAction: 'fold' | 'delete' = 'fold'; // fold = combine; delete = remove (delete mode picks any tier)
const _picked = new Set<string>();
let _pickAnchor: string | null = null;
let _summaryIds: string[] = []; // all chapter/arc memory ids (set each render), for select-all / delete-all
// Story-beat suggestions, filled by the vellum_beat_suggestions broadcast.
let _beatSuggest: Array<{ turn: number; day?: number; text: string }> = [];
export function setBeatSuggestions(items: unknown): void { _beatSuggest = Array.isArray(items) ? items as typeof _beatSuggest : []; }
// Turn Inspector data (per-turn change digests), filled by the vellum_turnlog broadcast.
let _turnLog: Array<{ turn: number; changes: Array<{ icon: string; text: string }> }> = [];
let _turnMax = 0;
export function setTurnLog(turns: unknown, maxTurn: unknown): void { _turnLog = Array.isArray(turns) ? turns as typeof _turnLog : []; _turnMax = typeof maxTurn === 'number' ? maxTurn : 0; }

/** First-sentence preview of a (possibly very long) stored turn text. We store
 * turns in FULL now; the chronicle shows only one line + an ellipsis, with the
 * whole text in the hover title. */
function oneLine(text: string, max = 160): string {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const m = s.match(/^.*?[.!?](?=\s|$)/);
  let out = m && m[0].length <= max ? m[0] : s.slice(0, max);
  if (out.length < s.length) out = out.replace(/\s+\S*$/, '').replace(/[\s,;:.\u2014-]+$/, '') + '\u2026';
  return out.trim();
}

export const chronicleTab: Component<ChronicleState> = {
  version: (s) => `${_view}:${_tlKind}:${_tlDay}:${_pickMode}:${_pickTier}:${_pickAction}:${_picked.size}:${_beatSuggest.length}:${_turnLog.length}:${s.arcs.length}:${s.threads.length}:${s.memories.length}:${s.memories.filter((m) => m.tier === 'beat').map((m) => m.id + (m.ord ?? '') + (m.spine ? 's' : '')).join(',')}:${s.knowledge.length}:${s.secrets.length}:${(s.scars ?? []).length}:${(s.lore ?? []).length}:${(s.items ?? []).length}:${s.turns}:${(s.offscreen ?? []).map((o) => o.id + o.status + o.beats.length).join(',')}:${(s.parallel ?? []).length}:${s.knowledge.map((k) => k.reliability[0] + (k.truth === 'false' ? 'F' : '')).join('')}`,
  render(s) {
    const openOff = (s.offscreen ?? []).filter((o) => o.status === 'active').length + (s.parallel ?? []).filter((p) => p.src !== 'sim').length;
    const memCount = s.memories.filter((m) => m.tier !== 'beat').length; // Memory view excludes beats (own tab)
    const counts: Record<CView, number> = { world: s.arcs.length + s.threads.length + openOff, timeline: s.memories.length, turns: _turnMax, beats: s.memories.filter((m) => m.tier === 'beat').length, memory: memCount, knowledge: s.knowledge.length, secrets: s.secrets.length, scars: (s.scars ?? []).length, codex: (s.lore ?? []).length, items: (s.items ?? []).length };
    const btn = (v: { id: CView; label: string }): string =>
      `<button class="vle-subnav-b${_view === v.id ? ' on' : ''}" data-cview="${v.id}">${v.label}${counts[v.id] ? ` <span class="vle-n">${counts[v.id]}</span>` : ''}</button>`;
    // Story (the Spine river) leads as the primary reading surface; World/Beats
    // sit beside it; the editable record lists group under "Records".
    const inGroup = (ids: CView[]): string => VIEWS.filter((v) => ids.includes(v.id)).map(btn).join('');
    const nav = '<div class="vle-subnav">'
      + '<span class="vle-subnav-g">Story</span>' + inGroup(['timeline', 'world', 'beats'])
      + '<span class="vle-subnav-g">Records</span>' + inGroup(['memory', 'knowledge', 'secrets', 'scars', 'codex', 'items'])
      + '</div>';
    let body = '';
    if (_view === 'world') body = scene(s) + tracks('\u2746 Arcs', s.arcs) + tracks('\u269C Threads', s.threads) + offscreenSection(s) || '';
    else if (_view === 'timeline') body = timeline(s);
    else if (_view === 'turns') body = turnsView(s);
    else if (_view === 'beats') body = beatsView(s);
    else if (_view === 'memory') body = memories(s);
    else if (_view === 'knowledge') body = knowledge(s);
    else if (_view === 'secrets') body = secrets(s);
    else if (_view === 'scars') body = scars(s);
    else if (_view === 'codex') body = codex(s);
    else body = itemsView(s);
    if (_view === 'world' && !s.scene.location && !s.scene.tension && !s.arcs.length && !s.threads.length && !(s.offscreen ?? []).length && !(s.parallel ?? []).length) body = emptyState('No world state yet.', 'Scene, arcs, and threads fill in as the story unfolds.');
    return nav + body;
  },
  mount(host) {
    host.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const nv = t.closest('[data-cview]');
      if (nv) { _view = nv.getAttribute('data-cview') as CView; if (_view === 'turns') send({ type: 'vellum_get_turnlog' }); refreshUI(); return; }
      const tu = t.closest('[data-turn-undo]');
      if (tu) { confirmModal('Undo this turn? Its chronicle changes are dropped (the chat message stays).', () => { send({ type: 'vellum_undo' }); setTimeout(() => send({ type: 'vellum_get_turnlog' }), 400); }); return; }
      const tk = t.closest('[data-tl-kind]');
      if (tk) { _tlKind = tk.getAttribute('data-tl-kind')!; refreshUI(); return; }
      const td = t.closest('[data-tl-day]');
      if (td) { _tlDay = td.getAttribute('data-tl-day')!; refreshUI(); return; }
      // --- manual pick: turns→chapter, chapters→arc ---
      const ptg = t.closest('[data-pick-toggle]');
      if (ptg) {
        const tier = (ptg.getAttribute('data-pick-toggle') === 'chapter' ? 'chapter' : 'turn') as 'turn' | 'chapter';
        if (_pickMode && _pickAction === 'fold' && _pickTier === tier) { _pickMode = false; } else { _pickMode = true; _pickAction = 'fold'; _pickTier = tier; }
        _picked.clear(); _pickAnchor = null; refreshUI(); return;
      }
      if (t.closest('[data-pick-del]')) {
        if (_pickMode && _pickAction === 'delete') { _pickMode = false; } else { _pickMode = true; _pickAction = 'delete'; }
        _picked.clear(); _pickAnchor = null; refreshUI(); return;
      }
      const pk = t.closest('[data-pick-id]');
      if (pk) {
        const id = pk.getAttribute('data-pick-id')!;
        const ids = Array.from(host.querySelectorAll('[data-pick-id]')).map((el) => el.getAttribute('data-pick-id')!).filter(Boolean);
        if ((e as MouseEvent).shiftKey && _pickAnchor && ids.includes(_pickAnchor) && ids.includes(id)) {
          const a = ids.indexOf(_pickAnchor), b = ids.indexOf(id);
          for (let i = Math.min(a, b); i <= Math.max(a, b); i++) _picked.add(ids[i]!);
        } else {
          if (_picked.has(id)) _picked.delete(id); else _picked.add(id);
          _pickAnchor = id;
        }
        refreshUI(); return;
      }
      if (t.closest('[data-pick-fold]')) {
        if (_picked.size >= 2) {
          const ids = Array.from(_picked);
          send(_pickTier === 'chapter' ? { type: 'vellum_arc', ids } : { type: 'vellum_summarize_pick', ids });
          _pickMode = false; _picked.clear(); _pickAnchor = null; refreshUI();
        }
        return;
      }
      if (t.closest('[data-pick-selall]')) { for (const id of _summaryIds) _picked.add(id); refreshUI(); return; }
      if (t.closest('[data-pick-delete]')) {
        const ids = Array.from(_picked);
        if (ids.length) confirmModal(`Delete ${ids.length} selected summar${ids.length === 1 ? 'y' : 'ies'}? The turns/chapters they folded are restored.`, () => { cmd('memory_delete_many', { ids }); _pickMode = false; _picked.clear(); _pickAnchor = null; refreshUI(); });
        return;
      }
      if (t.closest('[data-pick-delall]')) {
        const ids = _summaryIds.slice();
        if (ids.length) confirmModal(`Delete ALL ${ids.length} chapter/arc summaries? Everything they folded is restored to the chronicle. (Turn memories are kept.)`, () => { cmd('memory_delete_many', { ids }); _pickMode = false; _picked.clear(); _pickAnchor = null; refreshUI(); });
        return;
      }
      if (t.closest('[data-beat-add]')) { formModal('New Story Beat', [
        { key: 'text', label: 'What happened (one line)', type: 'text', placeholder: 'Aldous and Mira dueled; Mira won.' },
        { key: 'day', label: 'Day (optional)', type: 'number', min: 0, step: 1 },
        { key: 'time', label: 'Time (optional)', type: 'text', placeholder: 'dusk' },
        { key: 'spine', label: 'Recall', type: 'select', value: 'spine', options: [{ value: 'spine', label: 'On the always-injected spine' }, { value: 'relevance', label: 'By relevance only' }] },
      ], (o) => { if (o.text?.trim()) send({ type: 'vellum_beat_add', text: o.text, day: o.day ? Number(o.day) : undefined, time: o.time || undefined, spine: o.spine !== 'relevance' }); }); return; }
      if (t.closest('[data-beat-suggest]')) { send({ type: 'vellum_beat_suggest' }); return; }
      const bacc = t.closest('[data-beat-accept]');
      if (bacc) { const x = _beatSuggest[Number(bacc.getAttribute('data-beat-accept'))]; if (x) { send({ type: 'vellum_beat_add', text: x.text, day: x.day, spine: true }); } return; }
      const bdel = t.closest('[data-beat-del]');
      if (bdel) { confirmModal('Delete this story beat?', () => send({ type: 'vellum_beat_delete', id: bdel.getAttribute('data-id') })); return; }
      const bmove = t.closest('[data-beat-move]');
      if (bmove && !bmove.hasAttribute('disabled')) { send({ type: 'vellum_beat_reorder', id: bmove.getAttribute('data-id'), dir: bmove.getAttribute('data-dir') }); return; }
      const bedit = t.closest('[data-beat-edit]');
      if (bedit) {
        const id = bedit.getAttribute('data-id');
        const dayAttr = bedit.getAttribute('data-day') || '';
        formModal('Edit Story Beat', [
          { key: 'text', label: 'What happened (one line)', type: 'text', value: bedit.getAttribute('data-text') || '' },
          { key: 'day', label: 'Day (optional)', type: 'number', min: 0, step: 1, value: dayAttr },
          { key: 'time', label: 'Time (optional)', type: 'text', value: bedit.getAttribute('data-time') || '' },
          { key: 'spine', label: 'Recall', type: 'select', value: bedit.getAttribute('data-spine') === '1' ? 'spine' : 'relevance', options: [{ value: 'spine', label: 'On the always-injected spine' }, { value: 'relevance', label: 'By relevance only' }] },
        ], (o) => { if (o.text?.trim()) send({ type: 'vellum_beat_edit', id, text: o.text, day: o.day !== '' ? Number(o.day) : undefined, time: o.time || undefined, spine: o.spine !== 'relevance' }); });
        return;
      }
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
      if (t.closest('[data-item-add]')) { formModal('New Item', [
        { key: 'item', label: 'Item', type: 'text', placeholder: 'the forged letter' },
        { key: 'who', label: 'Held by (blank = a scene/world item)', type: 'text', placeholder: 'Cersei' },
        { key: 'note', label: 'Note (optional)', type: 'text', placeholder: 'taken from the desk' },
      ], (o) => { if (o.item?.trim()) send({ type: 'vellum_item_add', item: o.item, who: o.who || '', scene: !o.who?.trim(), note: o.note || undefined }); }); return; }
      const ie = t.closest('[data-item-edit]');
      if (ie) { formModal('Edit Item', [
        { key: 'item', label: 'Item', type: 'text', value: ie.getAttribute('data-item') || '' },
        { key: 'who', label: 'Held by (blank = a scene/world item)', type: 'text', value: ie.getAttribute('data-who') || '' },
        { key: 'note', label: 'Note (optional)', type: 'text', value: ie.getAttribute('data-note') || '' },
      ], (o) => { if (o.item?.trim()) send({ type: 'vellum_item_edit', id: ie.getAttribute('data-id'), item: o.item, who: o.who ?? '', note: o.note ?? '' }); }); return; }
      const idl = t.closest('[data-item-del]');
      if (idl) { confirmModal('Delete this item?', () => send({ type: 'vellum_item_delete', id: idl.getAttribute('data-id') })); return; }
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
    if (m.tier === 'beat') { rows.push({ turn: m.turn, ...(m.beatDay !== undefined ? { day: m.beatDay } : {}), kind: 'beat', group: 'beat', text: m.text }); continue; }
    rows.push({ turn: m.covers?.[1] ?? m.turn, kind: m.tier, group: 'memory', text: m.text, ...(m.covers ? { span: m.covers } : {}) });
  }
  for (const k of s.knowledge) rows.push({ turn: k.turn, kind: 'knew', group: 'knew', text: nameOf(s, k.who) + ': ' + k.fact });
  for (const sec of s.secrets) rows.push({ turn: sec.formedTurn, kind: 'secret', group: 'secret', text: nameOf(s, sec.keeper) + ': ' + sec.text });
  for (const j of s.journal) rows.push({ turn: j.turn, day: j.day, kind: 'journal', group: 'journal', text: nameOf(s, j.who) + ': ' + j.memory });
  for (const x of s.scars ?? []) rows.push({ turn: x.turn, kind: 'scar', group: 'scar', text: nameOf(s, x.who) + ' (scar): ' + x.was });
  for (const x of s.lore ?? []) rows.push({ turn: x.turn, kind: 'lore', group: 'lore', text: 'Codex: ' + x.fact });
  if (!rows.length) return head + emptyState('Nothing on the timeline yet.', 'Arcs, chapters, knowledge and secrets appear here as the story advances.');

  // filter bars: kind (group) + day. Days are sparse, so only offer ones present.
  const KINDS: Array<[string, string]> = [['all', 'all'], ['beat', '\u2691 beats'], ['memory', '\u25C9 memory'], ['knew', '\u25C8 knowledge'], ['secret', '\u26C0 secrets'], ['journal', '\u270E journal'], ['scar', '\u2620 scars'], ['lore', '\u2756 codex']];
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

  // "The Spine" (mockup 10): a central river. Beats sit centered ON the spine;
  // every other record branches left/right as a card with its per-type color
  // spine. Day changes drop a node; act changes drop a divider band. Degrades to
  // a flat list if anything is off — each row is independently rendered.
  const beatAct = new Map<number, string>();
  for (const m of s.memories) if (m.tier === 'beat' && m.act) beatAct.set(m.turn, m.act);
  let lastDay: number | undefined; let lastAct: string | undefined; let side = 0;
  const parts: string[] = [];
  for (const r of shown.slice(0, 80)) {
    const act = beatAct.get(r.turn);
    if (act && act !== lastAct) { parts.push(`<div class="vle-spine-act">${esc(act)}</div>`); lastAct = act; }
    if (r.day !== undefined && r.day !== lastDay) { parts.push(`<div class="vle-spine-day"><span>D${esc(r.day)}</span></div>`); lastDay = r.day; }
    const label = r.span ? `t${r.span[0]}\u2013${r.span[1]}` : `t${r.turn}`;
    if (r.kind === 'beat') {
      parts.push(`<div class="vle-spine-beat"><span class="vle-spine-beat-k">\u2691 beat</span><span class="vle-spine-beat-x">${esc(r.text)}</span></div>`);
      continue;
    }
    const s2 = side++ % 2 === 0 ? 'l' : 'r';
    parts.push(`<div class="vle-spine-row vle-spine-${s2}"><div class="vle-spine-card vle-spine-${esc(r.kind)}">`
      + `<span class="vle-spine-meta"><span class="vle-spine-kind">${esc(r.kind)}</span><span class="vle-spine-t">${esc(label)}</span></span>`
      + `<span class="vle-spine-x">${esc(r.text)}</span></div></div>`);
  }
  return head + kindBar + dayBar + `<div class="vle-spine">${parts.join('')}</div>`;
}

/** Story Beats — the author-curated landmark layer + recall spine. Sorted by
 * day then turn; spine-flagged beats carry a marker (always-injected). */
function turnsView(s: ChronicleState): string {
  const head = sectionHeader('\u21BA Turns', { sub: true, count: _turnLog.length });
  const intro = '<div class="vle-cz-note">What each turn changed in the chronicle. Read-only; the most recent turn can be undone (its chat message is untouched).</div>';
  if (!_turnLog.length) return head + intro + emptyState('No tracked changes yet.', 'As you play, each turn\u2019s bond/knowledge/trait changes appear here.');
  const rows = _turnLog.map((t) => {
    const undo = t.turn === _turnMax && _turnMax > 0 ? `<button class="vle-mini del" data-turn-undo data-turn="${t.turn}" title="Undo this turn">\u21A9</button>` : '';
    const changes = t.changes.map((c) => `<div class="vle-turn-change"><span class="vle-turn-ico">${esc(c.icon)}</span><span class="vle-turn-tx">${esc(c.text)}</span></div>`).join('');
    return `<div class="vle-turn"><div class="vle-turn-h"><span class="vle-turn-n">turn ${t.turn}</span><span class="vle-turn-count">${t.changes.length} change${t.changes.length === 1 ? '' : 's'}</span>${undo}</div>${changes}</div>`;
  }).join('');
  return head + intro + rows;
}

function beatsView(s: ChronicleState): string {
  const list = s.memories.filter((m) => m.tier === 'beat')
    .sort((a, b) => {
      // manual `ord` (author reordering) wins when present; else chronological
      const ka = a.ord !== undefined ? a.ord : (a.beatDay ?? 0) * 100000 + a.turn;
      const kb = b.ord !== undefined ? b.ord : (b.beatDay ?? 0) * 100000 + b.turn;
      return ka - kb || ((a.beatDay ?? 0) * 100000 + a.turn) - ((b.beatDay ?? 0) * 100000 + b.turn);
    });
  const head = sectionHeader('\u2691 Story Beats', { sub: true, count: list.length, action: '<button class="vle-add sm" data-beat-suggest title="Suggest beats from the story so far">\u2728 suggest</button><button class="vle-add sm" data-beat-add>+</button>' });
  const intro = '<div class="vle-cz-note">Landmark index cards you author - the story\u2019s through-line. Spine beats (\u2691) are injected into every prompt as ground truth; the rest surface by relevance. Use \u25B4\u25BE to reorder.</div>';
  const sug = _beatSuggest.length
    ? '<div class="vle-beat-sug-h"><span class="vle-beat-sug-lbl">Suggested:</span><div class="vle-beat-sug-row">' + _beatSuggest.slice(0, 12).map((x, i) => `<button class="vle-beat-sug-chip" data-beat-accept="${i}" title="Add as a beat: ${esc(x.text)}">+ ${esc((x.day ? 'D' + x.day + ' ' : '') + x.text).slice(0, 48)}</button>`).join('') + '</div></div>'
    : '';
  if (!list.length) return head + intro + sug + emptyState('No beats yet.', 'Mark a landmark: a duel, a betrayal, a vow. Or hit \u2728 suggest to pull candidates from what already happened.');
  const rows = list.map((m, i) => {
    const anchor = (m.beatDay !== undefined ? 'Day ' + m.beatDay : '') + (m.beatTime ? (m.beatDay !== undefined ? ', ' : '') + m.beatTime : '');
    const spine = m.spine ? '<span class="vle-mem-tier t-beat" title="On the always-injected spine">\u2691</span>' : '<span class="vle-mem-tier" title="Recalled by relevance only" style="opacity:.5">\u25CB</span>';
    const up = `<button class="vle-mini" data-beat-move data-id="${esc(m.id)}" data-dir="up"${i === 0 ? ' disabled' : ''} title="Move earlier">\u25B4</button>`;
    const down = `<button class="vle-mini" data-beat-move data-id="${esc(m.id)}" data-dir="down"${i === list.length - 1 ? ' disabled' : ''} title="Move later">\u25BE</button>`;
    const edit = `<button class="vle-mini" data-beat-edit data-id="${esc(m.id)}" data-text="${esc(m.text)}" data-day="${m.beatDay ?? ''}" data-time="${esc(m.beatTime ?? '')}" data-spine="${m.spine ? '1' : '0'}" title="Edit">\u270E</button>`;
    return '<div class="vle-mem">' + spine
      + (anchor ? `<span class="vle-tl-day">${esc(anchor)}</span>` : '')
      + `<span class="vle-mem-t">${esc(m.text)}</span>`
      + `<span class="vle-mem-ctl">${up}${down}${edit}<button class="vle-mini del" data-beat-del data-id="${esc(m.id)}" title="Delete">\u2715</button></span></div>`;
  }).join('');
  return head + intro + sug + rows;
}

function memories(s: ChronicleState): string {
  const turnCount = s.memories.filter((m) => m.tier === 'turn').length;
  const chapCount = s.memories.filter((m) => m.tier === 'chapter').length;
  // pick controls: fold turns→chapter (2+ turns), fold chapters→arc (2+ chapters),
  // and DELETE (select any summaries to remove). Delete restores what was folded.
  const summaryCount = s.memories.filter((m) => m.tier === 'chapter' || m.tier === 'arc').length;
  _summaryIds = s.memories.filter((m) => m.tier === 'chapter' || m.tier === 'arc').map((m) => m.id);
  const inFold = _pickMode && _pickAction === 'fold';
  const inDel = _pickMode && _pickAction === 'delete';
  const pickTurns = turnCount >= 2 ? `<button class="vle-add sm" data-pick-toggle="turn" title="Select turns to fold into a chapter">${inFold && _pickTier === 'turn' ? '\u2715 cancel' : '\u2748 fold turns'}</button>` : '';
  const pickChaps = chapCount >= 2 ? `<button class="vle-add sm" data-pick-toggle="chapter" title="Select chapters to fold into an arc">${inFold && _pickTier === 'chapter' ? '\u2715 cancel' : '\u2748 fold chapters'}</button>` : '';
  const pickDel = summaryCount >= 1 ? `<button class="vle-add sm" data-pick-del title="Select summaries to delete (restores what they folded)">${inDel ? '\u2715 cancel' : '\u2717 delete'}</button>` : '';
  const nonBeat = s.memories.filter((m) => m.tier !== 'beat'); // Memory view excludes beats (own tab)
  const head = sectionHeader('\uD83D\uDCD6 Memory', { sub: true, count: nonBeat.length, action: pickTurns + pickChaps + pickDel + '<button class="vle-add sm" data-mem-add>+</button>' });
  if (!nonBeat.length) return head + emptyState('No memories yet.', 'Summaries of what happened accrue here as you play and summarize.');
  const bar = filterBar('memories', { cats: ['turn', 'chapter', 'arc'], counts: { turn: turnCount, chapter: chapCount, arc: s.memories.filter((m) => m.tier === 'arc').length } });
  const filtered = applyFilter('memories', nonBeat, { cat: (m) => m.tier });
  const { slice, page, pages } = paginate('memories', filtered);
  const rows = slice.map((m: Memory) => {
    const isTurn = m.tier === 'turn';
    const shown = isTurn ? oneLine(m.text) : m.text;
    const titleAttr = isTurn ? ` title="${esc(m.text).slice(0, 1000)}"` : '';
    // fold mode: only the matching tier is pickable. delete mode: any summary
    // (chapter/arc) is pickable; turns are not (use fold/their own delete).
    const pickable = inFold ? m.tier === _pickTier : inDel ? (m.tier === 'chapter' || m.tier === 'arc') : false;
    const checked = _picked.has(m.id) ? ' checked' : '';
    const box = pickable ? `<input type="checkbox" class="vle-mem-pick" data-pick-id="${esc(m.id)}"${checked}>` : '';
    return '<div class="vle-mem' + (pickable ? ' pickable' : '') + '">' + box
      + '<span class="vle-mem-tier t-' + m.tier + '">' + m.tier + '</span>'
      + '<span class="vle-mem-t"' + titleAttr + '>' + esc(shown) + '</span>'
      + `<span class="vle-mem-ctl"><button class="vle-mini" data-mem-edit data-id="${esc(m.id)}" data-text="${esc(m.text)}" data-detail="${esc(m.detail ?? '')}" title="Edit summary">\u270E</button>`
      + `<button class="vle-mini del" data-mem-del data-id="${esc(m.id)}" title="Delete">\u2715</button></span></div>`;
  }).join('');
  const foldLabel = _pickTier === 'chapter' ? 'Fold into arc' : 'Fold into chapter';
  const unit = inDel ? 'summary' : (_pickTier === 'chapter' ? 'chapter' : 'turn');
  const unitPl = inDel ? 'summaries' : unit + 's';
  let footer = '';
  if (inFold) {
    footer = `<div class="vle-pickbar"><span>${_picked.size} ${_picked.size === 1 ? unit : unitPl} selected</span>`
      + `<button class="vle-add sm" data-pick-fold${_picked.size < 2 ? ' disabled' : ''}>${foldLabel}</button></div>`;
  } else if (inDel) {
    footer = `<div class="vle-pickbar"><span>${_picked.size} ${_picked.size === 1 ? unit : unitPl} selected</span>`
      + `<button class="vle-add sm" data-pick-selall>Select all</button>`
      + `<button class="vle-add sm danger" data-pick-delete${_picked.size < 1 ? ' disabled' : ''}>Delete selected</button>`
      + `<button class="vle-add sm danger" data-pick-delall>Delete all summaries</button></div>`;
  }
  if (!slice.length) return head + bar + emptyState('No memories match this filter.');
  return head + bar + footer + rows + pagerHtml('memories', page, pages);
}

/** Small certainty chip before a fact. 'knows' is the neutral default and shows
 * nothing; the others read at a glance (the dramatic-irony tells). */
function relChip(r: string): string {
  if (!r || r === 'knows') return '';
  return `<span class="vle-krel vle-krel-${esc(r)}">${esc(r)}</span>`;
}

function knowledge(s: ChronicleState): string {
  const head = sectionHeader('\u25C8 Knowledge', { sub: true, count: s.knowledge.length, action: '<button class="vle-add sm" data-know-add>+</button>' });
  if (!s.knowledge.length) return head + emptyState('Nothing known yet.', 'Who-knows-what fills in as the story reveals it. Mark a belief false to track dramatic irony \u2014 when a character is sure of something untrue.');
  const whos = Array.from(new Set(s.knowledge.map((k) => k.who))).map((id) => ({ id, name: nameOf(s, id) }));
  const whoCounts: Record<string, number> = {};
  for (const k of s.knowledge) whoCounts[k.who] = (whoCounts[k.who] ?? 0) + 1;
  const bar = filterBar('knowledge', { whos, whoCounts });
  const filtered = applyFilter('knowledge', s.knowledge, { who: (k) => k.who });
  const { slice, page, pages } = paginate('knowledge', filtered);
  const rows = slice.map((k) => '<div class="vle-mem vle-mem--know"><span class="vle-mem-tier t-chapter">' + esc(nameOf(s, k.who)) + '</span>'
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
  const rows = slice.map((sec) => '<div class="vle-mem vle-mem--secret"><span class="vle-mem-tier t-turn">' + esc(nameOf(s, sec.keeper)) + (sec.revealed ? ' \u00b7 out' : '') + '</span><span class="vle-mem-t">' + esc(sec.text) + (sec.from.length ? ' <em>(from ' + esc(sec.from.map((f) => nameOf(s, f)).join(', ')) + ')</em>' : '') + '</span>'
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
  const rows = slice.map((x) => '<div class="vle-mem vle-mem--scar"><span class="vle-mem-tier t-turn">' + esc(nameOf(s, x.who)) + '</span>'
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
  const rows = sorted.map((x) => '<div class="vle-mem vle-mem--codex"><span class="vle-mem-tier t-chapter">' + esc(x.tag || 'canon') + '</span>'
    + '<span class="vle-mem-t">' + esc(x.fact) + '</span>'
    + `<button class="vle-mini del" data-lore-del data-id="${esc(x.id)}" title="Delete">\u2715</button></div>`).join('');
  return head + rows;
}

/** Items \u2014 the possession tracker. Named, notable possessions grouped by owner
 * (present characters first, then absent, then a Scene group for world items). */
function itemsView(s: ChronicleState): string {
  const list = s.items ?? [];
  const head = sectionHeader('\u2726 Items', { sub: true, count: list.length, action: '<button class="vle-add sm" data-item-add>+</button>' });
  if (!list.length) return head + emptyState('No items tracked.', 'Notable possessions (a letter, a blade, a key) and scene objects are recorded here. Enable the Inventory block in the preset to track them automatically.');
  const present = new Set(s.scene.present);
  // group: scene (world) last; characters split present vs absent, present first
  const groups = new Map<string, typeof list>();
  for (const it of list) {
    const key = it.who === 'world' ? '\u0000scene' : it.who;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(it);
  }
  const charKeys = [...groups.keys()].filter((k) => k !== '\u0000scene')
    .sort((a, b) => (present.has(b) ? 1 : 0) - (present.has(a) ? 1 : 0) || nameOf(s, a).localeCompare(nameOf(s, b)));
  const order = [...charKeys, ...(groups.has('\u0000scene') ? ['\u0000scene'] : [])];
  const body = order.map((key) => {
    const label = key === '\u0000scene' ? 'Scene' : nameOf(s, key) + (present.has(key) ? ' \u00b7 present' : '');
    const rows = groups.get(key)!.map((it) =>
      '<div class="vle-item-row"><span class="vle-item-name">' + esc(it.item) + '</span>'
      + (it.note ? `<span class="vle-item-note">${esc(it.note)}</span>` : '')
      + `<span class="vle-mem-ctl"><button class="vle-mini" data-item-edit data-id="${esc(it.id)}" data-item="${esc(it.item)}" data-who="${esc(it.who === 'world' ? '' : nameOf(s, it.who))}" data-note="${esc(it.note ?? '')}" title="Edit">\u270E</button>`
      + `<button class="vle-mini del" data-item-del data-id="${esc(it.id)}" title="Delete">\u2715</button></span></div>`
    ).join('');
    return `<div class="vle-item-grp"><div class="vle-item-grp-h">${esc(label)}</div>${rows}</div>`;
  }).join('');
  return head + body;
}

import type { Component } from '../component.js';
import type { ChronicleState, Memory } from '../../domain/types.js';
import { esc, byRecent, nameOf, emptyState, sectionHeader } from '../format.js';
import { cmd, send, paginate, pagerHtml, filterBar, applyFilter, refreshUI } from '../bridge.js';
import { formModal, confirmModal } from '../modal.js';
import { linkedOffscreen, linkedThreads } from '../../domain/offscreen.js';
import { threadAwaitsFill, offscreenAwaitsFill } from '../../domain/thread-catchup.js';
import { formatDate, spanLabel } from '../../domain/date-format.js';
import { parseClock, clockLabel } from '../../domain/clock.js';
import { checkThreadOffscreenSync } from '../../domain/continuity.js';
import { activeShape } from '../theme.js';
import { shapeOrnament } from '../ornament.js';


/**
 * Chronicle tab. Split into sub-views so it stops being a 6-deep heterogeneous
 * scroll: World (scene + arcs + threads), Memory, Knowledge, Secrets. One view
 * at a time via a sub-nav; each keeps its own filter/pager wiring. CRUD flows
 * through the bridge → vellum_cmd.
 */

type CView = 'world' | 'timeline' | 'turns' | 'beats' | 'timesync' | 'memory' | 'knowledge' | 'secrets' | 'scars' | 'codex' | 'items';
const VIEWS: Array<{ id: CView; label: string }> = [
  { id: 'world', label: 'World' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'turns', label: 'Turns' },
  { id: 'beats', label: 'Beats' },
  { id: 'timesync', label: 'Time Sync' },
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
// open plot-thread ids lagging the current narrative day, refilled every render of
// desyncInspector so the "catch-up all" mount handler can read them cheaply.
let _laggingIds: string[] = [];
let _laggingOffIds: string[] = [];
// expanded thread-card ids (World view). Session-only; cards start collapsed and
// expand to reveal beat history, meanwhile note, and controls.
const _threadExpanded = new Set<string>();
// expanded chapter-card ids (Memory view). Session-only; chapters start collapsed.
const _chapExpanded = new Set<string>();
// snapshot of open arcs refilled each render(), read by the arc-link click handler
// (which runs in mount(), where render() state `s` is not in scope).
let _arcSnapshot: Array<{ id: string; name: string; beats: string[] }> = [];

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
  version: (s) => `${_view}:${_tlKind}:${_tlDay}:${_pickMode}:${_pickTier}:${_pickAction}:${_picked.size}:${_threadExpanded.size}:${_beatSuggest.length}:${_turnLog.length}:${s.arcs.map((t) => t.id + t.status + t.name + '>' + t.beats.map((b) => b.replace(/\s+/g, '').length).join(',')).join(';')}:${s.threads.map((t) => t.id + t.status + t.name + '>' + t.beats.map((b) => b.replace(/\s+/g, '').length).join(',')).join(';')}:${s.memories.length}:${s.memories.filter((m) => m.tier === 'beat').map((m) => m.id + (m.ord ?? '') + (m.spine ? 's' : '')).join(',')}:${s.memories.filter((m) => m.tier !== 'beat').map((m) => m.id + (m.text ?? '').length + (m.detail ?? '').length).join(',')}:${s.knowledge.length}:${s.secrets.length}:${(s.scars ?? []).length}:${(s.lore ?? []).length}:${(s.items ?? []).length}:${s.turns}:${(s.offscreen ?? []).map((o) => o.id + o.status + o.beats.length + (o.thread ?? '')).join(',')}:${(s.parallel ?? []).length}:${s.knowledge.map((k) => k.reliability[0] + (k.truth === 'false' ? 'F' : '')).join('')}`,
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
      + '<span class="vle-subnav-g">Story</span>' + inGroup(['timeline', 'world', 'beats', 'turns', 'timesync'])
      + '<span class="vle-subnav-g">Records</span>' + inGroup(['memory', 'knowledge', 'secrets', 'scars', 'codex', 'items'])
      + '</div>';
    let body = '';
    if (_view === 'world') {
      _arcSnapshot = (s.arcs ?? []).filter((a) => !/resolv/i.test(a.status || '')).slice(0, 20).map((a) => ({ id: a.id, name: a.name, beats: a.beats }));
      body = establishingShot(s) + tracks('\u2746 Arcs', s.arcs, true, s) + tracks('\u269C Threads', s.threads, false, s) || '';
    }
    else if (_view === 'timeline') body = timeline(s);
    else if (_view === 'turns') body = turnsView(s);
    else if (_view === 'beats') body = beatsView(s);
    else if (_view === 'timesync') body = desyncInspector(s) || emptyState('All in sync.', 'When a time-skip leaves threads or off-screen subplots behind, they appear here with catch-up options.');
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
    // Keyboard: Enter/Space toggles a focused arc/thread leaf header (it carries
    // role="button" tabindex="0"). Click handling lives in the listener below.
    host.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      const lt = (e.target as HTMLElement).closest('[data-leaf-toggle]');
      if (!lt) return;
      e.preventDefault();
      const id = lt.getAttribute('data-leaf-toggle') || '';
      if (_threadExpanded.has(id)) _threadExpanded.delete(id); else _threadExpanded.add(id);
      refreshUI();
    });
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
      // --- plot threads / arcs (user CRUD) ---
      const tadd = t.closest('[data-track-add]');
      if (tadd) {
        const arc = tadd.getAttribute('data-arc') === '1';
        formModal(arc ? 'New Arc' : 'New Thread', [
          { key: 'name', label: arc ? 'Arc name' : 'Thread name', type: 'text', placeholder: arc ? 'The Long Reckoning' : 'The Letter' },
          { key: 'status', label: 'Status (optional)', type: 'text', placeholder: 'advance' },
        ], (o) => { if (o.name?.trim()) send({ type: 'vellum_thread_set', name: o.name, status: o.status || undefined, kindArc: arc }); });
        return;
      }
      const ted = t.closest('[data-track-edit]');
      if (ted) {
        const arc = ted.getAttribute('data-arc') === '1';
        formModal(arc ? 'Edit Arc' : 'Edit Thread', [
          { key: 'name', label: 'Name', type: 'text', value: ted.getAttribute('data-name') || '' },
          { key: 'status', label: 'Status', type: 'text', value: ted.getAttribute('data-status') || '' },
          { key: 'note', label: 'Add a beat (optional)', type: 'text', placeholder: 'what just happened' },
        ], (o) => { if (o.name?.trim()) send({ type: 'vellum_thread_set', id: ted.getAttribute('data-id'), name: o.name, status: o.status ?? '', note: o.note || undefined, kindArc: arc }); });
        return;
      }
      const tres = t.closest('[data-track-resolve]');
      if (tres) { send({ type: 'vellum_thread_set', id: tres.getAttribute('data-id'), name: tres.getAttribute('data-name'), status: 'resolved', kindArc: tres.getAttribute('data-arc') === '1' }); return; }
      const tro = t.closest('[data-track-reopen]');
      if (tro) { send({ type: 'vellum_thread_set', id: tro.getAttribute('data-id'), name: tro.getAttribute('data-name'), status: 'advance', kindArc: tro.getAttribute('data-arc') === '1' }); return; }
      const tdel = t.closest('[data-track-del]');
      if (tdel) { confirmModal('Delete this thread? (removes it from the board now; the model may re-raise it if the story keeps naming it)', () => send({ type: 'vellum_thread_drop', id: tdel.getAttribute('data-id'), kindArc: tdel.getAttribute('data-arc') === '1' })); return; }
      // arc<->thread bridge: unlink a thread from its arc (thread.set with arc='').
      // Shared by the thread-card UNLINK button and the arc-card per-thread chip.
      const tUnlink = t.closest('[data-thread-arc-unlink]');
      if (tUnlink) {
        const tid = tUnlink.getAttribute('data-id') || '';
        const tname = tUnlink.getAttribute('data-name') || '';
        formModal(`Unlink thread from its arc`, [
          { key: 'confirm', label: `Unlink “${tname.length > 30 ? tname.slice(0, 30) + '…' : tname}” from its arc? (the thread stays; only the link is removed)`, type: 'select', value: 'no', options: [{ value: 'no', label: 'Cancel' }, { value: 'yes', label: 'Unlink' }] },
        ], (o) => { if (o.confirm === 'yes') send({ type: 'vellum_thread_set', id: tid, name: tname, arc: '' }); });
        return;
      }
      // arc<->thread bridge: pick an arc to link a thread to (thread.set with arc=id).
      const tArcPick = t.closest('[data-thread-arc-pick]');
      if (tArcPick) {
        const tid = tArcPick.getAttribute('data-id') || '';
        const tname = tArcPick.getAttribute('data-name') || '';
        const opts = [{ value: '', label: '— cancel —' }, ..._arcSnapshot.map((a) => ({ value: a.id, label: `↳ ${a.name}${a.beats.length ? ' · ' + a.beats.length + ' beat' + (a.beats.length === 1 ? '' : 's') : ''}` }))];
        if (_arcSnapshot.length === 0) {
          // no open arcs yet — inline-create one rather than a dead-end: mirroring
          // the existing arc-add flow (kindArc: true) so a link is always possible.
          formModal('Link to a new arc', [
            { key: 'name', label: 'New arc name', type: 'text', placeholder: 'The Long Reckoning' },
          ], (o) => { if (o.name?.trim()) send({ type: 'vellum_thread_set', name: o.name.trim(), kindArc: true }); });
          return;
        }
        formModal(`Link “${tname.length > 40 ? tname.slice(0, 40) + '…' : tname}” to an arc`, [
          { key: 'arc', label: 'Parent arc', type: 'select', value: '', options: opts },
        ], (o) => { if (o.arc) send({ type: 'vellum_thread_set', id: tid, name: tname, arc: o.arc }); });
        return;
      }
      const dset = t.closest('[data-day-set]');
      if (dset) {
        const cur = dset.getAttribute('data-day') || '';
        formModal('Set narrative day', [
          { key: 'day', label: 'Day', type: 'number', min: 0, step: 1, value: cur },
        ], (o) => { if (o.day !== '' && o.day != null) send({ type: 'vellum_set_day', day: Number(o.day) }); });
        return;
      }
      const tcatch = t.closest('[data-thread-catchup]');
      if (tcatch) {
        const day = Number(tcatch.getAttribute('data-day'));
        send({ type: 'vellum_thread_catchup', id: tcatch.getAttribute('data-id'), ...(Number.isFinite(day) && day > 0 ? { day } : {}) });
        return;
      }
      const ocatch = t.closest('[data-offscreen-catchup]');
      if (ocatch) {
        const day = Number(ocatch.getAttribute('data-day'));
        send({ type: 'vellum_offscreen_catchup', id: ocatch.getAttribute('data-id'), ...(Number.isFinite(day) && day > 0 ? { day } : {}) });
        return;
      }
      const catchAll = t.closest('[data-catchup-all]');
      if (catchAll) {
        const day = Number(catchAll.getAttribute('data-day'));
        // unified catch-up: dispatch both thread and offscreen handlers with their
        // respective lagging id sets so everything catches up in one action.
        if (_laggingIds.length) send({ type: 'vellum_thread_catchup', ids: _laggingIds, ...(Number.isFinite(day) && day > 0 ? { day } : {}) });
        if (_laggingOffIds.length) send({ type: 'vellum_offscreen_catchup', ids: _laggingOffIds, ...(Number.isFinite(day) && day > 0 ? { day } : {}) });
        return;
      }
      // arc/thread leaf expand/collapse (World view). Placed AFTER the track
      // control handlers so clicking edit/resolve/delete/link doesn't toggle. Keys
      // are namespaced ('a:'/'t:') so an arc and thread sharing a slug stay distinct.
      const thToggle = t.closest('[data-leaf-toggle]');
      if (thToggle) {
        const id = thToggle.getAttribute('data-leaf-toggle') || '';
        if (_threadExpanded.has(id)) _threadExpanded.delete(id); else _threadExpanded.add(id);
        refreshUI();
        return;
      }
      // Chapter card toggle (Memory view)
      const chapToggle = t.closest('[data-chap-toggle]');
      if (chapToggle) {
        const id = chapToggle.getAttribute('data-chap-toggle') || '';
        if (_chapExpanded.has(id)) _chapExpanded.delete(id); else _chapExpanded.add(id);
        refreshUI();
        return;
      }
      const tcatchAll = t.closest('[data-thread-catchup-all]');
      if (tcatchAll) {
        const day = Number(tcatchAll.getAttribute('data-day'));
        send({ type: 'vellum_thread_catchup', ids: _laggingIds, ...(Number.isFinite(day) && day > 0 ? { day } : {}) });
        return;
      }
      // the desync advisory log toggle (collapsible findings)
      const logTog = t.closest('.vle-desync-log-toggle');
      if (logTog) {
        const body = logTog.parentElement?.querySelector('.vle-desync-log-body') as HTMLElement | null;
        if (body) { const open = !body.hidden; body.hidden = !open; logTog.setAttribute('aria-expanded', open ? 'true' : 'false'); }
        return;
      }
    });
  },
};

/** Establishing Shot hero header — cinematic scene presentation with day, time,
 * location, present cast, and tension at a glance. Replaces the old scene chip. */
function establishingShot(s: ChronicleState): string {
  const day = s.day || 0;
  const hasScene = s.scene.location || s.scene.tension;
  if (!hasScene && day <= 0 && !s.scene.time) return '';
  
  const dateStr = formatDate(day, s.dateFormat || 'day', s);
  const clock = s.scene.clock !== undefined ? s.scene.clock : parseClock(s.scene.time);
  const timeStr = s.scene.time?.trim() || (clock !== undefined ? clockLabel(clock) : '');
  const tension = Number(s.scene.tension) || 0;
  
  // day part label
  const dayPart = clock === undefined ? '' : 
    (clock >= 300 && clock < 720) ? 'Morning' :
    (clock >= 720 && clock < 1080) ? 'Afternoon' :
    (clock >= 1080 && clock < 1260) ? 'Evening' : 'Night';
  
  // "Set day" pencil, so a spurious high day can be walked back (was on the old NOW chip)
  const setBtn = `<button class="vle-hero-edit" data-day-set data-day="${day}" title="Correct the narrative day (fixes a spurious high day)" aria-label="Set day">\u270E</button>`;
  
  const kicker = '<div class="vle-hero-kicker">'
    + (day > 0 ? `<span>Now</span><span class="vle-hero-sep">\u00B7</span><span>${esc(dateStr)}</span>` : '<span>Now</span>')
    + (dayPart ? `<span class="vle-hero-sep">\u00B7</span><span>${dayPart}</span>` : '')
    + (timeStr ? `<span class="vle-hero-sep">\u00B7</span><span>${esc(timeStr)}</span>` : '')
    + setBtn
    + '</div>';
  
  const location = s.scene.location || 'Unknown Location';
  const title = `<h3 class="vle-hero-title">${esc(location)}</h3>`;
  
  // present cast with character colors — color the names directly
  const present = s.scene.present?.length
    ? `<div class="vle-hero-meta"><span class="vle-hero-label">Present:</span> <span class="vle-hero-val">${s.scene.present.map((id) => {
        const cast = s.cast[id];
        const name = esc(nameOf(s, id));
        const color = cast?.color;
        return color ? `<span class="vle-hero-cast-name" style="color:${esc(color)}">${name}</span>` : name;
      }).join(', ')}</span></div>`
    : '';
  
  // tension
  const tensionEl = tension > 0
    ? `<div class="vle-hero-meta"><span class="vle-hero-label">Tension:</span> <span class="vle-hero-val vle-hero-tension${tension >= 8 ? ' hot' : tension >= 5 ? ' warm' : ''}">${tension}</span></div>`
    : '';
  
  const meta = (present || tensionEl) ? `<div class="vle-hero-metas">${present}${tensionEl}</div>` : '';
  
  return `<div class="vle-hero">${kicker}${title}${meta}</div>`;
}

function scene(s: ChronicleState): string {
  if (!s.scene.location && !s.scene.tension) return '';
  const tension = Number(s.scene.tension) || 0;
  // tension as a 10-pip gauge (filled to level) so it reads at a glance, plus the
  // number for precision. Level tints the banner accent (calm -> charged).
  const lvl = tension >= 8 ? ' hot' : tension >= 5 ? ' warm' : '';
  const gauge = s.scene.tension
    ? '<span class="vle-scene-gauge' + lvl + '" title="scene tension ' + esc(s.scene.tension) + '/10">'
      + Array.from({ length: 10 }, (_, i) => `<i${i < tension ? ' class="on"' : ''}></i>`).join('')
      + '<b>' + esc(s.scene.tension) + '</b></span>'
    : '';
  return '<div class="vle-scene' + lvl + '">'
    + '<span class="vle-scene-pin" aria-hidden="true">\u25C9</span>'
    + '<span class="vle-scene-loc">' + esc(s.scene.location || '\u2014') + '</span>'
    + gauge + '</div>';
}

/** NOW chip — the authoritative day + time-of-day, so the current clock is
 * visible at a glance (mirrors the recall NOW line). Empty when there's no day
 * or scene yet. A "Set day" action lets the user walk back a spurious high day. */
function nowChip(s: ChronicleState): string {
  const day = s.day || 0;
  if (day <= 0 && !s.scene.location && !s.scene.time) return '';
  const dateStr = formatDate(day, s.dateFormat || 'day', s);
  const clock = s.scene.clock !== undefined ? s.scene.clock : parseClock(s.scene.time);
  const timeStr = s.scene.time?.trim() || (clock !== undefined ? clockLabel(clock) : '');
  // a dusk/night/dawn glyph tints the plate to the time of day (falls back to a clock)
  const daySlot = clock !== undefined && (clock >= 300 && clock < 1080);
  const glyph = clock === undefined ? '\u25F7' : (clock >= 300 && clock < 1080 ? '\u2600' : (clock >= 1080 && clock < 1260 ? '\u263D' : '\u2605'));
  const setBtn = `<button class="vle-now-edit" data-day-set data-day="${day}" title="Correct the narrative day (fixes a spurious high day)" aria-label="Set day">\u270E</button>`;
  return `<div class="vle-now${daySlot ? ' day' : ''}">`
    + `<span class="vle-now-ico" aria-hidden="true">${glyph}</span>`
    + `<span class="vle-now-day">${esc(dateStr)}</span>`
    + (timeStr ? `<span class="vle-now-sep" aria-hidden="true"></span><span class="vle-now-time">${esc(timeStr)}</span>` : '')
    + setBtn
    + '</div>';
}

/** Desync inspector — surfaces every open thread AND off-screen subplot's narrative
 * day vs the sim's current day, each with a "catch up" or "write beat" button, plus
 * a unified "generate missed beats" action that catches up everything in one pass.
 * The checkThreadOffscreenSync advisories render as a collapsible log beneath. Empty
 * when everything is in sync. Threads and subplots are listed together so the user
 * can author all lagging content at once. */
function desyncInspector(s: ChronicleState): string {
  const nowDay = s.day || 0;
  if (nowDay <= 0) return '';
  const isOpen = (t: { status: string }): boolean => !/resolv/i.test(t.status || '');
  // Threads needing attention: lag OR carry an unfilled marker.
  const threadRows = s.threads.filter(isOpen).map((t) => {
    const lag = t.lastDay !== undefined && t.lastDay < nowDay ? nowDay - t.lastDay : 0;
    const awaits = threadAwaitsFill(t);
    return { kind: 'thread' as const, id: t.id, name: t.name, lastDay: t.lastDay, lag, awaits };
  }).filter((r) => r.lag > 0 || r.awaits);
  // Off-screen subplots needing attention: lag OR carry an unfilled marker.
  const offRows = (s.offscreen ?? []).filter((o) => o.status === 'active').map((o) => {
    const lag = o.lastDay !== undefined && o.lastDay < nowDay ? nowDay - o.lastDay : 0;
    const awaits = offscreenAwaitsFill(o);
    const anchor = [o.who ? (s.cast[o.who]?.name ?? o.who) : '', o.where ? `@${o.where}` : ''].filter(Boolean).join(' ');
    return { kind: 'offscreen' as const, id: o.id, name: o.name, anchor, lastDay: o.lastDay, lag, awaits };
  }).filter((r) => r.lag > 0 || r.awaits);
  const rowsData = [...threadRows, ...offRows].sort((a, b) => (b.lag - a.lag) || (Number(b.awaits) - Number(a.awaits)));
  const findings = checkThreadOffscreenSync(s);
  _laggingIds = threadRows.map((r) => r.id);
  _laggingOffIds = offRows.map((r) => r.id);
  if (!rowsData.length && !findings.length) return '';
  const rows = rowsData.map((r) => {
    const span = r.lag > 0 ? spanLabel(r.lag) : '';
    const state = r.awaits && r.lag <= 0
      ? `<span class="vle-desync-lag await" title="Day stamped forward, but no beat written for the gap yet">needs a beat</span>`
      : `<span class="vle-desync-lag">~${esc(span)} behind</span>`;
    const label = r.kind === 'thread' ? r.name : `${r.name}${r.anchor ? ` (${r.anchor})` : ''}`;
    const attr = r.kind === 'thread' ? 'data-thread-catchup' : 'data-offscreen-catchup';
    const title = r.awaits && r.lag <= 0
      ? `Write the missed beat for this ${r.kind === 'thread' ? 'thread' : 'subplot'}\u2019s gap`
      : `Catch this ${r.kind === 'thread' ? 'thread' : 'subplot'} up to day ${nowDay} and write the missed beat`;
    const btnLabel = r.awaits && r.lag <= 0 ? 'write beat' : `catch up \u2192 d${nowDay}`;
    return `<div class="vle-desync-row">`
      + `<span class="vle-desync-n">${esc(label)}</span>`
      + `<span class="vle-desync-from">d${esc(r.lastDay ?? '?')}</span>`
      + `<span class="vle-desync-arrow" aria-hidden="true">\u2192</span>`
      + state
      + `<button class="vle-desync-catch" ${attr} data-id="${esc(r.id)}" data-day="${nowDay}" title="${esc(title)}">${esc(btnLabel)}</button>`
      + `</div>`;
  }).join('');
  const findingsId = 'dsync-f-' + Math.random().toString(36).slice(2, 7);
  const notes = findings.length
    ? `<div class="vle-desync-log">`
      + `<button class="vle-desync-log-toggle" data-desync-log-toggle aria-expanded="false" aria-controls="${findingsId}">\u26A0 <span class="vle-desync-log-count">${findings.length}</span> desync advisory${findings.length === 1 ? '' : 'ies'}<span class="vle-desync-log-chev" aria-hidden="true">\u25BE</span></button>`
      + `<div class="vle-desync-log-body" data-desync-log-body id="${findingsId}" hidden>${findings.map((w) => `<div class="vle-desync-note">${esc(w.text)}</div>`).join('')}</div>`
      + `</div>`
    : '';
  // The unified "generate missed beats" button catches up BOTH threads and subplots
  // in one action. It persists while anything lags or awaits authoring.
  const allBtn = rowsData.length
    ? `<button class="vle-desync-all" data-catchup-all data-day="${nowDay}" title="Catch up all ${rowsData.length} thread(s) and subplot(s), writing their missed beats grounded in this story\u2019s canon">\u26A1 generate missed beats</button>`
    : '';
  const intro = rows
    ? `<div class="vle-cz-note">A time-skip left these plot threads and off-screen subplots behind. Generating writes the beat that most plausibly happened over each gap \u2014 grounded strictly in this story\u2019s established canon (no details imported from source material), then stamps them to day ${nowDay}.</div>`
    : '';
  return sectionHeader('⦖ Time Sync', { sub: true, count: rowsData.length, action: allBtn })
    + (rows ? `<div class="vle-desync">${rows}</div>${intro}` : '')
    + notes;
}

/** Classify a track's free-text status into a pill style + label. Resolved wins;
 * a handful of "charged" keywords read as crimson (hot); everything else is the
 * calm open/active tint. Shared by arcs and threads so status reads consistently. */
function statusPill(status: string, kindArc: boolean): { cls: 'open' | 'hot' | 'done'; label: string } {
  if (/resolv/i.test(status || '')) return { cls: 'done', label: 'resolved' };
  const hot = /escalat|rising|climax|crisis|war|siege|hunt|burn|break|clash|blood/i.test(status || '');
  const label = status && !/^(advance|new)$/i.test(status) ? status : (kindArc ? 'open' : 'active');
  return { cls: hot ? 'hot' : 'open', label };
}

/** Inline vertical beat rail — oldest to newest, the last beat lit as "latest".
 * When an arc/thread has many beats the earliest collapse behind a details toggle
 * so the rail stays scannable. */
function beatRail(beats: string[]): string {
  if (!beats.length) return '<div class="vle-leaf-empty">No beats yet.</div>';
  const row = (b: string, i: number): string => {
    const latest = i === beats.length - 1;
    return `<div class="vle-leaf-beat${latest ? ' latest' : ''}"><span class="vle-leaf-node"></span>`
      + (latest ? '<div class="vle-leaf-bmeta">latest</div>' : '')
      + `<div class="vle-leaf-btxt">${esc(b)}</div></div>`;
  };
  const rows = beats.map(row);
  if (beats.length > 3) {
    const cut = beats.length - 2;
    const earlier = rows.slice(0, cut).join('');
    const recent = rows.slice(cut).join('');
    return `<div class="vle-leaf-rail"><details><summary class="vle-leaf-more">show ${cut} earlier beat${cut === 1 ? '' : 's'}</summary>${earlier}</details>${recent}</div>`;
  }
  return `<div class="vle-leaf-rail">${rows.join('')}</div>`;
}

/** Arcs and threads, rendered as the same collapsible "illuminated leaf" card
 * (Layout A of the redesign). A header that toggles shows the title, a one-line
 * gist when collapsed, a beat-count pill (arcs) and a status pill; expanding
 * reveals the inline beat rail, a "meanwhile" off-screen note, owned-thread chips
 * (arcs), and the CRUD actions. Threads are the lesser tier: smaller title,
 * thinner rail, and an arc-link kicker in place of the beat-count pill. */
function tracks(title: string, list: ChronicleState['arcs'], kindArc: boolean, s: ChronicleState): string {
  const arc = kindArc ? '1' : '0';
  const addBtn = `<button class="vle-add sm" data-track-add data-arc="${arc}" title="Add ${kindArc ? 'an arc' : 'a thread'}">+</button>`;
  const A = (x: unknown): string => esc(x);
  // Expanded-card ids are namespaced ('a:'/'t:') so an arc and a thread that share
  // a slug id never toggle each other.
  const prefix = kindArc ? 'a:' : 't:';

  const sorted = list.slice().sort(byRecent).slice(0, kindArc ? 24 : 12);
  // Auto-expand a lone entry so the section opens with content on first render.
  const anyOpen = list.some((t) => _threadExpanded.has(prefix + t.id));
  if (!anyOpen && sorted.length === 1 && sorted[0]) _threadExpanded.add(prefix + sorted[0].id);

  const cards = sorted.map((t) => {
    const key = prefix + t.id;
    const expanded = _threadExpanded.has(key);
    const resolved = /resolv/i.test(t.status || '');
    const sp = statusPill(t.status, kindArc);
    const latestBeat = t.beats[t.beats.length - 1] || '';

    // Parent arc: an EXPLICIT arc<->thread link (threads only).
    const parentArc = !kindArc && t.arc ? s.arcs.find((a) => a.id === t.arc) : undefined;

    // Kicker (threads only): the parent-arc link, or "Thread" when unlinked.
    const kicker = kindArc ? ''
      : `<div class="vle-leaf-kicker${parentArc ? ' arclink' : ''}">${parentArc ? '\u21B3 ' + esc(parentArc.name) : 'Thread'}</div>`;

    // Cluster: arcs carry a beat-count pill only. No status badge on either tier —
    // the model often emits long prose into status; a resolved track is conveyed by
    // the dimmed card + the Reopen action instead. (sp still drives the hot tint.)
    const beatsPill = kindArc ? `<span class="vle-leaf-beats" title="${t.beats.length} beat${t.beats.length === 1 ? '' : 's'}">${t.beats.length}</span>` : '';
    const cluster = kindArc ? `<div class="vle-leaf-cluster">${beatsPill}</div>` : '';

    const chev = `<span class="vle-leaf-chev" aria-hidden="true">${expanded ? '\u25BC' : '\u25B6'}</span>`;
    const sub = !expanded && latestBeat ? `<div class="vle-leaf-sub">${esc(latestBeat)}</div>` : '';
    const header = `<div class="vle-leaf-head" data-leaf-toggle="${A(key)}" role="button" tabindex="0" aria-expanded="${expanded}">`
      + chev
      + `<div class="vle-leaf-tw">${kicker}<div class="vle-leaf-title">${esc(t.name)}</div>${sub}</div>`
      + cluster
      + '</div>';

    let body = '';
    if (expanded) {
      const rail = beatRail(t.beats);

      // Meanwhile note (off-screen reflection linked to this track).
      const off = linkedOffscreen(s, { id: t.id, name: t.name });
      const offNote = off.length && off[0]
        ? `<div class="vle-leaf-meanwhile"><div class="vle-leaf-mw-label">Meanwhile</div><div class="vle-leaf-mw-text">${esc(off[0].gist || off[0].beats[off[0].beats.length - 1] || '')} \u2192 ${esc(off[0].status || 'advancing')}</div></div>`
        : '';

      // Owned-thread chips (arcs only): explicit links win over soft name-matches.
      let chips = '';
      if (kindArc) {
        const owned = linkedThreads(s, t);
        if (owned.length) {
          chips = `<div class="vle-leaf-chips">${owned.slice(0, 8).map((th) => `<span class="vle-leaf-chip"><span class="vle-leaf-chip-lead" aria-hidden="true">\u21B3</span>${esc(th.name.length > 28 ? th.name.slice(0, 28) + '\u2026' : th.name)}<button class="vle-leaf-chip-x" data-thread-arc-unlink data-id="${A(th.id)}" data-name="${A(th.name)}" title="Unlink">\u00d7</button></span>`).join('')}${owned.length > 8 ? `<span class="vle-leaf-chip more">+${owned.length - 8}</span>` : ''}</div>`;
        }
      }

      // Actions. Threads additionally get a link/unlink-arc control.
      const editBtn = `<button class="vle-btn vle-btn--secondary" data-track-edit data-id="${A(t.id)}" data-arc="${arc}" data-name="${A(t.name)}" data-status="${A(t.status)}" title="Edit">Edit</button>`;
      const stBtn = resolved
        ? `<button class="vle-btn vle-btn--secondary" data-track-reopen data-id="${A(t.id)}" data-arc="${arc}" data-name="${A(t.name)}" title="Reopen">Reopen</button>`
        : `<button class="vle-btn vle-btn--secondary" data-track-resolve data-id="${A(t.id)}" data-arc="${arc}" data-name="${A(t.name)}" title="Resolve">Resolve</button>`;
      const delBtn = `<button class="vle-btn vle-btn--danger" data-track-del data-id="${A(t.id)}" data-arc="${arc}" title="Delete">Delete</button>`;
      let arcCtl = '';
      if (!kindArc) {
        arcCtl = parentArc
          ? `<button class="vle-btn vle-btn--secondary" data-thread-arc-unlink data-id="${A(t.id)}" data-name="${A(t.name)}" title="Unlink from arc ${esc(parentArc.name)}">\u21B3 ${esc(parentArc.name)} \u2715</button>`
          : `<button class="vle-btn vle-btn--secondary" data-thread-arc-pick data-id="${A(t.id)}" data-name="${A(t.name)}" title="Link to an arc">Link arc</button>`;
      }
      const actions = `<div class="vle-leaf-actions">${arcCtl}${editBtn}${stBtn}${delBtn}</div>`;

      body = `<div class="vle-leaf-body"><div class="vle-leaf-rule"></div>${rail}${offNote}${chips}${actions}</div>`;
    }

    const cls = ['vle-leaf', kindArc ? 'is-arc' : 'is-thread', sp.cls === 'hot' ? 'hot' : '', resolved ? 'done' : '', expanded ? 'open' : 'closed'].filter(Boolean).join(' ');
    return `<div class="${cls}">${header}${body}</div>`;
  }).join('');

  const body = cards
    ? `<div class="vle-leaf-list${kindArc ? ' arcs' : ' threads'}">${cards}</div>`
    : emptyState(kindArc ? 'No arcs yet.' : 'No threads yet.', 'They fill in as the story unfolds; add one by hand too.');
  return sectionHeader(title, { sub: true, count: list.length, action: addBtn }) + body;
}

/** Off-screen subplots (the sim) + any model-narrated meanwhile lines, so all
 * off-stage life is visible in one place in the World view. */

/**
 * Timeline — a vertical rail keyed on the reliable TURN axis, with model-emitted
 * `day` labels overlaid where present (day is sparse, so it's a label, never the
 * spine). Arc/chapter summaries render as covers-spans; their turn ranges place
 * them on the rail. Pure view over existing state — no schema change.
 */
function timeline(s: ChronicleState): string {
  const head = sectionHeader('\u2637 Timeline', { sub: true, count: s.memories.length });
  // collect dated entries: arcs+chapters (by covers end), knowledge/secrets/journal (by turn)
  type Row = { turn: number; day?: number; min?: number; kind: string; group: string; text: string; span?: [number, number] };
  const rows: Row[] = [];
  for (const m of s.memories) {
    if (m.tier === 'turn') continue; // turn-notes are noise on the timeline
    if (m.tier === 'beat') { const mn = parseClock(m.beatTime); rows.push({ turn: m.turn, ...(m.beatDay !== undefined ? { day: m.beatDay } : {}), ...(mn !== undefined ? { min: mn } : {}), kind: 'beat', group: 'beat', text: m.text }); continue; }
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
  // newest first; when two rows share a day, order by time-of-day minutes so
  // same-day beats sort by their clock, falling back to turn when times are equal.
  shown = shown.slice().sort((a, b) => {
    if (a.day !== undefined && b.day !== undefined && a.day !== b.day) return b.day - a.day;
    if (a.min !== undefined && b.min !== undefined && a.min !== b.min) return b.min - a.min;
    return b.turn - a.turn;
  });
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
      // spine beats sit centered ON the rail as a filled square node with a glow
      parts.push(`<div class="vle-spine-beat vle-spine-beat--sq v-orn--glow"><span class="vle-spine-beat-k">\u2691 beat</span><span class="vle-spine-beat-x">${esc(r.text)}</span></div>`);
      continue;
    }
    const s2 = side++ % 2 === 0 ? 'l' : 'r';
    parts.push(`<div class="vle-spine-row vle-spine-${s2}"><span class="vle-spine-node vle-spine-node--${esc(r.kind)}"></span><div class="vle-spine-card vle-spine-${esc(r.kind)}">`
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
    ? '<div class="vle-beat-sug-h"><span class="vle-beat-sug-lbl">Suggested:</span><div class="vle-beat-sug-row">' + _beatSuggest.slice(0, 12).map((x, i) => `<button class="vle-beat-sug-chip" data-beat-accept="${i}" title="Add as a beat: ${esc(x.text)}">+ ${esc((x.day ? formatDate(x.day, s.dateFormat || 'day', s) + ' ' : '') + x.text).slice(0, 48)}</button>`).join('') + '</div></div>'
    : '';
  if (!list.length) return head + intro + sug + emptyState('No beats yet.', 'Mark a landmark: a duel, a betrayal, a vow. Or hit \u2728 suggest to pull candidates from what already happened.');
  const rows = list.map((m, i) => {
    const anchor = (m.beatDay !== undefined ? formatDate(m.beatDay, s.dateFormat || 'day', s) : '') + (m.beatTime ? (m.beatDay !== undefined ? ', ' : '') + m.beatTime : '');
    const spine = m.spine ? '<span class="vle-mem-tier t-beat" title="On the always-injected spine">\u2691</span>' : '<span class="vle-mem-tier" title="Recalled by relevance only" style="opacity:.5">\u25CB</span>';
    const up = `<button class="vle-mini" data-beat-move data-id="${esc(m.id)}" data-dir="up"${i === 0 ? ' disabled' : ''} title="Move earlier">\u25B4</button>`;
    const down = `<button class="vle-mini" data-beat-move data-id="${esc(m.id)}" data-dir="down"${i === list.length - 1 ? ' disabled' : ''} title="Move later">\u25BE</button>`;
    const edit = `<button class="vle-mini" data-beat-edit data-id="${esc(m.id)}" data-text="${esc(m.text)}" data-day="${m.beatDay ?? ''}" data-time="${esc(m.beatTime ?? '')}" data-spine="${m.spine ? '1' : '0'}" title="Edit">\u270E</button>`;
    return '<div class="vle-mem vle-mem--beat">' + shapeOrnament(activeShape('beats'), 'beats') + spine
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
  
  // Pick mode uses flat paginated list (preserve existing behavior)
  if (_pickMode) {
    const { slice, page, pages } = paginate('memories', filtered);
    const rows = slice.map((m: Memory) => {
      const isTurn = m.tier === 'turn';
      const shown = isTurn ? oneLine(m.text) : m.text;
      const titleAttr = isTurn ? ` title="${esc(m.text).slice(0, 1000)}"` : '';
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
  
  // Normal mode: layered arc/chapter/turn view
  const arcs = filtered.filter((m) => m.tier === 'arc');
  const chapters = filtered.filter((m) => m.tier === 'chapter');
  const turns = filtered.filter((m) => m.tier === 'turn');
  
  // Build set of turn ids that are subsumed by any chapter
  const subsumedTurnIds = new Set<string>();
  for (const chap of s.memories.filter((m) => m.tier === 'chapter')) {
    if (chap.subsumed) for (const sub of chap.subsumed) subsumedTurnIds.add(sub.id);
  }
  const uncoveredTurns = turns.filter((t) => !subsumedTurnIds.has(t.id));
  
  const arcHtml = arcs.map((m) => {
    const isDone = m.covers && m.covers[1] < s.turns - 10;
    const chapsInArc = (m.subsumed ?? []).filter((sub) => sub.tier === 'chapter').length;
    return '<div class="vle-m-arc' + (isDone ? ' done' : '') + '">'
      + '<div class="vle-m-arc-bar"></div>'
      + '<div class="vle-m-arc-body">'
      + '<div class="vle-m-arc-head">'
      + '<span class="vle-m-arc-tier">arc</span>'
      + '<span class="vle-m-arc-span">' + (m.covers ? 'T' + m.covers[0] + '\u2013' + m.covers[1] : 't' + m.turn) + '</span>'
      + '</div>'
      + '<div class="vle-m-arc-text">' + esc(m.text) + '</div>'
      + '<div class="vle-m-arc-foot">'
      + '<span class="vle-m-arc-covers">covers ' + chapsInArc + ' chapter' + (chapsInArc === 1 ? '' : 's') + '</span>'
      + '<span class="vle-mem-ctl">'
      + `<button class="vle-mini" data-mem-edit data-id="${esc(m.id)}" data-text="${esc(m.text)}" data-detail="${esc(m.detail ?? '')}" title="Edit">\u270E</button>`
      + `<button class="vle-mini del" data-mem-del data-id="${esc(m.id)}" title="Delete">\u2715</button>`
      + '</span>'
      + '</div>'
      + '</div>'
      + '</div>';
  }).join('');
  
  const chapHtml = chapters.map((m) => {
    const isOpen = _chapExpanded.has(m.id);
    const sourceCount = m.subsumed?.length ?? 0;
    return '<div class="vle-m-chap ' + (isOpen ? 'open' : 'closed') + '" data-chap-id="' + esc(m.id) + '">'
      + '<div class="vle-m-chap-head" data-chap-toggle="' + esc(m.id) + '">'
      + '<span class="vle-m-chap-chev">\u25B6</span>'
      + '<div class="vle-m-chap-tw">'
      + '<span class="vle-m-chap-tier">chapter</span>'
      + '<span class="vle-m-chap-title">' + esc(isOpen ? m.text : oneLine(m.text, 80)) + '</span>'
      + '</div>'
      + '<span class="vle-m-chap-span">' + (m.covers ? 'T' + m.covers[0] + '\u2013' + m.covers[1] : 't' + m.turn) + '</span>'
      + '<span class="vle-mem-ctl">'
      + `<button class="vle-mini" data-mem-edit data-id="${esc(m.id)}" data-text="${esc(m.text)}" data-detail="${esc(m.detail ?? '')}" title="Edit">\u270E</button>`
      + `<button class="vle-mini del" data-mem-del data-id="${esc(m.id)}" title="Delete">\u2715</button>`
      + '</span>'
      + '</div>'
      + '<div class="vle-m-chap-body">'
      + '<div class="vle-m-chap-text">' + esc(m.text) + '</div>'
      + '<div class="vle-m-chap-turns">'
      + '<div class="vle-m-chap-turns-label">\u25BE ' + sourceCount + ' source turn' + (sourceCount === 1 ? '' : 's') + '</div>'
      + '<div class="vle-m-chap-turn-list">'
      + (sourceCount > 0
        ? m.subsumed!.map((sub) => '<div class="vle-m-turn-chip">t' + sub.turn + ' \u00b7 ' + esc(oneLine(sub.text, 80)) + '</div>').join('')
        : '<div class="vle-m-turn-chip">no source turns recorded</div>')
      + '</div>'
      + '</div>'
      + '</div>'
      + '</div>';
  }).join('');
  
  const turnHtml = uncoveredTurns.length > 0
    ? '<div class="vle-m-turns-label">uncovered turns <span style="color:var(--vle-gold-dim)">(' + uncoveredTurns.length + ')</span></div>'
      + '<div class="vle-m-turns-grid">'
      + uncoveredTurns.sort((a, b) => b.turn - a.turn).map((m) =>
        '<div class="vle-m-turn-raw">'
        + '<span class="vle-m-turn-raw-t">t' + m.turn + '</span>'
        + '<span class="vle-m-turn-raw-x">' + esc(oneLine(m.text)) + '</span>'
        + '<span class="vle-mem-ctl">'
        + `<button class="vle-mini" data-mem-edit data-id="${esc(m.id)}" data-text="${esc(m.text)}" data-detail="${esc(m.detail ?? '')}" title="Edit">\u270E</button>`
        + `<button class="vle-mini del" data-mem-del data-id="${esc(m.id)}" title="Delete">\u2715</button>`
        + '</span>'
        + '</div>'
      ).join('')
      + '</div>'
    : '';
  
  if (!filtered.length) return head + bar + emptyState('No memories match this filter.');
  return head + bar + arcHtml + (chapHtml ? '<div style="height:0.8rem"></div>' + chapHtml : '') + turnHtml;
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
  
  // Keep filter bar for pagination/filtering support
  const whos = Array.from(new Set(s.knowledge.map((k) => k.who))).map((id) => ({ id, name: nameOf(s, id) }));
  const whoCounts: Record<string, number> = {};
  for (const k of s.knowledge) whoCounts[k.who] = (whoCounts[k.who] ?? 0) + 1;
  const bar = filterBar('knowledge', { whos, whoCounts });
  const filtered = applyFilter('knowledge', s.knowledge, { who: (k) => k.who });
  const { slice, page, pages } = paginate('knowledge', filtered);
  
  // Group paginated slice by character
  const groups = new Map<string, typeof slice>();
  for (const k of slice) {
    (groups.get(k.who) ?? groups.set(k.who, []).get(k.who)!).push(k);
  }
  
  // Sort groups by character name
  const whoIds = [...groups.keys()].sort((a, b) => nameOf(s, a).localeCompare(nameOf(s, b)));
  
  const cards = whoIds.map((who) => {
    const facts = groups.get(who)!;
    const rows = facts.map((k) => {
      const isFalse = k.truth === 'false';
      const relIcon = k.reliability === 'knows' ? '\u00B7' : k.reliability === 'believes' ? '\u25C6' : k.reliability === 'suspects' ? '\u203A' : '\u2715';
      const rowClass = isFalse ? 'irony' : k.reliability === 'believes' ? 'believes' : k.reliability === 'suspects' ? 'suspects' : '';
      const relClass = isFalse ? 'irony' : k.reliability;
      return '<div class="vle-k-row ' + rowClass + '">'
        + '<span class="vle-k-rel vle-k-rel-' + relClass + '">' + relIcon + '</span>'
        + '<span class="vle-k-fact">'
        + (isFalse ? '<span class="vle-k-irony-label">\u26A0 false</span>' : '')
        + esc(k.fact)
        + '</span>'
        + (k.about ? '<span class="vle-k-about">re: ' + esc(nameOf(s, k.about)) + '</span>' : '')
        + `<button class="vle-mini del" data-know-del data-id="${esc(k.id)}" title="Delete">\u2715</button>`
        + '</div>';
    }).join('');
    return '<div class="vle-k-card">'
      + '<div class="vle-k-card-head">'
      + '<span class="vle-k-card-name">' + esc(nameOf(s, who)) + '</span>'
      + '<span class="vle-k-card-count">' + facts.length + ' fact' + (facts.length === 1 ? '' : 's') + '</span>'
      + '</div>'
      + '<div class="vle-k-rows">' + rows + '</div>'
      + '</div>';
  }).join('');
  
  if (!slice.length) return head + bar + emptyState('No knowledge matches this filter.');
  return head + bar + cards + pagerHtml('knowledge', page, pages);
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
  
  // Helper: derive danger level from heuristics (no schema field yet)
  const secretDanger = (sec: typeof slice[0]): 'minor' | 'major' | 'explosive' => {
    if (sec.text.length > 180 || sec.from.length >= 3) return 'explosive';
    if (sec.from.length >= 2 || sec.text.length > 80) return 'major';
    return 'minor';
  };
  
  const cards = slice.map((sec) => {
    const danger = secretDanger(sec);
    const dangerClass = sec.revealed ? 'revealed ' + danger : danger;
    return '<div class="vle-sec-card ' + dangerClass + '">'
      + '<div class="vle-sec-danger-bar"></div>'
      + '<div class="vle-sec-body">'
      + (sec.revealed ? '<div class="vle-sec-watermark">REVEALED</div>' : '')
      + '<div class="vle-sec-head-row">'
      + '<span class="vle-sec-keeper">' + esc(nameOf(s, sec.keeper)) + '</span>'
      + '<span class="vle-sec-danger ' + danger + '">' + danger + '</span>'
      + '<span class="vle-sec-from-label">' + (sec.revealed ? 'was hidden from' : 'hidden from') + '</span>'
      + sec.from.map((f) => '<span class="vle-sec-from-chip">' + esc(nameOf(s, f)) + '</span>').join('')
      + '</div>'
      + '<div class="vle-sec-text">' + esc(sec.text) + '</div>'
      + '<div class="vle-sec-foot">'
      + '<span class="vle-sec-turn">formed t' + sec.formedTurn + (sec.revealed ? ' \u00b7 revealed' : '') + '</span>'
      + '<span class="vle-mem-ctl">'
      + (sec.revealed ? '' : `<button class="vle-mini" data-sec-reveal data-id="${esc(sec.id)}" title="Reveal">\u25D0</button>`)
      + `<button class="vle-mini del" data-sec-del data-id="${esc(sec.id)}" title="Delete">\u2715</button>`
      + '</span>'
      + '</div>'
      + '</div>'
      + '</div>';
  }).join('');
  
  if (!slice.length) return head + bar + emptyState('No secrets match this filter.');
  return head + bar + cards + pagerHtml('secrets', page, pages);
}

/** Palimpsest scars — beliefs once held, proven wrong, kept as a mark. The
 * superseded belief renders struck through; grouped by holder via the filter. */
function scars(s: ChronicleState): string {
  const list = s.scars ?? [];
  const head = sectionHeader('\u2620 Scars', { sub: true, count: list.length, action: '<button class="vle-add sm" data-scar-add>+</button>' });
  if (!list.length) return head + emptyState('No scars yet.', 'When a belief is proven wrong, the old belief is kept here \u2014 it resurfaces under stress as doubt.');
  
  // Group by character (who holds the scar)
  const groups = new Map<string, typeof list>();
  for (const x of list) {
    (groups.get(x.who) ?? groups.set(x.who, []).get(x.who)!).push(x);
  }
  
  // Sort groups by character name
  const whos = [...groups.keys()].sort((a, b) => nameOf(s, a).localeCompare(nameOf(s, b)));
  
  const body = whos.map((who) => {
    const scarsForWho = groups.get(who)!.sort((a, b) => b.turn - a.turn);
    const cards = scarsForWho.map((x) =>
      '<div class="vle-scar-card">'
      + '<div class="vle-scar-head">'
      + '<span class="vle-scar-turn">overturned t' + x.turn + '</span>'
      + `<button class="vle-mini del" data-scar-del data-id="${esc(x.id)}" title="Delete" style="margin-left:auto">\u2715</button>`
      + '</div>'
      + '<div class="vle-scar-was">'
      + esc(x.was)
      + (x.about ? '<span class="vle-scar-about">about: ' + esc(nameOf(s, x.about)) + '</span>' : '')
      + '</div>'
      + '<div class="vle-scar-divider"></div>'
      + '<div class="vle-scar-now">'
      + '<span class="vle-scar-now-label">proved wrong</span>'
      + 'Belief overturned.'
      + '</div>'
      + '</div>'
    ).join('');
    return '<div class="vle-scar-group">'
      + '<div class="vle-scar-group-head">' + esc(nameOf(s, who)) + '</div>'
      + cards
      + '</div>';
  }).join('');
  
  return head + body;
}

/** Codex \u2014 minted canon (facts true of the world, not a character's belief). */
function codex(s: ChronicleState): string {
  const list = s.lore ?? [];
  const head = sectionHeader('\u2756 Codex', { sub: true, count: list.length, action: '<button class="vle-add sm" data-lore-add>+</button>' });
  if (!list.length) return head + emptyState('The Codex is empty.', 'World-facts the engine establishes (custom, geography, history) are recorded here as canon.');
  
  // Group by tag ('canon' is the default/fallback tag)
  const groups = new Map<string, typeof list>();
  for (const x of list) {
    const tag = x.tag || 'canon';
    (groups.get(tag) ?? groups.set(tag, []).get(tag)!).push(x);
  }
  
  // Sort groups: alphabetical, 'canon' last
  const tags = [...groups.keys()].sort((a, b) => {
    if (a === 'canon') return 1;
    if (b === 'canon') return -1;
    return a.localeCompare(b);
  });
  
  const body = tags.map((tag) => {
    const entries = groups.get(tag)!.sort((a, b) => b.turn - a.turn);
    const rows = entries.map((x) =>
      '<div class="vle-lore-row">'
      + '<span class="vle-lore-fact">' + esc(x.fact) + '</span>'
      + '<span class="vle-lore-turn">t' + x.turn + '</span>'
      + `<button class="vle-mini del" data-lore-del data-id="${esc(x.id)}" title="Delete">\u2715</button>`
      + '</div>'
    ).join('');
    return '<div class="vle-lore-group">'
      + '<div class="vle-lore-group-head">' + esc(tag) + '</div>'
      + rows
      + '</div>';
  }).join('');
  
  return head + body;
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
      '<div class="vle-item-row">' + shapeOrnament(activeShape('items'), 'items') + '<span class="vle-item-name">' + esc(it.item) + '</span>'
      + (it.note ? `<span class="vle-item-note">${esc(it.note)}</span>` : '')
      + `<span class="vle-mem-ctl"><button class="vle-mini" data-item-edit data-id="${esc(it.id)}" data-item="${esc(it.item)}" data-who="${esc(it.who === 'world' ? '' : nameOf(s, it.who))}" data-note="${esc(it.note ?? '')}" title="Edit">\u270E</button>`
      + `<button class="vle-mini del" data-item-del data-id="${esc(it.id)}" title="Delete">\u2715</button></span></div>`
    ).join('');
    return `<div class="vle-item-grp"><div class="vle-item-grp-h">${esc(label)}</div>${rows}</div>`;
  }).join('');
  return head + body;
}

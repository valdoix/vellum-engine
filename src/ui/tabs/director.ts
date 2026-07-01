import type { Component } from '../component.js';
import type { ChronicleState } from '../../domain/types.js';
import { esc, nameOf, emptyState, sectionHeader } from '../format.js';
import { send, refreshUI } from '../bridge.js';
import { formModal, confirmModal } from '../modal.js';

/**
 * Director tab — the "next-scene control panel". Four sub-views:
 *   Directives — the Plot Director lifecycle board (scheduled/active/done) + CRUD
 *   Locations  — the gazetteer (auto-collected + pinned), injected to stop
 *                location hallucination
 *   Next Scene — set where/when the UPCOMING turn opens (clears after one turn)
 *   Log        — continuity flags + secret reveals (read-only feed)
 *
 * Directives + next-scene aren't on ChronicleState (chat vars), so app.ts mirrors
 * them here via setDirectives/setNextScene. Built on theme vars + per-chrome
 * overrides (illuminated default / modern / futuristic) like the other tabs.
 */

type DView = 'directives' | 'locations' | 'nextscene' | 'log';
let _view: DView = 'directives';

interface UIDirective { id: string; kind: string; text: string; target?: string; status: string; ttl: number; whenTurn?: number; whenDay?: number }
let _directives: UIDirective[] = [];
let _nextScene: { location?: string; day?: number; time?: string; note?: string } | null = null;
export function setDirectorDirectives(d: unknown): void { _directives = Array.isArray(d) ? d as UIDirective[] : []; }
export function setDirectorNextScene(n: unknown): void { _nextScene = (n && typeof n === 'object') ? n as typeof _nextScene : null; }

const VIEWS: Array<{ id: DView; label: string }> = [
  { id: 'directives', label: 'Directives' },
  { id: 'locations', label: 'Locations' },
  { id: 'nextscene', label: 'Next Scene' },
  { id: 'log', label: 'Log' },
];

const KIND_GLYPH: Record<string, string> = { reveal_secret: '\u26C0', reveal_knowledge: '\u25C8', advance_thread: '\u269C', note: '\u270E' };

function pushDirectives(next: UIDirective[]): void { send({ type: 'vellum_set_directives', directives: next }); refreshUI(); }

export const directorTab: Component<ChronicleState> = {
  version: (s) => `${_view}:${_directives.map((d) => d.id + d.status).join(',')}:${_nextScene ? JSON.stringify(_nextScene) : '0'}:${(s.locations ?? []).length}:${(s.locations ?? []).map((l) => l.id + l.lastTurn).join(',')}:${(s.continuityFlags ?? []).length}:${s.secrets.filter((x) => x.revealed).length}`,
  render(s) {
    const counts: Record<DView, number> = {
      directives: _directives.filter((d) => d.status !== 'done').length,
      locations: (s.locations ?? []).length,
      nextscene: _nextScene ? 1 : 0,
      log: (s.continuityFlags ?? []).length,
    };
    const nav = '<div class="vle-subnav">' + VIEWS.map((v) =>
      `<button class="vle-subnav-b${_view === v.id ? ' on' : ''}" data-dview="${v.id}">${v.label}${counts[v.id] ? ` <span class="vle-n">${counts[v.id]}</span>` : ''}</button>`).join('') + '</div>';
    let body = '';
    if (_view === 'directives') body = directivesView();
    else if (_view === 'locations') body = locationsView(s);
    else if (_view === 'nextscene') body = nextSceneView(s);
    else body = logView(s);
    return `<div class="vle-director">${nav}${body}</div>`;
  },
  mount(host) {
    host.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const nv = t.closest('[data-dview]');
      if (nv) { _view = nv.getAttribute('data-dview') as DView; refreshUI(); return; }

      // --- directives ---
      if (t.closest('[data-dir-add]')) { addDirectiveForm(); return; }
      const ddel = t.closest('[data-dir-del]');
      if (ddel) { const id = ddel.getAttribute('data-id'); pushDirectives(_directives.filter((d) => d.id !== id)); return; }

      // --- locations ---
      if (t.closest('[data-loc-add]')) {
        formModal('New Location', [
          { key: 'name', label: 'Place name', type: 'text', placeholder: 'The Salt Docks' },
          { key: 'note', label: 'Note (optional)', type: 'text', placeholder: 'working harbor, south quarter' },
        ], (o) => { if (o.name?.trim()) send({ type: 'vellum_location_set', name: o.name, note: o.note || undefined }); });
        return;
      }
      const le = t.closest('[data-loc-edit]');
      if (le) {
        formModal('Edit Location', [
          { key: 'name', label: 'Place name', type: 'text', value: le.getAttribute('data-name') || '' },
          { key: 'note', label: 'Note (optional)', type: 'text', value: le.getAttribute('data-note') || '' },
        ], (o) => { if (o.name?.trim()) send({ type: 'vellum_location_set', id: le.getAttribute('data-id'), name: o.name, note: o.note ?? '' }); });
        return;
      }
      const ld = t.closest('[data-loc-del]');
      if (ld) { confirmModal('Delete this location?', () => send({ type: 'vellum_location_drop', id: ld.getAttribute('data-id') })); return; }

      // --- next scene ---
      if (t.closest('[data-ns-set]')) {
        const cur = _nextScene ?? {};
        formModal('Set Next Scene', [
          { key: 'location', label: 'Location (opens here)', type: 'text', value: cur.location || '' },
          { key: 'day', label: 'Day (optional)', type: 'number', min: 0, step: 1, value: cur.day !== undefined ? String(cur.day) : '' },
          { key: 'time', label: 'Time (optional)', type: 'text', value: cur.time || '' },
          { key: 'note', label: 'Note (optional)', type: 'text', value: cur.note || '' },
        ], (o) => { send({ type: 'vellum_set_next_scene', location: o.location || '', day: o.day !== '' ? Number(o.day) : undefined, time: o.time || '', note: o.note || '' }); });
        return;
      }
      if (t.closest('[data-ns-clear]')) { send({ type: 'vellum_set_next_scene', clear: true }); return; }
    });
  },
};

function directivesView(): string {
  const head = sectionHeader('\u2693 Directives', { sub: true, count: _directives.filter((d) => d.status !== 'done').length, action: '<button class="vle-add sm" data-dir-add>+</button>' });
  const intro = '<div class="vle-cz-note">Gentle steers for the next scene. They self-clear when fulfilled and fade on a timer; scheduled ones wait until their turn/day.</div>';
  if (!_directives.length) return head + intro + emptyState('No directives.', 'Add one to nudge the next scene \u2014 reveal a secret, advance a thread, or a freeform note.');
  const col = (label: string, ds: UIDirective[]): string => {
    if (!ds.length) return '';
    const rows = ds.map((d) => {
      const sched = d.status === 'dormant' && (d.whenTurn || d.whenDay) ? ` <span class="vle-dir-when">arms ${d.whenDay ? 'day ' + d.whenDay : 'turn ' + d.whenTurn}</span>` : '';
      const ttl = d.status === 'armed' && d.ttl ? ` <span class="vle-dir-ttl">fades in ${d.ttl}</span>` : '';
      return `<div class="vle-dir-card vle-dir-${d.status}"><span class="vle-dir-glyph">${KIND_GLYPH[d.kind] ?? '\u2022'}</span>`
        + `<span class="vle-dir-text">${esc(d.text)}${d.target ? ` <span class="vle-dir-target">${esc(d.target)}</span>` : ''}${sched}${ttl}</span>`
        + `<button class="vle-mini del" data-dir-del data-id="${esc(d.id)}" title="Remove">\u2715</button></div>`;
    }).join('');
    return `<div class="vle-dir-col"><div class="vle-dir-col-h">${label}</div>${rows}</div>`;
  };
  return head + intro
    + col('Scheduled', _directives.filter((d) => d.status === 'dormant'))
    + col('Active', _directives.filter((d) => d.status === 'armed'))
    + col('Done', _directives.filter((d) => d.status === 'done'));
}

function addDirectiveForm(): void {
  formModal('New Directive', [
    { key: 'kind', label: 'Kind', type: 'select', value: 'note', options: [
      { value: 'note', label: 'Note (freeform steer)' },
      { value: 'reveal_secret', label: 'Reveal a secret' },
      { value: 'reveal_knowledge', label: 'Reveal knowledge' },
      { value: 'advance_thread', label: 'Advance a thread' },
    ] },
    { key: 'text', label: 'What should happen', type: 'text', placeholder: 'Bring the storm in by nightfall' },
    { key: 'target', label: 'Target (secret id / thread name, optional)', type: 'text' },
    { key: 'whenDay', label: 'Arm on day (optional, leave blank = now)', type: 'number', min: 0, step: 1 },
  ], (o) => {
    const text = (o.text ?? '').trim();
    if (!text) return;
    const d: UIDirective = { id: 'd' + Math.random().toString(36).slice(2, 9), kind: o.kind || 'note', text, status: o.whenDay !== '' ? 'dormant' : 'armed', ttl: 6, ...(o.target?.trim() ? { target: o.target.trim() } : {}), ...(o.whenDay !== '' ? { whenDay: Number(o.whenDay) } : {}) };
    pushDirectives([..._directives, d]);
  });
}

function locationsView(s: ChronicleState): string {
  const list = (s.locations ?? []).slice().sort((a, b) => b.lastTurn - a.lastTurn);
  const head = sectionHeader('\u25C9 Locations', { sub: true, count: list.length, action: '<button class="vle-add sm" data-loc-add>+</button>' });
  const intro = '<div class="vle-cz-note">Established places, injected each turn so the model reuses these names instead of inventing or renaming. Visited scenes are added automatically; pin or edit your own.</div>';
  if (!list.length) return head + intro + emptyState('No locations yet.', 'Places you visit are collected here automatically; you can also add and pin your own.');
  const pinned = list.filter((l) => l.auto !== true);
  const auto = list.filter((l) => l.auto === true);
  const row = (l: typeof list[number]): string =>
    `<div class="vle-loc-row"><span class="vle-loc-mark" title="${l.auto ? 'auto-collected from a scene' : 'pinned by you'}">${l.auto ? '\u25CB' : '\u2691'}</span>`
    + `<span class="vle-loc-name">${esc(l.name)}</span>`
    + (l.note ? `<span class="vle-loc-note">${esc(l.note)}</span>` : '')
    + `<span class="vle-mem-ctl"><button class="vle-mini" data-loc-edit data-id="${esc(l.id)}" data-name="${esc(l.name)}" data-note="${esc(l.note ?? '')}" title="Edit / pin">\u270E</button>`
    + `<button class="vle-mini del" data-loc-del data-id="${esc(l.id)}" title="Delete">\u2715</button></span></div>`;
  const grp = (label: string, ls: typeof list): string => ls.length ? `<div class="vle-loc-grp"><div class="vle-loc-grp-h">${label}</div>${ls.map(row).join('')}</div>` : '';
  return head + intro + grp('Pinned', pinned) + grp('Visited', auto);
}

function nextSceneView(s: ChronicleState): string {
  const head = sectionHeader('\u2192 Next Scene', { sub: true, action: '<button class="vle-add sm" data-ns-set>Set</button>' });
  const intro = '<div class="vle-cz-note">Set where and when the upcoming turn opens. It injects as a strong steer for ONE turn, then clears \u2014 it frames the opening, never teleports characters who\u2019d be elsewhere.</div>';
  // the Director tab is the hub for steering the next turn — link the related
  // dial that lives in the Actions menu (Tone) so it's discoverable from here.
  const steer = '<div class="vle-ns-steer">Also steers the next turn: '
    + '<button class="vle-link" data-qol="tone">\u2665 Tone &amp; world bias</button></div>';
  if (!_nextScene) return head + intro + emptyState('No next-scene set.', 'The story flows naturally. Set one to open the next turn at a specific place/time.') + steer;
  const ns = _nextScene;
  const when = [ns.day !== undefined ? 'Day ' + ns.day : '', ns.time || ''].filter(Boolean).join(', ');
  const card = `<div class="vle-nextscene">`
    + (ns.location ? `<div class="vle-ns-row"><span class="vle-ns-k">where</span><span class="vle-ns-v">${esc(ns.location)}</span></div>` : '')
    + (when ? `<div class="vle-ns-row"><span class="vle-ns-k">when</span><span class="vle-ns-v">${esc(when)}</span></div>` : '')
    + (ns.note ? `<div class="vle-ns-row"><span class="vle-ns-k">note</span><span class="vle-ns-v">${esc(ns.note)}</span></div>` : '')
    + `<div class="vle-ns-ctl"><button class="vle-add sm" data-ns-set>Edit</button><button class="vle-add sm danger" data-ns-clear>Clear</button></div></div>`;
  return head + intro + card + steer;
}

function logView(s: ChronicleState): string {
  const head = sectionHeader('\u2261 Director Log', { sub: true });
  type Row = { turn: number; kind: 'flag' | 'reveal'; text: string };
  const rows: Row[] = [];
  for (const f of s.continuityFlags ?? []) rows.push({ turn: f.turn, kind: 'flag', text: f.detail });
  for (const sec of s.secrets) if (sec.revealed) rows.push({ turn: sec.formedTurn ?? 0, kind: 'reveal', text: 'Revealed: ' + sec.text + (sec.keeper ? ' (' + nameOf(s, sec.keeper) + ')' : '') });
  if (!rows.length) return head + emptyState('Log is empty.', 'Continuity warnings and secret reveals will appear here as the story runs.');
  rows.sort((a, b) => b.turn - a.turn);
  const body = rows.slice(0, 60).map((r) =>
    `<div class="vle-dir-log-row vle-dir-log-${r.kind}"><span class="vle-dir-log-mark">${r.kind === 'flag' ? '\u26A0' : '\u26C0'}</span>`
    + `<span class="vle-dir-log-t">${esc(r.text)}</span>`
    + `<span class="vle-dir-log-turn">t${r.turn}</span></div>`).join('');
  return head + body;
}

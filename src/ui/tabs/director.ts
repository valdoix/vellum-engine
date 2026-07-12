import type { Component } from '../component.js';
import type { ChronicleState } from '../../domain/types.js';
import { esc, nameOf, emptyState, sectionHeader } from '../format.js';
import { send, refreshUI } from '../bridge.js';
import { formModal, confirmModal } from '../modal.js';
import { readyToIntersect } from '../../domain/offscreen.js';
import { formatDate } from '../../domain/date-format.js';

/**
 * Director tab — the "next-scene control panel". Sub-views:
 *   Directives — the Plot Director lifecycle board (scheduled/active/done) + CRUD
 *   Locations  — the gazetteer (auto-collected + pinned), injected to stop
 *                location hallucination
 *   Next Scene — set where/when the UPCOMING turn opens (clears after one turn)
 *   Off-screen — every parallel subplot (active + resolved) with per-thread
 *                advance / edit / delete / resolve / reopen
 *   Planted    — foreshadow / Chekhov plants awaiting payoff
 *   Log        — continuity flags + secret reveals (read-only feed)
 *
 * Directives + next-scene aren't on ChronicleState (chat vars), so app.ts mirrors
 * them here via setDirectives/setNextScene. Built on theme vars + per-chrome
 * overrides (illuminated default / modern / futuristic) like the other tabs.
 */

type DView = 'directives' | 'locations' | 'nextscene' | 'offscreen' | 'plants' | 'log';
let _view: DView = 'directives';

interface UIDirective { id: string; kind: string; text: string; target?: string; status: string; ttl: number; whenTurn?: number; whenDay?: number }
let _directives: UIDirective[] = [];
let _nextScene: { location?: string; day?: number; time?: string; note?: string } | null = null;
// latest rendered state, so click handlers (location/plant forms) can read lists.
let _state: ChronicleState | null = null;
// collapsed location ids (their contained places hidden). Session-only UI state;
// a place stays expanded by default so nothing is hidden unless the user folds it.
const _locCollapsed = new Set<string>();
// expanded off-screen feed item ids (Elsewhere Feed). Session-only; items start
// collapsed except the lone active thread (handled in offscreenView).
const _feedExpanded = new Set<string>();

/** Location options for a parent/seat picker: every location except `selfId`
 * (a place can't contain itself). Leading blank = "none". */
function parentOpts(s: ChronicleState | null, selfId: string): Array<{ value: string; label: string }> {
  const locs = (s?.locations ?? []).filter((l) => l.id !== selfId).sort((a, b) => a.name.localeCompare(b.name));
  return [{ value: '', label: '\u2014 none \u2014' }, ...locs.map((l) => ({ value: l.id, label: l.name }))];
}

/** Subject options for a plant: characters + locations (both id-keyed). Leading
 * blank = "none". */
function subjectOpts(s: ChronicleState | null): Array<{ value: string; label: string }> {
  const cast = Object.values(s?.cast ?? {}).sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: c.id, label: c.name }));
  const locs = (s?.locations ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)).map((l) => ({ value: l.id, label: l.name + ' (place)' }));
  return [{ value: '', label: '\u2014 none \u2014' }, ...cast, ...locs];
}
export function setDirectorDirectives(d: unknown): void { _directives = Array.isArray(d) ? d as UIDirective[] : []; }
export function setDirectorNextScene(n: unknown): void { _nextScene = (n && typeof n === 'object') ? n as typeof _nextScene : null; }

const VIEWS: Array<{ id: DView; label: string }> = [
  { id: 'directives', label: 'Directives' },
  { id: 'locations', label: 'Locations' },
  { id: 'nextscene', label: 'Next Scene' },
  { id: 'offscreen', label: 'Off-screen' },
  { id: 'plants', label: 'Planted' },
  { id: 'log', label: 'Log' },
];

const KIND_GLYPH: Record<string, string> = { reveal_secret: '\u26C0', reveal_knowledge: '\u25C8', advance_thread: '\u269C', note: '\u270E' };

function pushDirectives(next: UIDirective[]): void { send({ type: 'vellum_set_directives', directives: next }); refreshUI(); }

export const directorTab: Component<ChronicleState> = {
  version: (s) => `${_view}:${_directives.map((d) => d.id + d.status).join(',')}:${_nextScene ? JSON.stringify(_nextScene) : '0'}:${(s.plants ?? []).map((p) => p.id + p.status).join(',')}:${(s.locations ?? []).length}:${(s.locations ?? []).map((l) => l.id + l.lastTurn + (l.parent ?? '') + (l.source ?? '') + (l.pinned ? 'p' : '') + (l.name ?? '') + (l.note ?? '')).join(',')}:${(s.scene?.location ?? '')}:${[..._locCollapsed].sort().join(',')}:${(s.offscreen ?? []).map((o) => o.id + o.status + o.lastTurn + o.beats.length).join(',')}:${(s.parallel ?? []).map((p) => (p.who ?? '') + (p.where ?? '') + p.activity + p.turn).join('|')}:${(s.continuityFlags ?? []).map((f) => f.turn + f.code).join(',')}:${s.secrets.filter((x) => x.revealed).length}:${[..._feedExpanded].sort().join(',')}`,
  render(s) {
    _state = s;
    const counts: Record<DView, number> = {
      directives: _directives.filter((d) => d.status !== 'done').length,
      locations: (s.locations ?? []).length,
      nextscene: _nextScene ? 1 : 0,
      offscreen: (s.offscreen ?? []).filter((o) => o.status === 'active').length + (s.parallel ?? []).length,
      plants: (s.plants ?? []).filter((x) => x.status === 'planted').length,
      log: (s.continuityFlags ?? []).length,
    };
    const nav = '<div class="vle-subnav">' + VIEWS.map((v) =>
      `<button class="vle-subnav-b${_view === v.id ? ' on' : ''}" data-dview="${v.id}">${v.label}${counts[v.id] ? ` <span class="vle-n">${counts[v.id]}</span>` : ''}</button>`).join('') + '</div>';
    let body = '';
    if (_view === 'directives') body = directivesView();
    else if (_view === 'locations') body = locationsView(s);
    else if (_view === 'nextscene') body = nextSceneView(s);
    else if (_view === 'offscreen') body = offscreenView(s);
    else if (_view === 'plants') body = plantsView(s);
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
      const ltog = t.closest('[data-loc-toggle]');
      if (ltog) { const id = ltog.getAttribute('data-id') || ''; if (_locCollapsed.has(id)) _locCollapsed.delete(id); else _locCollapsed.add(id); refreshUI(); return; }
      if (t.closest('[data-loc-add]')) {
        formModal('New Location', [
          { key: 'name', label: 'Place name', type: 'text', placeholder: 'The Salt Docks' },
          { key: 'note', label: 'Note (optional)', type: 'text', placeholder: 'working harbor, south quarter' },
          { key: 'parent', label: 'Inside (containing place, optional)', type: 'select', value: '', options: parentOpts(_state, '') },
        ], (o) => { if (o.name?.trim()) send({ type: 'vellum_location_set', name: o.name, note: o.note || undefined, parent: o.parent || '' }); });
        return;
      }
      const le = t.closest('[data-loc-edit]');
      if (le) {
        const selfId = le.getAttribute('data-id') || '';
        formModal('Edit Location', [
          { key: 'name', label: 'Place name', type: 'text', value: le.getAttribute('data-name') || '' },
          { key: 'note', label: 'Note (optional)', type: 'text', value: le.getAttribute('data-note') || '' },
          { key: 'parent', label: 'Inside (containing place, optional)', type: 'select', value: le.getAttribute('data-parent') || '', options: parentOpts(_state, selfId) },
        ], (o) => { if (o.name?.trim()) send({ type: 'vellum_location_set', id: selfId, name: o.name, note: o.note ?? '', parent: o.parent ?? '' }); });
        return;
      }
      const lpin = t.closest('[data-loc-pin]');
      if (lpin) { send({ type: 'vellum_location_pin', id: lpin.getAttribute('data-id'), pinned: lpin.getAttribute('data-pinned') === '1' }); return; }
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
      // --- plants ---
      if (t.closest('[data-plant-add]')) {
        formModal('New Plant', [
          { key: 'what', label: 'What is being seeded (pays off later)', type: 'text', placeholder: 'a locked drawer nobody opened' },
          { key: 'subject', label: 'Concerns (character or place, optional)', type: 'select', value: '', options: subjectOpts(_state) },
        ], (o) => { if (o.what?.trim()) send({ type: 'vellum_plant_add', what: o.what, subject: o.subject || '' }); });
        return;
      }
      const pp = t.closest('[data-plant-pay]');
      if (pp) { send({ type: 'vellum_plant_pay', id: pp.getAttribute('data-id') }); return; }
      const pab = t.closest('[data-plant-abandon]');
      if (pab) { confirmModal('Abandon this plant? (kept on record as let-go, not deleted)', () => send({ type: 'vellum_plant_abandon', id: pab.getAttribute('data-id') })); return; }
      const pd = t.closest('[data-plant-del]');
      if (pd) { confirmModal('Delete this plant?', () => send({ type: 'vellum_plant_drop', id: pd.getAttribute('data-id') })); return; }

      // --- off-screen threads (re-homed from Chronicle→World) ---
      if (t.closest('[data-off-simall]')) { send({ type: 'vellum_offthread_advance' }); return; } // whole-world AI tick
      if (t.closest('[data-off-add]')) {
        formModal('New Off-screen Thread', [
          { key: 'name', label: 'Subplot name', type: 'text', placeholder: 'The harbor strike' },
          { key: 'who', label: 'Character (optional)', type: 'text' },
          { key: 'where', label: 'Where (optional)', type: 'text' },
          { key: 'gist', label: 'What\u2019s happening now', type: 'text', placeholder: 'dockhands walk off the job' },
        ], (o) => { if (o.name?.trim()) send({ type: 'vellum_offthread_set', name: o.name, who: o.who || undefined, where: o.where || undefined, gist: o.gist || undefined }); });
        return;
      }
      const oadv = t.closest('[data-off-adv]');
      if (oadv) { send({ type: 'vellum_offthread_advance', id: oadv.getAttribute('data-id') }); return; } // per-thread AI beat
      const oedit = t.closest('[data-off-edit]');
      if (oedit) {
        formModal('Edit Off-screen Thread', [
          { key: 'name', label: 'Subplot name', type: 'text', value: oedit.getAttribute('data-name') || '' },
          { key: 'who', label: 'Character (optional)', type: 'text', value: oedit.getAttribute('data-who') || '' },
          { key: 'where', label: 'Where (optional)', type: 'text', value: oedit.getAttribute('data-where') || '' },
          { key: 'gist', label: 'Latest beat / gist', type: 'text', value: oedit.getAttribute('data-gist') || '' },
        ], (o) => { send({ type: 'vellum_offthread_set', id: oedit.getAttribute('data-id'), name: o.name, who: o.who || undefined, where: o.where || undefined, gist: o.gist || undefined }); });
        return;
      }
      const ores = t.closest('[data-off-resolve]');
      if (ores) { send({ type: 'vellum_offthread_resolve', id: ores.getAttribute('data-id') }); return; }
      const oreopen = t.closest('[data-off-reopen]');
      if (oreopen) { send({ type: 'vellum_offthread_set', id: oreopen.getAttribute('data-id'), name: oreopen.getAttribute('data-name') || '' }); return; }
      const olink = t.closest('[data-off-link]');
      if (olink) {
        const id = olink.getAttribute('data-id') || '';
        const cur = olink.getAttribute('data-thread') || '';
        const opts = [{ value: '', label: '\u2014 none (use auto text-match) \u2014' },
          ...(_state?.threads ?? []).map((th) => ({ value: th.id, label: th.name }))];
        formModal('Link to a plot thread', [
          { key: 'thread', label: 'Plot thread', type: 'select', value: cur, options: opts },
        ], (o) => { send({ type: 'vellum_offthread_link', id, thread: o.thread ?? '' }); });
        return;
      }
      const odel = t.closest('[data-off-del]');
      if (odel) { confirmModal('Delete this off-screen thread?', () => send({ type: 'vellum_offthread_drop', id: odel.getAttribute('data-id') })); return; }
      
      // --- feed toggle (expand/collapse off-screen items) ---
      const ftog = t.closest('[data-feed-toggle]');
      if (ftog) {
        const id = ftog.getAttribute('data-id') || '';
        if (_feedExpanded.has(id)) _feedExpanded.delete(id); else _feedExpanded.add(id);
        refreshUI();
        return;
      }
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
      return `<div class="vle-dir-card vle-dir-${d.status}${d.status === 'armed' ? ' v-orn--glow' : ''}"><span class="vle-dir-glyph">${KIND_GLYPH[d.kind] ?? '\u2022'}</span>`
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
  const list = (s.locations ?? []).slice();
  const head = sectionHeader('\u25C9 Locations', { sub: true, count: list.length, action: '<button class="vle-add sm" data-loc-add>+</button>' });
  const intro = '<div class="vle-cz-note">Established places, injected so the model reuses these names instead of inventing or renaming. <b>Pinned</b> places are always sent; unpinned ones are sent when recently visited or when you\u2019re in/near them. The breadcrumb shows containment; the pulse shows how recently a place was seen.</div>';
  if (!list.length) return head + intro + emptyState('No locations yet.', 'Places you visit are collected here automatically; you can also add and pin your own.');
  // Build the containment tree: a location nests under its `parent` when that
  // parent is itself a known location; otherwise it's a root (a dangling parent
  // ref falls back to a root so nothing is hidden).
  const byId = new Map(list.map((l) => [l.id, l]));
  const kids = new Map<string, typeof list>();
  const roots: typeof list = [];
  for (const l of list) {
    const pid = l.parent && byId.has(l.parent) ? l.parent : '';
    if (pid) (kids.get(pid) ?? kids.set(pid, []).get(pid)!).push(l);
    else roots.push(l);
  }
  const byRecent = (a: typeof list[number], b: typeof list[number]): number => b.lastTurn - a.lastTurn;
  const now = s.turns || 0;
  const hereName = (s.scene?.location ?? '').trim().toLowerCase();
  // region hue: hash the ROOT ancestor's id so places in the same region share a
  // spine color (visual grouping without deep indentation).
  const rootOf = (l: typeof list[number]): string => {
    let cur = l; const guard = new Set<string>();
    while (cur.parent && byId.has(cur.parent) && !guard.has(cur.id)) { guard.add(cur.id); cur = byId.get(cur.parent)!; }
    return cur.id;
  };
  const hue = (id: string): number => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h % 360; };
  // breadcrumb: walk the parent chain to the root, ancestors first (cycle-guarded).
  const crumb = (l: typeof list[number]): string[] => {
    const chain: string[] = []; let cur: typeof list[number] | undefined = l; const guard = new Set<string>();
    while (cur && !guard.has(cur.id)) { guard.add(cur.id); chain.unshift(cur.name); cur = cur.parent ? byId.get(cur.parent) : undefined; }
    return chain;
  };
  // recency bucket → freshness class (fresh = bright, stale = cold).
  const seenClass = (l: typeof list[number]): string => {
    const age = now - l.lastTurn;
    if (age <= 0) return 'fresh';
    if (age <= 4) return 'warm';
    if (age <= 12) return 'cool';
    return 'cold';
  };
  const plate = (l: typeof list[number], depth: number, kidCount: number, collapsed: boolean): string => {
    const isHere = hereName && l.name.trim().toLowerCase() === hereName;
    const pinned = l.pinned === true;
    const isAuto = l.source !== 'user'; // legacy rows w/o source read as auto
    // three-state chip: pinned ⚑ wins; else auto ○; else nothing (user-made/edited).
    const kind = pinned
      ? '<span class="vle-atlas-kind pin" title="Always injected into the prompt.">\u2691 pinned</span>'
      : isAuto
        ? '<span class="vle-atlas-kind auto" title="Added by the model from a visited scene. Sent when recently visited or when you\u2019re in/near it.">\u25CB auto</span>'
        : '';
    const path = crumb(l);
    const crumbHtml = path.length > 1
      ? `<div class="vle-atlas-crumb">${path.slice(0, -1).map(esc).join(' <span class="sep">\u25B8</span> ')} <span class="sep">\u25B8</span> <span class="cur">${esc(path[path.length - 1]!)}</span></div>`
      : '';
    const seen = isHere ? 'current scene' : (now - l.lastTurn <= 0 ? 'seen this turn' : `last seen t${l.lastTurn}`);
    // a caret toggles contained places (only when the place has any); it doubles as
    // the "N inside" child tag so collapsed places still show how many they hold.
    const childTag = kidCount
      ? `<button class="vle-atlas-childtag toggle${collapsed ? ' closed' : ''}" data-loc-toggle data-id="${esc(l.id)}" title="${collapsed ? 'Show' : 'Hide'} contained places" aria-expanded="${collapsed ? 'false' : 'true'}"><span class="vle-atlas-caret">\u25BE</span> ${kidCount} inside</button>`
      : '';
    // pin control: target state is the OPPOSITE of current pinned.
    const pinBtn = `<button class="vle-mini${pinned ? ' on' : ''}" data-loc-pin data-id="${esc(l.id)}" data-pinned="${pinned ? '0' : '1'}" title="${pinned ? 'Unpin (send only when recent/near)' : 'Pin (always inject)'}">${pinned ? '\u2691' : '\u2690'}</button>`;
    return `<div class="vle-atlas-plate${isHere ? ' here' : ''}" style="margin-left:${Math.min(depth, 4) * 1.15}rem;--atlas-hue:${hue(rootOf(l))}">`
      + `<div class="vle-atlas-spine"></div>`
      + `<div class="vle-atlas-body">`
      + `<div class="vle-atlas-top"><span class="vle-atlas-name">${esc(l.name)}</span>`
      + (isHere ? '<span class="vle-atlas-here">you are here</span>' : '')
      + kind + '</div>'
      + crumbHtml
      + (l.note ? `<div class="vle-atlas-note">${esc(l.note)}</div>` : '')
      + `<div class="vle-atlas-foot"><span class="vle-atlas-seen ${seenClass(l)}"><span class="dot"></span>${seen}</span>${childTag}`
      + `<span class="vle-atlas-ctl">${pinBtn}`
      + `<button class="vle-mini" data-loc-edit data-id="${esc(l.id)}" data-name="${esc(l.name)}" data-note="${esc(l.note ?? '')}" data-parent="${esc(l.parent ?? '')}" title="Edit">\u270E</button>`
      + `<button class="vle-mini del" data-loc-del data-id="${esc(l.id)}" title="Delete">\u2715</button></span></div>`
      + `</div></div>`;
  };
  // depth-first walk so a child plate always renders under its parent, indented by
  // depth. A collapsed place hides its whole subtree. A `seen` guard breaks any
  // accidental parent cycle in the data.
  const seenIds = new Set<string>();
  const walk = (l: typeof list[number], depth: number): string => {
    if (seenIds.has(l.id)) return '';
    seenIds.add(l.id);
    const children = (kids.get(l.id) ?? []).slice().sort(byRecent);
    const collapsed = children.length > 0 && _locCollapsed.has(l.id);
    const kidsHtml = collapsed ? '' : children.map((c) => walk(c, depth + 1)).join('');
    return plate(l, depth, children.length, collapsed) + kidsHtml;
  };
  return head + intro + `<div class="vle-atlas">${roots.sort(byRecent).map((r) => walk(r, 0)).join('')}</div>`;
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
  const when = [ns.day !== undefined ? formatDate(ns.day, s.dateFormat || 'day', s) : '', ns.time || ''].filter(Boolean).join(', ');
  const card = `<div class="vle-nextscene">`
    + (ns.location ? `<div class="vle-ns-row"><span class="vle-ns-k">where</span><span class="vle-ns-v">${esc(ns.location)}</span></div>` : '')
    + (when ? `<div class="vle-ns-row"><span class="vle-ns-k">when</span><span class="vle-ns-v">${esc(when)}</span></div>` : '')
    + (ns.note ? `<div class="vle-ns-row"><span class="vle-ns-k">note</span><span class="vle-ns-v">${esc(ns.note)}</span></div>` : '')
    + `<div class="vle-ns-ctl"><button class="vle-add sm" data-ns-set>Edit</button><button class="vle-add sm danger" data-ns-clear>Clear</button></div></div>`;
  return head + intro + card + steer;
}

function plantsView(s: ChronicleState): string {
  const list = (s.plants ?? []).slice().sort((a, b) => (a.status === b.status ? a.plantedTurn - b.plantedTurn : a.status === 'planted' ? -1 : 1));
  const head = sectionHeader('\u2698 Planted', { sub: true, count: list.filter((p) => p.status === 'planted').length, action: '<button class="vle-add sm" data-plant-add>+</button>' });
  const intro = '<div class="vle-cz-note">Details seeded to pay off later (a locked drawer, an omen). Open plants are injected so they never quietly vanish; mark one paid when it lands.</div>';
  if (!list.length) return head + intro + emptyState('Nothing planted.', 'Seed a Chekhov detail here (or let the story plant one via ext.plant); it stays on the board until it pays off.');
  const now = s.turns || 0;
  const subjName = (id: string): string => s.cast[id]?.name ?? (s.locations ?? []).find((l) => l.id === id)?.name ?? id;
  const rows = list.map((p) => {
    const done = p.status !== 'planted';
    const age = Math.max(0, now - p.plantedTurn);
    const meta = p.status === 'paid' ? `paid t${p.paidTurn ?? '?'}` : p.status === 'abandoned' ? 'abandoned' : `planted t${p.plantedTurn}${age >= 15 ? ' \u00b7 overdue' : ''}`;
    const mark = p.status === 'paid' ? '\u2713' : p.status === 'abandoned' ? '\u2717' : '\u2698';
    const subj = p.subject ? `<span class="vle-plant-meta">${esc(subjName(p.subject))}</span>` : '';
    const payBtn = done ? '' : `<button class="vle-mini" data-plant-pay data-id="${esc(p.id)}" title="Mark paid off">\u2713</button>`;
    const abandonBtn = done ? '' : `<button class="vle-mini" data-plant-abandon data-id="${esc(p.id)}" title="Abandon (let it go, keep on record)">\u2717</button>`;
    return `<div class="vle-plant${done ? ' paid' : ''}"><span class="vle-plant-mark">${mark}</span>`
      + `<span class="vle-plant-what">${esc(p.what)}</span>${subj}<span class="vle-plant-meta">${meta}</span>`
      + `<span class="vle-mem-ctl">${payBtn}${abandonBtn}<button class="vle-mini del" data-plant-del data-id="${esc(p.id)}" title="Delete">\u2715</button></span></div>`;
  }).join('');
  return head + intro + rows;
}

function offscreenView(s: ChronicleState): string {
  const all = (s.offscreen ?? []).slice();
  const active = all.filter((o) => o.status === 'active').sort(byRecentOff);
  const resolved = all.filter((o) => o.status === 'resolved').sort(byRecentOff);
  const par = (s.parallel ?? []).slice();
  const head = sectionHeader('\u2748 Elsewhere Feed', { sub: true, count: active.length, action: '<button class="vle-add sm" data-off-simall title="Advance the whole off-screen world one AI tick (needs generation)">\u2748 simulate all</button><button class="vle-add sm" data-off-add>+</button>' });
  const intro = '<div class="vle-cz-note">A timeline of "meanwhile" moments. Each subplot shows its latest beat, status, and cast. Expand a card to see full history and controls.</div>';
  if (!all.length && !par.length) return head + intro + emptyState('No off-screen threads.', 'Add one by hand, or enable Off-screen in Actions to let subplots auto-simulate every few turns.');
  
  const now = s.turns || 0;
  const A = (x: unknown): string => esc(x);
  
  // Feed item renderer - collapsible cards
  const feedItem = (o: ChronicleState['offscreen'][number], expanded = false): string => {
    const done = o.status === 'resolved';
    const who = o.who ? esc(s.cast[o.who]?.name ?? o.who) : '';
    const where = o.where || 'Unknown';
    const stale = now - o.lastTurn;
    const ripe = !done && readyToIntersect(s, o);
    
    // Status badge
    const statusClass = ripe ? 'ripe' : done ? 'done' : 'active';
    const statusLabel = ripe ? 'RIPE' : done ? 'RESOLVED' : 'ACTIVE';
    const statusBadge = `<span class="vle-feed-status vle-feed-status--${statusClass}">${statusLabel}</span>`;
    
    // Kicker: Meanwhile · Location
    const kicker = `<div class="vle-feed-kicker">Meanwhile \u00B7 ${esc(where)}</div>`;
    
    // Title
    const title = `<h4 class="vle-feed-title">${esc(o.name)}</h4>`;
    
    // Metadata line
    const turnsAgo = stale === 0 ? 'just now' : stale === 1 ? '1 turn ago' : `${stale} turns ago`;
    const meta = `<div class="vle-feed-meta">Last advanced ${turnsAgo}</div>`;
    
    // Header (always visible)
    const toggleBtn = `<button class="vle-feed-toggle" data-feed-toggle data-id="${A(o.id)}" aria-label="${expanded ? 'Collapse' : 'Expand'}">${expanded ? '\u25BC' : '\u25B6'}</button>`;
    const header = `<div class="vle-feed-header">${kicker}${title}${meta}${statusBadge}${toggleBtn}</div>`;
    
    // Body (only when expanded)
    let body = '';
    if (expanded) {
      // Latest beat
      const latestBeat = o.gist || o.beats[o.beats.length - 1] || '';
      const beatCard = latestBeat ? `<div class="vle-feed-beat">
        <div class="vle-feed-beat-label">LATEST BEAT</div>
        <div class="vle-feed-beat-text">${esc(latestBeat)}</div>
      </div>` : '';
      
      // Beat history (collapsible, shows all previous beats)
      const beatHist = o.beats.length > 1 ? `<details class="vle-feed-hist">
        <summary class="vle-feed-hist-toggle">${o.beats.length} beat${o.beats.length === 1 ? '' : 's'} total</summary>
        <div class="vle-feed-hist-list">${o.beats.map((b, i) => `<div class="vle-feed-hist-item"><span class="vle-feed-hist-n">${i + 1}.</span> ${esc(b)}</div>`).join('')}</div>
      </details>` : '';
      
      // Cast & linked thread
      const castLine = who ? `<div class="vle-feed-detail"><span class="vle-feed-label">Cast:</span> <span class="vle-feed-val">${who}</span></div>` : '';
      const linkedName = o.thread ? (s.threads.find((th) => th.id === o.thread)?.name ?? '') : '';
      const linkedLine = linkedName ? `<div class="vle-feed-detail"><span class="vle-feed-label">Linked thread:</span> <span class="vle-feed-val vle-feed-linked">${esc(linkedName)}</span></div>` : '';
      const details = (castLine || linkedLine) ? `<div class="vle-feed-details">${castLine}${linkedLine}</div>` : '';
      
      // Actions
      const advBtn = done ? '' : `<button class="vle-btn vle-btn--primary" data-off-adv data-id="${A(o.id)}" title="Advance this thread one AI beat">ADVANCE</button>`;
      const editBtn = `<button class="vle-btn vle-btn--secondary" data-off-edit data-id="${A(o.id)}" data-name="${A(o.name)}" data-who="${A(o.who ? (s.cast[o.who]?.name ?? o.who) : '')}" data-where="${A(o.where ?? '')}" data-gist="${A(o.gist ?? '')}" title="Edit">EDIT</button>`;
      const linkBtn = `<button class="vle-btn vle-btn--secondary" data-off-link data-id="${A(o.id)}" data-thread="${A(o.thread ?? '')}" title="${o.thread ? 'Change / clear link' : 'Link to thread'}">LINK</button>`;
      const stBtn = done
        ? `<button class="vle-btn vle-btn--secondary" data-off-reopen data-id="${A(o.id)}" data-name="${A(o.name)}" title="Reopen">REOPEN</button>`
        : `<button class="vle-btn vle-btn--secondary" data-off-resolve data-id="${A(o.id)}" title="Resolve">RESOLVE</button>`;
      const delBtn = `<button class="vle-btn vle-btn--danger" data-off-del data-id="${A(o.id)}" title="Delete">DELETE</button>`;
      const actions = `<div class="vle-feed-actions">${advBtn}${editBtn}${linkBtn}${stBtn}${delBtn}</div>`;
      
      body = `<div class="vle-feed-body">${beatCard}${beatHist}${details}${actions}</div>`;
    }
    
    return `<div class="vle-feed-item${done ? ' vle-feed-item--done' : ''}${expanded ? ' vle-feed-item--expanded' : ''}" data-feed-id="${A(o.id)}">${header}${body}</div>`;
  };
  
  // On first render (nothing toggled yet), auto-expand a lone active thread so the
  // feed opens with useful content instead of all-collapsed.
  if (_feedExpanded.size === 0 && active.length === 1 && active[0]) _feedExpanded.add(active[0].id);
  const isExpanded = (o: { id: string }): boolean => _feedExpanded.has(o.id);
  
  let html = head + intro + '<div class="vle-feed">';
  
  // Active threads
  if (active.length) {
    html += active.map(o => feedItem(o, isExpanded(o))).join('');
  }
  
  // Resolved threads
  if (resolved.length) {
    html += resolved.map(o => feedItem(o, isExpanded(o))).join('');
  }
  
  html += '</div>';
  
  // Model-narrated "meanwhile" lines (separate section, read-only)
  if (par.length) {
    html += '<div class="vle-subnav-g" style="margin-top:16px">Meanwhile (narrated)</div>';
    html += '<div class="vle-cz-note">Model-narrated off-stage activity. These are snapshots, not full subplots.</div>';
    html += '<div class="vle-feed">';
    const parItems = par.slice().sort((a, b) => b.turn - a.turn).map(p => {
      const who = p.who ? `<span class="vle-feed-who">${esc(s.cast[p.who]?.name ?? p.who)}</span>` : '';
      const where = p.where || '';
      const sim = p.src === 'sim' ? ' <span class="vle-feed-status vle-feed-status--auto">AUTO</span>' : '';
      const kicker = `<div class="vle-feed-kicker">Meanwhile${where ? ' \u00B7 ' + esc(where) : ''}</div>`;
      const activity = `<div class="vle-feed-title">${esc(p.activity)}</div>`;
      const meta = `<div class="vle-feed-meta">Turn ${p.turn}</div>`;
      return `<div class="vle-feed-item vle-feed-item--narrated">${kicker}${activity}${who}${sim}${meta}</div>`;
    }).join('');
    html += parItems;
    html += '</div>';
  }
  
  return html;
}

function byRecentOff(a: { lastTurn: number }, b: { lastTurn: number }): number { return b.lastTurn - a.lastTurn; }

// Continuity-flag codes that concern the passage of time / the calendar clock.
// These are the "time continuity log" — surfaced as their own section so a
// one-shot day/clock finding isn't lost among the general continuity feed.
const TIME_FLAG_CODES = new Set(['day_backward', 'day_jump', 'day_creep', 'clock_backward', 'thread_offscreen_conflict', 'thread_thread_desync']);

function logView(s: ChronicleState): string {
  const head = sectionHeader('\u2261 Director Log', { sub: true });
  type Row = { turn: number; kind: 'flag' | 'reveal'; text: string };
  const flags = (s.continuityFlags ?? []);
  // split the flag feed: time/clock findings get their own labeled section (the
  // "time continuity log") so they read as a distinct concern, above the general
  // continuity + reveal feed.
  const timeFlags = flags.filter((f) => TIME_FLAG_CODES.has(f.code)).slice().sort((a, b) => b.turn - a.turn);
  const rows: Row[] = [];
  for (const f of flags) if (!TIME_FLAG_CODES.has(f.code)) rows.push({ turn: f.turn, kind: 'flag', text: f.detail });
  for (const sec of s.secrets) if (sec.revealed) rows.push({ turn: sec.formedTurn ?? 0, kind: 'reveal', text: 'Revealed: ' + sec.text + (sec.keeper ? ' (' + nameOf(s, sec.keeper) + ')' : '') });
  rows.sort((a, b) => b.turn - a.turn);

  if (!timeFlags.length && !rows.length) return head + emptyState('Log is empty.', 'Time-continuity findings, other continuity warnings and secret reveals will appear here as the story runs.');

  let body = '';
  // --- Time continuity log ---
  if (timeFlags.length) {
    const timeRows = timeFlags.slice(0, 40).map((f) =>
      `<div class="vle-dir-log-row vle-dir-log-time"><span class="vle-dir-log-mark">\u231A</span>`
      + `<span class="vle-dir-log-t">${esc(f.detail)}</span>`
      + `<span class="vle-dir-log-turn">t${f.turn}</span></div>`).join('');
    body += '<div class="vle-subnav-g">\u231A Time continuity</div>'
      + '<div class="vle-cz-note">The clock &amp; calendar guard: reversed time, day-creep, unexplained skips, and on/off-screen desync. Advisory only \u2014 nothing here blocks a turn.</div>'
      + timeRows;
  }
  // --- other continuity + reveals ---
  if (rows.length) {
    const otherRows = rows.slice(0, 60).map((r) =>
      `<div class="vle-dir-log-row vle-dir-log-${r.kind}"><span class="vle-dir-log-mark">${r.kind === 'flag' ? '\u26A0' : '\u26C0'}</span>`
      + `<span class="vle-dir-log-t">${esc(r.text)}</span>`
      + `<span class="vle-dir-log-turn">t${r.turn}</span></div>`).join('');
    body += (timeFlags.length ? '<div class="vle-subnav-g">Continuity &amp; reveals</div>' : '') + otherRows;
  }
  return head + body;
}

import { STYLES } from './styles.js';
import { mount, type Mounted } from './component.js';
import { freshState, type ChronicleState } from '../domain/types.js';
import { chronicleTab } from './tabs/chronicle.js';
import { castTab } from './tabs/cast.js';
import { relationsTab, setRelationLocks } from './tabs/relations.js';
import { graphTab, resetGraphCache } from './tabs/graph.js';
import { journalTab } from './tabs/journal.js';
import { injectionTab, setInjectionLog, pushInjectionRecord } from './tabs/injection.js';
import { vaultTab, setVaultSnap } from './tabs/vault.js';
import { createFloatWindow, type FloatWindow } from './float.js';
import { applyTheme, customizePanel, wireCustomize } from './theme.js';
import { dashboardHtml, setPhoneSection, setSysInfo } from './dashboard.js';
import { esc } from './format.js';
import type { Component } from './component.js';
import { wireBridge, wirePagers, wireFilters, refreshUI, send } from './bridge.js';
import { confirmModal, formModal } from './modal.js';

/**
 * Frontend entrypoint. One reusable shell (tab bar + QOL toolbar + body) is
 * mounted into BOTH the drawer tab and a beautiful floating window, so they
 * stay in lockstep. Each panel is an isolated Component with an error boundary,
 * so one panel's failure can never freeze the others. New tab = a Component +
 * one entry in TABS.
 */

interface Ctx {
  ui: {
    registerDrawerTab(opts: Record<string, unknown>): { root: HTMLElement; destroy(): void };
    registerInputBarAction?(opts: Record<string, unknown>): { destroy(): void };
  };
  dom: { addStyle(css: string): { remove(): void }; cleanup(): void };
  sendToBackend(payload: Record<string, unknown>): void;
  onBackendMessage(handler: (payload: any) => void): () => void;
  events?: { on(name: string, fn: (p: any) => void): () => void };
  toast?: { info?(m: string): void; warning?(m: string): void; success?(m: string): void };
}

const ICON = '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="color:var(--vg,#cda84e)"><path d="M4 3.5h9l3 3V16.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.4"/><path d="M6 9h8M6 12h6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';

// "Now" — the live-scene dashboard, reused as the first drawer view so the drawer
// and the floating window share one language (float = Now alone; drawer = Now +
// the archive tabs). Same composable section engine as the float (dashboard.ts).
const nowTab: Component<ChronicleState> = {
  version: (s) => `${s.turns}:${s.day}:${s.scene.location ?? ''}:${s.scene.tension ?? 0}:${s.scene.present.join(',')}:${s.relations.length}`,
  render: (s) => `<div class="vld">${dashboardHtml(s)}</div>`,
  mount: (host) => host.addEventListener('click', (e) => { const d = (e.target as HTMLElement).closest('[data-phone-sec]'); if (d) { setPhoneSection(d.getAttribute('data-phone-sec')!); refreshUI(); } }),
};

const TABS = [
  { id: 'now', label: 'Now', comp: nowTab, group: 'primary' },
  { id: 'chronicle', label: 'Chronicle', comp: chronicleTab, group: 'primary' },
  { id: 'cast', label: 'Cast', comp: castTab, group: 'primary' },
  { id: 'relations', label: 'Relations', comp: relationsTab, group: 'primary' },
  { id: 'journal', label: 'Journal', comp: journalTab, group: 'primary' },
  { id: 'graph', label: 'Graph', comp: graphTab, group: 'primary' },
  { id: 'vault', label: 'Vault', comp: vaultTab, group: 'tools' },
  { id: 'injection', label: 'Context', comp: injectionTab, group: 'tools' },
] as const;

// QOL actions, grouped. 'inline' stays on the toolbar; the rest live in the
// Actions menu so the shell isn't a wall of 12 equal-weight pills. Toggles show
// their current state; the destructive Clear is quarantined in its own group.
const QOL = [
  { id: 'customize', label: '\u25C8 Customize', title: 'Theme: color, font, size & skins', group: 'inline' },
  { id: 'summarize', label: '\u2727 Summarize', title: 'Compress older turns into chapter memories', group: 'maint' },
  { id: 'rescan', label: '\u21bb Rescan', title: 'Re-fold the latest turn from the raw message', group: 'maint' },
  { id: 'undo', label: '\u21A9 Undo turn', title: 'Drop the most recent turn\u2019s events (event-log undo)', group: 'maint' },
  { id: 'rebuild', label: '\u27F3 Rebuild', title: 'Reconstruct the whole chronicle from the chat transcript (recovery)', group: 'maint' },
  { id: 'tidy', label: '\u2702 Tidy threads', title: 'Merge near-duplicate plot threads now (needs generation permission)', group: 'maint' },
  { id: 'hide', label: '\u25d1 Hide filed', title: 'Hide summarized turns from the prompt (toggle)', group: 'toggle' },
  { id: 'traverse', label: '\u2748 Traverse', title: 'Controller-guided retrieval (click to cycle: off \u2192 flat one-shot \u2192 tree arc\u2192chapter\u2192leaf drill; needs generation permission)', group: 'toggle' },
  { id: 'tone', label: '\u2665 Tone', title: 'Romance pace + world disposition: steers how fast bonds form and how the world leans toward you', group: 'toggle' },
  { id: 'export', label: '\u2913 Export', title: 'Download the chronicle as JSON', group: 'data' },
  { id: 'import', label: '\u2912 Import', title: 'Load a chronicle JSON', group: 'data' },
  { id: 'clear', label: '\u2715 Clear', title: 'Erase all chronicle data for this chat', group: 'danger' },
] as const;

/** Open the Customize (theme) panel as a modal-style overlay. */
function openCustomize(onChange: () => void): void {
  const ov = document.createElement('div');
  ov.className = 'vlfm-overlay';
  ov.innerHTML = '<div class="vlfm vle-root" style="width:min(440px,94vw)"><div class="vlfm-head"><span class="vlfm-mark">\u2756</span>Customize</div>'
    + '<div class="vlfm-body" data-cz-host>' + customizePanel('skin') + '</div>'
    + '<div class="vlfm-foot"><button class="vlfm-btn vlfm-save" data-close>Done</button></div></div>';
  document.body.appendChild(ov);
  const host = ov.querySelector('[data-cz-host]') as HTMLElement;
  const reskin = () => applyTheme(ov.querySelector('.vlfm') as HTMLElement);
  reskin();
  wireCustomize(host, onChange, (tab) => { host.innerHTML = customizePanel(tab); reskin(); });
  const close = (): void => { try { ov.remove(); } catch { /* ignore */ } };
  ov.addEventListener('click', (e) => { if (e.target === ov || (e.target as HTMLElement).closest('[data-close]')) close(); });
}

/** A self-contained shell instance: renders the tab bar + toolbar + body. */
function createShell(ctx: Ctx, getState: () => ChronicleState) {
  const root = document.createElement('div');
  root.className = 'vle-root';
  const primary = TABS.filter((t) => t.group === 'primary');
  const tools = TABS.filter((t) => t.group === 'tools');
  const tabBtn = (t: typeof TABS[number], on: boolean): string => `<button class="vle-tabbtn${on ? ' on' : ''}" data-tab="${t.id}">${t.label}</button>`;
  root.innerHTML = '<div class="vle-head"><span class="vle-mark">\u2756</span> VELLUM <span class="vle-ver">II</span>'
    + '<span class="vle-stats" data-stats></span></div>'
    + '<div class="vle-tabbar" data-tabbar>'
      + primary.map((t, i) => tabBtn(t, i === 0)).join('')
      + '<span class="vle-tabbar-sep"></span>'
      + tools.map((t) => tabBtn(t, false)).join('')
    + '</div>'
    + '<div class="vle-toolbar" data-toolbar>'
      + '<button class="vle-qol" data-search title="Search the chronicle (cast, bonds, journal, knowledge)">\u2315 Search</button>'
      + '<button class="vle-qol" data-director title="Plot Director: steer the next scene">\u2691 Director</button>'
      + '<button class="vle-qol" data-qol="customize" title="Theme: color, font, size & skins">\u25C8 Customize</button>'
      + '<button class="vle-qol vle-qol-menu" data-actions title="Chronicle actions">\u22EF Actions</button>'
    + '</div>'
    + '<div class="vle-body" data-body></div>';

  const statsEl = root.querySelector('[data-stats]') as HTMLElement;
  const tabbar = root.querySelector('[data-tabbar]') as HTMLElement;
  const bodyEl = root.querySelector('[data-body]') as HTMLElement;
  let active: string = TABS[0]!.id;
  let mounted: Mounted<ChronicleState> | null = null;
  const _scroll = new Map<string, number>(); // remember reading position per tab

  const showTab = (id: string): void => {
    if (active !== id) _scroll.set(active, bodyEl.scrollTop); // stash before leaving
    active = id;
    tabbar.querySelectorAll('.vle-tabbtn').forEach((b) => b.classList.toggle('on', b.getAttribute('data-tab') === id));
    if (mounted) { mounted.destroy(); mounted = null; }
    bodyEl.innerHTML = '';
    const def = TABS.find((t) => t.id === id) ?? TABS[0]!;
    mounted = mount(bodyEl, def.comp, getState(), def.id);
    bodyEl.scrollTop = _scroll.get(id) ?? 0; // restore reading position
  };
  const stats = (): void => {
    const s = getState();
    const w = s.scene.weather ? ` \u00b7 \u2601 ${s.scene.weather}` : '';
    statsEl.innerHTML = `T${s.turns ?? 0} \u00b7 D${s.day ?? 0} \u00b7 ${Object.keys(s.cast).length} cast \u00b7 ${s.relations.length} bonds${w}`;
  };
  tabbar.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('[data-tab]'); if (b) showTab(b.getAttribute('data-tab')!); });
  root.querySelector('[data-toolbar]')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-qol]'); if (b) { onQol(ctx, b.getAttribute('data-qol')!); return; }
    if ((e.target as HTMLElement).closest('[data-search]')) openSearch(getState, showTab);
    if ((e.target as HTMLElement).closest('[data-director]')) openDirector(getState);
    if ((e.target as HTMLElement).closest('[data-actions]')) openActions(ctx);
  });
  wirePagers(bodyEl); // delegated pager clicks for any paginated list
  wireFilters(bodyEl); // delegated filter-bar controls

  showTab(active); stats();
  return {
    root,
    update(force = false): void { stats(); if (mounted) mounted.update(getState(), force); else showTab(active); },
    destroy(): void { try { mounted?.destroy(); } catch { /* ignore */ } try { root.remove(); } catch { /* ignore */ } },
  };
}

let _ctxRef: Ctx | null = null;
let _hideOn = false;
let _traverseMode = 'off'; // off | flat | tree
let _traverseAxis = 'temporal'; // temporal | character | hybrid (tree only)
const axisLabel = (a: string): string => a === 'character' ? 'by char' : a === 'hybrid' ? 'by char+time' : 'by time';
let _tone = { romance: 'medium', disposition: 'fair' };
let _tidyOn = false;
let _chapterVault = 'keyed';
let _retheme: () => void = () => { /* set in setup */ };

// Transient "running" indication for one-shot QOL actions. Set busy when the
// action is dispatched; cleared when the matching backend reply arrives. A
// safety timeout auto-clears so a dropped reply can't strand a button.
const _busyTimers = new Map<string, ReturnType<typeof setTimeout>>();
function setQolBusy(id: string, busy: boolean, timeoutMs = 30000): void {
  document.querySelectorAll(`[data-qol='${id}']`).forEach((b) => {
    b.classList.toggle('busy', busy);
    (b as HTMLButtonElement).disabled = busy;
  });
  const prev = _busyTimers.get(id);
  if (prev) { clearTimeout(prev); _busyTimers.delete(id); }
  if (busy) _busyTimers.set(id, setTimeout(() => setQolBusy(id, false), timeoutMs));
}

/** Open the grouped Actions menu as an overlay. Items reuse the same `data-qol`
 * ids so all existing busy/toggle wiring keeps working; only the container moved
 * off the always-on toolbar. Toggles render their current state inline. */
function openActions(ctx: Ctx): void {
  const ov = document.createElement('div');
  ov.className = 'vlfm-overlay';
  const toggleState: Record<string, string> = {
    hide: _hideOn ? 'on' : 'off',
    traverse: _traverseMode === 'off' ? 'off' : (_traverseMode === 'tree' ? `tree \u00b7 ${axisLabel(_traverseAxis)}` : 'flat'),
    tone: (_tone.romance === 'medium' && _tone.disposition === 'fair') ? 'default' : `${_tone.romance.replace('_', ' ')} \u00b7 ${_tone.disposition}`,
  };
  const groups: Array<[string, string]> = [['maint', 'Maintenance'], ['toggle', 'Toggles'], ['data', 'Data'], ['danger', 'Danger']];
  const body = groups.map(([g, label]) => {
    const items = QOL.filter((q) => q.group === g);
    if (!items.length) return '';
    const rows = items.map((q) => {
      const st = toggleState[q.id];
      const stHtml = g === 'toggle' ? `<span class="vle-act-st">${esc(st ?? '')}</span>` : '';
      return `<button class="vle-act-item${g === 'danger' ? ' danger' : ''}" data-qol="${q.id}" title="${esc(q.title)}"><span class="vle-act-l">${q.label}</span>${stHtml}</button>`;
    }).join('');
    return `<div class="vle-act-grp"><div class="vle-act-h">${label}</div>${rows}</div>`;
  }).join('');
  ov.innerHTML = '<div class="vlfm vle-root" style="width:min(420px,94vw)"><div class="vlfm-head"><span class="vlfm-mark">\u22EF</span>Actions</div>'
    + `<div class="vlfm-body vle-acts">${body}</div>`
    + '<div class="vlfm-foot"><button class="vlfm-btn vlfm-cancel" data-close>Close</button></div></div>';
  document.body.appendChild(ov);
  applyTheme(ov.querySelector('.vlfm') as HTMLElement);
  const close = (): void => { try { ov.remove(); } catch { /* ignore */ } };
  ov.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === ov || t.closest('[data-close]')) { close(); return; }
    const item = t.closest('[data-qol]');
    if (item) { close(); onQol(ctx, item.getAttribute('data-qol')!); }
  });
}

interface SearchHit { tab: string; kind: string; label: string; sub: string }
/** Flat free-text search across cast, factions, relations, journal, knowledge,
 * secrets by name/text. Result click jumps to the owning tab. Read-only over
 * state; no index to maintain — the chronicle is small enough to scan live. */
function buildSearchIndex(s: ChronicleState): SearchHit[] {
  const hits: SearchHit[] = [];
  const nm = (id: string): string => s.cast[id]?.name ?? id;
  for (const c of Object.values(s.cast)) hits.push({ tab: 'cast', kind: 'cast', label: c.name, sub: [c.role, c.status].filter(Boolean).join(' \u00b7 ') });
  for (const f of Object.values(s.factions)) hits.push({ tab: 'cast', kind: 'faction', label: f.name, sub: f.kind || 'faction' });
  for (const r of s.relations) hits.push({ tab: 'relations', kind: 'bond', label: `${nm(r.a)} \u2192 ${nm(r.b)}`, sub: r.label || r.categories.join(', ') });
  for (const j of s.journal) hits.push({ tab: 'journal', kind: 'journal', label: nm(j.who), sub: j.memory });
  for (const k of s.knowledge) hits.push({ tab: 'chronicle', kind: 'knowledge', label: nm(k.who), sub: k.fact });
  for (const sec of s.secrets) hits.push({ tab: 'chronicle', kind: 'secret', label: nm(sec.keeper), sub: sec.text });
  return hits;
}

function openSearch(getState: () => ChronicleState, go: (tab: string) => void): void {
  const index = buildSearchIndex(getState());
  const ov = document.createElement('div');
  ov.className = 'vlfm-overlay';
  ov.innerHTML = '<div class="vlfm vle-root" style="width:min(520px,94vw)"><div class="vlfm-head"><span class="vlfm-mark">\u2315</span>Search</div>'
    + '<div class="vlfm-body"><input class="vlfm-in" data-search-in placeholder="character, bond, memory, fact\u2026" autocomplete="off" spellcheck="false">'
    + '<div class="vle-search-results" data-search-out></div></div>'
    + '<div class="vlfm-foot"><button class="vlfm-btn vlfm-cancel" data-close>Close</button></div></div>';
  document.body.appendChild(ov);
  applyTheme(ov.querySelector('.vlfm') as HTMLElement);
  const input = ov.querySelector('[data-search-in]') as HTMLInputElement;
  const out = ov.querySelector('[data-search-out]') as HTMLElement;
  const close = (): void => { try { ov.remove(); } catch { /* ignore */ } };
  const render = (): void => {
    const q = input.value.trim().toLowerCase();
    if (!q) { out.innerHTML = '<div class="vle-empty sm">Type to search the chronicle.</div>'; return; }
    const matches = index.filter((h) => h.label.toLowerCase().includes(q) || h.sub.toLowerCase().includes(q)).slice(0, 40);
    if (!matches.length) { out.innerHTML = `<div class="vle-empty sm">No matches for \u201c${esc(q)}\u201d.</div>`; return; }
    out.innerHTML = matches.map((h) =>
      `<button class="vle-search-hit" data-go="${esc(h.tab)}"><span class="vle-search-k">${esc(h.kind)}</span><span class="vle-search-l">${esc(h.label)}</span><span class="vle-search-s">${esc(h.sub.slice(0, 80))}</span></button>`).join('');
  };
  input.addEventListener('input', render);
  ov.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === ov || t.closest('[data-close]')) { close(); return; }
    const hit = t.closest('[data-go]'); if (hit) { go(hit.getAttribute('data-go')!); close(); }
  });
  render();
  setTimeout(() => input.focus(), 30);
}

// Plot Director directives mirrored from the backend broadcast.
interface UIDirective { id: string; kind: string; text: string; target?: string; status: string; ttl: number }
let _directives: UIDirective[] = [];
function setDirectives(d: UIDirective[]): void { _directives = Array.isArray(d) ? d : []; }

const DIR_KIND_LABEL: Record<string, string> = {
  reveal_secret: 'reveal secret', reveal_knowledge: 'act on knowledge', advance_thread: 'advance thread', note: 'note',
};

/** Plot Director panel: armed/done directives + add a new one. Directives are
 * gentle nudges injected next turn; they self-clear when the fold sees them done. */
function openDirector(getState: () => ChronicleState): void {
  const s = getState();
  const ov = document.createElement('div');
  ov.className = 'vlfm-overlay';
  const armed = _directives.filter((d) => d.status === 'armed');
  const list = armed.length
    ? armed.map((d) => `<div class="vle-dir-row"><span class="vle-dir-k">${esc(DIR_KIND_LABEL[d.kind] ?? d.kind)}</span><span class="vle-dir-t">${esc(d.text)}</span><button class="vle-mini del" data-dir-del="${esc(d.id)}" title="Remove">\u2715</button></div>`).join('')
    : '<div class="vle-empty sm">No active directives. Add one to steer the next scene.</div>';
  ov.innerHTML = '<div class="vlfm vle-root" style="width:min(480px,94vw)"><div class="vlfm-head"><span class="vlfm-mark">\u2691</span>Plot Director</div>'
    + `<div class="vlfm-body"><div class="vle-cz-h">Active intent</div><div class="vle-dir-list">${list}</div>`
    + '<div class="vle-cz-row"><button class="vle-cz-btn" data-dir-add>+ Add directive</button></div>'
    + '<div class="vle-cz-note">Directives inject as gentle guidance next scene and self-clear when fulfilled. They suggest \u2014 they don\u2019t force.</div></div>'
    + '<div class="vlfm-foot"><button class="vlfm-btn vlfm-cancel" data-close>Close</button></div></div>';
  document.body.appendChild(ov);
  applyTheme(ov.querySelector('.vlfm') as HTMLElement);
  const close = (): void => { try { ov.remove(); } catch { /* ignore */ } };
  const push = (next: UIDirective[]): void => { send({ type: 'vellum_set_directives', directives: next }); close(); };
  ov.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === ov || t.closest('[data-close]')) { close(); return; }
    const del = t.closest('[data-dir-del]');
    if (del) { push(_directives.filter((d) => d.id !== del.getAttribute('data-dir-del'))); return; }
    if (t.closest('[data-dir-add]')) { close(); addDirective(s); }
  });
}

/** Add-directive form: pick a kind + target (an existing secret/thread) or a note. */
function addDirective(s: ChronicleState): void {
  const secrets = s.secrets.filter((x) => !x.revealed).map((x) => ({ value: 'reveal_secret|' + x.id, label: 'reveal: ' + x.text.slice(0, 50) }));
  const threads = s.threads.filter((t) => t.status !== 'resolved').map((t) => ({ value: 'advance_thread|' + t.name, label: 'advance: ' + t.name }));
  const opts = [...secrets, ...threads, { value: 'note|', label: 'free note (custom)' }];
  if (!opts.length) return;
  formModal('New directive', [
    { key: 'pick', label: 'What should happen next scene?', type: 'select', value: opts[0]!.value, options: opts },
    { key: 'note', label: 'Custom note (for free note, or extra detail)', type: 'text', value: '' },
    { key: 'ttl', label: 'Expire after N turns (0 = never)', type: 'text', value: '6' },
  ], (out) => {
    const parts = (out.pick ?? 'note|').split('|');
    const kind = parts[0] || 'note';
    const target = parts[1] || '';
    const ttl = Math.max(0, Math.min(50, parseInt(out.ttl ?? '6', 10) || 0));
    let text = out.note?.trim() ?? '';
    if (!text) {
      const sec = s.secrets.find((x) => x.id === target);
      const thr = s.threads.find((t) => t.name === target);
      text = kind === 'reveal_secret' && sec ? `Reveal the secret: ${sec.text}` : kind === 'advance_thread' && thr ? `Advance the thread: ${thr.name}` : 'Director note';
    }
    const dir: UIDirective = { id: 'd' + Date.now().toString(36), kind, text, ...(target ? { target } : {}), status: 'armed', ttl };
    send({ type: 'vellum_set_directives', directives: [..._directives.filter((d) => d.status === 'armed'), dir] });
  });
}

function onQol(ctx: Ctx, id: string): void {
  if (id === 'customize') { openCustomize(() => _retheme()); }
  else if (id === 'summarize') { setQolBusy('summarize', true); ctx.sendToBackend({ type: 'vellum_summarize' }); ctx.toast?.info?.('Summarizing older turns\u2026'); }
  else if (id === 'rescan') { setQolBusy('rescan', true); ctx.sendToBackend({ type: 'vellum_rescan' }); ctx.toast?.info?.('Rescanning the latest turn\u2026'); }
  else if (id === 'undo') { confirmModal('Undo the most recent turn? This drops that turn\u2019s chronicle events (the chat messages are untouched).', () => { setQolBusy('undo', true); ctx.sendToBackend({ type: 'vellum_undo' }); }); }
  else if (id === 'rebuild') { confirmModal('Rebuild the entire chronicle from this chat\u2019s transcript? This replaces the current chronicle by re-reading every turn (use this to recover after data loss). Deep extraction (knowledge/secrets/journal) runs too.', () => { setQolBusy('rebuild', true); ctx.sendToBackend({ type: 'vellum_rebuild', deep: true }); ctx.toast?.info?.('Rebuilding chronicle from transcript\u2026 this may take a moment.'); }); }
  else if (id === 'hide') { _hideOn = !_hideOn; setQolBusy('hide', true); ctx.sendToBackend({ type: 'vellum_set_hide', enabled: _hideOn }); }
  else if (id === 'traverse') {
    // cycle: off → flat → tree·time → tree·char → tree·hybrid → off
    if (_traverseMode === 'off') { _traverseMode = 'flat'; }
    else if (_traverseMode === 'flat') { _traverseMode = 'tree'; _traverseAxis = 'temporal'; }
    else if (_traverseMode === 'tree' && _traverseAxis === 'temporal') { _traverseAxis = 'character'; }
    else if (_traverseMode === 'tree' && _traverseAxis === 'character') { _traverseAxis = 'hybrid'; }
    else { _traverseMode = 'off'; _traverseAxis = 'temporal'; }
    setQolBusy('traverse', true);
    ctx.sendToBackend({ type: 'vellum_set_traversal', mode: _traverseMode, axis: _traverseAxis });
  }
  else if (id === 'tone') { openToneModal(ctx); }
  else if (id === 'tidy') { setQolBusy('tidy', true); ctx.sendToBackend({ type: 'vellum_tidy_now' }); ctx.toast?.info?.('Reconciling plot threads\u2026'); }
  else if (id === 'export') { setQolBusy('export', true); ctx.sendToBackend({ type: 'vellum_export' }); }
  else if (id === 'import') { triggerImport(ctx); }
  else if (id === 'clear') { confirmModal('Erase ALL VELLUM chronicle data for this chat? This cannot be undone.', () => { setQolBusy('clear', true); ctx.sendToBackend({ type: 'vellum_clear' }); }); }
}

function openToneModal(ctx: Ctx): void {
  formModal('Tone & Relationship', [
    { key: 'romance', label: 'Romance Pace', type: 'select', value: _tone.romance, options: [
      { value: 'off', label: 'Off (no romance)' },
      { value: 'slow_burn', label: 'Slow Burn' },
      { value: 'medium', label: 'Measured' },
      { value: 'fast', label: 'Fast-Paced' },
      { value: 'erotic', label: 'Erotic' },
    ] },
    { key: 'disposition', label: 'World Disposition', type: 'select', value: _tone.disposition, options: [
      { value: 'kind', label: 'Kind (everybody warms to you)' },
      { value: 'warm', label: 'Warm' },
      { value: 'fair', label: 'Fair (neutral)' },
      { value: 'harsh', label: 'Harsh' },
      { value: 'brutal', label: 'Brutal (the world is against you)' },
    ] },
    { key: 'tidy', label: 'Auto-tidy plot threads', type: 'select', value: _tidyOn ? 'on' : 'off', options: [
      { value: 'off', label: 'Off' },
      { value: 'on', label: 'On (merge duplicate threads as you play)' },
    ] },
    { key: 'chaptervault', label: 'Chapter detail in vault', type: 'select', value: _chapterVault, options: [
      { value: 'keyed', label: 'Keyed (detailed chapters, injected on relevance)' },
      { value: 'constant', label: 'Constant (detailed chapters, always in context)' },
      { value: 'off', label: 'Off (chronicle gist only)' },
    ] },
  ], (out) => {
    ctx.sendToBackend({ type: 'vellum_set_tone', romance: out.romance, disposition: out.disposition });
    ctx.sendToBackend({ type: 'vellum_set_tidy', enabled: out.tidy === 'on' });
    ctx.sendToBackend({ type: 'vellum_set_chaptervault', mode: out.chaptervault });
  });
}

function triggerImport(ctx: Ctx): void {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.addEventListener('change', () => {
    const f = inp.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { try { const log = JSON.parse(String(r.result)); setQolBusy('import', true); ctx.sendToBackend({ type: 'vellum_import', log }); ctx.toast?.info?.('Importing chronicle\u2026'); } catch { ctx.toast?.warning?.('That file is not valid JSON.'); } };
    r.readAsText(f);
  });
  inp.click();
}

function downloadJson(name: string, data: unknown): void {
  try {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch { /* ignore */ }
}

export function setup(ctx: Ctx): () => void {
  _ctxRef = ctx;
  const style = ctx.dom.addStyle(STYLES);
  let state: ChronicleState = freshState();
  const getState = (): ChronicleState => state;

  const tab = ctx.ui.registerDrawerTab({
    id: 'vellum-engine-tab', title: 'VELLUM', shortName: 'VELLUM',
    description: 'Living-narrative chronicle, cast, relations, graph & QOL',
    keywords: ['vellum', 'chronicle', 'cast', 'relations', 'lore', 'memory', 'graph'],
    headerTitle: 'VELLUM', iconSvg: ICON,
  });
  const drawer = createShell(ctx, getState);
  tab.root.appendChild(drawer.root);

  // apply the saved theme to the drawer shell + document (launcher/toggle/icon)
  applyTheme(drawer.root);
  _retheme = () => { applyTheme(drawer.root); try { float.applyTheme(); float.refresh(); } catch { /* ignore */ } };

  // bridge: tab components issue CRUD via send(); refresh re-renders both shells
  wireBridge((payload) => ctx.sendToBackend(payload), (force?: boolean) => { drawer.update(force); float.refresh(); });

  // beautiful floating window â€” a live scene DASHBOARD with a refresh button
  const float: FloatWindow = createFloatWindow({
    title: 'VELLUM',
    actions: [{ id: 'refresh', label: '\u27F3', title: 'Refresh' }],
    onAction: (id) => { if (id === 'refresh') ctx.sendToBackend({ type: 'vellum_get_state' }); },
    render: (host) => {
      try { host.innerHTML = `<div class="vld">${dashboardHtml(getState())}</div>`; } catch (e) { try { console.warn('[vellum] dashboard render failed:', e); } catch { /* ignore */ } host.innerHTML = '<div class="vld"><div class="vle-empty sm">Dashboard hit an error. Hit refresh.</div></div>'; }
      if (!host.hasAttribute('data-phone-wired')) { host.setAttribute('data-phone-wired', '1'); host.addEventListener('click', (e) => { const d = (e.target as HTMLElement).closest('[data-phone-sec]'); if (d) { setPhoneSection(d.getAttribute('data-phone-sec')!); refreshUI(); } }); }
    },
  });
  let floatShell: ReturnType<typeof createShell> | null = null;
  void floatShell; void createShell;

  let inputBtn: { destroy(): void } | null = null;
  try {
    inputBtn = ctx.ui.registerInputBarAction?.({ id: 'vellum-float-toggle', title: 'VELLUM window', iconSvg: ICON, onClick: () => float.toggle() }) ?? null;
  } catch { /* optional */ }

  const unsub = ctx.onBackendMessage((p: any) => {
    try {
      if (p?.type === 'vellum_state') {
        state = p.state ?? freshState();
        if (p.tone) {
          _tone = { romance: p.tone.romance ?? 'medium', disposition: p.tone.disposition ?? 'fair' };
          const isDefault = _tone.romance === 'medium' && _tone.disposition === 'fair';
          document.querySelectorAll('[data-qol=\'tone\']').forEach((b) => b.classList.toggle('on', !isDefault));
        }
        if (typeof p.tidy === 'boolean') _tidyOn = p.tidy;
        if (typeof p.chapterVault === 'string') _chapterVault = p.chapterVault;
        if (Array.isArray(p.relationLocks)) setRelationLocks(p.relationLocks);
        if (Array.isArray(p.directives)) setDirectives(p.directives);
        if (typeof p.traversalMode === 'string') {
          _traverseMode = p.traversalMode;
          if (typeof p.traversalAxis === 'string') _traverseAxis = p.traversalAxis;
          document.querySelectorAll('[data-qol=\'traverse\']').forEach((b) => b.classList.toggle('on', _traverseMode !== 'off'));
        }
        setSysInfo({ recall: _traverseMode === 'off' ? 'off' : _traverseMode === 'tree' ? `tree\u00b7${axisLabel(_traverseAxis)}` : 'flat' });
        drawer.update(); float.refresh();
      } else if (p?.type === 'vellum_injection') {
        setInjectionLog(p.log ?? []);
        if (p.log?.[0]?.chars) setSysInfo({ injChars: p.log[0].chars });
        drawer.update(); float.refresh();
      } else if (p?.type === 'vellum_injection_push') {
        // Fix 11 — live retrieval feed: stream the new record in as it happens
        if (p.record) { pushInjectionRecord(p.record); if (p.record.chars) setSysInfo({ injChars: p.record.chars }); drawer.update(); float.refresh(); }
      } else if (p?.type === 'vellum_vault') {
        setVaultSnap(p);
        drawer.update();
      } else if (p?.type === 'vellum_vault_categories') {
        // categories changed — re-request the full snapshot to reflect counts
        ctx.sendToBackend({ type: 'vellum_get_vault' });
      } else if (p?.type === 'vellum_vault_done') {
        if (!p.ok) ctx.toast?.warning?.('Vault: ' + (p.reason ?? 'failed'));
      } else if (p?.type === 'vellum_export' && p.log) {
        setQolBusy('export', false);
        downloadJson(`vellum-${p.chatId ?? 'chronicle'}.json`, p.log);
        ctx.toast?.success?.('Chronicle exported.');
      } else if (p?.type === 'vellum_summarize_done') {
        setQolBusy('summarize', false);
        ctx.toast?.success?.(p.rounds ? `Summarized ${p.rounds} chapter${p.rounds === 1 ? '' : 's'}.` : 'Nothing old enough to summarize yet.');
        // surface WHY the vault didn't update (the silent-gate that hid this)
        const v = p.vault;
        if (p.rounds && v && !v.created && !v.updated) {
          if (v.reason === 'no_world_books') ctx.toast?.warning?.('Chapter detail not saved to vault — grant the world_books permission.');
          else if (v.reason === 'mode_off') ctx.toast?.info?.('Chapter-vault is off (Tone \u2192 Chapter detail in vault) — chronicle gist only.');
        } else if (v && (v.created || v.updated)) {
          ctx.toast?.success?.(`Vault: ${v.created} chapter${v.created === 1 ? '' : 's'} saved${v.updated ? `, ${v.updated} updated` : ''}.`);
        }
      } else if (p?.type === 'vellum_cleared') {
        setQolBusy('clear', false);
        ctx.toast?.success?.('Chronicle cleared.');
      } else if (p?.type === 'vellum_import_done') {
        setQolBusy('import', false);
        ctx.toast?.[p.ok ? 'success' : 'warning']?.(p.ok ? `Imported ${p.events ?? ''} events.` : `Import failed: ${p.reason ?? 'error'}`);
      } else if (p?.type === 'vellum_rescan_done') {
        setQolBusy('rescan', false);
        ctx.toast?.success?.('Rescanned.');
      } else if (p?.type === 'vellum_undo_done') {
        setQolBusy('undo', false);
        ctx.toast?.[p.ok ? 'success' : 'warning']?.(p.ok ? `Undid turn ${p.undoneTurn ?? ''}.` : (p.reason === 'nothing_to_undo' ? 'Nothing to undo.' : `Undo failed: ${p.reason ?? 'error'}`));
      } else if (p?.type === 'vellum_rebuild_done') {
        setQolBusy('rebuild', false);
        ctx.toast?.[p.ok ? 'success' : 'warning']?.(p.ok ? `Chronicle rebuilt from ${p.turns ?? 0} turn(s).` : `Rebuild failed: ${p.reason ?? 'error'}`);
      } else if (p?.type === 'vellum_hide_done') {
        setQolBusy('hide', false);
        _hideOn = !!p.enabled;
        document.querySelectorAll('[data-qol=\'hide\']').forEach((b) => b.classList.toggle('on', _hideOn));
        ctx.toast?.success?.(p.enabled ? `Hiding ${p.hid ?? 0} filed turn(s) from the prompt.` : `Restored ${p.shown ?? 0} turn(s).`);
      } else if (p?.type === 'vellum_traversal_done') {
        setQolBusy('traverse', false);
        _traverseMode = p.mode ?? (p.enabled ? 'flat' : 'off');
        if (typeof p.axis === 'string') _traverseAxis = p.axis;
        document.querySelectorAll('[data-qol=\'traverse\']').forEach((b) => b.classList.toggle('on', _traverseMode !== 'off'));
        if (_traverseMode !== 'off' && !p.available) ctx.toast?.warning?.('Traversal needs the generation permission \u2014 falling back to standard recall.');
        else if (_traverseMode === 'tree') ctx.toast?.success?.(`Controller retrieval: tree drill (${_traverseAxis === 'character' ? 'by character' : _traverseAxis === 'hybrid' ? 'by character + timeline' : 'by timeline'}).`);
        else ctx.toast?.success?.(_traverseMode === 'flat' ? 'Controller retrieval: flat (one-shot).' : 'Controller retrieval off.');
      } else if (p?.type === 'vellum_tone_done') {
        _tone = { romance: p.romance ?? 'medium', disposition: p.disposition ?? 'fair' };
        const isDefault = _tone.romance === 'medium' && _tone.disposition === 'fair';
        document.querySelectorAll('[data-qol=\'tone\']').forEach((b) => b.classList.toggle('on', !isDefault));
        ctx.toast?.success?.(`Tone set \u2014 romance: ${_tone.romance.replace('_', ' ')}, world: ${_tone.disposition}.`);
      } else if (p?.type === 'vellum_tidy_done') {
        setQolBusy('tidy', false);
        if (!p.ok) ctx.toast?.warning?.(p.reason === 'no_generation' ? 'Tidy threads needs the generation permission.' : 'Tidy threads failed.');
        else ctx.toast?.success?.(p.merged ? `Merged ${p.merged} duplicate thread(s).` : 'No duplicate threads found.');
      } else if (p?.type === 'vellum_tidy_set_done') {
        _tidyOn = !!p.enabled;
        if (p.enabled && !p.available) ctx.toast?.warning?.('Auto-tidy needs the generation permission to run.');
        else ctx.toast?.success?.(p.enabled ? 'Auto-tidy threads on.' : 'Auto-tidy threads off.');
      } else if (p?.type === 'vellum_chaptervault_done') {
        _chapterVault = p.mode ?? 'keyed';
        if (p.mode !== 'off' && !p.available) ctx.toast?.warning?.('Chapter-vault needs the world_books permission \u2014 keeping chronicle gist only.');
        else ctx.toast?.success?.(p.mode === 'off' ? 'Chapter detail: chronicle only.' : `Chapter detail \u2192 vault (${p.mode}).`);
      }
    } catch (e) { try { console.warn('[vellum] message handler:', e); } catch { /* ignore */ } }
  });

  const offChat = ctx.events?.on('CHAT_SWITCHED', () => { resetGraphCache(); ctx.sendToBackend({ type: 'vellum_get_state' }); });
  // belt-and-suspenders: after a turn finishes, pull fresh state a couple times
  // (the backend folds asynchronously + may retry reading a just-committed msg)
  const offGen = ctx.events?.on('GENERATION_ENDED', () => {
    setTimeout(() => ctx.sendToBackend({ type: 'vellum_get_state' }), 600);
    setTimeout(() => ctx.sendToBackend({ type: 'vellum_get_state' }), 1800);
  });
  ctx.sendToBackend({ type: 'vellum_get_state' });

  return () => {
    try { unsub(); } catch { /* ignore */ }
    try { offChat?.(); } catch { /* ignore */ }
    try { offGen?.(); } catch { /* ignore */ }
    try { drawer.destroy(); } catch { /* ignore */ }
    try { float.destroy(); } catch { /* ignore */ }
    try { inputBtn?.destroy(); } catch { /* ignore */ }
    try { tab.destroy(); } catch { /* ignore */ }
    try { style.remove(); } catch { /* ignore */ }
    try { ctx.dom.cleanup(); } catch { /* ignore */ }
  };
}

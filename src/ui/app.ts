import { STYLES } from './styles.js';
import { mount, type Mounted } from './component.js';
import { freshState, type ChronicleState } from '../domain/types.js';
import { chronicleTab } from './tabs/chronicle.js';
import { castTab } from './tabs/cast.js';
import { relationsTab } from './tabs/relations.js';
import { graphTab, resetGraphCache } from './tabs/graph.js';
import { journalTab } from './tabs/journal.js';
import { injectionTab, setInjectionLog, pushInjectionRecord } from './tabs/injection.js';
import { vaultTab, setVaultSnap } from './tabs/vault.js';
import { createFloatWindow, type FloatWindow } from './float.js';
import { applyTheme, customizePanel, wireCustomize } from './theme.js';
import { dashboardHtml } from './dashboard.js';
import { wireBridge, wirePagers, wireFilters } from './bridge.js';
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

const TABS = [
  { id: 'chronicle', label: 'Chronicle', comp: chronicleTab },
  { id: 'cast', label: 'Cast', comp: castTab },
  { id: 'relations', label: 'Relations', comp: relationsTab },
  { id: 'journal', label: 'Journal', comp: journalTab },
  { id: 'graph', label: 'Graph', comp: graphTab },
  { id: 'vault', label: 'Vault', comp: vaultTab },
  { id: 'injection', label: 'Injection', comp: injectionTab },
] as const;

const QOL = [
  { id: 'customize', label: '\u25C8 Customize', title: 'Theme: color, font, size & skins' },
  { id: 'summarize', label: '\u2727 Summarize', title: 'Compress older turns into chapter memories' },
  { id: 'rescan', label: '\u21bb Rescan', title: 'Re-fold the latest turn from the raw message' },
  { id: 'undo', label: '\u21A9 Undo turn', title: 'Drop the most recent turn\u2019s events (event-log undo)' },
  { id: 'rebuild', label: '\u27F3 Rebuild', title: 'Reconstruct the whole chronicle from the chat transcript (recovery)' },
  { id: 'hide', label: '\u25d1 Hide filed', title: 'Hide summarized turns from the prompt (toggle)' },
  { id: 'traverse', label: '\u2748 Traverse', title: 'Controller-guided retrieval (click to cycle: off \u2192 flat one-shot \u2192 tree arc\u2192chapter\u2192leaf drill; needs generation permission)' },
  { id: 'tone', label: '\u2665 Tone', title: 'Romance pace + world disposition: steers how fast bonds form and how the world leans toward you' },
  { id: 'tidy', label: '\u2702 Tidy threads', title: 'Merge near-duplicate plot threads now (needs generation permission)' },
  { id: 'export', label: '\u2913 Export', title: 'Download the chronicle as JSON' },
  { id: 'import', label: '\u2912 Import', title: 'Load a chronicle JSON' },
  { id: 'clear', label: '\u2715 Clear', title: 'Erase all chronicle data for this chat' },
];

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
  root.innerHTML = '<div class="vle-head"><span class="vle-mark">\u2756</span> VELLUM <span class="vle-ver">II</span>'
    + '<span class="vle-stats" data-stats></span></div>'
    + '<div class="vle-tabbar" data-tabbar>' + TABS.map((t, i) =>
      `<button class="vle-tabbtn${i === 0 ? ' on' : ''}" data-tab="${t.id}">${t.label}</button>`).join('') + '</div>'
    + '<div class="vle-toolbar" data-toolbar>' + QOL.map((q) =>
      `<button class="vle-qol" data-qol="${q.id}" title="${q.title}">${q.label}</button>`).join('') + '</div>'
    + '<div class="vle-body" data-body></div>';

  const statsEl = root.querySelector('[data-stats]') as HTMLElement;
  const tabbar = root.querySelector('[data-tabbar]') as HTMLElement;
  const bodyEl = root.querySelector('[data-body]') as HTMLElement;
  let active: string = TABS[0]!.id;
  let mounted: Mounted<ChronicleState> | null = null;

  const showTab = (id: string): void => {
    active = id;
    tabbar.querySelectorAll('.vle-tabbtn').forEach((b) => b.classList.toggle('on', b.getAttribute('data-tab') === id));
    if (mounted) { mounted.destroy(); mounted = null; }
    bodyEl.innerHTML = '';
    const def = TABS.find((t) => t.id === id) ?? TABS[0]!;
    mounted = mount(bodyEl, def.comp, getState(), def.id);
  };
  const stats = (): void => {
    const s = getState();
    const w = s.scene.weather ? ` \u00b7 \u2601 ${s.scene.weather}` : '';
    statsEl.innerHTML = `T${s.turns ?? 0} \u00b7 D${s.day ?? 0} \u00b7 ${Object.keys(s.cast).length} cast \u00b7 ${s.relations.length} bonds${w}`;
  };
  tabbar.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('[data-tab]'); if (b) showTab(b.getAttribute('data-tab')!); });
  root.querySelector('[data-toolbar]')!.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('[data-qol]'); if (b) onQol(ctx, b.getAttribute('data-qol')!); });
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
let _traverseAxis = 'temporal'; // temporal | character (tree only)
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

function onQol(ctx: Ctx, id: string): void {
  if (id === 'customize') { openCustomize(() => _retheme()); }
  else if (id === 'summarize') { setQolBusy('summarize', true); ctx.sendToBackend({ type: 'vellum_summarize' }); ctx.toast?.info?.('Summarizing older turns\u2026'); }
  else if (id === 'rescan') { setQolBusy('rescan', true); ctx.sendToBackend({ type: 'vellum_rescan' }); ctx.toast?.info?.('Rescanning the latest turn\u2026'); }
  else if (id === 'undo') { confirmModal('Undo the most recent turn? This drops that turn\u2019s chronicle events (the chat messages are untouched).', () => { setQolBusy('undo', true); ctx.sendToBackend({ type: 'vellum_undo' }); }); }
  else if (id === 'rebuild') { confirmModal('Rebuild the entire chronicle from this chat\u2019s transcript? This replaces the current chronicle by re-reading every turn (use this to recover after data loss). Deep extraction (knowledge/secrets/journal) runs too.', () => { setQolBusy('rebuild', true); ctx.sendToBackend({ type: 'vellum_rebuild', deep: true }); ctx.toast?.info?.('Rebuilding chronicle from transcript\u2026 this may take a moment.'); }); }
  else if (id === 'hide') { _hideOn = !_hideOn; setQolBusy('hide', true); ctx.sendToBackend({ type: 'vellum_set_hide', enabled: _hideOn }); }
  else if (id === 'traverse') {
    // cycle: off → flat → tree·time → tree·char → off
    if (_traverseMode === 'off') { _traverseMode = 'flat'; }
    else if (_traverseMode === 'flat') { _traverseMode = 'tree'; _traverseAxis = 'temporal'; }
    else if (_traverseMode === 'tree' && _traverseAxis === 'temporal') { _traverseAxis = 'character'; }
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
    render: (host) => { try { host.innerHTML = `<div class="vld">${dashboardHtml(getState())}</div>`; } catch (e) { try { console.warn('[vellum] dashboard render failed:', e); } catch { /* ignore */ } host.innerHTML = '<div class="vld"><div class="vle-empty sm">Dashboard hit an error. Hit refresh.</div></div>'; } },
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
        if (typeof p.traversalMode === 'string') {
          _traverseMode = p.traversalMode;
          if (typeof p.traversalAxis === 'string') _traverseAxis = p.traversalAxis;
          document.querySelectorAll('[data-qol=\'traverse\']').forEach((b) => b.classList.toggle('on', _traverseMode !== 'off'));
        }
        drawer.update(); float.refresh();
      } else if (p?.type === 'vellum_injection') {
        setInjectionLog(p.log ?? []);
        drawer.update(); float.refresh();
      } else if (p?.type === 'vellum_injection_push') {
        // Fix 11 — live retrieval feed: stream the new record in as it happens
        if (p.record) { pushInjectionRecord(p.record); drawer.update(); float.refresh(); }
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
        else if (_traverseMode === 'tree') ctx.toast?.success?.(`Controller retrieval: tree drill (${_traverseAxis === 'character' ? 'by character' : 'by timeline'}).`);
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

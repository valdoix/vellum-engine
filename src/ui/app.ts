import { STYLES } from './styles.js';
import { mount, type Mounted } from './component.js';
import { freshState, type ChronicleState } from '../domain/types.js';
import { chronicleTab } from './tabs/chronicle.js';
import { castTab } from './tabs/cast.js';
import { relationsTab } from './tabs/relations.js';
import { graphTab, resetGraphCache } from './tabs/graph.js';
import { createFloatWindow, type FloatWindow } from './float.js';

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

const ICON = '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 3.5h9l3 3V16.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z" stroke="#cda84e" stroke-width="1.4"/><path d="M6 9h8M6 12h6" stroke="#cda84e" stroke-width="1.2" stroke-linecap="round"/></svg>';

const TABS = [
  { id: 'chronicle', label: 'Chronicle', comp: chronicleTab },
  { id: 'cast', label: 'Cast', comp: castTab },
  { id: 'relations', label: 'Relations', comp: relationsTab },
  { id: 'graph', label: 'Graph', comp: graphTab },
] as const;

const QOL = [
  { id: 'summarize', label: '\u2727 Summarize', title: 'Compress older turns into chapter memories' },
  { id: 'export', label: '\u2913 Export', title: 'Download the chronicle as JSON' },
  { id: 'import', label: '\u2912 Import', title: 'Load a chronicle JSON' },
  { id: 'clear', label: '\u2715 Clear', title: 'Erase all chronicle data for this chat' },
];

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
    statsEl.innerHTML = `T${s.turns ?? 0} \u00b7 D${s.day ?? 0} \u00b7 ${Object.keys(s.cast).length} cast \u00b7 ${s.relations.length} bonds`;
  };
  tabbar.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('[data-tab]'); if (b) showTab(b.getAttribute('data-tab')!); });
  root.querySelector('[data-toolbar]')!.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('[data-qol]'); if (b) onQol(ctx, b.getAttribute('data-qol')!); });

  showTab(active); stats();
  return {
    root,
    update(): void { stats(); if (mounted) mounted.update(getState()); else showTab(active); },
    destroy(): void { try { mounted?.destroy(); } catch { /* ignore */ } try { root.remove(); } catch { /* ignore */ } },
  };
}

let _ctxRef: Ctx | null = null;
function onQol(ctx: Ctx, id: string): void {
  if (id === 'summarize') { ctx.sendToBackend({ type: 'vellum_summarize' }); ctx.toast?.info?.('Summarizing older turns\u2026'); }
  else if (id === 'export') { ctx.sendToBackend({ type: 'vellum_export' }); }
  else if (id === 'import') { triggerImport(ctx); }
  else if (id === 'clear') { if (confirm('Erase ALL VELLUM chronicle data for this chat? This cannot be undone.')) ctx.sendToBackend({ type: 'vellum_clear' }); }
}

function triggerImport(ctx: Ctx): void {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.addEventListener('change', () => {
    const f = inp.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { try { const log = JSON.parse(String(r.result)); ctx.sendToBackend({ type: 'vellum_import', log }); ctx.toast?.info?.('Importing chronicle\u2026'); } catch { ctx.toast?.warning?.('That file is not valid JSON.'); } };
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

  // beautiful floating window — same shell, opened from the input bar
  const float: FloatWindow = createFloatWindow({
    title: 'VELLUM', actions: [],
    render: (host) => { host.innerHTML = ''; const shell = createFloatShell(); host.appendChild(shell.root); floatShell = shell; shell.update(); },
  });
  let floatShell: ReturnType<typeof createShell> | null = null;
  function createFloatShell(): ReturnType<typeof createShell> { return createShell(ctx, getState); }

  let inputBtn: { destroy(): void } | null = null;
  try {
    inputBtn = ctx.ui.registerInputBarAction?.({ id: 'vellum-float-toggle', title: 'VELLUM window', iconSvg: ICON, onClick: () => float.toggle() }) ?? null;
  } catch { /* optional */ }

  const unsub = ctx.onBackendMessage((p: any) => {
    try {
      if (p?.type === 'vellum_state') {
        state = p.state ?? freshState();
        drawer.update(); floatShell?.update(); float.refresh();
      } else if (p?.type === 'vellum_export' && p.log) {
        downloadJson(`vellum-${p.chatId ?? 'chronicle'}.json`, p.log);
        ctx.toast?.success?.('Chronicle exported.');
      } else if (p?.type === 'vellum_summarize_done') {
        ctx.toast?.success?.(p.rounds ? `Summarized ${p.rounds} chapter${p.rounds === 1 ? '' : 's'}.` : 'Nothing old enough to summarize yet.');
      } else if (p?.type === 'vellum_cleared') {
        ctx.toast?.success?.('Chronicle cleared.');
      } else if (p?.type === 'vellum_import_done') {
        ctx.toast?.[p.ok ? 'success' : 'warning']?.(p.ok ? `Imported ${p.events ?? ''} events.` : `Import failed: ${p.reason ?? 'error'}`);
      }
    } catch (e) { try { console.warn('[vellum] message handler:', e); } catch { /* ignore */ } }
  });

  const offChat = ctx.events?.on('CHAT_SWITCHED', () => { resetGraphCache(); ctx.sendToBackend({ type: 'vellum_get_state' }); });
  ctx.sendToBackend({ type: 'vellum_get_state' });

  return () => {
    try { unsub(); } catch { /* ignore */ }
    try { offChat?.(); } catch { /* ignore */ }
    try { drawer.destroy(); } catch { /* ignore */ }
    try { floatShell?.destroy(); } catch { /* ignore */ }
    try { float.destroy(); } catch { /* ignore */ }
    try { inputBtn?.destroy(); } catch { /* ignore */ }
    try { tab.destroy(); } catch { /* ignore */ }
    try { style.remove(); } catch { /* ignore */ }
    try { ctx.dom.cleanup(); } catch { /* ignore */ }
  };
}

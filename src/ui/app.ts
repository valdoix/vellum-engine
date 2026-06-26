import { STYLES } from './styles.js';
import { mount, type Mounted } from './component.js';
import { freshState, type ChronicleState } from '../domain/types.js';
import { chronicleTab } from './tabs/chronicle.js';
import { castTab } from './tabs/cast.js';
import { relationsTab } from './tabs/relations.js';

/**
 * Frontend entrypoint. Mounts a themed shell with an in-tab tab bar; each panel
 * is an isolated Component with an error boundary, so one panel's failure can
 * never freeze the others (the legacy "stale Relations tab" bug is impossible
 * here). New tabs: add a Component + one entry in TABS.
 */

interface Ctx {
  ui: { registerDrawerTab(opts: Record<string, unknown>): { root: HTMLElement; destroy(): void } };
  dom: { addStyle(css: string): { remove(): void }; cleanup(): void };
  sendToBackend(payload: Record<string, unknown>): void;
  onBackendMessage(handler: (payload: any) => void): () => void;
  events?: { on(name: string, fn: (p: any) => void): () => void };
}

const ICON = '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 3.5h9l3 3V16.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z" stroke="#cda84e" stroke-width="1.4"/><path d="M6 9h8M6 12h6" stroke="#cda84e" stroke-width="1.2" stroke-linecap="round"/></svg>';

const TABS = [
  { id: 'chronicle', label: 'Chronicle', comp: chronicleTab },
  { id: 'cast', label: 'Cast', comp: castTab },
  { id: 'relations', label: 'Relations', comp: relationsTab },
] as const;

export function setup(ctx: Ctx): () => void {
  const style = ctx.dom.addStyle(STYLES);
  const tab = ctx.ui.registerDrawerTab({
    id: 'vellum-engine-tab', title: 'VELLUM', shortName: 'VELLUM',
    description: 'Living-narrative chronicle, cast, relations & more',
    keywords: ['vellum', 'chronicle', 'cast', 'relations', 'lore', 'memory'],
    headerTitle: 'VELLUM', iconSvg: ICON,
  });

  const root = document.createElement('div');
  root.className = 'vle-root';
  root.innerHTML = '<div class="vle-head"><span class="vle-mark">\u2756</span> VELLUM <span class="vle-ver">II</span>'
    + '<span class="vle-stats" data-vle-stats></span></div>'
    + '<div class="vle-tabbar" data-vle-tabbar>' + TABS.map((t, i) =>
      '<button class="vle-tabbtn' + (i === 0 ? ' on' : '') + '" data-tab="' + t.id + '">' + t.label + '</button>').join('') + '</div>'
    + '<div class="vle-body" data-vle-body></div>';
  tab.root.appendChild(root);

  const statsEl = root.querySelector('[data-vle-stats]') as HTMLElement;
  const body = root.querySelector('[data-vle-body]') as HTMLElement;
  const tabbar = root.querySelector('[data-vle-tabbar]') as HTMLElement;

  let state: ChronicleState = freshState();
  let activeTab: string = TABS[0]!.id;
  let mounted: Mounted<ChronicleState> | null = null;

  function showTab(id: string): void {
    activeTab = id;
    tabbar.querySelectorAll('.vle-tabbtn').forEach((b) => b.classList.toggle('on', b.getAttribute('data-tab') === id));
    if (mounted) { mounted.destroy(); mounted = null; }
    body.innerHTML = '';
    const def = TABS.find((t) => t.id === id) ?? TABS[0]!;
    mounted = mount(body, def.comp, state, def.id);
  }

  function renderStats(): void {
    const cast = Object.keys(state.cast).length;
    statsEl.innerHTML = 'T' + (state.turns ?? 0) + ' \u00b7 D' + (state.day ?? 0) + ' \u00b7 ' + cast + ' cast \u00b7 ' + state.relations.length + ' bonds';
  }

  tabbar.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-tab]');
    if (b) showTab(b.getAttribute('data-tab')!);
  });

  const unsub = ctx.onBackendMessage((p: any) => {
    try {
      if (p?.type === 'vellum_state') {
        state = p.state ?? freshState();
        renderStats();
        if (mounted) mounted.update(state); else showTab(activeTab);
      }
    } catch (e) { try { console.warn('[vellum] message handler:', e); } catch { /* ignore */ } }
  });

  const offChat = ctx.events?.on('CHAT_SWITCHED', () => ctx.sendToBackend({ type: 'vellum_get_state' }));

  showTab(activeTab);
  renderStats();
  ctx.sendToBackend({ type: 'vellum_get_state' });

  return () => {
    try { unsub(); } catch { /* ignore */ }
    try { offChat?.(); } catch { /* ignore */ }
    try { mounted?.destroy(); } catch { /* ignore */ }
    try { tab.destroy(); } catch { /* ignore */ }
    try { style.remove(); } catch { /* ignore */ }
    try { ctx.dom.cleanup(); } catch { /* ignore */ }
  };
}

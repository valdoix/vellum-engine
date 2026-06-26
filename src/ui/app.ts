import { STYLES } from './styles.js';

/**
 * Frontend entrypoint. Phase 0: registers a drawer tab, mounts a themed shell,
 * pings the backend, and renders the live state when it arrives. Tabs and the
 * graph land in Phase 4 as isolated components (see ui/component.ts).
 */

interface Ctx {
  ui: { registerDrawerTab(opts: Record<string, unknown>): { root: HTMLElement; destroy(): void } };
  dom: { addStyle(css: string): { remove(): void }; cleanup(): void };
  sendToBackend(payload: Record<string, unknown>): void;
  onBackendMessage(handler: (payload: any) => void): () => void;
  events?: { on(name: string, fn: (p: any) => void): () => void };
}

const ICON = '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 3.5h9l3 3V16.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z" stroke="#cda84e" stroke-width="1.4"/><path d="M6 9h8M6 12h6" stroke="#cda84e" stroke-width="1.2" stroke-linecap="round"/></svg>';

export function setup(ctx: Ctx): () => void {
  const style = ctx.dom.addStyle(STYLES);
  const tab = ctx.ui.registerDrawerTab({
    id: 'vellum-engine-tab',
    title: 'VELLUM',
    shortName: 'VELLUM',
    description: 'Living-narrative chronicle, cast, relations, graph & vault',
    keywords: ['vellum', 'chronicle', 'cast', 'relations', 'lore', 'memory'],
    headerTitle: 'VELLUM',
    iconSvg: ICON,
  });

  const root = document.createElement('div');
  root.className = 'vle-root';
  root.innerHTML = '<div class="vle-head"><span class="vle-mark">\u2756</span> VELLUM <span class="vle-ver">II \u00b7 alpha</span></div>'
    + '<div class="vle-body" data-vle-body><div class="vle-empty">Connecting to the chronicle\u2026</div></div>';
  tab.root.appendChild(root);
  const body = root.querySelector('[data-vle-body]') as HTMLElement;

  let currentChatId: string | null = null;

  const unsub = ctx.onBackendMessage((p: any) => {
    try {
      if (p?.type === 'vellum_state') {
        currentChatId = p.chatId;
        renderState(body, p.state);
      }
    } catch (e) { try { console.warn('[vellum] message handler:', e); } catch { /* ignore */ } }
  });

  const offChat = ctx.events?.on('CHAT_SWITCHED', () => ctx.sendToBackend({ type: 'vellum_get_state' }));

  ctx.sendToBackend({ type: 'vellum_get_state' });

  return () => {
    try { unsub(); } catch { /* ignore */ }
    try { offChat?.(); } catch { /* ignore */ }
    try { tab.destroy(); } catch { /* ignore */ }
    try { style.remove(); } catch { /* ignore */ }
    try { ctx.dom.cleanup(); } catch { /* ignore */ }
  };
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function renderState(body: HTMLElement, state: any): void {
  if (!state) { body.innerHTML = '<div class="vle-empty">No chronicle yet for this chat.<br><span>Play a turn to begin the record.</span></div>'; return; }
  const castN = state.cast ? Object.keys(state.cast).length : 0;
  const relN = (state.relations || []).length;
  body.innerHTML = '<div class="vle-stat-row">'
    + statCard('Turn', state.turns ?? 0)
    + statCard('Day', state.day ?? 0)
    + statCard('Cast', castN)
    + statCard('Bonds', relN)
    + '</div>'
    + '<div class="vle-scene">' + (state.scene?.location ? esc(state.scene.location) : '\u2014')
    + (state.scene?.tension ? ' <span class="vle-tension">tension ' + esc(state.scene.tension) + '/10</span>' : '') + '</div>'
    + '<div class="vle-note">Phase 0 shell. Chronicle, Cast, Relations, Graph &amp; Vault tabs arrive in later phases.</div>';
}

function statCard(label: string, value: unknown): string {
  return '<div class="vle-stat"><span class="vle-stat-v">' + esc(value) + '</span><span class="vle-stat-l">' + esc(label) + '</span></div>';
}

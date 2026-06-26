import { restoreUser, rememberUser } from './host/user.js';
import { invalidatePermissions } from './host/capability.js';
import { loadState, invalidate } from './store/chronicle.js';

declare const spindle: any;

/**
 * Backend entrypoint. Phase 0: wires lifecycle skeleton, identity restore, and
 * a state-broadcast on request. The FOLD/EXTRACT/INDEX steps land in Phase 1+.
 * Everything is guarded — the worker must never crash the host.
 */

async function boot(): Promise<void> {
  await restoreUser();
  spindle.log?.info?.('[vellum_engine] booted — event-log core online');
}

void boot();

// Keep identity fresh from every inbound signal.
try {
  spindle.on?.('PERMISSION_CHANGED', () => invalidatePermissions());
  spindle.on?.('CHAT_SWITCHED', (p: any) => { rememberUser(p?.userId); });
} catch { /* events optional */ }

// Frontend message dispatch (Phase 0: state fetch + ping).
try {
  spindle.onFrontendMessage?.(async (payload: any, userId: string) => {
    rememberUser(userId || payload?.userId);
    try {
      if (payload?.type === 'vellum_ping') {
        spindle.sendToFrontend?.({ type: 'vellum_pong', v: '2.0.0-alpha.0' }, userId);
        return;
      }
      if (payload?.type === 'vellum_get_state') {
        const chatId = payload?.chatId || (await spindle.chats?.getActive?.(userId))?.id;
        if (!chatId) { spindle.sendToFrontend?.({ type: 'vellum_state', chatId: null, state: null }, userId); return; }
        const state = await loadState(chatId);
        spindle.sendToFrontend?.({ type: 'vellum_state', chatId, state }, userId);
        return;
      }
    } catch (e) {
      spindle.log?.warn?.('[vellum_engine] frontend msg: ' + ((e as Error)?.message ?? e));
    }
  });
} catch { /* messaging optional */ }

// React to chat switches by dropping cached snapshots for cleanliness.
try {
  spindle.on?.('CHAT_SWITCHED', (p: any) => { if (p?.chatId) invalidate(); });
} catch { /* ignore */ }

spindle.log?.info?.('[vellum_engine] backend loaded');

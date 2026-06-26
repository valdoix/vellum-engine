import { restoreUser, rememberUser, currentUser } from './host/user.js';
import { invalidatePermissions, invalidateChatCaps, has } from './host/capability.js';
import { activeChatId, latestAssistantContent } from './host/chats.js';
import { loadState, append, invalidate } from './store/chronicle.js';
import { foldTurn } from './bus/lifecycle.js';
import { registerFeature } from './bus/registry.js';
import { coreFeature } from './domain/core-feature.js';
import { buildInjectionHybrid, invalidateIndex } from './retrieval/recall.js';
import { importLegacy } from './store/import-legacy.js';

declare const spindle: any;

/**
 * Backend entrypoint. Registers features, folds each turn into the event log,
 * and serves the frontend via a dispatch table. Everything is guarded — the
 * worker must never crash the host. New features call registerFeature() and
 * (if they need UI) add a message handler in the dispatch table below.
 */

registerFeature(coreFeature);

const lastSigByChat = new Map<string, string>();
const lastInjection = new Map<string, string[]>();

async function broadcastState(chatId: string, userId: string | null): Promise<void> {
  const state = await loadState(chatId);
  spindle.sendToFrontend?.({ type: 'vellum_state', chatId, state }, userId ?? currentUser());
}

/** FOLD: read the raw turn, parse → events → append → broadcast. */
async function foldChat(chatId: string, userId: string | null): Promise<void> {
  const read = await latestAssistantContent(chatId);
  if (!read.ok) return;
  const prior = await loadState(chatId);
  const turnNo = (prior.turns ?? 0) + 1;
  const { events, sig, source } = foldTurn(read.value, prior, turnNo);
  if (sig === lastSigByChat.get(chatId)) return; // already folded this turn (swipe/regen)
  lastSigByChat.set(chatId, sig);
  if (!events.length) return;
  await append(chatId, events);
  invalidateIndex(chatId); // chronicle changed → next interceptor rebuilds the index
  await broadcastState(chatId, userId);
  spindle.log?.info?.(`[vellum_engine] folded turn via ${source}: +${events.length} events`);
}

async function boot(): Promise<void> {
  await restoreUser();
  await wireCapabilities(); // attach interceptor + generation fold if already granted
  spindle.log?.info?.('[vellum_engine] booted — event-log core online');
}
void boot();

/**
 * Build a scene query from the tail of the prompt the interceptor is assembling.
 * We pull the last few message contents so recall keys off what's happening NOW.
 */
function sceneQuery(ctx: any): string {
  try {
    const msgs = ctx?.messages;
    if (Array.isArray(msgs) && msgs.length) {
      return msgs.slice(-4).map((m: any) => (typeof m?.content === 'string' ? m.content : '')).join(' ').slice(0, 2000);
    }
    if (typeof ctx?.prompt === 'string') return ctx.prompt.slice(-2000);
  } catch { /* ignore */ }
  return '';
}

// --- permission-gated wiring --------------------------------------------
// The host rejects interceptor/generation registration when the permission
// isn't granted, and won't re-wire on its own when the user grants it later.
// So we attach each piece behind a capability check, idempotently, and re-run
// the whole attach pass whenever permissions change — no reload required.
let _interceptorWired = false;
let _genWired = false;

async function wireCapabilities(): Promise<void> {
  // INTERCEPT: inject authoritative cast/bonds + scene-relevant recall.
  if (!_interceptorWired && (await has('interceptor')) && spindle.registerInterceptor) {
    try {
      spindle.registerInterceptor(async (ctx: any) => {
        try {
          const uid = ctx?.userId || currentUser();
          rememberUser(uid);
          const chatId = ctx?.chatId || (await activeChatId(uid));
          if (!chatId) return undefined;
          const state = await loadState(chatId);
          if (!state.turns && !Object.keys(state.cast).length) return undefined;
          const inj = await buildInjectionHybrid(chatId, state, sceneQuery(ctx), uid);
          if (!inj.text) return undefined;
          lastInjection.set(chatId, inj.recallIds);
          return { context: inj.text };
        } catch (e) {
          spindle.log?.warn?.('[vellum_engine] interceptor: ' + ((e as Error)?.message ?? e));
          return undefined;
        }
      }, 120);
      _interceptorWired = true;
      spindle.log?.info?.('[vellum_engine] interceptor wired');
    } catch (e) { spindle.log?.warn?.('[vellum_engine] interceptor wiring deferred: ' + ((e as Error)?.message ?? e)); }
  }

  // FOLD on generation end (requires the generation permission to subscribe).
  if (!_genWired && (await has('generation'))) {
    try {
      spindle.on?.('GENERATION_ENDED', async (p: any) => {
        rememberUser(p?.userId);
        const chatId = p?.chatId || (await activeChatId(currentUser()));
        if (chatId) await foldChat(chatId, p?.userId ?? currentUser());
      });
      _genWired = true;
      spindle.log?.info?.('[vellum_engine] generation fold wired');
    } catch (e) { spindle.log?.warn?.('[vellum_engine] generation wiring deferred: ' + ((e as Error)?.message ?? e)); }
  }
}

// Always-safe events (no special permission to subscribe).
try {
  spindle.on?.('PERMISSION_CHANGED', () => { invalidatePermissions(); void wireCapabilities(); });
  spindle.on?.('CHAT_SWITCHED', (p: any) => { rememberUser(p?.userId); invalidateChatCaps(); if (p?.chatId) invalidate(); });
} catch { /* events optional */ }

// --- frontend dispatch table ---------------------------------------------
// Each entry is isolated; a throw in one handler can't affect the others.
type Handler = (payload: any, userId: string | null) => Promise<void> | void;
const dispatch: Record<string, Handler> = {
  vellum_ping: (_p, uid) => { spindle.sendToFrontend?.({ type: 'vellum_pong', v: '2.0.0-alpha.0' }, uid); },
  vellum_get_state: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) { spindle.sendToFrontend?.({ type: 'vellum_state', chatId: null, state: null }, uid); return; }
    await broadcastState(chatId, uid);
  },
  vellum_refold: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (chatId) { lastSigByChat.delete(chatId); await foldChat(chatId, uid); }
  },
  vellum_import_legacy: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) { spindle.sendToFrontend?.({ type: 'vellum_import_done', ok: false, reason: 'no_active_chat' }, uid); return; }
    try {
      const events = importLegacy(p?.chronicle);
      await append(chatId, events);
      invalidateIndex(chatId);
      await broadcastState(chatId, uid);
      spindle.sendToFrontend?.({ type: 'vellum_import_done', ok: true, events: events.length }, uid);
    } catch (e) {
      spindle.sendToFrontend?.({ type: 'vellum_import_done', ok: false, reason: (e as Error)?.message ?? 'error' }, uid);
    }
  },
};

try {
  spindle.onFrontendMessage?.(async (payload: any, userId: string) => {
    const uid = userId || payload?.userId || currentUser();
    rememberUser(uid);
    const h = payload?.type && dispatch[payload.type];
    if (!h) return;
    try { await h(payload, uid); }
    catch (e) { spindle.log?.warn?.('[vellum_engine] dispatch ' + payload.type + ': ' + ((e as Error)?.message ?? e)); }
  });
} catch { /* messaging optional */ }

try { spindle.log?.info?.('[vellum_engine] backend loaded'); } catch { /* ignore */ }

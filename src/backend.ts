import { restoreUser, rememberUser, currentUser } from './host/user.js';
import { invalidatePermissions, invalidateChatCaps, has } from './host/capability.js';
import { activeChatId, latestAssistantContent } from './host/chats.js';
import { loadState, append, invalidate, clearLog, exportLog, importLog } from './store/chronicle.js';
import { foldTurn } from './bus/lifecycle.js';
import { registerFeature } from './bus/registry.js';
import { coreFeature } from './domain/core-feature.js';
import { buildInjectionHybrid, invalidateIndex } from './retrieval/recall.js';
import { importLegacy } from './store/import-legacy.js';
import { cmdEvents, CMD_TYPES } from './domain/commands.js';
import { summarizeOnce, summarizeAll } from './bus/summarize.js';
import { EventLog as EventLogSchema } from './core/events.js';
import { nextSeq as nextSeqLocal } from './core/ids.js';
import { syncHideOnFile } from './host/hide.js';
import type { ChronicleState } from './domain/types.js';
import { vaultSnapshot, setBookAttached, createBook, updateBook, createEntry, updateEntry, deleteEntry, syncEntry, hasVault } from './host/worldbooks.js';
import { loadCategories, upsertCategory, deleteCategory } from './store/vault-categories.js';
import { resolveCategory, settingsToEntryFields, customCategory, type EntrySettings, type VaultCategory } from './domain/vault.js';
import { buildPromotion, reconcileCategory, type PromoteKind } from './domain/promote.js';
import { sceneSuggestions, recursionSeeds, evaluateSchedules, type VaultEntryLite } from './domain/vault-intel.js';

/** Highest turn already captured by a chapter/arc memory (the hide-on-file mark). */
function coveredTurn(state: ChronicleState): number {
  let c = 0;
  for (const m of state.memories) if ((m.tier === 'chapter' || m.tier === 'arc') && m.covers) c = Math.max(c, m.covers[1]);
  return c;
}

/** Parse a comma/array keyword list into a clean string[]. */
function splitList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  return String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

// dismissed scene-suggestions, per chat (in-memory; cheap + resets on reload)
const _dismissed = new Map<string, Set<string>>();
function dismissedFor(chatId: string): Set<string> { let s = _dismissed.get(chatId); if (!s) { s = new Set(); _dismissed.set(chatId, s); } return s; }

/** Snapshot + scene-coverage suggestions â†’ broadcast the full vault view. */
async function vaultBroadcast(chatId: string, uid: string | null): Promise<void> {
  const categories = await loadCategories();
  const snap = await vaultSnapshot(chatId, uid);
  let suggestions: unknown[] = [];
  try {
    if (chatId && snap.ok) {
      const state = await loadState(chatId);
      const lites: VaultEntryLite[] = snap.books.flatMap((b) => b.entries).map((e) => ({ id: e.id, key: e.key, content: e.content, link: e.link, category: e.category, disabled: e.disabled, ...(e.reveal ? { reveal: e.reveal } : {}) }));
      suggestions = sceneSuggestions(state, lites, dismissedFor(chatId));
    }
  } catch { /* suggestions best-effort */ }
  spindle.sendToFrontend?.({ type: 'vellum_vault', categories, ...snap, suggestions }, uid ?? currentUser());
}

declare const spindle: any;

/**
 * Backend entrypoint. Registers features, folds each turn into the event log,
 * and serves the frontend via a dispatch table. Everything is guarded â€” the
 * worker must never crash the host. New features call registerFeature() and
 * (if they need UI) add a message handler in the dispatch table below.
 */

registerFeature(coreFeature);

const lastSigByChat = new Map<string, string>();
interface InjRecord { turn: number; at: number; chars: number; recallIds: string[]; text: string }
const injectionLog = new Map<string, InjRecord[]>(); // per-chat ring of recent injections
function recordInjection(chatId: string, turn: number, text: string, recallIds: string[]): void {
  const ring = injectionLog.get(chatId) ?? [];
  ring.push({ turn, at: Date.now(), chars: text.length, recallIds, text: text.slice(0, 4000) });
  while (ring.length > 20) ring.shift(); // keep last 20 turns of injection history
  injectionLog.set(chatId, ring);
}

async function broadcastState(chatId: string, userId: string | null): Promise<void> {
  const state = await loadState(chatId);
  spindle.sendToFrontend?.({ type: 'vellum_state', chatId, state }, userId ?? currentUser());
}

/** FOLD: read the raw turn, parse â†’ events â†’ append â†’ broadcast. */
async function foldChat(chatId: string, userId: string | null): Promise<void> {
  const read = await latestAssistantContent(chatId);
  if (!read.ok) return;
  const prior = await loadState(chatId);
  const turnNo = (prior.turns ?? 0) + 1;
  const { events, sig, source } = foldTurn(read.value, prior, turnNo);
  if (sig === lastSigByChat.get(chatId)) return; // already folded this turn (swipe/regen)
  lastSigByChat.set(chatId, sig);
  if (!events.length) return;
  // record a compact per-turn memory (the prose, state-block stripped) so the
  // summarizer has detail-dense material to later compress into chapters
  const gist = read.value.replace(/(?:\u2039vellum\u203a|<vellum>)[\s\S]*?(?:\u2039\/vellum\u203a|<\/vellum>)/gi, '').replace(/<reverie>[\s\S]*?<\/reverie>/gi, '').replace(/\s+/g, ' ').trim();
  if (gist) events.push({ seq: nextSeqLocal(), turn: turnNo, day: prior.day || 0, src: 'system', kind: 'memory.record', id: 'turn_' + chatId.slice(0, 6) + '_' + turnNo, tier: 'turn', text: gist.slice(0, 600), keys: [] } as any);
  await append(chatId, events);
  invalidateIndex(chatId); // chronicle changed â†’ next interceptor rebuilds the index
  await broadcastState(chatId, userId);
  spindle.log?.info?.(`[vellum_engine] folded turn via ${source}: +${events.length} events`);
  // auto-summarize once the backlog of raw turn-memories is large enough
  void maybeAutoSummarize(chatId, userId);
  // Tier-B: refresh Vault entries whose chronicle source changed (per-category)
  void maybeVaultSync(chatId, userId);
}

const _vaultSyncing = new Set<string>();
/** Tier-B sync: for each category set to 'sync', refresh linked entries whose source changed. */
async function maybeVaultSync(chatId: string, userId: string | null): Promise<void> {
  if (_vaultSyncing.has(chatId)) return;
  if (!(await hasVault())) return;
  const cats = (await loadCategories()).filter((c) => c.sync === 'sync' && c.source);
  _vaultSyncing.add(chatId);
  try {
    const state = await loadState(chatId);
    const snap = await vaultSnapshot(chatId, userId);
    const owned = snap.books.flatMap((b) => b.entries).filter((e) => e.vellum && e.link);
    let changed = 0;
    for (const cat of cats) {
      const managed = owned.filter((e) => e.category === cat.id).map((e) => ({ id: e.id, link: e.link, hash: e.hash }));
      if (!managed.length) continue;
      const plan = reconcileCategory(state, cat.source!, managed);
      for (const u of plan.update) { await syncEntry(u.entryId, u.promotion.content, u.promotion.key, u.promotion.hash, u.promotion.link, cat.id, userId); changed++; }
    }
    // scheduled Events: enable/disable entries whose reveal condition flipped
    const lites = snap.books.flatMap((b) => b.entries).filter((e) => e.vellum && e.reveal).map((e) => ({ id: e.id, key: e.key, content: e.content, link: e.link, category: e.category, disabled: e.disabled, reveal: e.reveal! }));
    if (lites.length) { for (const ch of evaluateSchedules(state, lites)) { await updateEntry(ch.entryId, { disabled: !ch.enable }, userId); changed++; } }
    if (changed) { await vaultBroadcast(chatId, userId); spindle.log?.info?.('[vellum_engine] vault sync: ' + changed + ' change(s)'); }
  } catch (e) { spindle.log?.warn?.('[vellum_engine] vault sync: ' + ((e as Error)?.message ?? e)); }
  finally { _vaultSyncing.delete(chatId); }
}

let _summarizing = new Set<string>();
async function maybeAutoSummarize(chatId: string, userId: string | null): Promise<void> {
  if (_summarizing.has(chatId)) return;
  const state = await loadState(chatId);
  const turnMems = state.memories.filter((m) => m.tier === 'turn').length;
  if (turnMems < AUTO_SUMMARY_AT) return; // threshold; keeps recent turns verbatim
  _summarizing.add(chatId);
  try {
    const evs = await summarizeOnce(state, userId);
    if (evs.length) {
      await append(chatId, evs); invalidateIndex(chatId); await broadcastState(chatId, userId);
      spindle.log?.info?.('[vellum_engine] auto-summarized a chapter');
      // if the user enabled hide-summarized, fold the freshly-covered turns away
      try {
        const enabled = !!(await spindle.chats?.getVar?.(chatId, 'vellum_hide_summarized', userId));
        if (enabled) { const ns = await loadState(chatId); await syncHideOnFile(chatId, true, coveredTurn(ns)); }
      } catch { /* best effort */ }
    }
  } catch (e) { spindle.log?.warn?.('[vellum_engine] auto-summary: ' + ((e as Error)?.message ?? e)); }
  finally { _summarizing.delete(chatId); }
}
const AUTO_SUMMARY_AT = 16; // compress the oldest 8 once 16 turn-memories accrue

async function boot(): Promise<void> {
  await restoreUser();
  await wireCapabilities(); // attach interceptor + generation fold if already granted
  spindle.log?.info?.('[vellum_engine] booted â€” event-log core online');
}
void boot();

/**
 * Build a scene query from the tail of the prompt the interceptor is assembling.
 * We pull the last few message contents so recall keys off what's happening NOW.
 */
function sceneQuery(messages: any[]): string {
  try {
    if (Array.isArray(messages) && messages.length) {
      return messages.slice(-4).map((m: any) => (typeof m?.content === 'string' ? m.content : '')).join(' ').slice(0, 2000);
    }
  } catch { /* ignore */ }
  return '';
}

// --- permission-gated wiring --------------------------------------------
// The host rejects interceptor/generation registration when the permission
// isn't granted, and won't re-wire on its own when the user grants it later.
// So we attach each piece behind a capability check, idempotently, and re-run
// the whole attach pass whenever permissions change â€” no reload required.
let _interceptorWired = false;
let _genWired = false;

async function wireCapabilities(): Promise<void> {
  // INTERCEPT: inject authoritative cast/bonds + scene-relevant recall.
  if (!_interceptorWired && (await has('interceptor')) && spindle.registerInterceptor) {
    try {
      // The host calls (messages, context) and expects the messages array back
      // (or { messages, breakdown }). We PREPEND our injection as a system
      // message rather than returning a custom shape â€” returning anything
      // without `.messages` breaks the host's `normalized.messages`.
      spindle.registerInterceptor(async (messages: any[], context: any) => {
        const out = Array.isArray(messages) ? messages : [];
        try {
          const uid = context?.userId || currentUser();
          rememberUser(uid);
          const chatId = context?.chatId || context?.chat_id || (await activeChatId(uid));
          if (!chatId) return out;
          const state = await loadState(chatId);
          if (!state.turns && !Object.keys(state.cast).length) return out;
          const inj = await buildInjectionHybrid(chatId, state, sceneQuery(out), uid);
          if (!inj.text) return out;
          recordInjection(chatId, state.turns || 0, inj.text, inj.recallIds);
          const head = { role: 'system', content: inj.text };
          return { messages: [head, ...out], breakdown: [{ messageIndex: 0, name: 'VELLUM Recall' }] };
        } catch (e) {
          spindle.log?.warn?.('[vellum_engine] interceptor: ' + ((e as Error)?.message ?? e));
          return out;
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
  vellum_cmd: async (p, uid) => {
    // CRUD: add/edit/delete any entity. payload.cmd = e.g. 'cast_upsert'.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId || !p?.cmd || !CMD_TYPES.has(p.cmd)) return;
    const state = await loadState(chatId);
    const evs = cmdEvents(p.cmd, p, state, { turn: state.turns || 0, day: state.day || 0 });
    if (!evs.length) return;
    await append(chatId, evs);
    invalidateIndex(chatId);
    await broadcastState(chatId, uid);
  },
  vellum_summarize: async (p, uid) => {
    // manual "summarize past turns" â€” compress as many full windows as exist
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const state = await loadState(chatId);
    const rounds = await summarizeAll(state, uid, (evs) => append(chatId, evs));
    invalidateIndex(chatId);
    await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_summarize_done', ok: true, rounds }, uid);
  },
  vellum_clear: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    await clearLog(chatId);
    invalidateIndex(chatId);
    await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_cleared', ok: true }, uid);
  },
  vellum_export: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const log = await exportLog(chatId);
    spindle.sendToFrontend?.({ type: 'vellum_export', chatId, log }, uid);
  },
  vellum_get_injection: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    spindle.sendToFrontend?.({ type: 'vellum_injection', chatId, log: (injectionLog.get(chatId) ?? []).slice().reverse() }, uid);
  },
  vellum_get_vault: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    const categories = await loadCategories();
    if (!(await hasVault())) { spindle.sendToFrontend?.({ type: 'vellum_vault', ok: false, reason: 'no_permission', categories, books: [], attached: [], activated: [], suggestions: [] }, uid); return; }
    await vaultBroadcast(chatId ?? '', uid);
  },
  vellum_vault_category: async (p, uid) => {
    // upsert/delete a category. payload.op = 'upsert'|'delete'
    if (p?.op === 'delete' && p?.id) await deleteCategory(String(p.id));
    else if (p?.cat) {
      const c = p.cat as Partial<VaultCategory>;
      const id = c.id || ('custom_' + Date.now().toString(36));
      const base = c.builtin ? null : customCategory(id, String(c.label || 'Custom'), String(c.glyph || '\u2727'), String(c.color || '#cdbfa0'));
      await upsertCategory({ ...(base ?? {}), ...(c as VaultCategory), id });
    }
    const categories = await loadCategories();
    spindle.sendToFrontend?.({ type: 'vellum_vault_categories', categories }, uid);
  },
  vellum_vault_op: async (p, uid) => {
    // book + entry CRUD. payload.op decides.
    const chatId = p?.chatId || (await activeChatId(uid));
    const done = (ok: boolean, extra?: Record<string, unknown>) => spindle.sendToFrontend?.({ type: 'vellum_vault_done', op: p?.op, ok, ...(extra || {}) }, uid);
    if (!(await hasVault())) { done(false, { reason: 'no_permission' }); return; }
    try {
      const cats = await loadCategories();
      if (p.op === 'book_create') { const r = await createBook(String(p.name || 'New Lorebook'), String(p.description || ''), uid); if (r.ok && p.attach && chatId) await setBookAttached(chatId, r.value, true, uid); done(r.ok, r.ok ? { bookId: r.value } : { reason: r.error }); }
      else if (p.op === 'book_update') { const r = await updateBook(String(p.bookId), String(p.name || ''), p.description, uid); done(r.ok, r.ok ? {} : { reason: r.error }); }
      else if (p.op === 'book_attach') { if (!chatId) { done(false, { reason: 'no_active_chat' }); return; } const ok = await setBookAttached(chatId, String(p.bookId), !!p.attach, uid); done(ok); }
      else if (p.op === 'entry_create') {
        const cat = resolveCategory(cats, p.category);
        const settings: EntrySettings = p.settings ?? cat.defaults;
        // auto-resolve a target book: explicit → a VELLUM book → create+attach one
        let bookId = String(p.bookId || '');
        if (!bookId) {
          const snap = await vaultSnapshot(chatId ?? '', uid);
          bookId = snap.books.find((b) => b.vellum)?.id || snap.books[0]?.id || '';
          if (!bookId) { const cr = await createBook('VELLUM Vault', 'Lore authored in the Vault', uid); if (!cr.ok) { done(false, { reason: cr.error }); return; } bookId = cr.value; if (chatId) await setBookAttached(chatId, bookId, true, uid); }
        }
        const r = await createEntry({ bookId, key: splitList(p.key), keysecondary: splitList(p.keysecondary), content: String(p.content || ''), comment: String(p.comment || ''), settings, category: cat.id, source: 'manual' }, uid);
        done(r.ok, r.ok ? { entryId: r.value } : { reason: r.error });
      } else if (p.op === 'entry_update') {
        const patch: Record<string, unknown> = {};
        if (p.key !== undefined) patch.key = splitList(p.key);
        if (p.keysecondary !== undefined) patch.keysecondary = splitList(p.keysecondary);
        if (p.content !== undefined) patch.content = String(p.content);
        if (p.comment !== undefined) patch.comment = String(p.comment);
        if (p.settings) Object.assign(patch, settingsToEntryFields(p.settings));
        if (p.category) patch.extensions = { vellum: true, vellumCategory: String(p.category) };
        if (typeof p.disabled === 'boolean') patch.disabled = p.disabled;
        const r = await updateEntry(String(p.entryId), patch, uid); done(r.ok, r.ok ? {} : { reason: r.error });
      } else if (p.op === 'entry_delete') { const r = await deleteEntry(String(p.entryId), uid); done(r.ok, r.ok ? {} : { reason: r.error }); }
      else if (p.op === 'entry_unlink') {
        // convert an auto-managed entry to hand-owned: keep vellum tag + category,
        // drop the source link so Tier-B sync never touches it again
        const r = await updateEntry(String(p.entryId), { extensions: { vellum: true, vellumCategory: String(p.category || ''), vellumSource: 'manual' } }, uid);
        done(r.ok, r.ok ? {} : { reason: r.error });
      }
      else done(false, { reason: 'unknown_op' });
    } catch (e) { done(false, { reason: (e as Error)?.message ?? 'error' }); }
    // refresh the snapshot after any mutation
    await vaultBroadcast(chatId ?? '', uid);
  },
  vellum_vault_promote: async (p, uid) => {
    // Tier A: promote a chronicle record into a Vault entry (or refresh if it exists).
    const chatId = p?.chatId || (await activeChatId(uid));
    const done = (ok: boolean, extra?: Record<string, unknown>) => spindle.sendToFrontend?.({ type: 'vellum_vault_done', op: 'promote', ok, ...(extra || {}) }, uid);
    if (!chatId || !(await hasVault())) { done(false, { reason: 'no_permission' }); return; }
    try {
      const state = await loadState(chatId);
      const promo = buildPromotion(state, p.kind as PromoteKind, String(p.id));
      if (!promo) { done(false, { reason: 'not_found' }); return; }
      const cats = await loadCategories();
      const cat = resolveCategory(cats, promo.category);
      const snap = await vaultSnapshot(chatId, uid);
      // target a VELLUM-owned book (create one if none), reuse if entry already linked
      let bookId = p.bookId || snap.books.find((b) => b.vellum)?.id;
      if (!bookId) { const r = await createBook('VELLUM Vault', 'Lore promoted from the chronicle', uid); if (!r.ok) { done(false, { reason: r.error }); return; } bookId = r.value; await setBookAttached(chatId, bookId, true, uid); }
      const existing = snap.books.flatMap((b) => b.entries).find((e) => e.vellum && e.link === promo.link);
      if (existing) { await syncEntry(existing.id, promo.content, promo.key, promo.hash, promo.link, cat.id, uid); done(true, { updated: true }); }
      else { const r = await createEntry({ bookId, key: promo.key, keysecondary: promo.keysecondary, content: promo.content, comment: promo.comment, settings: cat.defaults, category: cat.id, source: 'promote', link: promo.link, hash: promo.hash }, uid); done(r.ok, r.ok ? { entryId: r.value } : { reason: r.error }); }
    } catch (e) { done(false, { reason: (e as Error)?.message ?? 'error' }); }
    await vaultBroadcast(chatId, uid);
  },
  vellum_vault_suggest: async (p, uid) => {
    // accept (promote) or dismiss a scene-coverage suggestion
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    if (p?.action === 'dismiss') { dismissedFor(chatId).add(String(p.kind === 'relation' ? 'rel:' + p.id : 'cast:' + p.id)); await vaultBroadcast(chatId, uid); return; }
    if (p?.action === 'accept') { await (dispatch.vellum_vault_promote as Handler)({ chatId, kind: p.kind, id: p.id }, uid); return; }
  },
  vellum_rescan: async (p, uid) => {
    // re-fold the latest turn from raw stored text (recover from a missed fold)
    const chatId = p?.chatId || (await activeChatId(uid));
    if (chatId) { lastSigByChat.delete(chatId); await foldChat(chatId, uid); spindle.sendToFrontend?.({ type: 'vellum_rescan_done', ok: true }, uid); }
  },
  vellum_set_hide: async (p, uid) => {
    // toggle hide-summarized-turns; persist the preference in a chat var
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const enabled = !!p?.enabled;
    try { await spindle.chats?.setVar?.(chatId, 'vellum_hide_summarized', enabled ? '1' : '', uid); } catch { /* best effort */ }
    const state = await loadState(chatId);
    const covered = coveredTurn(state);
    const res = await syncHideOnFile(chatId, enabled, covered);
    spindle.sendToFrontend?.({ type: 'vellum_hide_done', ok: true, enabled, ...res }, uid);
  },
  vellum_import: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId || !p?.log) { spindle.sendToFrontend?.({ type: 'vellum_import_done', ok: false, reason: 'no_data' }, uid); return; }
    const v = EventLogSchema.safeParse(p.log);
    if (!v.success) { spindle.sendToFrontend?.({ type: 'vellum_import_done', ok: false, reason: 'invalid' }, uid); return; }
    await importLog(chatId, v.data);
    invalidateIndex(chatId);
    await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_import_done', ok: true, events: v.data.events.length }, uid);
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

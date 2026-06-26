import { has } from './capability.js';
import { tryCatchAsync, type Result, Ok, Err } from '../core/result.js';
import { settingsToEntryFields, type EntrySettings } from '../domain/vault.js';

declare const spindle: any;

/**
 * Thin wrapper over the host world_books API. Operator-scoped: every call
 * carries a uid. The Vault delegates activation to the host; we only author,
 * organize, and read what fired. Reads degrade to empty; writes return a typed
 * Result so the UI can surface a reason.
 */

function api(): any { return spindle.world_books || null; }
export async function hasVault(): Promise<boolean> { return (await has('world_books')) && !!api(); }

export interface LiteEntry {
  id: string; bookId: string;
  key: string[]; keysecondary: string[];
  content: string; comment: string;
  position: number; depth: number; order_value: number;
  constant: boolean; disabled: boolean;
  vellum: boolean; category: string; source: string; link: string; pending: boolean; hash: string;
  reveal?: { day?: number; afterThread?: string };
}

function liteEntry(e: any): LiteEntry | null {
  if (!e) return null;
  const ext = e.extensions || {};
  return {
    id: e.id, bookId: e.world_book_id,
    key: Array.isArray(e.key) ? e.key : [],
    keysecondary: Array.isArray(e.keysecondary) ? e.keysecondary : [],
    content: String(e.content || ''), comment: String(e.comment || ''),
    position: typeof e.position === 'number' ? e.position : 0,
    depth: typeof e.depth === 'number' ? e.depth : 4,
    order_value: typeof e.order_value === 'number' ? e.order_value : 100,
    constant: !!e.constant, disabled: !!e.disabled,
    vellum: !!ext.vellum, category: String(ext.vellumCategory || ''), source: String(ext.vellumSource || ''),
    link: String(ext.vellumLink || ''), pending: !!ext.vellumPending, hash: String(ext.vellumHash || ''),
    reveal: (ext.vellumRevealDay != null || ext.vellumRevealThread) ? { ...(ext.vellumRevealDay != null ? { day: Number(ext.vellumRevealDay) } : {}), ...(ext.vellumRevealThread ? { afterThread: String(ext.vellumRevealThread) } : {}) } : undefined,
  };
}

export interface VaultSnapshot {
  ok: boolean; reason?: string;
  books: Array<{ id: string; name: string; description: string; vellum: boolean; attachedToChat: boolean; global: boolean; entries: LiteEntry[] }>;
  attached: string[];
  activated: Array<{ id: string; comment?: string; source?: string }>;
}

export async function vaultSnapshot(chatId: string, uid: string | null): Promise<VaultSnapshot> {
  const a = api();
  if (!a) return { ok: false, reason: 'no_permission', books: [], attached: [], activated: [] };
  const out: VaultSnapshot = { ok: true, books: [], attached: [], activated: [] };
  try {
    if (chatId && spindle.chats?.get) {
      try { const chat = await spindle.chats.get(chatId, uid); out.attached = Array.isArray(chat?.metadata?.chat_world_book_ids) ? chat.metadata.chat_world_book_ids.slice() : []; } catch { /* ignore */ }
    }
    let globalIds: string[] = [];
    try { if (a.getGlobal) globalIds = await a.getGlobal(uid); } catch { globalIds = []; }
    const listed = await a.list({ limit: 200, offset: 0 }, uid);
    const books = Array.isArray(listed?.data) ? listed.data : [];
    for (const b of books) {
      let entries: LiteEntry[] = [];
      try { const le = await a.entries.list(b.id, { limit: 300, offset: 0 }, uid); entries = (Array.isArray(le?.data) ? le.data : []).map(liteEntry).filter(Boolean) as LiteEntry[]; } catch { /* ignore */ }
      out.books.push({ id: b.id, name: String(b.name || 'Untitled'), description: String(b.description || ''), vellum: !!(b.metadata?.vellum), attachedToChat: out.attached.includes(b.id), global: globalIds.includes(b.id), entries });
    }
    if (chatId && a.getActivated) {
      try { const act = await a.getActivated(chatId, uid); if (Array.isArray(act)) out.activated = act.map((x: any) => ({ id: x.id, comment: x.comment, source: x.source })); } catch { /* ignore */ }
    }
  } catch (err) {
    spindle.log?.warn?.('[vellum_engine] vaultSnapshot: ' + ((err as Error)?.message ?? err));
    return { ok: false, reason: 'error', books: [], attached: [], activated: [] };
  }
  return out;
}

export async function setBookAttached(chatId: string, bookId: string, attach: boolean, uid: string | null): Promise<boolean> {
  if (!chatId || !bookId || !spindle.chats?.get || !spindle.chats?.update) return false;
  const r = await tryCatchAsync(async () => {
    const chat = await spindle.chats.get(chatId, uid);
    if (!chat) return false;
    const meta = { ...(chat.metadata || {}) };
    const cur: string[] = Array.isArray(meta.chat_world_book_ids) ? meta.chat_world_book_ids.slice() : [];
    const has2 = cur.includes(bookId);
    if (attach && !has2) meta.chat_world_book_ids = cur.concat(bookId);
    else if (!attach && has2) meta.chat_world_book_ids = cur.filter((x) => x !== bookId);
    else return true;
    await spindle.chats.update(chatId, { metadata: meta }, uid);
    return true;
  });
  return r.ok ? r.value : false;
}

export async function createBook(name: string, description: string, uid: string | null): Promise<Result<string, string>> {
  const a = api(); if (!a) return Err('no_permission');
  return tryCatchAsync(async () => { const b = await a.create({ name: name.slice(0, 120), description: description.slice(0, 400), metadata: { vellum: true } }, uid); return String(b?.id || ''); });
}

export async function updateBook(bookId: string, name: string, description: string | undefined, uid: string | null): Promise<Result<true, string>> {
  const a = api(); if (!a) return Err('no_permission');
  return tryCatchAsync(async () => { await a.update(bookId, { name: name.slice(0, 120), ...(description !== undefined ? { description: description.slice(0, 400) } : {}) }, uid); return true as const; });
}

export interface EntryInput {
  bookId: string; key: string[]; keysecondary?: string[]; content: string; comment?: string;
  settings: EntrySettings; category: string; source?: string; link?: string; pending?: boolean; hash?: string;
}

export async function createEntry(e: EntryInput, uid: string | null): Promise<Result<string, string>> {
  const a = api(); if (!a) return Err('no_permission');
  return tryCatchAsync(async () => {
    const fields = settingsToEntryFields(e.settings);
    const created = await a.entries.create(e.bookId, {
      key: e.key, keysecondary: e.keysecondary ?? [], content: e.content, comment: e.comment ?? '',
      ...fields,
      extensions: { vellum: true, vellumCategory: e.category, vellumSource: e.source ?? 'manual', ...(e.link ? { vellumLink: e.link } : {}), ...(e.pending ? { vellumPending: true } : {}), ...(e.hash ? { vellumHash: e.hash } : {}) },
    }, uid);
    return String(created?.id || '');
  });
}

/** Refresh a synced entry's content + keywords + hash (Tier-B sync). */
export async function syncEntry(entryId: string, content: string, key: string[], hash: string, link: string, category: string, uid: string | null): Promise<Result<true, string>> {
  const a = api(); if (!a) return Err('no_permission');
  return tryCatchAsync(async () => {
    await a.entries.update(entryId, { content, key, extensions: { vellum: true, vellumCategory: category, vellumSource: 'sync', vellumLink: link, vellumHash: hash } }, uid);
    return true as const;
  });
}

export async function updateEntry(entryId: string, patch: Record<string, unknown>, uid: string | null): Promise<Result<true, string>> {
  const a = api(); if (!a) return Err('no_permission');
  return tryCatchAsync(async () => { await a.entries.update(entryId, patch, uid); return true as const; });
}

export async function deleteEntry(entryId: string, uid: string | null): Promise<Result<true, string>> {
  const a = api(); if (!a) return Err('no_permission');
  return tryCatchAsync(async () => { await a.entries.delete(entryId, uid); return true as const; });
}

export { Ok, Err };

import { has } from './capability.js';
import { tryCatchAsync, type Result, Ok, Err } from '../core/result.js';
import { hashStr } from '../core/ids.js';
import { settingsToEntryFields, type EntrySettings } from '../domain/vault.js';

declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

export const VAULT_SCHEMA_VERSION = 2;
function api(): any { return spindle.world_books || null; }
export async function hasVault(): Promise<boolean> { return (await has('world_books')) && !!api(); }

export type VaultRole = 'manual' | 'summary' | 'lore';
export interface VaultOwnership {
  ownerChatId: string; role: VaultRole; canonicalType?: string; canonicalId?: string; schemaVersion: number;
}

export interface LiteEntry {
  id: string; bookId: string; key: string[]; keysecondary: string[]; content: string; comment: string;
  position: number; depth: number; order_value: number; roleCode?: number; priority?: number;
  sticky?: number; cooldown?: number; delay?: number; constant: boolean; disabled: boolean;
  vellum: boolean; category: string; source: string; link: string; pending: boolean; hash: string;
  keyHash?: string; ownerChatId?: string; vaultRole?: VaultRole; canonicalType?: string; canonicalId?: string;
  schemaVersion?: number; overrideFields?: string[]; createdAt?: number; updatedAt?: number;
  recursionKeys?: string[];
  bodyState?: 'clean' | 'override' | 'conflict' | 'legacy';
  reveal?: { day?: number; afterThread?: string };
}

function strings(v: unknown): string[] { return Array.isArray(v) ? v.map(String) : []; }
export function contentHash(content: string): string { return hashStr(String(content ?? '').trim()); }
export function keywordHash(keys: string[]): string { return hashStr(keys.map((x) => x.trim().toLocaleLowerCase()).filter(Boolean).sort().join('\u0000')); }

function liteEntry(e: any): LiteEntry | null {
  if (!e || e.id == null) return null;
  const ext = e.extensions || {};
  const content = String(e.content || '');
  const storedHash = String(ext.vellumHash || '');
  const overrideFields = strings(ext.vellumOverrideFields);
  const bodyState: LiteEntry['bodyState'] = overrideFields.includes('content') ? 'override'
    : !storedHash ? 'legacy' : contentHash(content) === storedHash ? 'clean' : 'conflict';
  return {
    id: String(e.id), bookId: String(e.world_book_id ?? e.bookId ?? ''),
    key: strings(e.key), keysecondary: strings(e.keysecondary), content, comment: String(e.comment || ''),
    position: typeof e.position === 'number' ? e.position : 0, depth: typeof e.depth === 'number' ? e.depth : 4,
    order_value: typeof e.order_value === 'number' ? e.order_value : 100, roleCode: typeof e.role === 'number' ? e.role : 0,
    priority: typeof e.priority === 'number' ? e.priority : 0, sticky: typeof e.sticky === 'number' ? e.sticky : 0,
    cooldown: typeof e.cooldown === 'number' ? e.cooldown : 0, delay: typeof e.delay === 'number' ? e.delay : 0,
    constant: !!e.constant, disabled: !!e.disabled,
    vellum: !!ext.vellum, category: String(ext.vellumCategory || ''), source: String(ext.vellumSource || ''),
    link: String(ext.vellumLink || ''), pending: !!ext.vellumPending, hash: storedHash,
    keyHash: String(ext.vellumKeyHash || ''), ownerChatId: String(ext.vellumOwnerChatId || ''),
    vaultRole: (ext.vellumRole === 'summary' || ext.vellumRole === 'lore') ? ext.vellumRole : 'manual',
    canonicalType: String(ext.vellumCanonicalType || ''), canonicalId: String(ext.vellumCanonicalId || ''),
    schemaVersion: Number(ext.vellumSchemaVersion) || 0, overrideFields,
    recursionKeys: strings(ext.vellumRecursionKeys),
    createdAt: Number(ext.vellumCreatedAt) || 0, updatedAt: Number(ext.vellumUpdatedAt) || 0, bodyState,
    reveal: (ext.vellumRevealDay != null || ext.vellumRevealThread) ? {
      ...(ext.vellumRevealDay != null ? { day: Number(ext.vellumRevealDay) } : {}),
      ...(ext.vellumRevealThread ? { afterThread: String(ext.vellumRevealThread) } : {}),
    } : undefined,
  };
}

export interface VaultBook {
  id: string; name: string; description: string; vellum: boolean; ownerChatId: string; role: VaultRole;
  attachedToChat: boolean; global: boolean; entries: LiteEntry[];
}
export interface VaultSnapshot {
  ok: boolean; reason?: string; listFailed?: boolean; complete: boolean; errors: string[]; loadedAt: number;
  books: VaultBook[]; attached: string[]; activated: Array<{ id: string; comment?: string; source?: string }>;
}

function unwrapList(r: any): { ok: boolean; arr: any[] } {
  if (Array.isArray(r)) return { ok: true, arr: r };
  if (r && Array.isArray(r.data)) return { ok: true, arr: r.data };
  if (r && Array.isArray(r.items)) return { ok: true, arr: r.items };
  return { ok: false, arr: [] };
}

async function callList(fn: (...a: any[]) => Promise<any>, baseArgs: any[], uid: string | null): Promise<{ items: any[]; failed: boolean }> {
  const lastOpt = baseArgs[baseArgs.length - 1];
  const optsWithUid = { ...(lastOpt && typeof lastOpt === 'object' ? lastOpt : {}), ...(uid ? { userId: uid } : {}) };
  // Current Spindle scopes list calls through options.userId. Try that form
  // first; passing userId as an ignored trailing argument can otherwise read an
  // operator's default library and silently cross user boundaries.
  const forms: any[][] = [[...baseArgs.slice(0, -1), optsWithUid], [...baseArgs, uid], baseArgs];
  for (const args of forms) {
    try {
      const u = unwrapList(await fn(...args));
      if (u.ok) return { items: u.arr, failed: false };
    } catch { /* try the next supported signature */ }
  }
  return { items: [], failed: true };
}

/** Load every page. If the host ignores offset and repeats a page, the snapshot
 * is incomplete and destructive reconciliation is disabled. */
async function listAll(fn: (...a: any[]) => Promise<any>, prefix: any[], uid: string | null, limit = 200): Promise<{ items: any[]; complete: boolean }> {
  const out: any[] = [];
  const pageSigs = new Set<string>();
  for (let offset = 0; offset < 100000; offset += limit) {
    const r = await callList(fn, [...prefix, { limit, offset }], uid);
    if (r.failed) return { items: out, complete: false };
    const sig = r.items.map((x) => String(x?.id ?? '')).join('\u0000');
    if (r.items.length && pageSigs.has(sig)) return { items: out, complete: false };
    if (r.items.length) pageSigs.add(sig);
    out.push(...r.items);
    if (r.items.length < limit) return { items: out, complete: true };
  }
  return { items: out, complete: false };
}

export async function vaultSnapshot(chatId: string, uid: string | null): Promise<VaultSnapshot> {
  const a = api();
  const out: VaultSnapshot = { ok: !!a, ...(a ? {} : { reason: 'no_permission' }), complete: !!a, errors: [], loadedAt: Date.now(), books: [], attached: [], activated: [] };
  if (!a) return out;
  if (chatId && spindle.chats?.get) {
    try { const chat = await spindle.chats.get(chatId, uid ?? undefined); out.attached = strings(chat?.metadata?.chat_world_book_ids); }
    catch {
      try { const chat = await spindle.chats.get(chatId); out.attached = strings(chat?.metadata?.chat_world_book_ids); }
      catch { out.complete = false; out.errors.push('chat_metadata'); }
    }
  }
  let globalIds: string[] = [];
  try {
    if (a.getGlobal) { const g = await a.getGlobal(uid).catch(() => a.getGlobal()); globalIds = unwrapList(g).arr.map((x: any) => String(x?.id ?? x)).filter(Boolean); }
  } catch { out.errors.push('global_books'); }
  const booksRes = await listAll(a.list.bind(a), [], uid, 200);
  if (!booksRes.complete) { out.listFailed = !booksRes.items.length; out.complete = false; out.errors.push('books_incomplete'); }
  for (const b of booksRes.items) {
    const id = String(b?.id ?? '');
    if (!id) { out.complete = false; out.errors.push('book_without_id'); continue; }
    const raw = await listAll(a.entries.list.bind(a.entries), [id], uid, 300);
    if (!raw.complete) { out.complete = false; out.errors.push(`entries_incomplete:${id}`); }
    const meta = b.metadata || {};
    out.books.push({
      id, name: String(b.name || 'Untitled'), description: String(b.description || ''), vellum: !!meta.vellum,
      ownerChatId: String(meta.vellumOwnerChatId || ''), role: (meta.vellumRole === 'summary' || meta.vellumRole === 'lore') ? meta.vellumRole : 'manual',
      attachedToChat: out.attached.includes(id), global: globalIds.includes(id), entries: raw.items.map(liteEntry).filter(Boolean) as LiteEntry[],
    });
  }
  if (chatId && a.getActivated) {
    try {
      const act = await a.getActivated(chatId, uid).catch(() => a.getActivated(chatId));
      const u = unwrapList(act);
      if (u.ok) out.activated = u.arr.map((x: any) => ({ id: String(x?.id ?? ''), comment: x?.comment, source: x?.source })).filter((x) => x.id);
      else { out.complete = false; out.errors.push('activated_invalid'); }
    } catch { out.errors.push('activated_failed'); }
  }
  spindle.log?.info?.(`[vellum_engine] vaultSnapshot: ${out.books.length} book(s), ${out.books.reduce((n, b) => n + b.entries.length, 0)} entries, complete=${out.complete}`);
  return out;
}

export function ownedBooks(snap: VaultSnapshot, chatId: string): VaultBook[] { return snap.books.filter((b) => b.vellum && b.ownerChatId === chatId); }
export function ownedEntries(snap: VaultSnapshot, chatId: string): LiteEntry[] { return snap.books.flatMap((b) => b.entries).filter((e) => e.vellum && e.ownerChatId === chatId); }

export async function setBookAttached(chatId: string, bookId: string, attach: boolean, uid: string | null): Promise<boolean> {
  if (!chatId || !bookId || !spindle.chats?.get || !spindle.chats?.update) return false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await tryCatchAsync(async () => {
      const chat = await spindle.chats.get(chatId, uid ?? undefined); if (!chat) return false;
      const meta = { ...(chat.metadata || {}) }; const cur = strings(meta.chat_world_book_ids);
      meta.chat_world_book_ids = attach ? [...new Set([...cur, bookId])] : cur.filter((x) => x !== bookId);
      await spindle.chats.update(chatId, { metadata: meta }, uid ?? undefined);
      const check = await spindle.chats.get(chatId, uid ?? undefined); const next = strings(check?.metadata?.chat_world_book_ids);
      return attach ? next.includes(bookId) : !next.includes(bookId);
    });
    if (r.ok && r.value) return true;
  }
  return false;
}

export async function createBook(name: string, description: string, uid: string | null, ownerChatId = '', role: VaultRole = 'manual'): Promise<Result<string, string>> {
  const a = api(); if (!a) return Err('no_permission');
  return tryCatchAsync(async () => {
    const b = await a.create({ name: name.slice(0, 120), description: description.slice(0, 400), metadata: { vellum: true, vellumSchemaVersion: VAULT_SCHEMA_VERSION, ...(ownerChatId ? { vellumOwnerChatId: ownerChatId } : {}), vellumRole: role } }, uid);
    const id = String(b?.id || ''); if (!id) throw new Error('book_create_missing_id'); return id;
  });
}

export async function updateBook(bookId: string, name: string, description: string | undefined, uid: string | null): Promise<Result<true, string>> {
  const a = api(); if (!a) return Err('no_permission');
  return tryCatchAsync(async () => { const updated = await a.update(bookId, { name: name.slice(0, 120), ...(description !== undefined ? { description: description.slice(0, 400) } : {}) }, uid); if (!updated || String(updated.id) !== bookId) throw new Error('book_update_unverified'); return true as const; });
}

export interface EntryInput {
  bookId: string; key: string[]; keysecondary?: string[]; content: string; comment?: string; settings: EntrySettings;
  category: string; source?: string; link?: string; pending?: boolean; hash?: string; ownerChatId?: string;
  vaultRole?: VaultRole; canonicalType?: string; canonicalId?: string; overrideFields?: string[]; recursionKeys?: string[];
}

export function makeExtensions(input: Omit<EntryInput, 'bookId' | 'keysecondary' | 'comment' | 'settings'> & { createdAt?: number; updatedAt?: number }): Record<string, unknown> {
  const now = Date.now(); const link = input.link || ''; const colon = link.indexOf(':');
  return {
    vellum: true, vellumSchemaVersion: VAULT_SCHEMA_VERSION, vellumCategory: input.category, vellumSource: input.source ?? 'manual',
    ...(link ? { vellumLink: link } : {}), ...(input.pending ? { vellumPending: true } : {}),
    ...(input.ownerChatId ? { vellumOwnerChatId: input.ownerChatId } : {}), vellumRole: input.vaultRole ?? 'manual',
    ...(input.canonicalType || colon > 0 ? { vellumCanonicalType: input.canonicalType || link.slice(0, colon) } : {}),
    ...(input.canonicalId || colon > 0 ? { vellumCanonicalId: input.canonicalId || link.slice(colon + 1) } : {}),
    vellumHash: input.hash || contentHash(input.content), vellumKeyHash: keywordHash(input.key),
    ...(input.overrideFields?.length ? { vellumOverrideFields: [...new Set(input.overrideFields)] } : {}),
    ...(input.recursionKeys?.length ? { vellumRecursionKeys: [...new Set(input.recursionKeys)] } : {}),
    vellumCreatedAt: input.createdAt || now, vellumUpdatedAt: input.updatedAt || now,
  };
}

export function extensionsFromEntry(e: LiteEntry, patch: Partial<EntryInput> = {}): Record<string, unknown> {
  const ext = makeExtensions({
    category: patch.category ?? e.category, source: patch.source ?? e.source, link: patch.link ?? e.link,
    pending: patch.pending ?? e.pending, ownerChatId: patch.ownerChatId ?? e.ownerChatId, vaultRole: patch.vaultRole ?? e.vaultRole ?? 'manual',
    canonicalType: patch.canonicalType ?? e.canonicalType, canonicalId: patch.canonicalId ?? e.canonicalId,
    hash: patch.hash ?? e.hash, key: patch.key ?? e.key, content: patch.content ?? e.content,
    overrideFields: patch.overrideFields ?? e.overrideFields ?? [], recursionKeys: patch.recursionKeys ?? e.recursionKeys ?? [], createdAt: e.createdAt, updatedAt: Date.now(),
  });
  if (e.reveal?.day != null) ext.vellumRevealDay = e.reveal.day;
  if (e.reveal?.afterThread) ext.vellumRevealThread = e.reveal.afterThread;
  return ext;
}

export async function createEntry(e: EntryInput, uid: string | null): Promise<Result<string, string>> {
  const a = api(); if (!a) return Err('no_permission');
  return tryCatchAsync(async () => {
    const created = await a.entries.create(e.bookId, { key: e.key, keysecondary: e.keysecondary ?? [], content: e.content, comment: e.comment ?? '', ...settingsToEntryFields(e.settings), extensions: makeExtensions(e) }, uid);
    const id = String(created?.id || ''); if (!id) throw new Error('entry_create_missing_id'); return id;
  });
}

export async function syncEntry(entry: LiteEntry, content: string, key: string[], hash: string, link: string, category: string, uid: string | null, enable = false, comment?: string, keysecondary?: string[]): Promise<Result<true, string>> {
  const a = api(); if (!a) return Err('no_permission');
  return tryCatchAsync(async () => {
    const updated = await a.entries.update(entry.id, { content, key, ...(comment !== undefined ? { comment } : {}), ...(keysecondary ? { keysecondary } : {}), ...(enable ? { disabled: false } : {}), extensions: extensionsFromEntry(entry, { content, key, hash, link, category, source: entry.source || 'sync', overrideFields: (entry.overrideFields ?? []).filter((x) => x !== 'content' && x !== 'key') }) }, uid);
    if (!updated || String(updated.id) !== entry.id) throw new Error('entry_sync_unverified');
    return true as const;
  });
}

export async function updateEntry(entryId: string, patch: Record<string, unknown>, uid: string | null): Promise<Result<true, string>> {
  const a = api(); if (!a) return Err('no_permission');
  return tryCatchAsync(async () => { const updated = await a.entries.update(entryId, patch, uid); if (!updated || String(updated.id) !== entryId) throw new Error('entry_update_unverified'); return true as const; });
}
export async function deleteEntry(entryId: string, uid: string | null): Promise<Result<true, string>> {
  const a = api(); if (!a) return Err('no_permission');
  return tryCatchAsync(async () => { if (!(await a.entries.delete(entryId, uid))) throw new Error('entry_delete_unverified'); return true as const; });
}

export { Ok, Err };

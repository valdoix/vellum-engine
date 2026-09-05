import type { ChronicleState, MemorySnapshot } from './types.js';
import type { LiteEntry, VaultSnapshot } from '../host/worldbooks.js';

export type VaultIssueCode =
  | 'snapshot_incomplete' | 'foreign_attachment' | 'legacy_owner' | 'duplicate_link'
  | 'orphan_link' | 'body_conflict' | 'user_override' | 'missing_keys'
  | 'restricted_projection' | 'oversized_entry' | 'disabled_projection';

export interface VaultHealthIssue {
  code: VaultIssueCode;
  severity: 'error' | 'warning' | 'info';
  message: string;
  entryId?: string;
  bookId?: string;
  link?: string;
}

export interface VaultHealth {
  score: number;
  issues: VaultHealthIssue[];
  stats: { books: number; entries: number; conflicts: number; orphaned: number; owned: number };
}

function memoryIds(memories: MemorySnapshot[]): Set<string> {
  const ids = new Set<string>();
  const visit = (m: MemorySnapshot): void => { ids.add(m.id); for (const child of m.subsumed ?? []) visit(child); };
  for (const m of memories) visit(m);
  return ids;
}

function canonicalLinks(state: ChronicleState): Set<string> {
  const links = new Set<string>();
  for (const id of Object.keys(state.cast)) links.add(`cast:${id}`);
  for (const r of state.relations) links.add(`rel:${r.a}|${r.b}`);
  for (const id of Object.keys(state.factions)) links.add(`faction:${id}`);
  for (const l of state.locations) links.add(`location:${l.id}`);
  for (const i of state.items) links.add(`item:${i.id}`);
  for (const k of state.knowledge) links.add(`knowledge:${k.id}`);
  for (const s of state.secrets) links.add(`secret:${s.id}`);
  for (const j of state.journal) links.add(`journal:${j.id}`);
  for (const s of state.scars) links.add(`scar:${s.id}`);
  for (const l of state.lore) links.add(`lore:${l.id}`);
  for (const t of [...state.threads, ...state.arcs]) links.add(`thread:${t.id}`);
  const mids = memoryIds(state.memories);
  const visit = (m: MemorySnapshot): void => {
    if (m.tier === 'beat') links.add(`timeline:${m.id}`);
    else if (m.tier === 'chapter' || m.tier === 'arc' || m.tier === 'book') links.add(`${m.tier}:${m.id}`);
    else links.add(`memory:${m.id}`);
    for (const child of m.subsumed ?? []) visit(child);
  };
  for (const m of state.memories) visit(m);
  void mids;
  return links;
}

function restricted(e: LiteEntry, state: ChronicleState): boolean {
  if (/^(knowledge|journal|scar):/.test(e.link) || e.source === 'knowledge' || e.source === 'journal' || e.source === 'scars') return true;
  if (e.link.startsWith('secret:')) {
    const s = state.secrets.find((x) => x.id === e.link.slice(7));
    return !s || !s.revealed || s.from.some((id) => !(s.revealedTo ?? []).includes(id));
  }
  if (e.link.startsWith('rel:')) {
    const id = e.link.slice(4); return state.relations.find((x) => `${x.a}|${x.b}` === id)?.status === 'secret';
  }
  return false;
}

/** Read-only integrity audit. The Chronicle remains canonical; this reports
 * unsafe or stale host projections and never repairs or deletes by itself. */
export function auditVault(snapshot: VaultSnapshot, chatId: string, state: ChronicleState): VaultHealth {
  const issues: VaultHealthIssue[] = [];
  const ownedBooks = snapshot.books.filter((b) => b.vellum && b.ownerChatId === chatId);
  const entries = snapshot.books.flatMap((b) => b.entries).filter((e) => e.vellum && e.ownerChatId === chatId);
  const canonical = canonicalLinks(state);
  const byLink = new Map<string, LiteEntry[]>();
  let conflicts = 0;
  let orphaned = 0;

  if (!snapshot.complete) issues.push({ code: 'snapshot_incomplete', severity: 'error', message: 'The host returned an incomplete lorebook snapshot. Automatic deletes and overwrites are paused.' });
  for (const b of snapshot.books) {
    if (b.attachedToChat && b.vellum && b.ownerChatId && b.ownerChatId !== chatId) {
      issues.push({ code: 'foreign_attachment', severity: 'warning', bookId: b.id, message: `${b.name} belongs to another chat but is attached here.` });
    }
    if (b.vellum && !b.ownerChatId) issues.push({ code: 'legacy_owner', severity: 'info', bookId: b.id, message: `${b.name} is a legacy VELLUM book without a chat owner. It will not be auto-reconciled.` });
  }

  for (const e of entries) {
    if (e.link) { const rows = byLink.get(e.link) ?? []; rows.push(e); byLink.set(e.link, rows); }
    if (e.bodyState === 'conflict') { conflicts++; issues.push({ code: 'body_conflict', severity: 'warning', entryId: e.id, link: e.link, message: 'Host content changed outside VELLUM. The canonical refresh is paused for this entry.' }); }
    if (e.bodyState === 'override') { conflicts++; issues.push({ code: 'user_override', severity: 'info', entryId: e.id, link: e.link, message: 'This entry has an explicit user override and will not be overwritten.' }); }
    if (restricted(e, state) && !e.disabled) issues.push({ code: 'restricted_projection', severity: 'error', entryId: e.id, link: e.link, message: 'Character-private knowledge is enabled in a host lorebook where audience boundaries cannot be enforced.' });
    if (!e.constant && !e.key.length && !e.disabled) issues.push({ code: 'missing_keys', severity: 'warning', entryId: e.id, link: e.link, message: 'This keyed entry has no activation keywords.' });
    if (e.content.length > 12000) issues.push({ code: 'oversized_entry', severity: 'warning', entryId: e.id, link: e.link, message: `This entry is ${e.content.length.toLocaleString()} characters and may crowd out other context.` });
    if (e.link && !canonical.has(e.link)) { orphaned++; issues.push({ code: 'orphan_link', severity: 'warning', entryId: e.id, link: e.link, message: 'The canonical Chronicle record for this projection no longer exists.' }); }
    if (e.link && e.disabled && !restricted(e, state)) issues.push({ code: 'disabled_projection', severity: 'info', entryId: e.id, link: e.link, message: 'This canonical projection is disabled in the host lorebook.' });
  }
  for (const [link, rows] of byLink) if (rows.length > 1) {
    issues.push({ code: 'duplicate_link', severity: 'error', link, message: `${rows.length} owned entries point to the same canonical record.` });
  }

  const cost = issues.reduce((n, i) => n + (i.severity === 'error' ? 18 : i.severity === 'warning' ? 8 : 2), 0);
  return {
    score: Math.max(0, 100 - cost),
    issues,
    stats: { books: ownedBooks.length, entries: entries.length, conflicts, orphaned, owned: entries.filter((e) => e.ownerChatId === chatId).length },
  };
}

import { type EventLog, type VellumEvent, VellumEvent as VellumEventSchema, freshLog, SCHEMA_VERSION } from '../core/events.js';
import { type ChronicleState } from '../domain/types.js';
import { reduce } from '../core/reduce.js';
import { mergeDuplicates } from '../domain/identity.js';
import { migrate } from '../core/migrate.js';
import { tryCatchAsync } from '../core/result.js';

declare const spindle: any;

/**
 * Persistence for the append-only event log + a cached derived snapshot.
 * DURABILITY (hardened after a wipe incident): reads are FORGIVING and writes
 * are PROTECTED, so a single bad/old event can never discard the history:
 *  - parse events PER-EVENT; keep the good ones, drop only the malformed
 *  - if a file EXISTED but failed to load, mark the chat read-only and NEVER
 *    overwrite it (a read problem must not become a data-loss problem)
 *  - keep a .bak of the last good log before every write
 */

const path = (chatId: string): string => `vellum/log-${chatId}.json`;
const bakPath = (chatId: string): string => `vellum/log-${chatId}.bak.json`;

interface CacheEntry { log: EventLog; state: ChronicleState; reduced: number; readonly: boolean }
const _cache = new Map<string, CacheEntry>();

/** Validate an envelope leniently: keep events that parse, drop only bad ones.
 * Exported for tests — this is the durability guarantee (one bad event must
 * never discard the rest of the history). */
export function lenientLog(raw: unknown, chatId: string): { log: EventLog; dropped: number; usable: boolean } {
  // require recognizable log shape BEFORE migrate (so a non-log object isn't
  // coerced into an empty "usable" log and risk overwriting recoverable data).
  // Recognized = has an events array, OR a version field (a known envelope).
  const pre = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : null;
  const recognized = !!pre && (Array.isArray(pre.events) || typeof pre.version === 'number');
  if (!recognized) return { log: freshLog(chatId), dropped: 0, usable: false };
  // a log written by a NEWER schema than this code understands must not be
  // parsed-and-pruned (that would drop unknown-kind events, then a later persist
  // would clobber the good file). Treat as unusable → caller goes read-only.
  if (typeof pre.version === 'number' && pre.version > SCHEMA_VERSION) {
    return { log: freshLog(chatId), dropped: 0, usable: false };
  }
  const obj = (migrate(raw) ?? {}) as Record<string, unknown>;
  const rawEvents = Array.isArray(obj.events) ? obj.events : [];
  const events: VellumEvent[] = [];
  let dropped = 0;
  for (const e of rawEvents) {
    const v = VellumEventSchema.safeParse(e);
    if (v.success) events.push(v.data);
    else dropped++;
  }
  const log: EventLog = {
    version: SCHEMA_VERSION, chatId,
    events,
    createdAt: typeof obj.createdAt === 'number' ? obj.createdAt : Date.now(),
    updatedAt: typeof obj.updatedAt === 'number' ? obj.updatedAt : Date.now(),
  };
  return { log, dropped, usable: true };
}

export async function loadLog(chatId: string): Promise<EventLog> {
  const cached = _cache.get(chatId);
  if (cached) return cached.log;
  let log = freshLog(chatId);
  let readonly = false;
  const r = await tryCatchAsync(async () => {
    if (spindle.storage?.exists && (await spindle.storage.exists(path(chatId)))) {
      const raw = await spindle.storage.read(path(chatId));
      return { raw, existed: true };
    }
    return { raw: null as string | null, existed: false };
  });
  if (r.ok && r.value.existed && typeof r.value.raw === 'string') {
    // a file EXISTS — parse leniently; on total failure, go read-only (never wipe)
    let parsed: unknown = null;
    try { parsed = JSON.parse(r.value.raw); } catch { parsed = null; }
    if (parsed === null) {
      readonly = true;
      spindle.log?.warn?.('[vellum_engine] log JSON unreadable for ' + chatId + ' — READ-ONLY, not overwriting.');
    } else {
      const { log: ll, dropped, usable } = lenientLog(parsed, chatId);
      if (!usable) { readonly = true; spindle.log?.warn?.('[vellum_engine] log shape unrecognized for ' + chatId + ' — READ-ONLY.'); }
      else { log = ll; if (dropped) spindle.log?.warn?.('[vellum_engine] dropped ' + dropped + ' malformed event(s) for ' + chatId + ' (kept ' + log.events.length + ').'); }
    }
  } else if (!r.ok) {
    // read threw (host error) — do NOT treat as empty; read-only this session
    readonly = true;
    spindle.log?.warn?.('[vellum_engine] log read failed for ' + chatId + ' — READ-ONLY this session.');
  }
  _cache.set(chatId, { log, state: mergeDuplicates(reduce(log.events)), reduced: log.events.length, readonly });
  return log;
}

/** Derived state for a chat (incrementally folded, cached). */
export async function loadState(chatId: string): Promise<ChronicleState> {
  await loadLog(chatId);
  const c = _cache.get(chatId)!;
  if (c.reduced < c.log.events.length) {
    c.state = reduce(c.log.events, c.state, c.reduced); // fold only new events
    c.reduced = c.log.events.length;
    // self-heal split cast nodes (cersei + cersei_lannister) into the canonical
    // id and remap all references. Idempotent; runs only when new events folded.
    c.state = mergeDuplicates(c.state);
  }
  return c.state;
}

async function persist(chatId: string): Promise<void> {
  const c = _cache.get(chatId);
  if (!c) return;
  if (c.readonly) { spindle.log?.warn?.('[vellum_engine] refusing to persist ' + chatId + ' (read-only — would risk overwriting recoverable data).'); return; }
  c.log.updatedAt = Date.now();
  c.log.version = SCHEMA_VERSION;
  await tryCatchAsync(async () => {
    if (!spindle.storage?.write) return;
    // Backup the last good on-disk log before overwriting — but NEVER let a
    // SHORTER log clobber a LONGER backup. A rollback/truncation that shrinks the
    // log must not destroy the only copy of the fuller history (the wipe vector).
    try {
      if (spindle.storage.exists && (await spindle.storage.exists(path(chatId)))) {
        const prev = await spindle.storage.read(path(chatId));
        if (prev) {
          const prevLen = eventCount(prev);
          const bakLen = (spindle.storage.exists && (await spindle.storage.exists(bakPath(chatId)))) ? eventCount(await spindle.storage.read(bakPath(chatId))) : -1;
          // keep whichever is LONGER as the backup (the fullest history we've seen)
          if (prevLen >= bakLen) await spindle.storage.write(bakPath(chatId), prev);
          else if (c.log.events.length > bakLen) { /* current write is the longest — leave the bak as the prior longest */ }
        }
      }
    } catch { /* best effort */ }
    await spindle.storage.write(path(chatId), JSON.stringify(c.log));
  });
}

/** Count events in a raw stored envelope without full validation (for the
 * shrink-guard: cheap, tolerant). Returns -1 if unparseable. */
function eventCount(raw: string | null | undefined): number {
  if (!raw) return -1;
  try { const o = JSON.parse(raw); return Array.isArray(o?.events) ? o.events.length : -1; } catch { return -1; }
}

/**
 * RECOVERY: restore a chat from its `.bak` if the backup holds MORE events than
 * the current log (i.e. a shrink/wipe happened). Clears the read-only guard and
 * re-persists. Returns the recovered state, or null if there's nothing better to
 * restore. Safe to call anytime.
 */
export async function recoverFromBackup(chatId: string): Promise<ChronicleState | null> {
  if (!spindle.storage?.read) return null;
  let bakRaw: string | null = null;
  try { if (spindle.storage.exists && (await spindle.storage.exists(bakPath(chatId)))) bakRaw = await spindle.storage.read(bakPath(chatId)); } catch { /* ignore */ }
  if (!bakRaw) return null;
  let curLen = -1;
  try { if (spindle.storage.exists && (await spindle.storage.exists(path(chatId)))) curLen = eventCount(await spindle.storage.read(path(chatId))); } catch { /* ignore */ }
  let parsed: unknown = null;
  try { parsed = JSON.parse(bakRaw); } catch { return null; }
  const { log, usable } = lenientLog(parsed, chatId);
  if (!usable || log.events.length <= curLen) return null; // backup isn't fuller — nothing to recover
  _cache.set(chatId, { log, state: mergeDuplicates(reduce(log.events)), reduced: log.events.length, readonly: false });
  await persist(chatId);
  spindle.log?.warn?.('[vellum_engine] recovered ' + chatId + ' from backup (' + log.events.length + ' events).');
  return _cache.get(chatId)!.state;
}

/** Append events to a chat's log (in memory) + persist. Returns new state. */
export async function append(chatId: string, events: VellumEvent[]): Promise<ChronicleState> {
  if (!events.length) return loadState(chatId);
  await loadLog(chatId);
  const c = _cache.get(chatId)!;
  if (c.readonly) { spindle.log?.warn?.('[vellum_engine] not appending to read-only ' + chatId); return loadState(chatId); }
  c.log.events.push(...events);
  await persist(chatId);
  return loadState(chatId);
}

export function invalidate(chatId?: string): void {
  if (chatId) _cache.delete(chatId);
  else _cache.clear();
}

/** Is this chat in the protective read-only state (load failed)? */
export function isReadonly(chatId: string): boolean { return _cache.get(chatId)?.readonly ?? false; }

/**
 * Per-turn content signature map from the log's `turn.fold` events: turn → sig.
 * Lets the fold reconcile detect a REGENERATED or EDITED earlier turn (same
 * message count, changed content) so it can roll that turn back and re-fold.
 * Last write wins, so a re-folded turn's newer sig overwrites the old.
 */
export async function turnSigs(chatId: string): Promise<Map<number, string>> {
  await loadLog(chatId);
  const c = _cache.get(chatId);
  const out = new Map<number, string>();
  if (!c) return out;
  for (const e of c.log.events) {
    if (e.kind === 'turn.fold') out.set(e.turn, e.sig);
  }
  return out;
}

/** Monotonic log version = event count. Bumps on every append/edit; used to
 * key the recall index so in-place content edits invalidate it (Fix 20). */
export function logVersion(chatId: string): number { return _cache.get(chatId)?.log.events.length ?? 0; }

/**
 * Fix 10 — UNDO: drop every event whose turn is greater than `turn` (so
 * `truncateAfterTurn(c, n)` keeps turns 1..n). Honors the read-only durability
 * guard: a recovered/unreadable log is never rewritten. Returns the new state.
 */
export async function truncateAfterTurn(chatId: string, turn: number): Promise<ChronicleState> {
  await loadLog(chatId);
  const c = _cache.get(chatId)!;
  if (c.readonly) { spindle.log?.warn?.('[vellum_engine] refusing to truncate read-only ' + chatId); return loadState(chatId); }
  const kept = c.log.events.filter((e) => e.turn <= turn);
  if (kept.length === c.log.events.length) return loadState(chatId); // nothing to drop
  c.log.events = kept;
  c.state = mergeDuplicates(reduce(kept)); // full re-reduce: truncation isn't a forward fold
  c.reduced = kept.length;
  await persist(chatId);
  return c.state;
}

/** Wipe a chat's event log entirely (clear all data). Explicit user action, so
 * it clears the read-only guard and persists the empty log intentionally. */
export async function clearLog(chatId: string): Promise<void> {
  _cache.set(chatId, { log: freshLog(chatId), state: reduce([]), reduced: 0, readonly: false });
  await persist(chatId);
}

/** Export a chat's full event log (for backup / portability). */
export async function exportLog(chatId: string): Promise<EventLog> {
  return loadLog(chatId);
}

/** Replace a chat's log with imported events (lenient: keeps parseable events).
 * Explicit user action → clears the read-only guard. */
export async function importLog(chatId: string, log: EventLog): Promise<ChronicleState> {
  const { log: next } = lenientLog(log, chatId);
  _cache.set(chatId, { log: next, state: mergeDuplicates(reduce(next.events)), reduced: next.events.length, readonly: false });
  await persist(chatId);
  return _cache.get(chatId)!.state;
}

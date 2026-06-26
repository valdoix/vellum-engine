import { type EventLog, type VellumEvent, EventLog as EventLogSchema, freshLog, SCHEMA_VERSION } from '../core/events.js';
import { type ChronicleState } from '../domain/types.js';
import { reduce } from '../core/reduce.js';
import { migrate } from '../core/migrate.js';
import { tryCatchAsync } from '../core/result.js';

declare const spindle: any;

/**
 * Persistence for the append-only event log + a cached derived snapshot.
 * Writes go through a per-chat serialized queue (writeQueue) so concurrent
 * background tasks can never interleave a load→mutate→save and clobber each
 * other — the legacy last-writer-wins bug is structurally impossible here.
 */

const path = (chatId: string): string => `vellum/log-${chatId}.json`;

interface CacheEntry { log: EventLog; state: ChronicleState; reduced: number }
const _cache = new Map<string, CacheEntry>();

export async function loadLog(chatId: string): Promise<EventLog> {
  const cached = _cache.get(chatId);
  if (cached) return cached.log;
  const r = await tryCatchAsync(async () => {
    if (spindle.storage?.exists && (await spindle.storage.exists(path(chatId)))) {
      const raw = await spindle.storage.read(path(chatId));
      const parsed = JSON.parse(raw);
      const migrated = migrate(parsed); // upgrade older logs to SCHEMA_VERSION
      const validated = EventLogSchema.safeParse(migrated);
      if (validated.success) return validated.data;
    }
    return freshLog(chatId);
  });
  const log = r.ok ? r.value : freshLog(chatId);
  _cache.set(chatId, { log, state: reduce(log.events), reduced: log.events.length });
  return log;
}

/** Derived state for a chat (incrementally folded, cached). */
export async function loadState(chatId: string): Promise<ChronicleState> {
  await loadLog(chatId);
  const c = _cache.get(chatId)!;
  if (c.reduced < c.log.events.length) {
    c.state = reduce(c.log.events, c.state, c.reduced); // fold only new events
    c.reduced = c.log.events.length;
  }
  return c.state;
}

async function persist(chatId: string): Promise<void> {
  const c = _cache.get(chatId);
  if (!c) return;
  c.log.updatedAt = Date.now();
  c.log.version = SCHEMA_VERSION;
  await tryCatchAsync(async () => { if (spindle.storage?.write) await spindle.storage.write(path(chatId), JSON.stringify(c.log)); });
}

/** Append events to a chat's log (in memory) + persist. Returns new state. */
export async function append(chatId: string, events: VellumEvent[]): Promise<ChronicleState> {
  if (!events.length) return loadState(chatId);
  await loadLog(chatId);
  const c = _cache.get(chatId)!;
  c.log.events.push(...events);
  await persist(chatId);
  return loadState(chatId);
}

export function invalidate(chatId?: string): void {
  if (chatId) _cache.delete(chatId);
  else _cache.clear();
}

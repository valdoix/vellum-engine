import { type Result, Ok, Err } from '../core/result.js';

declare const spindle: any;

/**
 * The ONE place userId is resolved. Operator-scoped hosts require a userId on
 * world_books/chats/memories/generation calls; several internal paths
 * (interceptor, timers, cold worker) don't naturally carry one. Legacy scattered
 * `userId || _lastUserId` everywhere with an in-memory-only global that was null
 * after idle-unload — the root cause of the Vault failure. Here it is resolved
 * once and PERSISTED so it survives worker reloads.
 */

const UID_PATH = 'vellum/last-user.json';
let _uid: string | null = null;
let _restored = false;

/** Remember a uid seen from any frontend message / event / generation. */
export function rememberUser(u: unknown): void {
  if (typeof u === 'string' && u) {
    if (u !== _uid) {
      _uid = u;
      // fire-and-forget persist; survives idle-unload
      try { void spindle.storage?.write?.(UID_PATH, JSON.stringify({ uid: u, at: Date.now() })); } catch { /* best effort */ }
    }
  }
}

/** Restore the persisted uid on cold start (call once during backend init). */
export async function restoreUser(): Promise<void> {
  if (_restored) return;
  _restored = true;
  try {
    if (spindle.storage?.exists && (await spindle.storage.exists(UID_PATH))) {
      const raw = await spindle.storage.read(UID_PATH);
      const parsed = JSON.parse(raw);
      if (parsed?.uid && !_uid) _uid = String(parsed.uid);
    }
  } catch { /* best effort */ }
}

/** Best-known uid right now (may be null on a truly cold worker pre-restore). */
export function currentUser(): string | null {
  return _uid;
}

/**
 * Resolve a uid for a host call, preferring an explicit one. Returns a typed
 * error instead of silently proceeding with undefined (which is what made
 * operator-scoped failures invisible).
 */
export function requireUser(explicit?: unknown): Result<string, 'no_user'> {
  const u = (typeof explicit === 'string' && explicit) ? explicit : _uid;
  return u ? Ok(u) : Err('no_user');
}

import { type Result, Ok, Err } from '../core/result.js';

declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

/**
 * The ONE place userId is resolved. Operator-scoped hosts require a userId on
 * world_books/chats/memories/generation calls. Authenticated frontend messages,
 * interceptors, and event callbacks now pass that id explicitly. `_uid` remains
 * only as a same-worker fallback for older single-user hosts; it is never written
 * to shared extension storage, where a singleton user id could cross-route an
 * operator-scoped installation.
 */

let _uid: string | null = null;

/** Remember a uid seen from any frontend message / event / generation. */
export function rememberUser(u: unknown): void {
  if (typeof u === 'string' && u) {
    if (u !== _uid) {
      _uid = u;
    }
  }
}

/** Kept for startup compatibility. User identity is host-supplied, not restored
 * from a process-global storage record. */
export async function restoreUser(): Promise<void> {
  return;
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

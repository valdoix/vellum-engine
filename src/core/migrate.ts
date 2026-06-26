import { SCHEMA_VERSION } from './events.js';

/**
 * Migrate a persisted log envelope (any prior shape) up to SCHEMA_VERSION.
 * Unlike legacy's `version:3`-that-nothing-read, this is the ONE place schema
 * evolution happens, keyed on the stored version. Each step is a pure transform.
 *
 * Accepts `unknown` (a raw parsed blob) and returns a best-effort upgraded
 * object; the caller still zod-validates the result, so a failed migration
 * degrades to a fresh log rather than crashing.
 */
export function migrate(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  let version = typeof obj.version === 'number' ? obj.version : 1;

  // v1 → v2: ensure events array + envelope timestamps exist.
  if (version < 2) {
    if (!Array.isArray(obj.events)) obj.events = [];
    if (typeof obj.createdAt !== 'number') obj.createdAt = Date.now();
    if (typeof obj.updatedAt !== 'number') obj.updatedAt = Date.now();
    version = 2;
  }

  // future: if (version < 3) { ... }

  obj.version = SCHEMA_VERSION;
  return obj;
}

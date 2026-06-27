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

  // v2 → v3: relationships became DIRECTIONAL (ordered a→b). Logs written under
  // the old undirected semantics expected a single `bond.drop` to fully sever a
  // pair; under directional reduce that now only severs one direction. Rewrite
  // historical drops to `both:true` so ended bonds stay ended on reload.
  if (version < 3) {
    if (Array.isArray(obj.events)) {
      for (const e of obj.events) {
        if (e && typeof e === 'object' && (e as Record<string, unknown>).kind === 'bond.drop' && (e as Record<string, unknown>).both === undefined) {
          (e as Record<string, unknown>).both = true;
        }
      }
    }
    version = 3;
  }

  // v3 → v4: knowledge gained reliability/truth/source. Purely additive +
  // optional; old knowledge.learn events default (knows/unknown/—) on reduce.
  // Nothing to rewrite — just advance the version.
  if (version < 4) {
    version = 4;
  }

  // v4 → v5: thread.merge / arc.merge event kinds added (Layer 3 reconcile).
  // Additive — no historical rewrite.
  if (version < 5) {
    version = 5;
  }

  obj.version = SCHEMA_VERSION;
  return obj;
}

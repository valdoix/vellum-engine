import { has } from './capability.js';
import { tryCatchAsync, type Result, Ok, Err } from '../core/result.js';

declare const spindle: any;

/**
 * Thin wrapper over the host regex_scripts API. Operator-scoped: every call
 * carries a uid. VELLUM owns `display`-target scripts that color character
 * dialogue (stamped `metadata.vellum: true`). Reads degrade to empty; writes
 * return a typed Result so the caller can surface a reason.
 */

function api(): any { return spindle.regex_scripts || null; }
export async function hasRegex(): Promise<boolean> { return (await has('regex_scripts')) && !!api(); }

/** Minimal read shape we need from a RegexScriptDTO. */
export interface LiteScript {
  id: string;
  script_id: string;
  disabled: boolean;
  metadata: Record<string, unknown>;
}

/** Create/update input — the fields VELLUM sets. */
export interface ScriptInput {
  script_id: string;
  name: string;
  find_regex: string;
  replace_string: string;
  flags?: string;
  placement?: string[];
  scope?: 'global' | 'character' | 'chat';
  scope_id?: string | null;
  target?: 'prompt' | 'response' | 'display';
  substitute_macros?: 'none' | 'raw' | 'escaped' | 'after';
  run_on_edit?: boolean;
  sort_order?: number;
  description?: string;
  folder?: string;
  metadata?: Record<string, unknown>;
}

/** List VELLUM-owned scripts (metadata.vellum truthy). Degrades to []. */
export async function listVellumScripts(uid: string | null): Promise<LiteScript[]> {
  const a = api(); if (!a) return [];
  try {
    const r = await a.list({ limit: 200, ...(uid ? { userId: uid } : {}) });
    const arr: any[] = Array.isArray(r) ? r : (r?.data ?? r?.items ?? []);
    return arr
      .filter((s) => s && s.metadata && (s.metadata as Record<string, unknown>).vellum)
      .map((s) => ({ id: String(s.id ?? ''), script_id: String(s.script_id ?? ''), disabled: !!s.disabled, metadata: (s.metadata ?? {}) as Record<string, unknown> }));
  } catch { return []; }
}

/** Find an existing script by its stable `script_id`. Returns null on miss. */
async function findByScriptId(scriptId: string, uid: string | null): Promise<any | null> {
  const a = api(); if (!a) return null;
  try {
    // Try a broad list first (no scope filter); Lumiverse list() does strict filtering
    // so we may need to scan multiple scopes if the script_id doesn't tell us its scope.
    const r = await a.list({ limit: 200, ...(uid ? { userId: uid } : {}) });
    const arr: any[] = Array.isArray(r) ? r : (r?.data ?? r?.items ?? []);
    return arr.find((s) => s?.script_id === scriptId) ?? null;
  } catch { return null; }
}

/** Idempotent upsert keyed on `script_id`: update if present, else create.
 * Returns the host script id. */
export async function upsertScript(input: ScriptInput, uid: string | null): Promise<Result<string, string>> {
  const a = api(); if (!a) return Err('no_permission');
  return tryCatchAsync(async () => {
    const existing = await findByScriptId(input.script_id, uid);
    const body = {
      name: input.name,
      find_regex: input.find_regex,
      replace_string: input.replace_string,
      flags: input.flags ?? 'gi',
      placement: input.placement ?? ['ai_output'],
      scope: input.scope ?? 'global',
      scope_id: input.scope_id ?? null,
      target: input.target ?? 'display',
      substitute_macros: input.substitute_macros ?? 'after',
      run_on_edit: input.run_on_edit ?? true,
      sort_order: input.sort_order ?? 30,
      description: input.description ?? '',
      folder: input.folder ?? 'VELLUM Engine',
      script_id: input.script_id,
      disabled: false, // VELLUM scripts default to enabled
      metadata: { vellum: true, ...(input.metadata ?? {}) },
    };
    
    // If found via list, update by ID
    if (existing?.id) { await a.update(String(existing.id), body, uid); return String(existing.id); }
    
    // Not found — try create, but catch "already exists" and retry as update
    try {
      const created = await a.create(body, uid);
      return String(created?.id ?? '');
    } catch (createErr: any) {
      const errMsg = String(createErr?.message ?? createErr ?? '').toLowerCase();
      if (errMsg.includes('already exists') || errMsg.includes('script_id')) {
        // list() missed it but create says it exists — try brute-force scan
        try {
          const allScripts = await a.list({ limit: 500 });
          const arr: any[] = Array.isArray(allScripts) ? allScripts : (allScripts?.data ?? allScripts?.items ?? []);
          const match = arr.find((s: any) => s?.script_id === input.script_id);
          if (match?.id) {
            await a.update(String(match.id), body, uid);
            return String(match.id);
          }
        } catch { /* ignore */ }
      }
      throw createErr; // re-throw if not "already exists" or recovery failed
    }
  });
}

/** Enable/disable a script by its stable `script_id`. No-op if absent. */
export async function setScriptDisabled(scriptId: string, disabled: boolean, uid: string | null): Promise<Result<true, string>> {
  const a = api(); if (!a) return Err('no_permission');
  return tryCatchAsync(async () => {
    const existing = await findByScriptId(scriptId, uid);
    if (existing?.id) await a.update(String(existing.id), { disabled }, uid);
    return true as const;
  });
}

/** Delete a script by its stable `script_id`. No-op if absent. */
export async function deleteScriptByScriptId(scriptId: string, uid: string | null): Promise<Result<true, string>> {
  const a = api(); if (!a) return Err('no_permission');
  return tryCatchAsync(async () => {
    const existing = await findByScriptId(scriptId, uid);
    if (existing?.id) await a.delete(String(existing.id), uid);
    return true as const;
  });
}

/** Read a script's metadata by its stable `script_id` (for idempotency hash checks). */
export async function scriptMeta(scriptId: string, uid: string | null): Promise<Record<string, unknown> | null> {
  const existing = await findByScriptId(scriptId, uid);
  return existing ? ((existing.metadata ?? {}) as Record<string, unknown>) : null;
}

export { Ok, Err };

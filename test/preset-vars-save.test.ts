import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { updatePresetMetadataKey } from '../src/host/presets.js';
import { invalidatePermissions } from '../src/host/capability.js';

// updatePresetMetadataKey backs the vellum_preset_vars_save handler (the backend
// fallback that persists the Loom editor's prompt-variable values into
// metadata.promptVariables). It must send expected_cache_revision, merge the one
// key without dropping other metadata (including vellum_engine), and retry once
// on a revision conflict.

let getCalls = 0;
let updateArgs: any[] = [];

function makeConflict(actualCacheRevision: number): Error {
  const e = new Error(`Preset p1 changed since revision 3; current revision is ${actualCacheRevision}`);
  return Object.assign(e, { code: 'PRESET_REVISION_CONFLICT', actualCacheRevision });
}

beforeEach(() => {
  invalidatePermissions();
  getCalls = 0;
  updateArgs = [];
  (globalThis as any).spindle = {
    permissions: { has: async () => true },
    has: async () => true,
    presets: {
      get: async (_id: string, _uid: string) => {
        getCalls++;
        return { id: 'p1', metadata: { foo: 1, vellum_engine: { identifier: 'vellum_engine' } }, cache_revision: 3 };
      },
      update: async (id: string, input: any, uid: string) => {
        updateArgs.push({ id, input, uid });
        return { id, metadata: input.metadata, cache_revision: (input.expected_cache_revision ?? 0) + 1 };
      },
    },
  };
});
afterEach(() => { invalidatePermissions(); });

describe('updatePresetMetadataKey — prompt-variable value persistence', () => {
  it('sends expected_cache_revision and merges only the target key', async () => {
    const pv = { blk1: { tone: 'formal' } };
    const r = await updatePresetMetadataKey('p1', 'promptVariables', pv, 'u1');
    expect(r.ok).toBe(true);
    expect(updateArgs).toHaveLength(1);
    const { input } = updateArgs[0];
    expect(input.expected_cache_revision).toBe(3);
    expect(input.metadata.promptVariables).toEqual(pv);
    // other metadata preserved, no prompt content marshalled
    expect(input.metadata.foo).toBe(1);
    expect(input.metadata.vellum_engine.identifier).toBe('vellum_engine');
    expect(input.prompts).toBeUndefined();
    expect(input.prompt_order).toBeUndefined();
  });

  it('retries once with the authoritative revision on a conflict', async () => {
    let first = true;
    (globalThis as any).spindle.presets.update = async (id: string, input: any, uid: string) => {
      updateArgs.push({ id, input, uid });
      if (first) { first = false; throw makeConflict(7); }
      return { id, metadata: input.metadata, cache_revision: 8 };
    };
    const r = await updatePresetMetadataKey('p1', 'promptVariables', { a: { x: 1 } }, 'u1');
    expect(r.ok).toBe(true);
    expect(updateArgs).toHaveLength(2);
    expect(updateArgs[1].input.expected_cache_revision).toBe(7);
    expect(getCalls).toBe(2); // re-read before retry so the merge is fresh
  });

  it('fails without throwing when the conflict persists', async () => {
    (globalThis as any).spindle.presets.update = async (id: string, input: any, uid: string) => {
      updateArgs.push({ id, input, uid });
      throw makeConflict(7);
    };
    const r = await updatePresetMetadataKey('p1', 'promptVariables', {}, 'u1');
    expect(r.ok).toBe(false);
    expect(updateArgs).toHaveLength(2);
  });

  it('returns no_presets_permission when the permission is absent', async () => {
    (globalThis as any).spindle.permissions = { getGranted: async () => [] };
    const r = await updatePresetMetadataKey('p1', 'promptVariables', {}, 'u1');
    expect(r).toEqual({ ok: false, error: 'no_presets_permission' });
    expect(updateArgs).toHaveLength(0);
  });

  it('returns no_presets_api when get/update are missing', async () => {
    (globalThis as any).spindle.presets = {};
    const r = await updatePresetMetadataKey('p1', 'promptVariables', {}, 'u1');
    expect(r).toEqual({ ok: false, error: 'no_presets_api' });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { stampPresetMetadata } from '../src/host/presets.js';
import { invalidatePermissions } from '../src/host/capability.js';

// stampPresetMetadata calls the host via globalThis.spindle. We stub
// spindle.presets.{get,update} to assert the revision-aware read-modify-write
// contract: it must send expected_cache_revision, merge metadata only (never
// prompts/prompt_order), and retry once on a revision conflict.

let getCalls = 0;
let updateArgs: any[] = [];

function makeConflict(actualCacheRevision: number): Error {
  // Mirror Lumiverse's deserializeWorkerResponseError: an Error whose message
  // carries the conflict text with `code`/`actualCacheRevision` assigned on.
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
        return { id: 'p1', metadata: { foo: 1 }, cache_revision: 3, prompts: { should: 'not-leak' }, prompt_order: [1, 2] };
      },
      update: async (id: string, input: any, uid: string) => {
        updateArgs.push({ id, input, uid });
        return { id, metadata: input.metadata, cache_revision: (input.expected_cache_revision ?? 0) + 1 };
      },
    },
  };
});
afterEach(() => { invalidatePermissions(); });

describe('stampPresetMetadata — revision-aware update contract', () => {
  it('sends expected_cache_revision and merges metadata only (no prompt round-trip)', async () => {
    const r = await stampPresetMetadata('p1', { version: '2.1.0', identifier: 'vellum_engine' }, 'u1');
    expect(r.ok).toBe(true);
    expect(updateArgs).toHaveLength(1);
    const { input } = updateArgs[0];
    expect(input.expected_cache_revision).toBe(3);
    expect(input.metadata.vellum_engine.identifier).toBe('vellum_engine');
    // preserves unrelated metadata and never marshals prompt content
    expect(input.metadata.foo).toBe(1);
    expect(input.prompts).toBeUndefined();
    expect(input.prompt_order).toBeUndefined();
  });

  it('replaces vellum_engine but preserves other metadata keys', async () => {
    (globalThis as any).spindle.presets.get = async () => {
      getCalls++;
      return { id: 'p1', metadata: { foo: 1, vellum_engine: { old: true } }, cache_revision: 5 };
    };
    const r = await stampPresetMetadata('p1', { identifier: 'vellum_engine', linkedAt: 42 }, 'u1');
    expect(r.ok).toBe(true);
    const { input } = updateArgs[0];
    expect(input.metadata.foo).toBe(1);
    expect(input.metadata.vellum_engine).toEqual({ identifier: 'vellum_engine', linkedAt: 42 });
    expect(input.metadata.vellum_engine.old).toBeUndefined();
  });

  it('retries once with the fresh revision on a conflict, then succeeds', async () => {
    let firstUpdate = true;
    (globalThis as any).spindle.presets.update = async (id: string, input: any, uid: string) => {
      updateArgs.push({ id, input, uid });
      if (firstUpdate) { firstUpdate = false; throw makeConflict(9); }
      return { id, metadata: input.metadata, cache_revision: 10 };
    };
    const r = await stampPresetMetadata('p1', { identifier: 'vellum_engine' }, 'u1');
    expect(r.ok).toBe(true);
    expect(updateArgs).toHaveLength(2);
    // second attempt used the host's authoritative revision from the conflict
    expect(updateArgs[1].input.expected_cache_revision).toBe(9);
    // re-read the preset before retrying so the merged metadata is fresh
    expect(getCalls).toBe(2);
  });

  it('fails (no throw) when the conflict persists across the retry', async () => {
    (globalThis as any).spindle.presets.update = async (id: string, input: any, uid: string) => {
      updateArgs.push({ id, input, uid });
      throw makeConflict(9);
    };
    const r = await stampPresetMetadata('p1', { identifier: 'vellum_engine' }, 'u1');
    expect(r.ok).toBe(false);
    expect(updateArgs).toHaveLength(2); // original + one retry, then give up
  });

  it('returns no_presets_permission when the permission is absent', async () => {
    // getGranted is probed first; an empty grant set means no presets permission.
    (globalThis as any).spindle.permissions = { getGranted: async () => [] };
    const r = await stampPresetMetadata('p1', {}, 'u1');
    expect(r).toEqual({ ok: false, error: 'no_presets_permission' });
    expect(updateArgs).toHaveLength(0);
  });

  it('returns no_presets_api when get/update are missing', async () => {
    (globalThis as any).spindle.presets = {};
    const r = await stampPresetMetadata('p1', {}, 'u1');
    expect(r).toEqual({ ok: false, error: 'no_presets_api' });
  });

  it('prefers a metadata-only host API when available', async () => {
    let metaArgs: any = null;
    (globalThis as any).spindle.presets.updateMetadata = async (id: string, patch: any, uid: string) => {
      metaArgs = { id, patch, uid };
    };
    const r = await stampPresetMetadata('p1', { identifier: 'vellum_engine' }, 'u1');
    expect(r.ok).toBe(true);
    expect(metaArgs.patch.vellum_engine.identifier).toBe('vellum_engine');
    // the revision-aware fallback is not exercised when updateMetadata exists
    expect(updateArgs).toHaveLength(0);
    expect(getCalls).toBe(0);
  });
});

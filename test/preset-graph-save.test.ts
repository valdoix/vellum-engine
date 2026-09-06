import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { updatePresetGraph } from '../src/host/presets.js';
import { invalidatePermissions } from '../src/host/capability.js';

let updates: any[] = [];

beforeEach(() => {
  invalidatePermissions();
  updates = [];
  (globalThis as any).spindle = {
    permissions: { has: async () => true },
    has: async () => true,
    presets: {
      get: async () => ({ id: 'p1', cache_revision: 7, metadata: { keep: 'yes', promptVariables: { old: {} } } }),
      update: async (id: string, input: any, uid: string) => {
        updates.push({ id, input, uid });
        return { id, ...input, cache_revision: 8 };
      },
    },
  };
});

afterEach(() => {
  invalidatePermissions();
  delete (globalThis as any).spindle;
});

describe('revision-checked compact preset save', () => {
  it('writes one coherent block/value snapshot and preserves unrelated metadata', async () => {
    const blocks = [{ id: 'b1', name: 'Block', role: 'system', position: 'pre_history', content: 'x', enabled: true }] as any;
    const values = { b1: { tone: 'quiet' } } as any;
    const result = await updatePresetGraph('p1', blocks, values, 7, 'u1');
    expect(result).toEqual({ ok: true, value: { cacheRevision: 8 } });
    expect(updates).toHaveLength(1);
    expect(updates[0].input).toMatchObject({
      prompt_order: blocks,
      metadata: { keep: 'yes', promptVariables: values },
      expected_cache_revision: 7,
    });
  });

  it('rejects a stale detached editor snapshot without issuing a write', async () => {
    const result = await updatePresetGraph('p1', [], {}, 6, 'u1');
    expect(result).toEqual({ ok: false, error: 'preset_revision_conflict' });
    expect(updates).toEqual([]);
  });

  it('rejects missing permission and API surfaces cleanly', async () => {
    (globalThis as any).spindle.permissions = { getGranted: async () => [] };
    expect(await updatePresetGraph('p1', [], {}, 7, 'u1')).toEqual({ ok: false, error: 'no_presets_permission' });
    invalidatePermissions();
    (globalThis as any).spindle.permissions = { has: async () => true };
    (globalThis as any).spindle.presets = {};
    expect(await updatePresetGraph('p1', [], {}, 7, 'u1')).toEqual({ ok: false, error: 'no_presets_api' });
  });
});

import { describe, it, expect } from 'vitest';
import { reduce } from '../src/core/reduce.js';
import { mergeCastDuplicates } from '../src/domain/identity.js';
import { coreFeature } from '../src/domain/core-feature.js';
import { freshState } from '../src/domain/types.js';
import { migrate } from '../src/core/migrate.js';
import { SCHEMA_VERSION } from '../src/core/events.js';
import type { ExtractCtx } from '../src/bus/registry.js';
import type { VellumEvent } from '../src/core/events.js';

let seq = 0;
const sf = () => ++seq;
const ev = (e: Partial<VellumEvent>): VellumEvent => ({ seq: sf(), turn: 5, day: 1, src: 'model', ...(e as object) } as VellumEvent);
const ctx = (state = freshState(), userCanon = ''): ExtractCtx => ({ turn: 5, day: 1, state, seq: sf, userCanon } as any);

describe('possession tracker — reduce', () => {
  it('gain adds an item and registers the holder; dedups same who+item', () => {
    const s = reduce([
      ev({ kind: 'item.change', id: 'i1', who: 'cersei', item: 'the forged letter', op: 'gain' }),
      ev({ kind: 'item.change', id: 'i2', who: 'cersei', item: 'The Forged Letter', op: 'gain', note: 'hid it' }),
    ]);
    expect(s.items).toHaveLength(1);
    expect(s.cast.cersei).toBeDefined();
    expect(s.items[0]!.note).toBe('hid it'); // dedup merged the note
  });

  it('lose removes; give moves to the recipient', () => {
    const lost = reduce([
      ev({ kind: 'item.change', id: 'i1', who: 'cersei', item: 'ring', op: 'gain' }),
      ev({ kind: 'item.change', id: 'i2', who: 'cersei', item: 'ring', op: 'lose' }),
    ]);
    expect(lost.items).toHaveLength(0);
    const given = reduce([
      ev({ kind: 'item.change', id: 'i1', who: 'cersei', item: 'ring', op: 'gain' }),
      ev({ kind: 'item.change', id: 'i2', who: 'cersei', item: 'ring', op: 'give', to: 'jaime' }),
    ]);
    expect(given.items).toHaveLength(1);
    expect(given.items[0]!.who).toBe('jaime');
  });

  it('scene items attach to world with scene:true', () => {
    const s = reduce([ev({ kind: 'item.change', id: 'i1', who: 'world', item: 'an open ledger', op: 'scene' })]);
    expect(s.items[0]!.who).toBe('world');
    expect(s.items[0]!.scene).toBe(true);
    expect(s.cast.world).toBeUndefined(); // never mints a World cast card
  });

  it('item.drop removes; cast.drop cascades a holder\u2019s items', () => {
    const dropped = reduce([ev({ kind: 'item.change', id: 'i1', who: 'cersei', item: 'ring', op: 'gain' }), ev({ kind: 'item.drop', id: 'i1' })]);
    expect(dropped.items).toHaveLength(0);
    const casc = reduce([ev({ kind: 'item.change', id: 'i1', who: 'cersei', item: 'ring', op: 'gain' }), ev({ kind: 'cast.drop', id: 'cersei' })]);
    expect(casc.items).toHaveLength(0);
  });

  it('mergeCastDuplicates remaps the holder onto the merged id; world untouched', () => {
    let s = reduce([
      ev({ kind: 'cast.seen', id: 'cersei_lannister', name: 'Cersei Lannister', status: 'active' }),
      ev({ kind: 'item.change', id: 'i1', who: 'cersei', item: 'ring', op: 'gain' }),
      ev({ kind: 'item.change', id: 'i2', who: 'world', item: 'a torch', op: 'scene' }),
    ]);
    s = mergeCastDuplicates(s);
    expect(s.items.find((x) => x.item === 'ring')!.who).toBe('cersei_lannister');
    expect(s.items.find((x) => x.item === 'a torch')!.who).toBe('world');
  });
});

describe('possession tracker — core-feature ext.inventory', () => {
  it('emits item.change through the name gate; world\u2192scene; mash/pronoun owner dropped', () => {
    const state = freshState();
    state.cast.cersei = { id: 'cersei', name: 'Cersei', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false } as any;
    state.cast.jaime = { id: 'jaime', name: 'Jaime', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false } as any;
    const out = coreFeature.extract!({ ext: { inventory: [
      { who: 'Cersei', item: 'the letter', op: 'gain' },
      { who: 'world', item: 'a candle', op: 'scene' },
      { who: 'Cersei Jaime', item: 'junk', op: 'gain' }, // mash → dropped
      { who: 'she', item: 'junk2', op: 'gain' },          // pronoun → dropped
    ] } } as any, ctx(state));
    const items = out.filter((e) => e.kind === 'item.change') as any[];
    expect(items).toHaveLength(2);
    expect(items.find((x) => x.item === 'a candle').who).toBe('world');
    expect(items.find((x) => x.item === 'the letter').who).toBe('cersei');
  });
});

describe('{{user}} is always present (presence != authoring)', () => {
  it('auto-includes the persona in present with NO inner fields when omitted', () => {
    const out = coreFeature.extract!({ scene: { loc: 'the solar' }, present: [{ id: 'Cersei', mood: 'guarded', thought: 'hm' }] } as any, ctx(freshState(), 'anne'));
    const scene = out.find((e) => e.kind === 'scene.set') as any;
    expect(scene.present[0]).toBe('anne'); // player leads
    const userDetail = scene.detail.find((d: any) => d.id === 'anne');
    expect(userDetail).toEqual({ id: 'anne' }); // presence only, no mood/thought
  });

  it('strips authored interiority if the model put it on the {{user}} entry', () => {
    const out = coreFeature.extract!({ scene: { loc: 'x' }, present: [{ id: 'Anne', mood: 'happy', thought: 'mine', doing: 'smiling' }] } as any, ctx(freshState(), 'anne'));
    const scene = out.find((e) => e.kind === 'scene.set') as any;
    const ud = scene.detail.find((d: any) => d.id === 'anne');
    expect(ud).toEqual({ id: 'anne' }); // no mood/thought/doing for the player
  });

  it('does not duplicate the player when already listed', () => {
    const out = coreFeature.extract!({ scene: { loc: 'x' }, present: [{ id: 'Anne' }, { id: 'Cersei' }] } as any, ctx(freshState(), 'anne'));
    const scene = out.find((e) => e.kind === 'scene.set') as any;
    expect(scene.present.filter((p: string) => p === 'anne')).toHaveLength(1);
  });
});

describe('migration v8 \u2192 v9', () => {
  it('advances version; reduce yields empty items', () => {
    const log = migrate({ version: 8, chatId: 'c', events: [], createdAt: 1, updatedAt: 1 }) as any;
    expect(log.version).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(9);
    expect(reduce([]).items).toEqual([]);
  });
});

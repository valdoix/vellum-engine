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
const ctx = (state = freshState()): ExtractCtx => ({ turn: 5, day: 1, state, seq: sf });

function ev<T extends Partial<VellumEvent>>(e: T): VellumEvent { return { seq: sf(), turn: 5, day: 1, src: 'model', ...(e as object) } as VellumEvent; }

describe('Palimpsest scars — reduce', () => {
  it('scar.form creates a scar and auto-registers the holder as cast', () => {
    const s = reduce([ev({ kind: 'scar.form', id: 'scar_1', who: 'cersei', was: 'believed Jaime was loyal' })]);
    expect(s.scars).toHaveLength(1);
    expect(s.scars[0]!.who).toBe('cersei');
    expect(s.cast.cersei).toBeDefined(); // ensureCast ran
  });

  it('dedups a near-duplicate belief for the same holder', () => {
    const s = reduce([
      ev({ kind: 'scar.form', id: 'a', who: 'cersei', was: 'believed Jaime betrayed her' }),
      ev({ kind: 'scar.form', id: 'b', who: 'cersei', was: 'believed Jaime betrayed her and lied' }),
    ]);
    expect(s.scars).toHaveLength(1);
  });

  it('scar.drop removes it; cast.drop cascades scars away', () => {
    const dropped = reduce([
      ev({ kind: 'scar.form', id: 'a', who: 'cersei', was: 'x' }),
      ev({ kind: 'scar.drop', id: 'a' }),
    ]);
    expect(dropped.scars).toHaveLength(0);
    const cascaded = reduce([
      ev({ kind: 'scar.form', id: 'b', who: 'cersei', was: 'y' }),
      ev({ kind: 'cast.drop', id: 'cersei' }),
    ]);
    expect(cascaded.scars).toHaveLength(0);
  });

  it('mergeCastDuplicates remaps a scar holder onto the merged id', () => {
    let s = reduce([
      ev({ kind: 'cast.seen', id: 'cersei_lannister', name: 'Cersei Lannister', status: 'active' }),
      ev({ kind: 'scar.form', id: 'a', who: 'cersei', was: 'x' }), // short form
    ]);
    s = mergeCastDuplicates(s);
    expect(s.scars[0]!.who).toBe('cersei_lannister');
  });
});

describe('Codex lore — reduce + core-feature reroute', () => {
  it('lore.note records canon and dedups near-duplicates', () => {
    const s = reduce([
      ev({ kind: 'lore.note', id: 'l1', fact: 'The Salt Guild brands initiates on the wrist' }),
      ev({ kind: 'lore.note', id: 'l2', fact: 'The Salt Guild brands its initiates on the wrist with iron' }),
    ]);
    expect(s.lore).toHaveLength(1);
  });

  it('a knowledge entry with who:"world" is rerouted to a lore note (no World cast card)', () => {
    const out = coreFeature.extract!({ delta: { knowledge: [{ who: 'world', fact: 'the Salt Guild brands initiates' }] } } as any, ctx());
    const lore = out.filter((e) => e.kind === 'lore.note');
    const know = out.filter((e) => e.kind === 'knowledge.learn');
    expect(lore).toHaveLength(1);
    expect(know).toHaveLength(0);
    const s = reduce(out);
    expect(s.cast.world).toBeUndefined(); // no pseudo-cast card
    expect(s.lore).toHaveLength(1);
  });

  it('ext.codex entries become lore notes', () => {
    const out = coreFeature.extract!({ ext: { codex: [{ fact: 'wrist-brand rite' }, 'salt tithe paid at dusk'] } } as any, ctx());
    expect(out.filter((e) => e.kind === 'lore.note')).toHaveLength(2);
  });

  it('a real character knowledge entry is still normal knowledge', () => {
    const out = coreFeature.extract!({ delta: { knowledge: [{ who: 'Cersei', fact: 'the letter was forged', reliability: 'knows' }] } } as any, ctx());
    expect(out.filter((e) => e.kind === 'knowledge.learn')).toHaveLength(1);
    expect(out.filter((e) => e.kind === 'lore.note')).toHaveLength(0);
  });
});

describe('ext.scars — core-feature extract (inherits the misattribution gate)', () => {
  it('emits scar.form with resolved id', () => {
    const state = freshState();
    state.cast.cersei_lannister = { id: 'cersei_lannister', name: 'Cersei Lannister', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false } as any;
    const out = coreFeature.extract!({ ext: { scars: [{ who: 'Cersei', was: 'believed Jaime was loyal' }] } } as any, ctx(state));
    const sc = out.find((e) => e.kind === 'scar.form') as any;
    expect(sc?.who).toBe('cersei_lannister'); // merged onto the full id
  });

  it('drops a scar whose holder is a pronoun/generic', () => {
    const out = coreFeature.extract!({ ext: { scars: [{ who: 'she', was: 'x' }, { who: 'a guard', was: 'y' }] } } as any, ctx());
    expect(out.filter((e) => e.kind === 'scar.form')).toHaveLength(0);
  });
});

describe('migration v7 → v8', () => {
  it('advances version and leaves events intact; reduce yields empty scars/lore', () => {
    const log = migrate({ version: 7, chatId: 'c', events: [], createdAt: 1, updatedAt: 1 }) as any;
    expect(log.version).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(8); // scars/lore landed in v8
    const s = reduce([]);
    expect(s.scars).toEqual([]);
    expect(s.lore).toEqual([]);
  });
});

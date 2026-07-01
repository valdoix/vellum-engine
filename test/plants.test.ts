import { describe, it, expect } from 'vitest';
import { reduce } from '../src/core/reduce.js';
import { coreFeature } from '../src/domain/core-feature.js';
import { freshState } from '../src/domain/types.js';
import { migrate } from '../src/core/migrate.js';
import { SCHEMA_VERSION } from '../src/core/events.js';
import { openPlants, plantsInjection } from '../src/domain/plants.js';
import type { ExtractCtx } from '../src/bus/registry.js';
import type { VellumEvent } from '../src/core/events.js';

let seq = 0;
const sf = () => ++seq;
const ev = (e: Partial<VellumEvent>): VellumEvent => ({ seq: sf(), turn: 5, day: 1, src: 'model', ...(e as object) } as VellumEvent);

describe('foreshadow plants — reduce', () => {
  it('plant.set adds a planted item; dedups same text', () => {
    const s = reduce([
      ev({ kind: 'plant.set', id: 'p1', what: 'a locked drawer' }),
      ev({ kind: 'plant.set', id: 'p2', what: 'A Locked Drawer' }),
    ]);
    expect(s.plants).toHaveLength(1);
    expect(s.plants[0]!.status).toBe('planted');
  });

  it('plant.pay by matching text marks it paid', () => {
    const s = reduce([
      ev({ kind: 'plant.set', id: 'p1', what: 'a locked drawer', turn: 3 }),
      ev({ kind: 'plant.pay', id: 'x', what: 'a locked drawer', turn: 9 } as any),
    ]);
    expect(s.plants[0]!.status).toBe('paid');
    expect(s.plants[0]!.paidTurn).toBe(9);
  });

  it('plant.pay by id + plant.drop', () => {
    const paid = reduce([ev({ kind: 'plant.set', id: 'p1', what: 'x' }), ev({ kind: 'plant.pay', id: 'p1', turn: 6 })]);
    expect(paid.plants[0]!.status).toBe('paid');
    const dropped = reduce([ev({ kind: 'plant.set', id: 'p1', what: 'x' }), ev({ kind: 'plant.drop', id: 'p1' })]);
    expect(dropped.plants).toHaveLength(0);
  });
});

describe('plants — core-feature ext.plant / ext.payoff', () => {
  it('emits plant.set from ext.plant and plant.pay from ext.payoff', () => {
    const ctx: ExtractCtx = { turn: 5, day: 1, state: freshState(), seq: sf } as any;
    const out = coreFeature.extract!({ ext: { plant: ['a locked drawer', { what: 'a stranger\u2019s ring' }], payoff: [{ what: 'the old debt' }] } } as any, ctx);
    expect(out.filter((e) => e.kind === 'plant.set')).toHaveLength(2);
    expect(out.filter((e) => e.kind === 'plant.pay')).toHaveLength(1);
  });
});

describe('plants — injection + views', () => {
  it('openPlants returns only planted, oldest first; injection nudges overdue', () => {
    const s = freshState(); s.turns = 40;
    s.plants.push({ id: 'a', what: 'old plant', status: 'planted', plantedTurn: 2 });
    s.plants.push({ id: 'b', what: 'paid plant', status: 'paid', plantedTurn: 5, paidTurn: 10 });
    s.plants.push({ id: 'c', what: 'newer plant', status: 'planted', plantedTurn: 30 });
    expect(openPlants(s).map((p) => p.id)).toEqual(['a', 'c']);
    const inj = plantsInjection(s, 40);
    expect(inj).toContain('UNRESOLVED THREADS');
    expect(inj).toContain('old plant');
    expect(inj).toContain('wants to pay off'); // overdue nudge on the 38-turn-old plant
    expect(inj).not.toContain('paid plant');
  });

  it('empty when nothing planted', () => {
    expect(plantsInjection(freshState(), 5)).toBe('');
  });
});

describe('migration v11 → v12', () => {
  it('advances version; reduce yields empty plants', () => {
    const log = migrate({ version: 11, chatId: 'c', events: [], createdAt: 1, updatedAt: 1 }) as any;
    expect(log.version).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(12);
    expect(reduce([]).plants).toEqual([]);
  });
});

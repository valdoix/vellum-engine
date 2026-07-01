import { describe, it, expect } from 'vitest';
import { lockKey, findLock, applyLockToBond, sanitizeLocks, lockInjection, type RelationLock } from '../src/domain/relation-lock.js';
import { foldTurn } from '../src/bus/lifecycle.js';
import { registerFeature } from '../src/bus/registry.js';
import { coreFeature } from '../src/domain/core-feature.js';
import { freshState } from '../src/domain/types.js';

registerFeature(coreFeature); // idempotent

describe('relation-lock — pure helpers', () => {
  it('lockKey is order-independent', () => {
    expect(lockKey('cersei', 'jaime')).toBe(lockKey('jaime', 'cersei'));
  });

  it('findLock matches a pair in either direction', () => {
    const locks: RelationLock[] = [{ key: lockKey('cersei', 'jaime'), a: 'cersei', b: 'jaime', forbid: ['romantic'], pin: [] }];
    expect(findLock(locks, 'jaime', 'cersei')?.forbid).toEqual(['romantic']);
    expect(findLock(locks, 'cersei', 'tyrion')).toBeUndefined();
  });

  it('applyLockToBond strips forbidden addCats and protects pinned removeCats', () => {
    const lock: RelationLock = { key: 'k', a: 'a', b: 'b', forbid: ['romantic'], pin: ['familial'] };
    const out = applyLockToBond({ addCats: ['romantic', 'social'], removeCats: ['familial'] }, lock);
    expect(out.addCats).toEqual(['social']); // romantic stripped
    expect(out.removeCats).toBeUndefined();  // familial pin-protected → removeCats emptied
  });

  it('no lock → returns the input unchanged (identity)', () => {
    const bond = { addCats: ['romantic' as const] };
    expect(applyLockToBond(bond, undefined)).toBe(bond);
  });

  it('sanitizeLocks drops empty/invalid and normalizes the key', () => {
    const out = sanitizeLocks([
      { a: 'cersei', b: 'jaime', forbid: ['romantic', 'bogus'] },
      { a: 'x', b: 'x', forbid: ['romantic'] }, // self-pair → dropped
      { a: 'p', b: 'q', forbid: [], pin: [] },  // empty → dropped
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.forbid).toEqual(['romantic']); // 'bogus' filtered
    expect(out[0]!.key).toBe(lockKey('cersei', 'jaime'));
  });
});

describe('relation-lock — fold enforcement', () => {
  const block = (bonds: string) => `<vellum>{"bonds":${bonds}}</vellum>`;

  it('forbidden romantic category is stripped at the fold (both directions)', () => {
    const locks = sanitizeLocks([{ a: 'cersei', b: 'jaime', forbid: ['romantic'] }]);
    // model tries to make them romantic, emitting Jaime→Cersei (reverse of the lock)
    const r = foldTurn(block('[{"a":"Jaime","b":"Cersei","aff":30,"cat":["romantic"]}]'), freshState(), 1, { locks });
    const bond = r.events.find((e: any) => e.kind === 'bond.delta') as any;
    expect(bond).toBeTruthy();
    expect(bond.addCats ?? []).not.toContain('romantic'); // stripped
    expect(bond.aff).toBe(30); // affection still recorded (category-only lock)
  });

  it('no lock → romantic category survives (unchanged behavior)', () => {
    const r = foldTurn(block('[{"a":"Jaime","b":"Cersei","aff":30,"cat":["romantic"]}]'), freshState(), 1, {});
    const bond = r.events.find((e: any) => e.kind === 'bond.delta') as any;
    expect(bond.addCats).toContain('romantic');
  });

  it('a bond whose only content was the forbidden cat is dropped entirely', () => {
    const locks = sanitizeLocks([{ a: 'cersei', b: 'jaime', forbid: ['romantic'] }]);
    const r = foldTurn(block('[{"a":"Cersei","b":"Jaime","cat":["romantic"]}]'), freshState(), 1, { locks });
    const bond = r.events.find((e: any) => e.kind === 'bond.delta');
    expect(bond).toBeUndefined(); // nothing left to record
  });
});

describe('lockInjection (prevention half)', () => {
  const nm = (id: string): string => (({ jaime: 'Jaime', cersei: 'Cersei', tywin: 'Tywin' }) as Record<string, string>)[id] ?? id;
  const L = (a: string, b: string, forbid: string[], pin: string[]): RelationLock => ({ key: lockKey(a, b), a, b, forbid: forbid as never, pin: pin as never });

  it('empty when no locks, no present, or no on-scene pair', () => {
    expect(lockInjection([], ['jaime', 'cersei'], nm)).toBe('');
    expect(lockInjection([L('jaime', 'cersei', ['romantic'], [])], [], nm)).toBe('');
    expect(lockInjection([L('jaime', 'cersei', ['romantic'], [])], ['jaime'], nm)).toBe(''); // only one endpoint present
  });

  it('forbid renders as a positive nature-statement (no raw NEVER)', () => {
    const out = lockInjection([L('jaime', 'cersei', ['romantic'], [])], ['jaime', 'cersei'], nm);
    expect(out).toContain('GUARDRAILS');
    expect(out).toContain('Jaime and Cersei');
    expect(out.toLowerCase()).toContain('platonic');
    expect(out).not.toContain('NEVER');
  });

  it('pin renders as a positive keep-them clause', () => {
    const out = lockInjection([L('jaime', 'tywin', [], ['familial'])], ['jaime', 'tywin'], nm);
    expect(out.toLowerCase()).toContain('keep them family');
  });

  it('present-gates: only pairs with BOTH endpoints on-scene', () => {
    const locks = [L('jaime', 'cersei', ['romantic'], []), L('jaime', 'tywin', ['alliance'], [])];
    const out = lockInjection(locks, ['jaime', 'cersei'], nm); // tywin absent
    expect(out).toContain('Cersei');
    expect(out).not.toContain('Tywin');
  });
});

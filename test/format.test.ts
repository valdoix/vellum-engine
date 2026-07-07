import { describe, it, expect } from 'vitest';
import { bondVerdict, isAsymmetric } from '../src/ui/format.js';

/**
 * Bond-summary helpers. bondVerdict maps a pair's category + sentiment + score
 * sign to a stable verdict word; isAsymmetric flags when a pair's two directions
 * disagree enough to headline (the relations refactor's dumbbell/badge). Pure,
 * DOM-free.
 */

describe('bondVerdict', () => {
  it("returns 'unknown' for no directions", () => {
    expect(bondVerdict([])).toBe('unknown');
  });

  it('maps representative combos to stable verdict words', () => {
    expect(bondVerdict([{ affection: 80, trust: 70, category: 'romantic' }])).toBe('devotion');
    expect(bondVerdict([{ affection: 60, trust: 0, category: 'romantic' }])).toBe('infatuation');
    expect(bondVerdict([{ affection: -60, trust: -50, category: 'romantic' }])).toBe('bitter ex');
    expect(bondVerdict([{ affection: 70, trust: 60, category: 'alliance' }])).toBe('firm alliance');
    expect(bondVerdict([{ affection: 0, trust: -50, category: 'alliance' }])).toBe('wary alliance');
    expect(bondVerdict([{ affection: -60, trust: -60, category: 'rivalry' }])).toBe('enmity');
    expect(bondVerdict([{ affection: 70, trust: 60, category: 'social' }])).toBe('close bond');
  });

  it('prefers a non-neutral category and reads sentiment for hostility', () => {
    expect(bondVerdict([{ affection: 0, trust: 0, category: 'neutral', categories: ['neutral', 'familial'], sentiment: 'hostile' }])).toBe('estranged kin');
  });

  it('averages both directions', () => {
    // one warm, one cold -> nets near zero -> not a warm verdict
    const v = bondVerdict([
      { affection: 80, trust: 80, category: 'social' },
      { affection: -80, trust: -80, category: 'social' },
    ]);
    expect(v).toBe('acquaintance');
  });
});

describe('isAsymmetric', () => {
  it('is false for a one-sided pair (nothing to compare)', () => {
    expect(isAsymmetric([{ a: 'x', b: 'y', affection: 80, trust: 80 }])).toBe(false);
  });

  it('is false when both directions roughly agree', () => {
    expect(isAsymmetric([
      { a: 'x', b: 'y', affection: 60, trust: 40 },
      { a: 'y', b: 'x', affection: 55, trust: 50 },
    ])).toBe(false);
  });

  it('flags an opposite-sign axis (she wary, he trusting)', () => {
    expect(isAsymmetric([
      { a: 'x', b: 'y', affection: 50, trust: -40 },
      { a: 'y', b: 'x', affection: 60, trust: 50 },
    ])).toBe(true);
  });

  it('flags a wide same-sign gap on either axis', () => {
    expect(isAsymmetric([
      { a: 'x', b: 'y', affection: 10, trust: 20 },
      { a: 'y', b: 'x', affection: 80, trust: 25 },
    ])).toBe(true);
  });
});

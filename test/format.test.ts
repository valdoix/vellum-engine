import { describe, it, expect } from 'vitest';
import { bondVerdict, bondMeter } from '../src/ui/format.js';

/**
 * Bond-summary helpers (Bonds digestibility, Part 4). bondVerdict maps a pair's
 * category + sentiment + score sign to a stable verdict word; bondMeter still
 * returns both axes / both directions and '' for empty. Pure, DOM-free.
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

describe('bondMeter', () => {
  const nameFor = (id: string): string => id;

  it("returns '' for no directions", () => {
    expect(bondMeter([], nameFor)).toBe('');
  });

  it('renders both axes and a continuous center-zero rule', () => {
    const out = bondMeter([{ a: 'x', b: 'y', affection: 40, trust: -20 }], nameFor);
    expect(out).toContain('affection');
    expect(out).toContain('trust');
    expect(out).toContain('vle-bm-zero');
  });

  it('renders one row per direction per axis', () => {
    const out = bondMeter([
      { a: 'x', b: 'y', affection: 40, trust: 10 },
      { a: 'y', b: 'x', affection: -10, trust: 30 },
    ], nameFor);
    // 2 directions x 2 axes = 4 rows
    expect((out.match(/vle-bm-row/g) || []).length).toBe(4);
  });
});

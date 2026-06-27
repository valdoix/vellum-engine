import { describe, it, expect } from 'vitest';
import { adjustBond, parseTone, DEFAULT_TONE, type Tone } from '../src/domain/tone.js';
import { coreFeature } from '../src/domain/core-feature.js';
import { reduce } from '../src/core/reduce.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';

const facts = (o: Partial<{ userId: string; relExists: boolean; romantic: boolean }> = {}) =>
  ({ userId: o.userId ?? '', relExists: o.relExists ?? false, romantic: o.romantic ?? false });

describe('parseTone', () => {
  it('defaults to medium/fair and rejects junk', () => {
    expect(parseTone(null, null)).toEqual(DEFAULT_TONE);
    expect(parseTone('bogus', 'nope')).toEqual(DEFAULT_TONE);
    expect(parseTone('slow_burn', 'brutal')).toEqual({ romance: 'slow_burn', disposition: 'brutal' });
  });
});

describe('adjustBond — romance pace', () => {
  const T = (romance: Tone['romance']): Tone => ({ romance, disposition: 'fair' });

  it('slow burn clamps a romantic aff delta to ±4', () => {
    const r = adjustBond({ a: 'x', b: 'y', aff: 30, addCats: ['romantic'] }, T('slow_burn'), facts({ romantic: true }));
    expect(r!.aff).toBe(4);
    const neg = adjustBond({ a: 'x', b: 'y', aff: -30, addCats: ['romantic'] }, T('slow_burn'), facts({ romantic: true }));
    expect(neg!.aff).toBe(-4);
  });

  it('does NOT clamp a non-romantic bond', () => {
    const r = adjustBond({ a: 'x', b: 'y', aff: 30 }, T('slow_burn'), facts({ romantic: false }));
    expect(r!.aff).toBe(30);
  });

  it('fast allows large romantic deltas', () => {
    const r = adjustBond({ a: 'x', b: 'y', aff: 30, addCats: ['romantic'] }, T('fast'), facts({ romantic: true }));
    expect(r!.aff).toBe(25); // clamp 25
  });

  it('off strips the romantic category; drops the bond if nothing else remains', () => {
    expect(adjustBond({ a: 'x', b: 'y', addCats: ['romantic'] }, T('off'), facts({ romantic: true }))).toBeNull();
    const kept = adjustBond({ a: 'x', b: 'y', aff: 5, addCats: ['romantic', 'rivalry'] }, T('off'), facts({ romantic: true }));
    expect(kept!.addCats).toEqual(['rivalry']);
    expect(kept!.aff).toBe(5);
  });
});

describe('adjustBond — disposition seed (first impression)', () => {
  const T = (disposition: Tone['disposition']): Tone => ({ romance: 'medium', disposition });

  it('brutal seeds -25 onto a NEW user bond', () => {
    const r = adjustBond({ a: 'anne', b: 'ned', aff: 5 }, T('brutal'), facts({ userId: 'anne', relExists: false }));
    expect(r!.aff).toBe(-20); // 5 + (-25)
  });

  it('kind seeds +15; only on creation, only when the user is involved', () => {
    expect(adjustBond({ a: 'anne', b: 'ned', aff: 0 }, T('kind'), facts({ userId: 'anne', relExists: false }))!.aff).toBe(15);
    // existing bond → no seed
    expect(adjustBond({ a: 'anne', b: 'ned', aff: 3 }, T('kind'), facts({ userId: 'anne', relExists: true }))!.aff).toBe(3);
    // user not involved → no seed
    expect(adjustBond({ a: 'ned', b: 'jon', aff: 3 }, T('kind'), facts({ userId: 'anne', relExists: false }))!.aff).toBe(3);
  });

  it('fair (default) seeds nothing', () => {
    expect(adjustBond({ a: 'anne', b: 'ned', aff: 5 }, T('fair'), facts({ userId: 'anne', relExists: false }))!.aff).toBe(5);
  });
});

describe('fold integration — tone steers the graph', () => {
  let seq = 0;
  const ctx = (state: ChronicleState, tone: Tone, userCanon: string) =>
    ({ turn: 1, day: 1, state, seq: () => ++seq, tone, userCanon });

  it('brutal world: a new user↔cast bond opens negative', () => {
    const s = reduce(coreFeature.extract!({
      present: [{ name: 'Anne' }, { name: 'Ned' }],
      delta: { bonds: [{ a: 'Anne', b: 'Ned', aff: 4 }] },
    } as any, ctx(freshState(), { romance: 'medium', disposition: 'brutal' }, 'anne')));
    expect(s.relations[0]!.affection).toBe(-21); // 4 - 25
  });

  it('romance off: no romantic edge sprouts', () => {
    const s = reduce(coreFeature.extract!({
      present: [{ name: 'Anne' }, { name: 'Ned' }],
      delta: { bonds: [{ a: 'Anne', b: 'Ned', cat: ['romantic'] }] },
    } as any, ctx(freshState(), { romance: 'off', disposition: 'fair' }, 'anne')));
    expect(s.relations).toHaveLength(0);
  });

  it('absolute bond bypasses the seed/clamp (a direct set is not a delta)', () => {
    // slow_burn would clamp a delta to ±4 and brutal would seed -25; an absolute
    // set must be honored as-is. abs aff 50 on a new romantic user bond stays 50.
    const s = reduce(coreFeature.extract!({
      present: [{ name: 'Anne' }, { name: 'Ned' }],
      delta: { bonds: [{ a: 'Anne', b: 'Ned', aff: 50, absolute: true, cat: ['romantic'] }] },
    } as any, ctx(freshState(), { romance: 'slow_burn', disposition: 'brutal' }, 'anne')));
    expect(s.relations[0]!.affection).toBe(50);
  });
});

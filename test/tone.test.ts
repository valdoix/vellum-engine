import { describe, it, expect } from 'vitest';
import { adjustBond, parseTone, DEFAULT_TONE, type Tone } from '../src/domain/tone.js';
import { coreFeature } from '../src/domain/core-feature.js';
import { reduce } from '../src/core/reduce.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';
import { SCHEMA_VERSION, VellumEvent as VellumEventSchema, type VellumEvent } from '../src/core/events.js';
import { nextSeq } from '../src/core/ids.js';

const facts = (o: Partial<{ userId: string; relExists: boolean; romantic: boolean }> = {}) =>
  ({ userId: o.userId ?? '', relExists: o.relExists ?? false, romantic: o.romantic ?? false });

describe('parseTone', () => {
  it('defaults to medium/fair and rejects junk', () => {
    expect(parseTone(null, null)).toEqual(DEFAULT_TONE);
    expect(parseTone('bogus', 'nope')).toEqual(DEFAULT_TONE);
    expect(parseTone('slow_burn', 'brutal')).toEqual({ romance: 'slow_burn', disposition: 'brutal', social: 'living', politics: 'off' });
    expect(parseTone('medium', 'fair', 'autonomous').social).toBe('autonomous');
    expect(parseTone('medium', 'fair', 'bogus').social).toBe('living'); // junk → default
  });
});

describe('adjustBond — romance pace', () => {
  const T = (romance: Tone['romance']): Tone => ({ romance, disposition: 'fair', social: 'living', politics: 'off' });

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
  const T = (disposition: Tone['disposition']): Tone => ({ romance: 'medium', disposition, social: 'living', politics: 'off' });

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

describe('tone.set event — durable tone in the log (reduce)', () => {
  const ev = (o: Partial<VellumEvent> & { kind: string }): VellumEvent =>
    ({ seq: nextSeq(), turn: 0, day: 0, src: 'user', ...o } as VellumEvent);

  it('state.tone defaults to DEFAULT_TONE with no tone.set', () => {
    expect(freshState().tone).toEqual(DEFAULT_TONE);
    expect(reduce([], freshState()).tone).toEqual(DEFAULT_TONE);
  });

  it('a tone.set event drives state.tone through reduce()', () => {
    const s = reduce([
      ev({ kind: 'tone.set', romance: 'slow_burn', disposition: 'brutal', social: 'autonomous', politics: 'living' } as any),
    ], freshState());
    expect(s.tone).toEqual({ romance: 'slow_burn', disposition: 'brutal', social: 'autonomous', politics: 'living' });
  });

  it('later tone.set overrides earlier per dial (last write wins)', () => {
    const s = reduce([
      ev({ kind: 'tone.set', romance: 'fast', disposition: 'kind', social: 'off', politics: 'off' } as any),
      ev({ kind: 'tone.set', romance: 'off' } as any), // partial: only romance changes
    ], freshState());
    expect(s.tone).toEqual({ romance: 'off', disposition: 'kind', social: 'off', politics: 'off' });
  });

  it('the tone.set schema round-trips (survives a log reload)', () => {
    const parsed = VellumEventSchema.safeParse(
      ev({ kind: 'tone.set', romance: 'erotic', disposition: 'harsh', social: 'reactive', politics: 'autonomous' } as any),
    );
    expect(parsed.success).toBe(true);
    // schema is at/above the tone-in-log version
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(15);
  });

  it('an invalid dial value is rejected by the schema (never reaches reduce)', () => {
    const bad = VellumEventSchema.safeParse(ev({ kind: 'tone.set', romance: 'bogus' } as any));
    expect(bad.success).toBe(false);
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
    } as any, ctx(freshState(), { romance: 'medium', disposition: 'brutal', social: 'living', politics: 'off' }, 'anne')));
    expect(s.relations[0]!.affection).toBe(-21); // 4 - 25
  });

  it('romance off: no romantic edge sprouts', () => {
    const s = reduce(coreFeature.extract!({
      present: [{ name: 'Anne' }, { name: 'Ned' }],
      delta: { bonds: [{ a: 'Anne', b: 'Ned', cat: ['romantic'] }] },
    } as any, ctx(freshState(), { romance: 'off', disposition: 'fair', social: 'living', politics: 'off' }, 'anne')));
    expect(s.relations).toHaveLength(0);
  });

  it('absolute bond bypasses the seed/clamp (a direct set is not a delta)', () => {
    // slow_burn would clamp a delta to ±4 and brutal would seed -25; an absolute
    // set must be honored as-is. abs aff 50 on a new romantic user bond stays 50.
    const s = reduce(coreFeature.extract!({
      present: [{ name: 'Anne' }, { name: 'Ned' }],
      delta: { bonds: [{ a: 'Anne', b: 'Ned', aff: 50, absolute: true, cat: ['romantic'] }] },
    } as any, ctx(freshState(), { romance: 'slow_burn', disposition: 'brutal', social: 'living', politics: 'off' }, 'anne')));
    expect(s.relations[0]!.affection).toBe(50);
  });
});

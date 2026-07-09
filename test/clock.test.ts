import { describe, it, expect } from 'vitest';
import {
  parseClock, clockLabel, detectBackwardClock, hasDayAdvanceCue, rollover,
  reconcileDay, CLOCK_SLOTS, DAY_JUMP_LIMIT,
} from '../src/domain/clock.js';

describe('parseClock', () => {
  it('reads coarse slot keywords', () => {
    expect(parseClock('dusk')).toBe(CLOCK_SLOTS['dusk']);
    expect(parseClock('late night')).toBe(CLOCK_SLOTS['late-night']);
    expect(parseClock('early morning light')).toBe(CLOCK_SLOTS['morning']);
    expect(parseClock('midnight')).toBe(0);
  });
  it('reads explicit clock times with meridiem', () => {
    expect(parseClock('9:47 PM')).toBe(21 * 60 + 47);
    expect(parseClock('12:00 AM')).toBe(0);
    expect(parseClock('12:30 PM')).toBe(12 * 60 + 30);
    expect(parseClock('21:47')).toBe(21 * 60 + 47);
  });
  it('does not trust a bare ambiguous hour with no minute or meridiem', () => {
    // "5" alone is ambiguous — falls through (no slot match here) to undefined
    expect(parseClock('5')).toBeUndefined();
  });
  it('returns undefined for empty/unknowable', () => {
    expect(parseClock('')).toBeUndefined();
    expect(parseClock(undefined)).toBeUndefined();
    expect(parseClock('a while later')).toBeUndefined();
  });
});

describe('clockLabel', () => {
  it('inverts minutes to the nearest coarse slot', () => {
    expect(clockLabel(1140)).toBe('dusk');
    expect(clockLabel(720)).toBe('midday');
    expect(clockLabel(300)).toBe('dawn');
    expect(clockLabel(undefined)).toBe('');
  });
});

describe('detectBackwardClock', () => {
  it('flags a same-day earlier time beyond tolerance', () => {
    expect(detectBackwardClock(5, 1140, 5, 540)).toBe(true); // dusk -> morning same day
  });
  it('does not flag a new day (clock legitimately resets)', () => {
    expect(detectBackwardClock(5, 1140, 6, 300)).toBe(false);
  });
  it('does not flag small jitter within tolerance', () => {
    expect(detectBackwardClock(5, 600, 5, 585)).toBe(false);
  });
  it('does not flag when a clock is unknown', () => {
    expect(detectBackwardClock(5, undefined, 5, 300)).toBe(false);
  });
});

describe('hasDayAdvanceCue / rollover', () => {
  it('detects day-advance prose cues', () => {
    expect(hasDayAdvanceCue('The next morning she woke.')).toBe(true);
    expect(hasDayAdvanceCue('Three weeks later the raven came.')).toBe(true);
    expect(hasDayAdvanceCue('He drew his sword.')).toBe(false);
  });
  it('suggests a rollover only when the clock wrapped with a prose cue', () => {
    expect(rollover(5, 1320, 300, true)).toBe(6);   // night -> dawn, "next morning"
    expect(rollover(5, 1320, 300, false)).toBeUndefined();
    expect(rollover(5, 300, 1320, true)).toBeUndefined(); // forward, no wrap
  });
});

describe('reconcileDay', () => {
  it('keeps prior when the report is absent (no forced 1)', () => {
    expect(reconcileDay(undefined, 7, false)).toEqual({ day: 7 });
  });
  it('defaults to 1 from a zero prior with no report', () => {
    expect(reconcileDay(undefined, 0, false).day).toBe(1);
  });
  it('keeps prior and flags a backward report', () => {
    const r = reconcileDay(3, 9, false);
    expect(r.day).toBe(9);
    expect(r.flag?.code).toBe('day_backward');
  });
  it('accepts an ordinary forward step with no flag', () => {
    expect(reconcileDay(10, 9, false)).toEqual({ day: 10 });
  });
  it('flags a large unexplained jump but still accepts it', () => {
    const r = reconcileDay(9 + DAY_JUMP_LIMIT + 5, 9, false);
    expect(r.day).toBe(9 + DAY_JUMP_LIMIT + 5);
    expect(r.flag?.code).toBe('day_jump');
  });
  it('does not flag a large jump when prose signals a skip', () => {
    const r = reconcileDay(9 + DAY_JUMP_LIMIT + 5, 9, true);
    expect(r.flag).toBeUndefined();
  });
});

import { describe, it, expect } from 'vitest';
import {
  parseClock, clockLabel, clockTime, completedElapsedMinutes, elapsedClockFloor, detectBackwardClock, explicitElapsedMinutes, hasDayAdvanceCue, rollover,
  supportsDayAdvance,
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

describe('canonical clock display and elapsed floor', () => {
  it('renders the numeric clock as exact HH:MM', () => {
    expect(clockTime(19 * 60 + 38)).toBe('19:38');
    expect(clockTime(24 * 60 + 3)).toBe('00:03');
  });
  it('recognizes completed exact and common vague passage without treating plans as elapsed', () => {
    expect(completedElapsedMinutes('Ten minutes later, the door opens.')).toBe(10);
    expect(completedElapsedMinutes('A few minutes later, the door opens.')).toBe(3);
    expect(completedElapsedMinutes('After a while, the door opens.')).toBe(5);
    expect(completedElapsedMinutes('"Come back in ten minutes," she says.')).toBeUndefined();
  });
  it('repairs a frozen or under-advanced endpoint from completed duration', () => {
    expect(elapsedClockFloor(4, 19 * 60 + 38, 4, 19 * 60 + 38, 'Ten minutes later.')).toMatchObject({ day: 4, clock: 19 * 60 + 48, inferred: true });
    expect(elapsedClockFloor(4, 19 * 60 + 38, 4, 19 * 60 + 40, 'Ten minutes later.')).toMatchObject({ day: 4, clock: 19 * 60 + 48, inferred: true });
    expect(elapsedClockFloor(4, 19 * 60 + 38, 4, 20 * 60, 'Ten minutes later.')).toMatchObject({ day: 4, clock: 20 * 60, inferred: false });
  });
  it('requires quantified passage before inferring midnight', () => {
    expect(elapsedClockFloor(4, 23 * 60 + 58, 4, 23 * 60 + 58, 'A while later.').inferred).toBe(false);
    expect(elapsedClockFloor(4, 23 * 60 + 58, 4, 23 * 60 + 58, 'Five minutes pass.')).toMatchObject({ day: 5, clock: 3, inferred: true });
  });
});

describe('detectBackwardClock', () => {
  it('flags a same-day earlier time beyond tolerance', () => {
    expect(detectBackwardClock(5, 1140, 5, 540)).toBe(true); // dusk -> morning same day
  });
  it('does not flag a new day (clock legitimately resets)', () => {
    expect(detectBackwardClock(5, 1140, 6, 300)).toBe(false);
  });
  it('flags even a one-minute same-day regression', () => {
    expect(detectBackwardClock(5, 600, 5, 599)).toBe(true);
  });
  it('does not flag when a clock is unknown', () => {
    expect(detectBackwardClock(5, undefined, 5, 300)).toBe(false);
  });
});

describe('hasDayAdvanceCue / rollover', () => {
  it('detects day-advance prose cues', () => {
    expect(hasDayAdvanceCue('The next morning she woke.')).toBe(true);
    expect(hasDayAdvanceCue('Three weeks later the raven came.')).toBe(true);
    expect(hasDayAdvanceCue('Five minutes later, after midnight, the lights failed.')).toBe(true);
    expect(hasDayAdvanceCue('They worked overnight.')).toBe(true);
    expect(hasDayAdvanceCue('He drew his sword.')).toBe(false);
  });
  it('keeps calendar day-of-month labels separate from narrative-day evidence', () => {
    expect(hasDayAdvanceCue('On Tuesday, the hearing resumed.')).toBe(true);
    expect(hasDayAdvanceCue('October 15th arrived cold and bright.')).toBe(false);
    expect(hasDayAdvanceCue('Narrative Day 15 began cold and bright.')).toBe(true);
    expect(hasDayAdvanceCue('May drew her sword.')).toBe(false);
  });
  it('suggests a rollover only when the clock wrapped with a prose cue', () => {
    expect(rollover(5, 1320, 300, true)).toBe(6);   // night -> dawn, "next morning"
    expect(rollover(5, 1320, 300, false)).toBeUndefined();
    expect(rollover(5, 300, 1320, true)).toBeUndefined(); // forward, no wrap
  });
});

describe('explicit elapsed day evidence', () => {
  it('reads quantified elapsed durations and ignores vague passage', () => {
    expect(explicitElapsedMinutes('She waits five minutes.')).toBe(5);
    expect(explicitElapsedMinutes('Half an hour passes.')).toBe(30);
    expect(explicitElapsedMinutes('They sleep for 8 hours.')).toBe(480);
    expect(explicitElapsedMinutes('A while later.')).toBeUndefined();
  });
  it('requires duration long enough to reach the proposed next-day clock', () => {
    expect(supportsDayAdvance('Five minutes pass.', 1438, 3, 1)).toBe(true);
    expect(supportsDayAdvance('Five minutes pass.', 900, 3, 1)).toBe(false);
    expect(supportsDayAdvance('The next morning arrives.', 900, 540, 1)).toBe(true);
    expect(supportsDayAdvance('The next morning is October 17.', 900, 540, 15)).toBe(false);
    expect(supportsDayAdvance('Two days later, the gate opens.', 900, 540, 2)).toBe(true);
    expect(supportsDayAdvance('The clock reads 08:00.', 1320, 480, 1)).toBe(false);
    expect(supportsDayAdvance('"Come back in five minutes," she says.', 1438, 3, 1)).toBe(false);
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
  it('holds an ordinary forward step when prose does not establish a new day', () => {
    const r = reconcileDay(10, 9, false);
    expect(r.day).toBe(9);
    expect(r.flag?.code).toBe('day_creep');
  });
  it('flags and holds a large unexplained jump', () => {
    const r = reconcileDay(9 + DAY_JUMP_LIMIT + 5, 9, false);
    expect(r.day).toBe(9);
    expect(r.flag?.code).toBe('day_jump');
  });
  it('does not flag a large jump when prose signals a skip', () => {
    const r = reconcileDay(9 + DAY_JUMP_LIMIT + 5, 9, true);
    expect(r.flag).toBeUndefined();
  });

  describe('day-creep guard', () => {
    it('keeps the prior day when +1 has no rollover, no prose cue (same-day clock)', () => {
      // dusk -> night same day, but the model bumped Day 9 -> 10
      const r = reconcileDay(10, 9, false, { priorClock: 1140, newClock: 1320 });
      expect(r.day).toBe(9);
      expect(r.flag?.code).toBe('day_creep');
    });
    it('does not mistake an earlier wall clock for proof of midnight', () => {
      const r = reconcileDay(10, 9, false, { priorClock: 1320, newClock: 300 });
      expect(r.day).toBe(9);
      expect(r.flag?.code).toBe('day_creep');
    });
    it('allows +1 when a prose skip cue is present', () => {
      const r = reconcileDay(10, 9, true, { priorClock: 1140, newClock: 1320 });
      expect(r.day).toBe(10);
    });
    it('does not trust a day increment when clock evidence is absent', () => {
      expect(reconcileDay(10, 9, false).day).toBe(9);
    });
    it('holds a +2 step without prose evidence too', () => {
      const r = reconcileDay(11, 9, false, { priorClock: 1140, newClock: 1320 });
      expect(r.day).toBe(9);
    });
  });
});

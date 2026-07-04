import { describe, it, expect } from 'vitest';
import { formatDate, type DateFormat, type DateNaming } from '../src/domain/date-format.js';
import { reduce } from '../src/core/reduce.js';
import { freshState } from '../src/domain/types.js';
import { nextSeq } from '../src/core/ids.js';
import type { VellumEvent } from '../src/core/events.js';

/**
 * Date-display formats: the day counter can render as a plain count OR as a
 * derived calendar date (month/day/year and subsets), with optional fantasy
 * month/era naming. Config persists as a config.set event so it flows through
 * reduce() to every consumer.
 */

const EPOCH = new Date(2026, 0, 1); // Jan 1, 2026
const fmt = (day: number, format: DateFormat, naming?: DateNaming): string =>
  formatDate(day, format, { dateEpoch: EPOCH, ...naming });

describe('formatDate — every option', () => {
  it('day count is the default, apart from any epoch', () => {
    expect(formatDate(0, 'day')).toBe('Day 0');
    expect(formatDate(47, 'day')).toBe('Day 47');
    expect(fmt(47, 'day')).toBe('Day 47'); // epoch ignored for 'day'
  });

  it('month-day-year', () => {
    expect(fmt(0, 'month-day-year')).toBe('January 1, 2026');
    expect(fmt(4, 'month-day-year')).toBe('January 5, 2026');
    expect(fmt(31, 'month-day-year')).toBe('February 1, 2026');
  });

  it('month-day', () => {
    expect(fmt(0, 'month-day')).toBe('January 1');
    expect(fmt(59, 'month-day')).toBe('March 1'); // 2026 not a leap year: day 59 = Mar 1
  });

  it('month only', () => {
    expect(fmt(0, 'month')).toBe('January');
    expect(fmt(40, 'month')).toBe('February');
  });

  it('week number', () => {
    expect(fmt(0, 'week')).toBe('Week 1');
    expect(fmt(7, 'week')).toBe('Week 2');
  });

  it('month-year (short month)', () => {
    expect(fmt(0, 'month-year')).toBe('Jan 2026');
    expect(fmt(365, 'month-year')).toBe('Jan 2027');
  });

  it('year only', () => {
    expect(fmt(0, 'year')).toBe('Year 2026');
    expect(fmt(365, 'year')).toBe('Year 2027');
  });

  it('works without an epoch (neutral fictional calendar)', () => {
    // no epoch → still produces a stable, non-Day string for calendar formats
    expect(formatDate(0, 'year')).toMatch(/^Year \d+$/);
    expect(formatDate(40, 'month')).toMatch(/^[A-Z][a-z]+$/);
  });
});

describe('formatDate — fantasy calendar naming', () => {
  const months = ['Frostfall', 'Thawmoon', 'Seedtide', 'Bloomrise', 'Suncrest', 'Highsun', 'Harvestwane', 'Emberfall', 'Duskmoor', 'Longnight', 'Deepcold', 'Yearsend'];

  it('renames months in order', () => {
    expect(fmt(0, 'month', { monthNames: months })).toBe('Frostfall');
    expect(fmt(31, 'month', { monthNames: months })).toBe('Thawmoon'); // Feb → 2nd custom month
    expect(fmt(0, 'month-day-year', { monthNames: months })).toBe('Frostfall 1, 2026');
  });

  it('applies era prefix/suffix to the year', () => {
    expect(fmt(0, 'month-day-year', { monthNames: months, yearSuffix: ' A.R.' })).toBe('Frostfall 1, 2026 A.R.');
    expect(fmt(0, 'year', { yearPrefix: 'the ', yearSuffix: 'th year of the Reign' })).toBe('the 2026th year of the Reign');
  });

  it('year-only keeps "Year N" when no era is set', () => {
    expect(fmt(0, 'year')).toBe('Year 2026');
  });

  it('short-month falls back to the custom long names when no short list given', () => {
    expect(fmt(0, 'month-year', { monthNames: months })).toBe('Frostfall 2026');
    expect(fmt(0, 'month-year', { monthNames: months, monthNamesShort: ['Fro'] })).toBe('Fro 2026');
  });

  it('a partial month list cycles (wraps) instead of blanking', () => {
    const two = ['Light', 'Dark'];
    expect(fmt(0, 'month', { monthNames: two })).toBe('Light');   // month 0
    expect(fmt(31, 'month', { monthNames: two })).toBe('Dark');   // month 1
    expect(fmt(59, 'month', { monthNames: two })).toBe('Light');  // month 2 → wraps
  });
});

describe('config.set event drives state.dateFormat through reduce()', () => {
  const ev = (o: Partial<VellumEvent> & { kind: string }): VellumEvent =>
    ({ seq: nextSeq(), turn: 1, day: 1, src: 'user', ...o } as VellumEvent);

  it('defaults to "day"', () => {
    expect(freshState().dateFormat).toBe('day');
  });

  it('a config.set event updates the format + epoch', () => {
    const s = reduce([
      ev({ kind: 'config.set', dateFormat: 'month-day-year', dateEpoch: '2026-01-01' } as any),
    ], freshState());
    expect(s.dateFormat).toBe('month-day-year');
    expect(s.dateEpoch instanceof Date).toBe(true);
  });

  it('later config.set overrides earlier (last write wins)', () => {
    const s = reduce([
      ev({ kind: 'config.set', dateFormat: 'week' } as any),
      ev({ kind: 'config.set', dateFormat: 'year' } as any),
    ], freshState());
    expect(s.dateFormat).toBe('year');
  });

  it('a bad epoch string is ignored, format still applies', () => {
    const s = reduce([
      ev({ kind: 'config.set', dateFormat: 'month', dateEpoch: 'not-a-date' } as any),
    ], freshState());
    expect(s.dateFormat).toBe('month');
    expect(s.dateEpoch).toBeUndefined();
  });

  it('persists custom month names + era, and folds them into a rendered date', () => {
    const months = ['Frostfall', 'Thawmoon', 'Seedtide'];
    const s = reduce([
      ev({ kind: 'config.set', dateFormat: 'month-day-year', dateEpoch: '2026-01-01', monthNames: months, yearSuffix: ' A.R.' } as any),
    ], freshState());
    expect(s.monthNames).toEqual(months);
    expect(s.yearSuffix).toBe(' A.R.');
    // state is a valid DateNaming source
    expect(formatDate(0, s.dateFormat, s)).toBe('Frostfall 1, 2026 A.R.');
  });

  it('an empty month-name array clears back to defaults', () => {
    const s = reduce([
      ev({ kind: 'config.set', monthNames: ['A', 'B'] } as any),
      ev({ kind: 'config.set', monthNames: [] } as any),
    ], freshState());
    expect(s.monthNames).toBeUndefined();
  });
});

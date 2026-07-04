import { describe, it, expect } from 'vitest';
import { formatDate, type DateFormat } from '../src/domain/date-format.js';
import { reduce } from '../src/core/reduce.js';
import { freshState } from '../src/domain/types.js';
import { nextSeq } from '../src/core/ids.js';
import type { VellumEvent } from '../src/core/events.js';

/**
 * Date-display formats: the day counter can render as a plain count OR as a
 * derived calendar date (month/day/year and subsets). The format persists as a
 * config.set event so it flows through reduce() to every consumer.
 */

const EPOCH = new Date(2026, 0, 1); // Jan 1, 2026

describe('formatDate — every option', () => {
  it('day count is the default, apart from any epoch', () => {
    expect(formatDate(0, 'day')).toBe('Day 0');
    expect(formatDate(47, 'day')).toBe('Day 47');
    expect(formatDate(47, 'day', EPOCH)).toBe('Day 47'); // epoch ignored for 'day'
  });

  it('month-day-year', () => {
    expect(formatDate(0, 'month-day-year', EPOCH)).toBe('January 1, 2026');
    expect(formatDate(4, 'month-day-year', EPOCH)).toBe('January 5, 2026');
    expect(formatDate(31, 'month-day-year', EPOCH)).toBe('February 1, 2026');
  });

  it('month-day', () => {
    expect(formatDate(0, 'month-day', EPOCH)).toBe('January 1');
    expect(formatDate(59, 'month-day', EPOCH)).toBe('March 1'); // 2026 not a leap year: day 59 = Mar 1
  });

  it('month only', () => {
    expect(formatDate(0, 'month', EPOCH)).toBe('January');
    expect(formatDate(40, 'month', EPOCH)).toBe('February');
  });

  it('week number', () => {
    expect(formatDate(0, 'week', EPOCH)).toBe('Week 1');
    expect(formatDate(7, 'week', EPOCH)).toBe('Week 2');
  });

  it('month-year (short month)', () => {
    expect(formatDate(0, 'month-year', EPOCH)).toBe('Jan 2026');
    expect(formatDate(365, 'month-year', EPOCH)).toBe('Jan 2027');
  });

  it('year only', () => {
    expect(formatDate(0, 'year', EPOCH)).toBe('Year 2026');
    expect(formatDate(365, 'year', EPOCH)).toBe('Year 2027');
  });

  it('works without an epoch (neutral fictional calendar)', () => {
    // no epoch → still produces a stable, non-Day string for calendar formats
    expect(formatDate(0, 'year')).toMatch(/^Year \d+$/);
    expect(formatDate(40, 'month')).toMatch(/^[A-Z][a-z]+$/);
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
});

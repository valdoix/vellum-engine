import { describe, expect, it } from 'vitest';
import { plotRefMatches, resolvePlotRef } from '../src/domain/plot-refs.js';

describe('plot reference compatibility', () => {
  const rows = [{ id: 'thr_the_city_conspiracy', name: 'The City Conspiracy' }];

  it.each(['The City Conspiracy', 'thr_the_city_conspiracy', 'arc_the_city_conspiracy', 'city_conspiracy'])(
    'resolves accepted parent spelling %s', (ref) => expect(resolvePlotRef(rows, ref)?.id).toBe(rows[0]!.id),
  );

  it('matches a pending suggested parent by its provider id or title', () => {
    const row = { id: 'arc_the_city_conspiracy', name: 'The City Conspiracy' };
    expect(plotRefMatches(row, 'arc_the_city_conspiracy')).toBe(true);
    expect(plotRefMatches(row, 'The City Conspiracy')).toBe(true);
  });
});

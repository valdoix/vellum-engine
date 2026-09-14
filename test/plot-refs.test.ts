import { describe, expect, it } from 'vitest';
import { plotRefMatches, plotStateInjection, resolvePlotRef } from '../src/domain/plot-refs.js';

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

  it('injects all active plot layers with anti-duplication rules', () => {
    const text = plotStateInjection({
      arcs: [{ id: 'arc_main', name: 'The Main Arc', status: 'active', beats: ['The crisis grows'], firstTurn: 1, lastTurn: 2 }],
      threads: [{ id: 'thr_main', name: 'The Main Thread', status: 'active', beats: ['The courier searches the archive'], arc: 'arc_main', firstTurn: 1, lastTurn: 2 }],
      offscreen: [{ id: 'sub_main', name: 'Ashes At Dawn', status: 'active', gist: 'The courier waits outside', beats: ['The courier waits outside'], who: 'courier', where: 'North Gate', thread: 'thr_main', arc: 'arc_main' }],
    } as any);
    expect(text).toContain('id=arc_main');
    expect(text).toContain('id=thr_main');
    expect(text).toContain('id=sub_main');
    expect(text).toContain('Do not create a new arc, thread, or subplot');
  });
});

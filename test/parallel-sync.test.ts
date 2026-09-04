import { describe, expect, it } from 'vitest';
import type { VellumEvent } from '../src/core/events.js';
import { reduce } from '../src/core/reduce.js';
import { coreFeature } from '../src/domain/core-feature.js';
import { freshState } from '../src/domain/types.js';

let seq = 0;
function ev(e: Partial<VellumEvent> & { kind: VellumEvent['kind'] }): VellumEvent {
  return { seq: ++seq, turn: 1, day: 1, src: 'model', ...(e as object) } as VellumEvent;
}

describe('parallel T1 synchronization', () => {
  it('clears the previous parallel snapshot when a new authoritative scene arrives', () => {
    const state = reduce([
      ev({ kind: 'parallel.set', items: [{ who: 'mara', where: 'Place A', activity: 'waits' }] }),
      ev({ kind: 'scene.set', turn: 2, location: 'Place B', time: '07:45', clock: 465, present: ['mara'] }),
    ]);

    expect(state.scene.location).toBe('Place B');
    expect(state.parallel).toEqual([]);
  });

  it('rejects a same-turn parallel row for a character already in scene.present', () => {
    const state = reduce([
      ev({ kind: 'scene.set', location: 'Place B', present: ['mara'] }),
      ev({ kind: 'parallel.set', items: [
        { who: 'mara', where: 'Place A', activity: 'waits at the old location' },
        { who: 'elara', where: 'Place C', activity: 'closes the gate' },
      ] }),
    ]);

    expect(state.parallel).toEqual([
      expect.objectContaining({ who: 'elara', where: 'Place C', activity: 'closes the gate' }),
    ]);
  });

  it('keeps only the final row when one absent actor is emitted in two places', () => {
    const state = reduce([
      ev({ kind: 'scene.set', location: 'Place C', present: [] }),
      ev({ kind: 'parallel.set', items: [
        { who: 'mara', where: 'Place A', activity: 'starts walking' },
        { who: 'mara', where: 'Place B', activity: 'opens the west door' },
      ] }),
    ]);

    expect(state.parallel).toHaveLength(1);
    expect(state.parallel[0]).toEqual(expect.objectContaining({
      who: 'mara',
      where: 'Place B',
      activity: 'opens the west door',
    }));
  });

  it('preserves an explicit empty parallel array as a clearing event', () => {
    let nextSeq = 0;
    const events = coreFeature.extract!({
      scene: { loc: 'Place B', time: '07:45', clock: 465 },
      present: [{ id: 'Mara' }],
      delta: { parallel: [] },
    } as never, {
      turn: 2,
      day: 1,
      state: freshState(),
      seq: () => ++nextSeq,
    } as never);

    const parallel = events.find((event) => event.kind === 'parallel.set');
    expect(parallel).toBeDefined();
    expect(parallel).toMatchObject({ kind: 'parallel.set', items: [] });
  });

  it('drops the exact stale-location contradiction from a parsed model snapshot', () => {
    let nextSeq = 0;
    const events = coreFeature.extract!({
      scene: { loc: 'Place B', time: '07:45', clock: 465 },
      present: [{ id: 'Mara', doing: 'opens the west door' }],
      delta: { parallel: [
        { who: 'Mara', where: 'Place A', activity: 'waits by the old gate' },
        { who: 'Elara', where: 'Place C', activity: 'reads the dispatch' },
      ] },
    } as never, {
      turn: 3,
      day: 1,
      state: freshState(),
      seq: () => ++nextSeq,
    } as never);

    const state = reduce(events);
    expect(state.scene.present).toContain('mara');
    expect(state.parallel.some((item) => item.who === 'mara')).toBe(false);
    expect(state.parallel).toEqual([
      expect.objectContaining({ who: 'elara', where: 'Place C', activity: 'reads the dispatch' }),
    ]);
  });
});

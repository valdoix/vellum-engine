import { describe, expect, it } from 'vitest';
import { VellumEvent as VellumEventSchema, type VellumEvent } from '../src/core/events.js';
import { reduce } from '../src/core/reduce.js';
import { cmdEvents } from '../src/domain/commands.js';
import { freshState } from '../src/domain/types.js';
import { canonicalTurnDay, timelineDay } from '../src/domain/timeline-days.js';

const fold = (seq: number, turn: number, day: number): VellumEvent => ({
  seq, turn, day, src: 'system', kind: 'turn.fold', sig: `turn-${turn}`,
});

describe('Timeline day repair', () => {
  it('re-derives the historical turn-to-day axis from old turn.fold events', () => {
    const state = reduce([fold(1, 1, 1), fold(2, 2, 17)]);
    expect(state.turnDays).toEqual({ '1': 1, '2': 17 });
    expect(timelineDay(state, 2)).toBe(17);
  });

  it('overrides every record stamp on a repaired turn without deleting the original', () => {
    const state = reduce([
      fold(1, 1, 1),
      fold(2, 2, 17),
      { seq: 3, turn: 2, day: 17, src: 'user', kind: 'timeline.day.set', fromTurn: 2, toTurn: 2, narrativeDay: 2 },
    ]);
    expect(canonicalTurnDay(state, 2)).toBe(2);
    expect(timelineDay(state, 2, 17)).toBe(2); // a wrong Story Beat/Journal stamp is repaired too
    expect(state.turnDays['2']).toBe(17); // source stamp remains auditable underneath
  });

  it('supports range repair and lossless reset', () => {
    const events: VellumEvent[] = [
      fold(1, 1, 1), fold(2, 2, 17), fold(3, 3, 17), fold(4, 4, 2),
      { seq: 5, turn: 4, day: 2, src: 'user', kind: 'timeline.day.set', fromTurn: 2, toTurn: 3, narrativeDay: 2 },
    ];
    const repaired = reduce(events);
    expect([1, 2, 3, 4].map((turn) => canonicalTurnDay(repaired, turn))).toEqual([1, 2, 2, 2]);
    const reset = reduce([...events, { seq: 6, turn: 4, day: 2, src: 'user', kind: 'timeline.day.set', fromTurn: 2, toTurn: 3, narrativeDay: null }]);
    expect([1, 2, 3, 4].map((turn) => canonicalTurnDay(reset, turn))).toEqual([1, 17, 17, 2]);
  });

  it('allows a historical record to be corrected to an earlier narrative day', () => {
    const state = reduce([
      fold(1, 1, 2),
      fold(2, 2, 2),
      { seq: 3, turn: 2, day: 2, src: 'model', kind: 'journal.entry', id: 'j1', who: 'alice', memory: 'I arrived yesterday', jkind: 'observation', weight: 'minor', sentiment: 'neutral' },
      { seq: 4, turn: 2, day: 2, src: 'user', kind: 'timeline.day.set', fromTurn: 2, toTurn: 2, narrativeDay: 1 },
    ]);
    expect(state.journal[0]?.day).toBe(2); // immutable authored stamp remains auditable
    expect(timelineDay(state, state.journal[0]!.turn, state.journal[0]!.day)).toBe(1);
    expect(canonicalTurnDay(state, 1)).toBe(2); // backward chronology is allowed
    expect(canonicalTurnDay(state, 2)).toBe(1);
  });

  it('creates schema-valid set and clear events through the command boundary', () => {
    const state = freshState();
    const set = cmdEvents('timeline_day_set', { fromTurn: 2, toTurn: 5, day: 3 }, state, { turn: 5, day: 3 });
    const clear = cmdEvents('timeline_day_set', { fromTurn: 2, toTurn: 5, clear: true }, state, { turn: 5, day: 3 });
    expect(VellumEventSchema.safeParse(set[0]).success).toBe(true);
    expect(set[0]).toMatchObject({ kind: 'timeline.day.set', fromTurn: 2, toTurn: 5, narrativeDay: 3 });
    expect(clear[0]).toMatchObject({ kind: 'timeline.day.set', narrativeDay: null });
    expect(cmdEvents('timeline_day_set', { fromTurn: 5, toTurn: 2, day: 3 }, state, { turn: 5, day: 3 })).toEqual([]);
  });
});

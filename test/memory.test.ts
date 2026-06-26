import { describe, it, expect } from 'vitest';
import { planChapter, chapterEvents } from '../src/domain/memory.js';
import { reduce } from '../src/core/reduce.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';
import type { VellumEvent } from '../src/core/events.js';

function withTurnMemories(n: number): ChronicleState {
  const s = freshState();
  s.turns = n;
  for (let i = 1; i <= n; i++) {
    s.memories.push({ id: 'm' + i, tier: 'turn', text: 'turn ' + i + ' happened', keys: [], turn: i });
  }
  return s;
}

describe('hierarchical memory', () => {
  it('does not plan until a full window exists', () => {
    expect(planChapter(withTurnMemories(5), 8)).toBeNull();
  });

  it('plans the oldest window of turn-memories', () => {
    const plan = planChapter(withTurnMemories(10), 8);
    expect(plan).not.toBeNull();
    expect(plan!.sourceIds).toHaveLength(8);
    expect(plan!.covers).toEqual([1, 8]);
  });

  it('chapter events record a chapter and drop the sources (folds correctly)', () => {
    const state = withTurnMemories(10);
    const plan = planChapter(state, 8)!;
    let seq = 1000;
    const evs = chapterEvents(plan, 'Chapter: the first eight turns', ['opening'], 11, 1, () => ++seq);
    // replay onto the existing memories to verify the net effect
    const base: VellumEvent[] = state.memories.map((m, i) => ({ seq: i, turn: m.turn, day: 1, src: 'system', kind: 'memory.record', id: m.id, tier: m.tier, text: m.text, keys: m.keys } as VellumEvent));
    const s = reduce([...base, ...evs]);
    const chapters = s.memories.filter((m) => m.tier === 'chapter');
    const turns = s.memories.filter((m) => m.tier === 'turn');
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.covers).toEqual([1, 8]);
    expect(turns).toHaveLength(2); // 8 of 10 compressed away, 2 recent remain
  });

  it('deleting a chapter restores the turn-memories it subsumed', () => {
    const state = withTurnMemories(10);
    const plan = planChapter(state, 8)!;
    let seq = 1000;
    const base: VellumEvent[] = state.memories.map((m, i) => ({ seq: i, turn: m.turn, day: 1, src: 'system', kind: 'memory.record', id: m.id, tier: m.tier, text: m.text, keys: m.keys } as VellumEvent));
    const compress = chapterEvents(plan, 'Chapter summary', ['opening'], 11, 1, () => ++seq);
    const chapId = compress.find((e) => e.kind === 'memory.record')!.id!;
    // after compression: 1 chapter + 2 recent turns
    let s = reduce([...base, ...compress]);
    expect(s.memories.filter((m) => m.tier === 'turn')).toHaveLength(2);
    // now delete the chapter → its 8 subsumed turns come back
    const del: VellumEvent = { seq: ++seq, turn: 12, day: 1, src: 'user', kind: 'memory.drop', id: chapId } as VellumEvent;
    s = reduce([...base, ...compress, del]);
    expect(s.memories.filter((m) => m.tier === 'chapter')).toHaveLength(0);
    expect(s.memories.filter((m) => m.tier === 'turn')).toHaveLength(10); // all restored
  });
});

import { describe, it, expect } from 'vitest';
import { freshState } from '../src/domain/types.js';
import type { Memory, JournalEntry, Track } from '../src/domain/types.js';
import { beatSpine, beatEvent, suggestBeats, sortedBeats, beatLabel } from '../src/domain/beats.js';
import { reduce } from '../src/core/reduce.js';

function beatMem(o: Partial<Memory> & { id: string; text: string }): Memory {
  return { tier: 'beat', keys: [], turn: 0, spine: true, ...o } as Memory;
}

describe('Story Beats — domain', () => {
  it('beatEvent defaults to a spine beat and folds via reduce', () => {
    let n = 0;
    const ev = beatEvent({ text: 'Aldous and Mira dueled; Mira won.', day: 3, time: 'dusk' }, 12, () => ++n);
    expect(ev).not.toBeNull();
    const s = reduce([ev!]);
    const b = s.memories.find((m) => m.tier === 'beat');
    expect(b?.text).toContain('dueled');
    expect(b?.beatDay).toBe(3);
    expect(b?.beatTime).toBe('dusk');
    expect(b?.spine).toBe(true);
  });

  it('beatEvent returns null for empty text', () => {
    expect(beatEvent({ text: '   ' }, 1, () => 1)).toBeNull();
  });

  it('respects spine:false (relevance-only beat)', () => {
    let n = 0;
    const ev = beatEvent({ text: 'A minor aside.', spine: false }, 5, () => ++n);
    const s = reduce([ev!]);
    expect(s.memories[0]!.spine).toBeUndefined();
  });

  it('sorts beats by day then turn', () => {
    const s = freshState();
    s.memories.push(beatMem({ id: 'b1', text: 'later', beatDay: 5, turn: 2 }));
    s.memories.push(beatMem({ id: 'b2', text: 'earlier', beatDay: 1, turn: 9 }));
    s.memories.push(beatMem({ id: 'b3', text: 'noday', turn: 1 }));
    expect(sortedBeats(s).map((m) => m.id)).toEqual(['b3', 'b2', 'b1']);
  });

  it('beatSpine injects only spine beats, chronologically, capped to most recent', () => {
    const s = freshState();
    s.memories.push(beatMem({ id: 'b1', text: 'first', beatDay: 1, turn: 1 }));
    s.memories.push(beatMem({ id: 'b2', text: 'second', beatDay: 2, turn: 2, spine: false } as any));
    s.memories.push(beatMem({ id: 'b3', text: 'third', beatDay: 3, turn: 3 }));
    const spine = beatSpine(s, 14);
    expect(spine).toContain('STORY SPINE');
    expect(spine).toContain('first');
    expect(spine).toContain('third');
    expect(spine).not.toContain('second'); // spine:false excluded
    // chronological order
    expect(spine.indexOf('first')).toBeLessThan(spine.indexOf('third'));
  });

  it('beatSpine respects the cap (keeps most recent)', () => {
    const s = freshState();
    for (let i = 1; i <= 20; i++) s.memories.push(beatMem({ id: 'b' + i, text: 'beat ' + i, beatDay: i, turn: i }));
    const spine = beatSpine(s, 5);
    expect(spine).toContain('beat 20');
    expect(spine).not.toContain('beat 1\n');
    expect(spine.split('\n').filter((l) => l.startsWith('- ')).length).toBe(5);
  });

  it('beatSpine is empty when no spine beats', () => {
    const s = freshState();
    s.memories.push(beatMem({ id: 'b1', text: 'x', spine: false } as any));
    expect(beatSpine(s)).toBe('');
  });

  it('beatLabel renders the day/time anchor', () => {
    expect(beatLabel(beatMem({ id: 'b', text: 'the duel', beatDay: 3, beatTime: 'dusk' }))).toBe('[Day 3, dusk] the duel');
    expect(beatLabel(beatMem({ id: 'b', text: 'no anchor' }))).toBe('no anchor');
  });

  it('suggestBeats pulls defining journal + resolved threads, skips already-beaten turns', () => {
    const s = freshState();
    s.journal.push({ id: 'j1', who: 'mira', memory: 'She broke the vow.', kind: 'betrayal', weight: 'defining', sentiment: 'negative', turn: 8, day: 2 } as JournalEntry);
    s.journal.push({ id: 'j2', who: 'mira', memory: 'trivial', kind: 'observation', weight: 'trivial', sentiment: 'neutral', turn: 9, day: 2 } as JournalEntry);
    s.threads.push({ name: 'The Duel', status: 'resolved', firstTurn: 3, lastTurn: 10 } as Track);
    const sug = suggestBeats(s);
    expect(sug.some((x) => x.text.includes('broke the vow'))).toBe(true);
    expect(sug.some((x) => x.text.includes('The Duel'))).toBe(true);
    expect(sug.some((x) => x.text === 'trivial')).toBe(false); // trivial excluded
  });

  it('memory.drop removes a beat (delete path)', () => {
    let n = 0;
    const ev = beatEvent({ text: 'gone soon' }, 1, () => ++n);
    const s1 = reduce([ev!]);
    const id = s1.memories[0]!.id;
    const s2 = reduce([ev!, { seq: ++n, turn: 0, day: 0, src: 'user', kind: 'memory.drop', id } as any]);
    expect(s2.memories.find((m) => m.tier === 'beat')).toBeUndefined();
  });
});

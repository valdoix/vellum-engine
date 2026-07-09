import { describe, it, expect } from 'vitest';
import { reduce } from '../src/core/reduce.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';
import type { VellumEvent } from '../src/core/events.js';
import {
  isCatchupMarker, markerDays, threadAwaitsFill, threadsAwaitingCatchup,
  catchupTargets, buildCatchupPrompt, parseCatchupReply, validateCatchupBeats,
  THREAD_CATCHUP_SYS,
} from '../src/domain/thread-catchup.js';

let seq = 0;
const ev = (e: Partial<VellumEvent> & { kind: string }): VellumEvent => ({ seq: ++seq, turn: 1, day: 1, src: 'model', ...(e as any) });

/** Build a state with one thread carrying the given beats + lastDay. */
function withThread(o: { id?: string; name: string; status?: string; beats?: string[]; lastDay?: number; firstDay?: number }): ChronicleState {
  const s = freshState();
  s.day = 12;
  s.threads.push({
    id: o.id ?? 'thr_' + o.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    name: o.name, status: o.status ?? 'advance', beats: o.beats ?? [],
    firstTurn: 1, lastTurn: 1, ...(o.firstDay !== undefined ? { firstDay: o.firstDay } : {}),
    ...(o.lastDay !== undefined ? { lastDay: o.lastDay } : {}),
  });
  return s;
}

describe('catch-up marker detection', () => {
  it('recognizes both marker phrasings', () => {
    expect(isCatchupMarker('caught up: Day 9 \u2192 Day 12')).toBe(true);
    expect(isCatchupMarker('caught up to Day 12')).toBe(true);
    expect(isCatchupMarker('caught up: day 9 -> day 12')).toBe(true);
  });
  it('does NOT flag ordinary beats', () => {
    expect(isCatchupMarker('The letter finally arrived at the keep.')).toBe(false);
    expect(isCatchupMarker('caught the thief red-handed')).toBe(false);
    expect(isCatchupMarker(undefined)).toBe(false);
    expect(isCatchupMarker('')).toBe(false);
  });
  it('recovers the day-span a marker recorded', () => {
    expect(markerDays('caught up: Day 9 \u2192 Day 12')).toEqual({ from: 9, to: 12 });
    expect(markerDays('caught up: day 3 -> day 8')).toEqual({ from: 3, to: 8 });
    expect(markerDays('caught up to Day 5')).toEqual({ to: 5 });
    expect(markerDays('the real beat')).toBeNull();
  });
});

describe('threadAwaitsFill / threadsAwaitingCatchup', () => {
  it('awaits fill only when the LATEST beat is a marker', () => {
    expect(threadAwaitsFill(withThread({ name: 'A', beats: ['real', 'caught up: Day 9 \u2192 Day 12'] }).threads[0]!)).toBe(true);
    // a real beat authored AFTER the marker means it's been filled
    expect(threadAwaitsFill(withThread({ name: 'A', beats: ['caught up: Day 9 \u2192 Day 12', 'the letter arrived'] }).threads[0]!)).toBe(false);
    expect(threadAwaitsFill(withThread({ name: 'A', beats: ['just a real beat'] }).threads[0]!)).toBe(false);
  });
  it('collects lagging threads AND stamped-but-unfilled ones, skips resolved', () => {
    const s = freshState(); s.day = 12;
    s.threads.push({ id: 'lag', name: 'Lagging', status: 'advance', beats: ['x'], firstTurn: 1, lastTurn: 1, lastDay: 9 });
    s.threads.push({ id: 'mark', name: 'Marked', status: 'advance', beats: ['caught up: Day 4 \u2192 Day 12'], firstTurn: 1, lastTurn: 1, lastDay: 12 });
    s.threads.push({ id: 'cur', name: 'Current', status: 'advance', beats: ['y'], firstTurn: 1, lastTurn: 1, lastDay: 12 });
    s.threads.push({ id: 'done', name: 'Done', status: 'resolved', beats: ['z'], firstTurn: 1, lastTurn: 1, lastDay: 4 });
    const ids = threadsAwaitingCatchup(s, 12).map((t) => t.id);
    expect(ids).toContain('lag');
    expect(ids).toContain('mark');
    expect(ids).not.toContain('cur');
    expect(ids).not.toContain('done');
  });
});

describe('catchupTargets', () => {
  it('reads the original gap from the marker after a stamp (lastDay already advanced)', () => {
    const s = withThread({ id: 't1', name: 'The Letter', beats: ['courier dispatched', 'caught up: Day 9 \u2192 Day 12'], lastDay: 12 });
    const [target] = catchupTargets(s, ['t1'], 12);
    expect(target).toBeDefined();
    expect(target!.fromDay).toBe(9);
    expect(target!.toDay).toBe(12);
    // the marker is stripped from the beats fed back to the model
    expect(target!.recentBeats).toEqual(['courier dispatched']);
  });
  it('uses lastDay when a plain lagging thread has no marker', () => {
    const s = withThread({ id: 't1', name: 'The Letter', beats: ['courier dispatched'], lastDay: 9 });
    const [target] = catchupTargets(s, ['t1'], 12);
    expect(target!.fromDay).toBe(9);
    expect(target!.toDay).toBe(12);
  });
  it('skips a thread already current with no marker', () => {
    const s = withThread({ id: 't1', name: 'Done-ish', beats: ['fresh'], lastDay: 12 });
    expect(catchupTargets(s, ['t1'], 12)).toHaveLength(0);
  });
});

describe('canon-locked prompt', () => {
  it('feeds roster, deceased flags, established facts, and per-thread history', () => {
    const s = withThread({ id: 't1', name: 'The Reckoning', beats: ['tension rising'], lastDay: 9 });
    s.scene.location = 'the Red Keep';
    s.cast['cersei'] = { id: 'cersei', name: 'Cersei', aka: [], status: 'active', standing: 0, trust: 0, source: 'auto', firstTurn: 1, lastTurn: 5, userEdited: false } as any;
    s.cast['robert'] = { id: 'robert', name: 'Robert', aka: [], status: 'mentioned', standing: 0, trust: 0, source: 'auto', firstTurn: 1, lastTurn: 2, userEdited: false, deceased: true } as any;
    s.knowledge.push({ id: 'k1', who: 'cersei', fact: 'has no children in this telling', reliability: 'knows', truth: 'true', turn: 3 } as any);
    const targets = catchupTargets(s, ['t1'], 12);
    const prompt = buildCatchupPrompt(s, targets);
    expect(prompt).toContain('Cersei');
    expect(prompt).toContain('Robert');
    expect(prompt).toContain('DECEASED');
    expect(prompt).toContain('has no children in this telling');
    expect(prompt).toContain('tension rising');
    expect(prompt).toContain('The Reckoning');
    expect(prompt).toContain('Day 9');
    expect(prompt).toContain('Day 12');
  });
  it('the system prompt forbids importing outside canon', () => {
    expect(THREAD_CATCHUP_SYS.toLowerCase()).toContain('alternate universe');
    expect(THREAD_CATCHUP_SYS.toLowerCase()).toContain('never import');
  });
});

describe('parse + validate reply', () => {
  it('parses {beats:[...]} and a bare array, trimming and capping', () => {
    expect(parseCatchupReply('{"beats":[{"id":"t1","beat":"the letter arrived"}]}')).toEqual([{ id: 't1', beat: 'the letter arrived' }]);
    expect(parseCatchupReply('[{"id":"t2","text":"talks stalled"}]')).toEqual([{ id: 't2', beat: 'talks stalled' }]);
    expect(parseCatchupReply('garbage')).toBeNull();
  });
  it('drops unknown ids, dedupes, and rejects marker echoes', () => {
    const targets = catchupTargets(withThread({ id: 't1', name: 'A', beats: ['x'], lastDay: 9 }), ['t1'], 12);
    const beats = validateCatchupBeats([
      { id: 't1', beat: 'a real development' },
      { id: 't1', beat: 'a second one (should dedupe)' },
      { id: 'ghost', beat: 'from a thread that does not exist' },
      { id: 't1', beat: 'caught up: Day 9 \u2192 Day 12' },
    ], targets);
    expect(beats).toEqual([{ id: 't1', beat: 'a real development' }]);
  });
});

describe('reducer — fill replaces a trailing marker in place', () => {
  it('swaps the marker for the authored beat, keeps prior history', () => {
    seq = 0;
    const s = reduce([
      ev({ kind: 'thread.set', id: 'thr_a', name: 'A', note: 'the courier set out', day: 9 }),
      ev({ kind: 'thread.set', id: 'thr_a', name: 'A', note: 'caught up: Day 9 \u2192 Day 12', day: 12 }),
      ev({ kind: 'thread.set', id: 'thr_a', name: 'A', note: 'the letter reached the keep', day: 12, fill: true } as any),
    ]);
    const t = s.threads.find((x) => x.id === 'thr_a')!;
    expect(t.beats).toEqual(['the courier set out', 'the letter reached the keep']);
    expect(t.beats.some((b) => isCatchupMarker(b))).toBe(false);
  });
  it('a fill with no marker present just appends (no data loss)', () => {
    seq = 0;
    const s = reduce([
      ev({ kind: 'thread.set', id: 'thr_a', name: 'A', note: 'first beat', day: 9 }),
      ev({ kind: 'thread.set', id: 'thr_a', name: 'A', note: 'second beat', day: 12, fill: true } as any),
    ]);
    const t = s.threads.find((x) => x.id === 'thr_a')!;
    expect(t.beats).toEqual(['first beat', 'second beat']);
  });
});

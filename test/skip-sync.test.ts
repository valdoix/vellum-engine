import { describe, it, expect } from 'vitest';
import { reduce } from '../src/core/reduce.js';
import { buildInjection } from '../src/retrieval/recall.js';
import { checkThreadOffscreenSync } from '../src/domain/continuity.js';
import { buildSimPrompt, timeSkipNote } from '../src/domain/offscreen.js';
import { openTracks } from '../src/domain/thread-merge.js';
import { spanLabel } from '../src/domain/date-format.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';
import type { VellumEvent } from '../src/core/events.js';

let seq = 0;
const ev = (e: Partial<VellumEvent> & { kind: string }): VellumEvent => ({ seq: ++seq, turn: 1, day: 1, src: 'model', ...(e as any) });

describe('Item 1 — thread/offscreen day-stamping in reduce', () => {
  it('stamps firstDay once and advances lastDay monotonically on thread.op', () => {
    const s = reduce([
      ev({ kind: 'thread.op', op: 'new', name: 'The Letter', note: 'penned', turn: 1, day: 3 }),
      ev({ kind: 'thread.op', op: 'advance', name: 'The Letter', note: 'sent', turn: 4, day: 9 }),
    ]);
    expect(s.threads[0]!.firstDay).toBe(3);
    expect(s.threads[0]!.lastDay).toBe(9);
  });

  it('never runs lastDay backward (a later event on an earlier day)', () => {
    const s = reduce([
      ev({ kind: 'thread.op', op: 'new', name: 'The Letter', turn: 1, day: 9 }),
      ev({ kind: 'thread.op', op: 'advance', name: 'The Letter', turn: 2, day: 4 }),
    ]);
    expect(s.threads[0]!.lastDay).toBe(9);
  });

  it('leaves day anchors undefined for a pre-day-stamp fold (day 0)', () => {
    const s = reduce([ev({ kind: 'thread.op', op: 'new', name: 'The Letter', turn: 1, day: 0 })]);
    expect(s.threads[0]!.firstDay).toBeUndefined();
    expect(s.threads[0]!.lastDay).toBeUndefined();
  });

  it('stamps offscreen.op day anchors', () => {
    const s = reduce([
      ev({ kind: 'offscreen.op', op: 'new', id: 'appt', name: 'The Appointment', gist: 'set', turn: 1, day: 2 } as any),
      ev({ kind: 'offscreen.op', op: 'advance', id: 'appt', gist: 'kept', turn: 5, day: 12 } as any),
    ]);
    expect(s.offscreen[0]!.firstDay).toBe(2);
    expect(s.offscreen[0]!.lastDay).toBe(12);
  });

  it('reconciles day anchors across a thread.merge (earliest first, latest last)', () => {
    const s = reduce([
      ev({ kind: 'thread.op', op: 'new', name: 'Jaime\u2019s Arrival', turn: 1, day: 3 }),
      ev({ kind: 'thread.op', op: 'new', name: 'Jaime at Harrenhal', turn: 2, day: 11 }),
      ev({ kind: 'thread.merge', from: ['Jaime at Harrenhal'], into: 'Jaime\u2019s Arrival', turn: 3, day: 11 } as any),
    ]);
    expect(s.threads).toHaveLength(1);
    expect(s.threads[0]!.firstDay).toBe(3);
    expect(s.threads[0]!.lastDay).toBe(11);
  });
});

describe('Item 2 — openTracks carries beats + lastDay for the sim payload', () => {
  it('projects the latest beat and day anchor', () => {
    const s = reduce([
      ev({ kind: 'thread.op', op: 'new', name: 'The Letter', note: 'penned', turn: 1, day: 3 }),
      ev({ kind: 'thread.op', op: 'advance', name: 'The Letter', note: 'sent by raven', turn: 4, day: 9 }),
    ]);
    const [t] = openTracks(s, 'threads');
    expect(t!.beats[t!.beats.length - 1]).toBe('sent by raven');
    expect(t!.lastDay).toBe(9);
  });

  it('surfaces the thread latest note in the sim prompt', () => {
    const s = freshState();
    s.scene = { location: 'The Hall', time: '', tension: 0, weather: '', present: [], detail: [] } as any;
    const prompt = buildSimPrompt(s, [{ name: 'Jaime' }], {
      threads: [{ id: 'thr_the_letter', name: 'The Letter', status: 'advance', note: 'sent by raven', lastDay: 9 }],
    });
    expect(prompt).toContain('The Letter');
    expect(prompt).toContain('sent by raven');
  });
});

describe('Item 4 — spanLabel + on-screen skip-lag note', () => {
  it('spanLabel buckets days/weeks/months and returns empty under 2 days', () => {
    expect(spanLabel(1)).toBe('');
    expect(spanLabel(5)).toBe('5 days');
    expect(spanLabel(14)).toBe('2 week(s)');
    expect(spanLabel(60)).toBe('2 month(s)');
  });

  it('timeSkipNote reuses spanLabel wording', () => {
    expect(timeSkipNote(1)).toBe('');
    expect(timeSkipNote(60)).toContain('2 month(s)');
  });

  it('flags a lagging thread in the injected structured block and orders fresh-day first', () => {
    const s = freshState();
    s.turns = 20;
    s.day = 40;
    s.cast = { ned: { id: 'ned', name: 'Ned', aka: [], status: 'present', source: 'auto', firstTurn: 1, lastTurn: 20, userEdited: false } };
    s.scene = { location: 'Harrenhal', time: '', tension: 0, weather: '', present: ['ned'], detail: [] } as any;
    s.threads = [
      { id: 'thr_stale', name: 'The Stale Vigil', status: 'advance', beats: [], firstTurn: 1, lastTurn: 3, firstDay: 2, lastDay: 5 },
      { id: 'thr_fresh', name: 'The Fresh Hunt', status: 'advance', beats: [], firstTurn: 1, lastTurn: 19, firstDay: 38, lastDay: 40 },
    ];
    const inj = buildInjection('cT', s, 'what happens at Harrenhal');
    expect(inj.text).toContain('catch it up to now');
    // fresh-day thread leads the lagging one in the OPEN THREADS block
    expect(inj.text.indexOf('The Fresh Hunt')).toBeLessThan(inj.text.indexOf('The Stale Vigil'));
  });

  it('does not add a lag note when threads share the current day', () => {
    const s = freshState();
    s.turns = 20;
    s.day = 40;
    s.cast = { ned: { id: 'ned', name: 'Ned', aka: [], status: 'present', source: 'auto', firstTurn: 1, lastTurn: 20, userEdited: false } };
    s.scene = { location: 'Harrenhal', time: '', tension: 0, weather: '', present: ['ned'], detail: [] } as any;
    s.threads = [{ id: 'thr_fresh', name: 'The Fresh Hunt', status: 'advance', beats: [], firstTurn: 1, lastTurn: 19, firstDay: 38, lastDay: 40 }];
    const inj = buildInjection('cT', s, 'what happens at Harrenhal');
    expect(inj.text).not.toContain('catch it up to now');
  });
});

describe('Item 6 — checkThreadOffscreenSync guard', () => {
  function linkedState(threadDay: number, offDay: number): ChronicleState {
    const s = freshState();
    s.threads = [{ id: 'thr_the_letter', name: 'The Letter', status: 'advance', beats: [], firstTurn: 1, lastTurn: 5, firstDay: 2, lastDay: threadDay }];
    s.offscreen = [{ id: 'appt', name: 'The Letter delivery', status: 'active', gist: 'in transit', beats: [], thread: 'thr_the_letter', firstTurn: 1, lastTurn: 8, firstDay: 2, lastDay: offDay }];
    return s;
  }

  it('flags a linked pair whose narrative days diverge past a skip', () => {
    const w = checkThreadOffscreenSync(linkedState(5, 30));
    expect(w.some((x) => x.kind === 'thread_offscreen_conflict')).toBe(true);
    expect(w[0]!.text).toContain('thread "The Letter"'); // the lagging side named
  });

  it('does not flag a synced pair', () => {
    const w = checkThreadOffscreenSync(linkedState(29, 30));
    expect(w).toHaveLength(0);
  });

  it('does not flag when day anchors are absent (pre-day-stamp log)', () => {
    const s = freshState();
    s.threads = [{ id: 'thr_the_letter', name: 'The Letter', status: 'advance', beats: [], firstTurn: 1, lastTurn: 5 }];
    s.offscreen = [{ id: 'appt', name: 'The Letter delivery', status: 'active', gist: 'x', beats: [], thread: 'thr_the_letter', firstTurn: 1, lastTurn: 8 }];
    expect(checkThreadOffscreenSync(s)).toHaveLength(0);
  });

  it('does not flag unlinked thread/offscreen pairs', () => {
    const s = freshState();
    s.threads = [{ id: 'thr_the_letter', name: 'The Letter', status: 'advance', beats: [], firstTurn: 1, lastTurn: 5, firstDay: 2, lastDay: 5 }];
    s.offscreen = [{ id: 'siege', name: 'The Northern Siege', status: 'active', gist: 'walls hold', beats: [], firstTurn: 1, lastTurn: 8, firstDay: 2, lastDay: 30 }];
    expect(checkThreadOffscreenSync(s)).toHaveLength(0);
  });
});

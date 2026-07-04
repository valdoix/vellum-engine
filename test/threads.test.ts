import { describe, it, expect } from 'vitest';
import { reduce } from '../src/core/reduce.js';
import { buildInjection } from '../src/retrieval/recall.js';
import { parseMergeReply, validateMerges, openTracks } from '../src/domain/thread-merge.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';
import type { VellumEvent } from '../src/core/events.js';

let seq = 0;
const ev = (e: Partial<VellumEvent> & { kind: string }): VellumEvent => ({ seq: ++seq, turn: 1, day: 1, src: 'model', ...(e as any) });
// Track literal helper — id/beats default so tests read cleanly.
const trk = (o: { name: string; status: string; firstTurn: number; lastTurn: number; id?: string; beats?: string[] }) =>
  ({ id: o.id ?? 'thr_' + o.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'), beats: o.beats ?? [], ...o });

describe('Layer 2 — upsertTrack conservative dedup', () => {
  it('merges token-set-equal rephrasings into the first-seen title', () => {
    const s = reduce([
      ev({ kind: 'thread.op', op: 'new', name: 'Jaime\u2019s Arrival', turn: 1 }),
      ev({ kind: 'thread.op', op: 'advance', name: 'the arrival of Jaime', turn: 3 }),
    ]);
    expect(s.threads).toHaveLength(1);
    expect(s.threads[0]!.name).toBe('Jaime\u2019s Arrival'); // canonical = first seen
    expect(s.threads[0]!.lastTurn).toBe(3);
  });

  it('merges whole-title containment with >=2 significant tokens', () => {
    const s = reduce([
      ev({ kind: 'thread.op', op: 'new', name: 'The Study Invitation', turn: 1 }),
      ev({ kind: 'thread.op', op: 'advance', name: 'Study Invitation pending in the tower', turn: 2 }),
    ]);
    expect(s.threads).toHaveLength(1);
  });

  it('does NOT merge distinct same-character threads (the over-merge guard)', () => {
    const s = reduce([
      ev({ kind: 'thread.op', op: 'new', name: 'The Letters', turn: 1 }),
      ev({ kind: 'thread.op', op: 'new', name: 'The Study Invitation', turn: 1 }),
      ev({ kind: 'thread.op', op: 'new', name: 'bedroom preferences', turn: 1 }),
    ]);
    expect(s.threads).toHaveLength(3);
  });

  it('does NOT merge on a single shared token (Jaime\u2019s Arrival vs Jaime at Harrenhal)', () => {
    const s = reduce([
      ev({ kind: 'thread.op', op: 'new', name: 'Jaime\u2019s Arrival', turn: 1 }),
      ev({ kind: 'thread.op', op: 'new', name: 'Jaime at Harrenhal', turn: 2 }),
    ]);
    expect(s.threads).toHaveLength(2); // semantic merge is Layer 3's job, not a blind token merge
  });
});

describe('Layer 1 — open threads injected to the model', () => {
  function withThreads(): ChronicleState {
    const s = freshState();
    s.turns = 5;
    s.cast = { ned: { id: 'ned', name: 'Ned', aka: [], status: 'present', source: 'auto', firstTurn: 1, lastTurn: 5, userEdited: false } };
    s.scene = { location: 'Harrenhal', time: '', tension: 0, weather: '', present: ['ned'], detail: [] };
    s.threads = [
      trk({ name: 'Jaime\u2019s Arrival', status: 'sleeping in Harrenhal', firstTurn: 1, lastTurn: 4 }),
      trk({ name: 'The Letters', status: 'resolved', firstTurn: 1, lastTurn: 2 }),
    ];
    s.arcs = [trk({ name: 'The Reckoning', status: 'advance', firstTurn: 1, lastTurn: 3 })];
    return s;
  }
  it('injects open threads/arcs and excludes resolved ones', () => {
    const inj = buildInjection('cT', withThreads(), 'what happens at Harrenhal');
    expect(inj.text).toContain('OPEN THREADS');
    expect(inj.text).toContain('Jaime\u2019s Arrival');
    expect(inj.text).toContain('The Reckoning');
    expect(inj.text).not.toContain('The Letters'); // resolved → omitted
  });
});

describe('Layer 3 — planThreadMerges validation + reduce', () => {
  it('parseMergeReply accepts {merge:[...]} and bare arrays', () => {
    expect(parseMergeReply('{"merge":[{"into":"A","from":["B"]}]}')).toEqual([{ into: 'A', from: ['B'] }]);
    expect(parseMergeReply('[{"into":"A","from":["B","C"]}]')).toEqual([{ into: 'A', from: ['B', 'C'] }]);
    expect(parseMergeReply('garbage')).toBeNull();
  });

  it('validateMerges keeps only existing names, drops self-merge + unknowns', () => {
    const names = ['Jaime\u2019s Arrival', 'Jaime at Harrenhal', 'The Letters'];
    const groups = validateMerges([
      { into: 'Jaime\u2019s Arrival', from: ['Jaime at Harrenhal', 'Nonexistent', 'Jaime\u2019s Arrival'] },
    ], names);
    expect(groups).toEqual([{ into: 'Jaime\u2019s Arrival', from: ['Jaime at Harrenhal'] }]);
  });

  it('reduce thread.merge folds sources into the target and removes them', () => {
    const s = reduce([
      ev({ kind: 'thread.op', op: 'new', name: 'Jaime\u2019s Arrival', turn: 1 }),
      ev({ kind: 'thread.op', op: 'advance', name: 'Jaime at Harrenhal', turn: 4 }),
      ev({ kind: 'thread.merge', from: ['Jaime at Harrenhal'], into: 'Jaime\u2019s Arrival', turn: 4 } as any),
    ]);
    expect(s.threads).toHaveLength(1);
    expect(s.threads[0]!.name).toBe('Jaime\u2019s Arrival');
    expect(s.threads[0]!.lastTurn).toBe(4); // latest carried
  });

  it('openTracks returns non-resolved tracks newest-first', () => {
    const s = freshState();
    s.threads = [
      trk({ name: 'old', status: 'advance', firstTurn: 1, lastTurn: 1 }),
      trk({ name: 'done', status: 'resolved', firstTurn: 1, lastTurn: 2 }),
      trk({ name: 'new', status: 'advance', firstTurn: 1, lastTurn: 5 }),
    ];
    expect(openTracks(s, 'threads').map((t) => t.name)).toEqual(['new', 'old']);
  });
});

describe('Track refactor — stable id + beats history', () => {
  it('mints a stable id on first sight and keeps it as the title drifts', () => {
    const s = reduce([
      ev({ kind: 'thread.op', op: 'new', name: 'Jaime\u2019s Arrival', note: 'a raven announces him', turn: 1 }),
      ev({ kind: 'thread.op', op: 'advance', name: 'the arrival of Jaime', note: 'he reaches the gate', turn: 3 }),
    ]);
    expect(s.threads).toHaveLength(1);
    expect(s.threads[0]!.id).toBe('thr_jaime_s_arrival'); // id from the FIRST title
    expect(s.threads[0]!.name).toBe('Jaime\u2019s Arrival'); // canonical name unchanged
    expect(s.threads[0]!.beats).toEqual(['a raven announces him', 'he reaches the gate']); // history accrues
  });

  it('caps beats at 6, newest last, deduping an immediate repeat', () => {
    const evs = [ev({ kind: 'thread.op', op: 'new', name: 'The Hunt', note: 'b1', turn: 1 })];
    for (let i = 2; i <= 9; i++) evs.push(ev({ kind: 'thread.op', op: 'advance', name: 'The Hunt', note: 'b' + i, turn: i }));
    evs.push(ev({ kind: 'thread.op', op: 'advance', name: 'The Hunt', note: 'b9', turn: 10 })); // immediate repeat
    const s = reduce(evs);
    expect(s.threads[0]!.beats).toHaveLength(6);
    expect(s.threads[0]!.beats[5]).toBe('b9');
    expect(s.threads[0]!.beats.filter((b) => b === 'b9')).toHaveLength(1); // deduped
  });

  it('merge unions beats and keeps one id', () => {
    const s = reduce([
      ev({ kind: 'thread.op', op: 'new', name: 'Jaime\u2019s Arrival', note: 'a raven', turn: 1 }),
      ev({ kind: 'thread.op', op: 'new', name: 'Jaime at Harrenhal', note: 'he dismounts', turn: 4 }),
      ev({ kind: 'thread.merge', from: ['Jaime at Harrenhal'], into: 'Jaime\u2019s Arrival', turn: 4 } as any),
    ]);
    expect(s.threads).toHaveLength(1);
    expect(s.threads[0]!.id).toBe('thr_jaime_s_arrival'); // target id kept
    expect(s.threads[0]!.beats).toEqual(['a raven', 'he dismounts']); // beats unioned
  });

  it('thread.drop removes by id; thread.set edits/creates by id or name', () => {
    let s = reduce([
      ev({ kind: 'thread.op', op: 'new', name: 'The Vigil', turn: 1 }),
      ev({ kind: 'thread.drop', id: 'thr_the_vigil', src: 'user', turn: 2 } as any),
    ]);
    expect(s.threads).toHaveLength(0);
    // user set: create, then edit by id (rename + status + beat)
    s = reduce([
      ev({ kind: 'thread.set', name: 'The Pact', status: 'advance', src: 'user', turn: 1 } as any),
      ev({ kind: 'thread.set', id: 'thr_the_pact', name: 'The Broken Pact', status: 'resolved', note: 'it fell apart', src: 'user', turn: 2 } as any),
    ]);
    expect(s.threads).toHaveLength(1);
    expect(s.threads[0]!.name).toBe('The Broken Pact');
    expect(s.threads[0]!.status).toBe('resolved');
    expect(s.threads[0]!.beats).toContain('it fell apart');
  });

  it('merge into a NEW target name folds every source into exactly one row', () => {
    // `into` doesn't already exist → keep borrows sources[0]'s id; the source
    // object must still be removed so there's no duplicate.
    const s = reduce([
      ev({ kind: 'thread.op', op: 'new', name: 'Raid at Dawn', turn: 1 }),
      ev({ kind: 'thread.op', op: 'new', name: 'Dawn Assault', turn: 2 }),
      ev({ kind: 'thread.merge', from: ['Raid at Dawn', 'Dawn Assault'], into: 'The Dawn Raid', turn: 3 } as any),
    ]);
    expect(s.threads).toHaveLength(1);
    expect(s.threads[0]!.name).toBe('The Dawn Raid');
  });

  it('a thread.merge repoints an off-screen subplot\u2019s explicit link to the survivor', () => {
    const s = reduce([
      // two threads, then an off-screen subplot explicitly linked to the one that
      // will be merged AWAY
      ev({ kind: 'thread.op', op: 'new', name: 'Jaime\u2019s Arrival', turn: 1 }),
      ev({ kind: 'thread.op', op: 'new', name: 'Jaime at Harrenhal', turn: 2 }),
      ev({ kind: 'offscreen.op', op: 'new', id: 'appt', name: 'The Appointment', gist: 'x', turn: 2 } as any),
      ev({ kind: 'offscreen.link', id: 'appt', thread: 'thr_jaime_at_harrenhal', src: 'user', turn: 2 } as any),
      // merge the linked thread away into the survivor
      ev({ kind: 'thread.merge', from: ['Jaime at Harrenhal'], into: 'Jaime\u2019s Arrival', turn: 3 } as any),
    ]);
    expect(s.threads).toHaveLength(1);
    expect(s.threads[0]!.id).toBe('thr_jaime_s_arrival');
    // the stale link was rewritten to the surviving id — the hole the refactor closes
    expect(s.offscreen[0]!.thread).toBe('thr_jaime_s_arrival');
  });
});

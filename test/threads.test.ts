import { describe, it, expect } from 'vitest';
import { reduce } from '../src/core/reduce.js';
import { buildInjection } from '../src/retrieval/recall.js';
import { parseMergeReply, validateMerges, openTracks } from '../src/domain/thread-merge.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';
import type { VellumEvent } from '../src/core/events.js';

let seq = 0;
const ev = (e: Partial<VellumEvent> & { kind: string }): VellumEvent => ({ seq: ++seq, turn: 1, day: 1, src: 'model', ...(e as any) });

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
      { name: 'Jaime\u2019s Arrival', status: 'sleeping in Harrenhal', firstTurn: 1, lastTurn: 4 },
      { name: 'The Letters', status: 'resolved', firstTurn: 1, lastTurn: 2 },
    ];
    s.arcs = [{ name: 'The Reckoning', status: 'advance', firstTurn: 1, lastTurn: 3 }];
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
      { name: 'old', status: 'advance', firstTurn: 1, lastTurn: 1 },
      { name: 'done', status: 'resolved', firstTurn: 1, lastTurn: 2 },
      { name: 'new', status: 'advance', firstTurn: 1, lastTurn: 5 },
    ];
    expect(openTracks(s, 'threads').map((t) => t.name)).toEqual(['new', 'old']);
  });
});

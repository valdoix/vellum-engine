import { describe, it, expect } from 'vitest';
import { linkedThreads } from '../src/domain/offscreen.js';
import { reduce } from '../src/core/reduce.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';
import type { VellumEvent } from '../src/core/events.js';

let seq = 0;
function ev(e: Partial<VellumEvent> & { kind: VellumEvent['kind'] }): VellumEvent {
  return { seq: ++seq, turn: 1, day: 1, src: 'model', ...(e as object) } as VellumEvent;
}

// Engine-minted ids (thr_ + canonId(name)) — matches what reduce() actually assigns,
// so thread->arc links point at real arc rows rather than dangling snapshot ids.
function mkState(): ChronicleState {
  const s = freshState();
  s.arcs = [
    { id: 'thr_the_siege_of_king_s_landing', name: 'The Siege of King\'s Landing', status: 'advance', beats: ['the walls are encircled'], firstTurn: 1, lastTurn: 5 },
    { id: 'thr_the_letter', name: 'The Letter', status: 'advance', beats: ['B opens it'], firstTurn: 2, lastTurn: 6 },
    { id: 'thr_the_old_plot', name: 'The Old Plot', status: 'resolved', beats: ['done'], firstTurn: 1, lastTurn: 3 },
  ];
  s.threads = [
    { id: 'thr_the_letter_arrives', name: 'The Letter arrives', status: 'advance', beats: ['a courier rides first light', 'the gates are sealed'], firstTurn: 2, lastTurn: 6, arc: 'thr_the_letter' },
    { id: 'thr_the_letter_burns', name: 'The letter burns', status: 'advance', beats: ['fires are lit'], firstTurn: 3, lastTurn: 7, arc: 'thr_the_letter' },
    { id: 'thr_the_siege_escalates', name: 'The Siege escalates', status: 'advance', beats: ['catapults roll'], firstTurn: 4, lastTurn: 8, arc: 'thr_the_siege_of_king_s_landing' },
    { id: 'thr_a_lonely_thread', name: 'A lonely thread', status: 'advance', beats: ['something'], firstTurn: 1, lastTurn: 4 }, // no arc — free
  ];
  return s;
}

describe('linkedThreads (arc <-> thread bridge)', () => {
  it('returns threads explicitly linked to an arc (many -> one)', () => {
    const hits = linkedThreads(mkState(), { id: 'thr_the_letter', name: 'The Letter' });
    expect(hits.map((t) => t.id).sort()).toEqual(['thr_the_letter_arrives', 'thr_the_letter_burns']);
  });

  it('returns a single thread when only one is linked', () => {
    expect(linkedThreads(mkState(), { id: 'thr_the_siege_of_king_s_landing', name: 'The Siege of King\'s Landing' }).map((t) => t.id)).toEqual(['thr_the_siege_escalates']);
  });

  it('returns empty for an arc with no linked threads', () => {
    const s = mkState();
    s.threads = s.threads.filter((t) => t.id !== 'thr_the_siege_escalates');
    expect(linkedThreads(s, { id: 'thr_the_siege_of_king_s_landing', name: 'The Siege of King\'s Landing' })).toEqual([]);
  });

  it('falls back to a soft token-set match when no explicit link exists', () => {
    const s = freshState();
    s.arcs = [{ id: 'thr_the_siege_of_king_s_landing', name: 'The Siege of King\'s Landing', status: 'advance', beats: [], firstTurn: 1, lastTurn: 5 }];
    s.threads = [
      // contains all of the arc's significant tokens (siege, kings, landing)
      { id: 'thr_x', name: 'The Siege of King\'s Landing escalates', status: 'advance', beats: ['x'], firstTurn: 2, lastTurn: 6 },
      // unrelated name — must NOT match
      { id: 'thr_y', name: 'A garden party', status: 'advance', beats: ['y'], firstTurn: 2, lastTurn: 6 },
    ];
    const hits = linkedThreads(s, { id: 'thr_the_siege_of_king_s_landing', name: 'The Siege of King\'s Landing' });
    expect(hits.map((t) => t.id)).toEqual(['thr_x']);
    expect(hits.map((t) => t.id)).not.toContain('thr_y');
  });

  it('does not double-assign a thread that is already explicitly parented elsewhere', () => {
    const s = mkState();
    // soft match would otherwise hit thr_the_siege_escalates against a same-named arc,
    // but it is explicitly parented to thr_the_siege_of_king_s_landing, so it must be excluded.
    const hits = linkedThreads(s, { id: 'thr_the_siege_of_king_s_landing', name: 'The Siege of King\'s Landing' });
    expect(hits.map((t) => t.id)).toEqual(['thr_the_siege_escalates']); // only the explicitly-linked one
  });

  it('requires >=2 significant tokens on the arc side (single shared token never links)', () => {
    const s = freshState();
    s.arcs = [{ id: 'arc_x', name: 'Siege', status: 'advance', beats: [], firstTurn: 1, lastTurn: 5 }];
    s.threads = [{ id: 'thr_x', name: 'The Siege continues', status: 'advance', beats: ['x'], firstTurn: 2, lastTurn: 6 }];
    expect(linkedThreads(s, { id: 'arc_x', name: 'Siege' })).toEqual([]);
  });
});

describe('reduce — thread.set arc link', () => {
  // threads are looked up by NAME below because reduce() assigns each a stable
  // slug id from its name — the id string on thread.set is a lookup hint, not a new id.
  const byThreadName = (s: ChronicleState, n: string) => s.threads.find((t) => t.name === n)!;

  it('sets a parent-arc link via thread.set with arc', () => {
    const s = reduce([
      ev({ kind: 'thread.set', name: 'A lonely thread', arc: 'arc_the_letter' }),
    ]);
    expect(byThreadName(s, 'A lonely thread').arc).toBe('arc_the_letter');
  });

  it('clears a parent-arc link via thread.set with empty arc', () => {
    const s = reduce([
      ev({ kind: 'thread.set', name: 'A lonely thread', arc: 'arc_the_letter' }),
      ev({ kind: 'thread.set', name: 'A lonely thread', arc: '' }),
    ]);
    expect(byThreadName(s, 'A lonely thread').arc).toBeUndefined();
  });

  it('only applies the arc link for threads (never for arcs via kindArc)', () => {
    const s = reduce([
      ev({ kind: 'thread.set', name: 'Free-Standing Arc', arc: 'arc_other', kindArc: true }),
    ]);
    // kindArc=true routes to arcs[]; the arc field must NOT attach (an arc is never parented to another)
    expect((s.arcs.find((a) => a.name === 'Free-Standing Arc') as any).arc).toBeUndefined();
  });

  it('arc.drop unparents threads that belonged to the dropped arc', () => {
    const base = reduce(sToEvents(mkState()));        // real board w/ real minted ids
    const dropId = base.arcs.find((a) => a.name === 'The Letter')!.id;
    const after = reduce([ev({ kind: 'arc.drop', id: dropId })], base);
    expect(byThreadName(after, 'The Letter arrives').arc).toBeUndefined();
    expect(byThreadName(after, 'The letter burns').arc).toBeUndefined();
    // unrelated arc's thread is untouched
    const siegeThreadId = base.arcs.find((a) => a.name === 'The Siege of King\'s Landing')!.id;
    expect(byThreadName(after, 'The Siege escalates').arc).toBe(siegeThreadId);
  });

  it('arc.merge repoints thread.arc at the survivor', () => {
    const base = reduce(sToEvents(mkState()));
    const after = reduce([ev({ kind: 'arc.merge', from: ['The Letter'], into: 'The Siege of King\'s Landing' })], base);
    // the survivor keeps its id; letter-threads are repointed onto it
    const survivor = base.arcs.find((a) => a.name === 'The Siege of King\'s Landing')!.id;
    expect(byThreadName(after, 'The Letter arrives').arc).toBe(survivor);
    expect(byThreadName(after, 'The Siege escalates').arc).toBe(survivor);
  });

  it('thread.merge keeps the arc link on the survivor', () => {
    const s = reduce([
      ev({ kind: 'thread.set', name: 'A', arc: 'arc_the_siege' }),
      ev({ kind: 'thread.set', name: 'B', arc: 'arc_the_siege' }),
      ev({ kind: 'thread.merge', from: ['B'], into: 'A' }),
    ]);
    const survivor = byThreadName(s, 'A');
    expect(s.threads).toHaveLength(1);
    expect(survivor.arc).toBe('arc_the_siege');
  });
});

// ---- helpers --------------------------------------------------------------------------

// Re-emit a built state's threads + arcs as the events that produced them, so a fresh
// reduce() reproduces the same board before we append the operation under test. Uses
// thread.set (carries `arc` in the mint path) for threads so their parent-arc links
// survive the replay.
function sToEvents(s: ChronicleState): VellumEvent[] {
  // Both arcs (kindArc:true) and threads mint engine slug ids from their name. Arcs first,
  // so a thread's parent-arc link resolves against a minted (real) arc id. Drop/merge
  // tests then operate on the live board via a two-step reduce.
  return [
    ...s.arcs.map((a) => ev({ kind: 'thread.set', name: a.name, status: a.status, kindArc: true }) as VellumEvent),
    ...s.threads.map((t) => ev({ kind: 'thread.set', name: t.name, ...(t.arc ? { arc: t.arc } : {}) }) as VellumEvent),
  ];
}

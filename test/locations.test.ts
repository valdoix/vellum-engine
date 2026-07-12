import { describe, it, expect } from 'vitest';
import { reduce } from '../src/core/reduce.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';
import { injectableLocations } from '../src/domain/locations.js';

// Replay location.set/drop events through the reducer to assert the split model
// (source = provenance, pinned = injection) resolves correctly, including the
// legacy-compat path where old events only carry `auto`.
function replay(events: any[]): ChronicleState {
  let s = freshState();
  for (const e of events) s = reduce([{ seq: 1, src: 'system', turn: 1, day: 0, ...e }], s);
  return s;
}
const loc = (s: ChronicleState, id: string) => s.locations.find((l) => l.id === id)!;

describe('location.set — new split model (source + pinned)', () => {
  it('a new auto-collected place is source:auto, pinned:false', () => {
    const s = replay([{ kind: 'location.set', id: 'a', name: 'Harrenhal', source: 'auto', pinned: false }]);
    expect(loc(s, 'a')).toMatchObject({ source: 'auto', pinned: false });
  });

  it('a user-created place is source:user, pinned:false (keyed by default)', () => {
    const s = replay([{ kind: 'location.set', id: 'a', name: 'The Docks', src: 'user', source: 'user', pinned: false }]);
    expect(loc(s, 'a')).toMatchObject({ source: 'user', pinned: false });
  });

  it('pinning toggles pinned WITHOUT changing source', () => {
    const s = replay([
      { kind: 'location.set', id: 'a', name: 'Harrenhal', source: 'auto', pinned: false },
      { kind: 'location.set', id: 'a', name: 'Harrenhal', src: 'user', pinned: true },
    ]);
    expect(loc(s, 'a')).toMatchObject({ source: 'auto', pinned: true });
  });

  it('unpinning a model place reverts it to showing auto (source preserved)', () => {
    const s = replay([
      { kind: 'location.set', id: 'a', name: 'Harrenhal', source: 'auto', pinned: true },
      { kind: 'location.set', id: 'a', name: 'Harrenhal', src: 'user', pinned: false },
    ]);
    expect(loc(s, 'a')).toMatchObject({ source: 'auto', pinned: false });
  });

  it('a user CONTENT edit (note/parent) flips a model place to source:user', () => {
    const s = replay([
      { kind: 'location.set', id: 'a', name: 'Harrenhal', source: 'auto', pinned: false },
      { kind: 'location.set', id: 'a', name: 'Harrenhal', src: 'user', note: 'ruined keep' },
    ]);
    expect(loc(s, 'a').source).toBe('user');
  });

  it('an auto refresh never overwrites a user-owned source or unpins', () => {
    const s = replay([
      { kind: 'location.set', id: 'a', name: 'Harrenhal', src: 'user', source: 'user', pinned: true },
      // later auto-collect from a scene visit
      { kind: 'location.set', id: 'a', name: 'Harrenhal', src: 'system', source: 'auto', pinned: false },
    ]);
    expect(loc(s, 'a')).toMatchObject({ source: 'user', pinned: true });
  });
});

describe('location.set — legacy compat (events carry only `auto`)', () => {
  it('legacy auto:true maps to source:auto, pinned:false', () => {
    const s = replay([{ kind: 'location.set', id: 'a', name: 'Harrenhal', auto: true }]);
    expect(loc(s, 'a')).toMatchObject({ source: 'auto', pinned: false });
  });

  it('legacy auto:false (old "pinned & sticky") maps to source:user, pinned:true', () => {
    const s = replay([{ kind: 'location.set', id: 'a', name: 'The Docks', src: 'user', auto: false }]);
    expect(loc(s, 'a')).toMatchObject({ source: 'user', pinned: true });
  });

  it('a log mixing legacy then new events resolves to the new event', () => {
    const s = replay([
      { kind: 'location.set', id: 'a', name: 'Harrenhal', auto: true },       // legacy → auto/unpinned
      { kind: 'location.set', id: 'a', name: 'Harrenhal', src: 'user', pinned: true }, // pin it
    ]);
    expect(loc(s, 'a')).toMatchObject({ source: 'auto', pinned: true });
  });
});

describe('injectableLocations — pinned always kept, rest recency-capped', () => {
  it('keeps all pinned places even past the cap; fills room with most-recent rest', () => {
    const s = freshState();
    s.locations = [
      { id: 'p1', name: 'Pinned 1', pinned: true, source: 'user', firstTurn: 1, lastTurn: 1 },
      { id: 'p2', name: 'Pinned 2', pinned: true, source: 'auto', firstTurn: 1, lastTurn: 2 },
      { id: 'r1', name: 'Recent', pinned: false, source: 'auto', firstTurn: 1, lastTurn: 20 },
      { id: 'r2', name: 'Stale', pinned: false, source: 'auto', firstTurn: 1, lastTurn: 3 },
    ];
    const out = injectableLocations(s, 3);
    const ids = out.map((l) => l.id);
    expect(ids).toContain('p1'); // pinned always kept
    expect(ids).toContain('p2'); // pinned always kept
    expect(ids).toContain('r1'); // most-recent unpinned fills remaining room
    expect(ids).not.toContain('r2'); // stale unpinned dropped by the cap
  });

  it('under the cap, returns everything recency-sorted', () => {
    const s = freshState();
    s.locations = [
      { id: 'a', name: 'A', pinned: false, source: 'auto', firstTurn: 1, lastTurn: 2 },
      { id: 'b', name: 'B', pinned: false, source: 'auto', firstTurn: 1, lastTurn: 9 },
    ];
    const out = injectableLocations(s, 12);
    expect(out.map((l) => l.id)).toEqual(['b', 'a']); // most-recent first
  });

  it('legacy unpinned auto places are recency-capped (no forced injection)', () => {
    const s = freshState();
    // simulate legacy rows that only had auto:true (→ pinned undefined, treated unpinned)
    s.locations = Array.from({ length: 20 }, (_, i) => ({
      id: 'l' + i, name: 'Place ' + i, auto: true, firstTurn: 1, lastTurn: i,
    })) as any;
    const out = injectableLocations(s, 5);
    expect(out.length).toBe(5); // capped, none forced-in
  });
});

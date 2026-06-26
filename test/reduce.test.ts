import { describe, it, expect } from 'vitest';
import { reduce } from '../src/core/reduce.js';
import type { VellumEvent } from '../src/core/events.js';

// helper to stamp the common base fields
let seq = 0;
function ev(e: Partial<VellumEvent> & { kind: VellumEvent['kind'] }): VellumEvent {
  return { seq: ++seq, turn: 1, day: 1, src: 'model', ...(e as object) } as VellumEvent;
}

describe('reduce — relations', () => {
  it('forms a bond and evolves its category set in place (one edge per pair)', () => {
    const events: VellumEvent[] = [
      ev({ kind: 'bond.delta', a: 'cersei', b: 'jaime', aff: 20, trust: 10, addCats: ['social'] }),
      ev({ kind: 'bond.delta', a: 'jaime', b: 'cersei', aff: 30, addCats: ['romantic'] }), // reverse order, same pair
    ];
    const s = reduce(events);
    expect(s.relations).toHaveLength(1); // identity is the pair, not pair+category
    const r = s.relations[0]!;
    expect(r.categories).toContain('romantic');
    expect(r.categories).toContain('social');
    expect(r.category).toBe('romantic'); // primary = highest rank
    expect(r.affection).toBe(50); // 20 + 30 accumulated
  });

  it('auto source cannot silently strip an established facet; user can', () => {
    const auto = reduce([
      ev({ kind: 'bond.delta', a: 'a', b: 'b', addCats: ['romantic'] }),
      ev({ kind: 'bond.delta', a: 'a', b: 'b', removeCats: ['romantic'], src: 'living' }),
    ]);
    expect(auto.relations[0]!.categories).toContain('romantic'); // auto blocked

    const user = reduce([
      ev({ kind: 'bond.delta', a: 'a', b: 'b', addCats: ['romantic'] }),
      ev({ kind: 'bond.delta', a: 'a', b: 'b', removeCats: ['romantic'], src: 'user' }),
    ]);
    expect(user.relations[0]!.categories).not.toContain('romantic'); // user allowed
  });

  it('user-edited bond is protected from later auto deltas', () => {
    const s = reduce([
      ev({ kind: 'bond.delta', a: 'a', b: 'b', aff: 50, src: 'user' }),
      ev({ kind: 'bond.delta', a: 'a', b: 'b', aff: -90, src: 'living' }),
    ]);
    expect(s.relations[0]!.affection).toBe(50); // auto delta ignored on user-locked edge
  });

  it('records a score history sample per change (powers the scrubber)', () => {
    const s = reduce([
      ev({ kind: 'bond.delta', a: 'a', b: 'b', aff: 10, turn: 1 }),
      ev({ kind: 'bond.delta', a: 'a', b: 'b', aff: 20, turn: 5 }),
    ]);
    expect(s.relations[0]!.history.length).toBe(2);
    expect(s.relations[0]!.history[1]!.turn).toBe(5);
  });
});

describe('reduce — cast, knowledge, secrets, memory', () => {
  it('tracks cast and drops cascade to relations', () => {
    const s = reduce([
      ev({ kind: 'cast.seen', id: 'ned', name: 'Ned Stark', status: 'present' }),
      ev({ kind: 'cast.seen', id: 'jon', name: 'Jon Snow', status: 'active' }),
      ev({ kind: 'bond.delta', a: 'ned', b: 'jon', addCats: ['familial'] }),
      ev({ kind: 'cast.drop', id: 'ned' }),
    ]);
    expect(s.cast.ned).toBeUndefined();
    expect(s.relations).toHaveLength(0); // edge removed with the node
  });

  it('dedupes knowledge and reveals secrets', () => {
    const s = reduce([
      ev({ kind: 'knowledge.learn', who: 'cersei', fact: 'the children are not the king\u2019s' }),
      ev({ kind: 'knowledge.learn', who: 'cersei', fact: 'the children are not the king\u2019s' }),
      ev({ kind: 'secret.form', id: 's1', keeper: 'cersei', from: ['robert'], text: 'incest' }),
      ev({ kind: 'secret.reveal', id: 's1', to: ['ned'] }),
    ]);
    expect(s.knowledge).toHaveLength(1);
    expect(s.secrets[0]!.revealed).toBe(true);
    expect(s.secrets[0]!.revealedTo).toContain('ned');
  });
});

describe('reduce — incremental folding', () => {
  it('folding new events onto a prior snapshot equals a full reduce', () => {
    const all: VellumEvent[] = [
      ev({ kind: 'bond.delta', a: 'a', b: 'b', aff: 10 }),
      ev({ kind: 'bond.delta', a: 'a', b: 'b', aff: 10 }),
      ev({ kind: 'bond.delta', a: 'a', b: 'b', aff: 10 }),
    ];
    const full = reduce(all);
    const partial = reduce(all.slice(0, 2));
    const incremental = reduce(all, partial, 2); // fold only the 3rd onto the snapshot
    expect(incremental.relations[0]!.affection).toBe(full.relations[0]!.affection);
  });
});

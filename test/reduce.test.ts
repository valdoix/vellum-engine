import { describe, it, expect } from 'vitest';
import { reduce } from '../src/core/reduce.js';
import type { VellumEvent } from '../src/core/events.js';

// helper to stamp the common base fields
let seq = 0;
function ev(e: Partial<VellumEvent> & { kind: VellumEvent['kind'] }): VellumEvent {
  return { seq: ++seq, turn: 1, day: 1, src: 'model', ...(e as object) } as VellumEvent;
}

describe('reduce — relations', () => {
  it('relationships are directional: a→b and b→a are independent edges', () => {
    const events: VellumEvent[] = [
      ev({ kind: 'bond.delta', a: 'cersei', b: 'jaime', aff: 20, trust: 10, addCats: ['social'] }),
      ev({ kind: 'bond.delta', a: 'jaime', b: 'cersei', aff: -30, addCats: ['rivalry'] }), // reverse order = distinct edge
    ];
    const s = reduce(events);
    expect(s.relations).toHaveLength(2); // directional identity
    const cj = s.relations.find((r) => r.a === 'cersei' && r.b === 'jaime')!;
    const jc = s.relations.find((r) => r.a === 'jaime' && r.b === 'cersei')!;
    expect(cj.affection).toBe(20);
    expect(jc.affection).toBe(-30);
    expect(cj.categories).toContain('social');
    expect(jc.categories).toContain('rivalry');
  });

  it('accumulates same-direction deltas in place', () => {
    const s = reduce([
      ev({ kind: 'bond.delta', a: 'a', b: 'b', aff: 20, addCats: ['social'] }),
      ev({ kind: 'bond.delta', a: 'a', b: 'b', aff: 30, addCats: ['romantic'] }),
    ]);
    expect(s.relations).toHaveLength(1);
    expect(s.relations[0]!.affection).toBe(50);
    expect(s.relations[0]!.category).toBe('romantic');
  });

  it('bond.drop is directed; both:true clears the reciprocal too', () => {
    const base: VellumEvent[] = [
      ev({ kind: 'bond.delta', a: 'a', b: 'b', aff: 10 }),
      ev({ kind: 'bond.delta', a: 'b', b: 'a', aff: -10 }),
    ];
    const directed = reduce([...base, ev({ kind: 'bond.drop', a: 'a', b: 'b' })]);
    expect(directed.relations).toHaveLength(1);
    expect(directed.relations[0]!.a).toBe('b');

    const both = reduce([...base, ev({ kind: 'bond.drop', a: 'a', b: 'b', both: true })]);
    expect(both.relations).toHaveLength(0);
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

  it('Fix 22: cast.edit changes only allowed fields, protects identity keys', () => {
    const s = reduce([
      ev({ kind: 'cast.seen', id: 'ned', name: 'Ned Stark', status: 'present' }),
      ev({ kind: 'cast.edit', id: 'ned', patch: { id: 'x', source: 'user', firstTurn: 99, role: 'King' } as any, src: 'user' }),
    ]);
    expect(s.cast.ned!.role).toBe('King');
    expect(s.cast.ned!.id).toBe('ned'); // identity untouched
    expect(s.cast.ned!.source).toBe('auto'); // protected
    expect(s.cast.ned!.firstTurn).toBe(1); // protected
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

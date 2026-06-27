import { describe, it, expect } from 'vitest';
import { resolveCastId } from '../src/domain/identity.js';
import { coreFeature } from '../src/domain/core-feature.js';
import { reduce } from '../src/core/reduce.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';

function withCast(...names: Array<[string, string[]?]>): ChronicleState {
  const s = freshState();
  for (const [name, aka] of names) {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    s.cast[id] = { id, name, aka: aka ?? [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false };
  }
  return s;
}

describe('resolveCastId — alias / identity merge', () => {
  it('exact id hit returns that id', () => {
    expect(resolveCastId(withCast(['Cersei Lannister']), 'Cersei Lannister')).toBe('cersei_lannister');
  });

  it('merges a short name onto an existing fuller name (token prefix)', () => {
    const s = withCast(['Cersei Lannister']);
    expect(resolveCastId(s, 'Cersei')).toBe('cersei_lannister'); // not a new `cersei`
  });

  it('merges a fuller name onto an existing short name', () => {
    const s = withCast(['Cersei']);
    expect(resolveCastId(s, 'Cersei Lannister')).toBe('cersei');
  });

  it('does NOT merge on a non-token substring (jon ⊄ jonas)', () => {
    const s = withCast(['Jonas']);
    expect(resolveCastId(s, 'Jon')).toBe('jon'); // distinct
  });

  it('does NOT merge when the prefix is ambiguous (two candidates)', () => {
    const s = withCast(['Cersei Lannister'], ); // single
    s.cast.cersei_baratheon = { id: 'cersei_baratheon', name: 'Cersei Baratheon', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false };
    expect(resolveCastId(s, 'Cersei')).toBe('cersei'); // ambiguous → fresh id, no wrong merge
  });

  it('resolves via aka', () => {
    const s = withCast(['Daeron Targaryen', ['the stranger']]);
    expect(resolveCastId(s, 'The Stranger')).toBe('daeron_targaryen');
  });
});

describe('fold dedup — bonds do not split a character across two ids', () => {
  let seq = 0;
  const ctx = (state: ChronicleState, turn: number) => ({ turn, day: 1, state, seq: () => ++seq });

  it('a bond using the short name targets the same id as the established full name', () => {
    // turn 1: full name seen + bond
    let s = reduce(coreFeature.extract!({
      present: [{ name: 'Cersei Lannister' }, { name: 'Daeron' }],
      delta: { bonds: [{ a: 'Cersei Lannister', b: 'Daeron', aff: 10 }] },
    } as any, ctx(freshState(), 1)));
    expect(s.relations).toHaveLength(1);

    // turn 2: model uses the SHORT name for the same person + same partner
    s = reduce(coreFeature.extract!({
      delta: { bonds: [{ a: 'Cersei', b: 'Daeron', aff: 5 }] },
    } as any, ctx(s, 2)), s, 0);

    // still ONE relation (cersei_lannister → daeron), accumulated — not a duplicate
    expect(s.relations).toHaveLength(1);
    expect(s.relations[0]!.a).toBe('cersei_lannister');
    expect(s.relations[0]!.affection).toBe(15);
    expect(Object.keys(s.cast).sort()).toEqual(['cersei_lannister', 'daeron']);
  });
});

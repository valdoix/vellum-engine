import { describe, it, expect } from 'vitest';
import { rrf } from '../src/retrieval/fuse.js';

describe('reciprocal rank fusion', () => {
  it('rewards items ranked highly across lists', () => {
    const out = rrf([
      { ids: ['a', 'b', 'c'] },
      { ids: ['b', 'a', 'd'] },
    ]);
    // a (ranks 0,1) and b (ranks 1,0) should top; both beat c/d (one list only)
    const top2 = out.slice(0, 2).map((r) => r.id).sort();
    expect(top2).toEqual(['a', 'b']);
  });

  it('honors per-list weight (lexical kept dominant for name precision)', () => {
    const out = rrf([
      { ids: ['name', 'x'], weight: 1.1 }, // lexical
      { ids: ['x', 'name'], weight: 1.0 }, // vector
    ]);
    expect(out[0]!.id).toBe('name'); // the weighted list tips the tie
  });

  it('handles a single list (vector unavailable → lexical only)', () => {
    const out = rrf([{ ids: ['a', 'b', 'c'] }]);
    expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('is empty for no input', () => {
    expect(rrf([])).toHaveLength(0);
  });
});

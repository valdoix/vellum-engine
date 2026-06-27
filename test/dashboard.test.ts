import { describe, it, expect } from 'vitest';
import { latestKnowledge, latestSecret } from '../src/ui/dashboard.js';
import { freshState } from '../src/domain/types.js';

describe('Fix 23 — dashboard latest by turn (not array tail)', () => {
  it('latestKnowledge picks max turn regardless of insertion order', () => {
    const s = freshState();
    s.knowledge = [
      { id: 'k1', who: 'a', fact: 'old', turn: 2 },
      { id: 'k2', who: 'b', fact: 'newest', turn: 9 },
      { id: 'k3', who: 'c', fact: 'mid', turn: 5 }, // tail, but not newest by turn
    ];
    expect(latestKnowledge(s)?.id).toBe('k2');
  });

  it('latestSecret picks max formedTurn', () => {
    const s = freshState();
    s.secrets = [
      { id: 's1', keeper: 'a', from: [], text: 'old', revealed: false, revealedTo: [], formedTurn: 3 },
      { id: 's2', keeper: 'b', from: [], text: 'newest', revealed: false, revealedTo: [], formedTurn: 8 },
      { id: 's3', keeper: 'c', from: [], text: 'mid', revealed: false, revealedTo: [], formedTurn: 6 },
    ];
    expect(latestSecret(s)?.id).toBe('s2');
  });

  it('returns undefined when empty', () => {
    const s = freshState();
    expect(latestKnowledge(s)).toBeUndefined();
    expect(latestSecret(s)).toBeUndefined();
  });
});

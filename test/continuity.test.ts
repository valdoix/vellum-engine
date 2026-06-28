import { describe, it, expect } from 'vitest';
import { checkContinuity } from '../src/domain/continuity.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';
import type { VellumEvent } from '../src/core/events.js';

function state(): ChronicleState {
  const s = freshState();
  s.cast = { cersei: { id: 'cersei', name: 'Cersei', aka: [], status: 'present', source: 'auto', firstTurn: 1, lastTurn: 5, userEdited: false } } as any;
  s.secrets = [{ id: 'sec1', keeper: 'cersei', text: 'poisoned the maester', from: [], formedTurn: 2, revealed: false, revealedTo: [] }] as any;
  s.knowledge = [{ id: 'k1', who: 'cersei', fact: 'the tunnel exists', turn: 3, reliability: 'knows', truth: 'true' }] as any;
  return s;
}

describe('continuity alarm', () => {
  it('flags revealing a secret that is not tracked', () => {
    const w = checkContinuity([{ kind: 'secret.reveal', id: 'ghost', to: [] }] as unknown as VellumEvent[], state());
    expect(w.some((x) => x.kind === 'unknown_secret')).toBe(true);
  });

  it('flags revealing an already-revealed secret', () => {
    const s = state(); s.secrets[0]!.revealed = true;
    const w = checkContinuity([{ kind: 'secret.reveal', id: 'sec1', to: [] }] as unknown as VellumEvent[], s);
    expect(w.some((x) => x.kind === 'already_revealed')).toBe(true);
  });

  it('does not flag a legitimate first reveal', () => {
    const w = checkContinuity([{ kind: 'secret.reveal', id: 'sec1', to: [] }] as unknown as VellumEvent[], state());
    expect(w).toHaveLength(0);
  });

  it('flags re-learning a fact already held (verbatim, case-insensitive)', () => {
    const w = checkContinuity([{ kind: 'knowledge.learn', who: 'cersei', fact: 'The Tunnel Exists' }] as unknown as VellumEvent[], state());
    expect(w.some((x) => x.kind === 'redundant_knowledge')).toBe(true);
  });

  it('does not flag genuinely new knowledge', () => {
    const w = checkContinuity([{ kind: 'knowledge.learn', who: 'cersei', fact: 'a new fact' }] as unknown as VellumEvent[], state());
    expect(w).toHaveLength(0);
  });
});

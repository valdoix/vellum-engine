import { describe, expect, it } from 'vitest';
import { repairSecretAudiences, SECRET_AUDIENCE_LIMIT } from '../src/domain/secret-audience.js';
import { freshState } from '../src/domain/types.js';

describe('secret audience repair', () => {
  it('repairs damaged derived state loaded from an older event log', () => {
    const state = freshState();
    state.secrets = [{
      id: 'sec_loop', keeper: 'cersei', text: 'the key is hidden', revealed: true,
      from: ['cersei', 'jaime', ...Array.from({ length: 100 }, () => 'cersei'), 'unspecified'],
      revealedTo: ['jaime', 'jaime'], formedTurn: 1,
    }];
    const repaired = repairSecretAudiences(state);
    expect(repaired.secrets[0]).toMatchObject({ from: [], revealedTo: ['jaime'] });
    expect(repaired).not.toBe(state);
  });

  it('caps a genuinely distinct individual audience deterministically', () => {
    const state = freshState();
    state.secrets = [{
      id: 'sec_crowd', keeper: 'keeper', text: 'the key is hidden', revealed: false,
      from: Array.from({ length: 60 }, (_, index) => `person_${index}`), revealedTo: [], formedTurn: 1,
    }];
    expect(repairSecretAudiences(state).secrets[0]!.from).toHaveLength(SECRET_AUDIENCE_LIMIT);
  });
});

import { describe, it, expect } from 'vitest';
import { notAName, notAFactionName } from '../src/domain/identity.js';

// Repro: the extractor is emitting RELATIONSHIP abstractions and WORLD/concept
// phrases as if they were characters or factions. They must be rejected by both
// the character guard (notAName) and the faction guard (notAFactionName).
describe('non-entity names must be rejected (repro)', () => {
  const NOT_ENTITIES = [
    'Daeron and Jaime Friendship',
    'Daeron and Jaime',
    "Cersei's Bond with Jaime",
    'The World At Large',
    'The Situation',
    'Stark vs Lannister',
    'The Rivalry',
    'Daeron & Jaime',
  ];
  for (const n of NOT_ENTITIES) {
    it(`rejects "${n}" as a character`, () => { expect(notAName(n)).toBe(true); });
    it(`rejects "${n}" as a faction`, () => { expect(notAFactionName(n)).toBe(true); });
  }
});

describe('real entities must still pass', () => {
  const ENTITIES_CHAR = ['Daeron', 'Cersei Lannister', 'The Stranger', 'Anne'];
  const ENTITIES_FACTION = ['House Lannister', 'The Alliance', 'The Kingsguard', 'The Night\u2019s Watch'];
  for (const n of ENTITIES_CHAR) it(`keeps character "${n}"`, () => { expect(notAName(n)).toBe(false); });
  for (const n of ENTITIES_FACTION) it(`keeps faction "${n}"`, () => { expect(notAFactionName(n)).toBe(false); });
});

import { describe, it, expect } from 'vitest';
import { notAName, notAFactionName } from '../src/domain/identity.js';
import { reduce } from '../src/core/reduce.js';
import { freshState } from '../src/domain/types.js';
import { coreFeature } from '../src/domain/core-feature.js';
import type { ParsedState } from '../src/parse/parsed.js';
import { nextSeq } from '../src/core/ids.js';

// Repro: the AI model sometimes emits possessive DESCRIPTIONS (e.g. "Daeron's
// Secret Research", "Daeron's Camp", "Rhaella's Letter") and hypothetical
// concepts ("The Future With Children") as if they were character names,
// minting junk cast cards like "Daeron S Camp". A PERSON is never named with a
// possessive apostrophe-s, so ANY "X's Y" is rejected as a character (kinship
// included). Factions keep the looser rule so proper-noun groups like "The
// Night's Watch" / "King's Landing" still resolve.

describe('possessive junk phrases must be rejected as characters', () => {
  const POSSESSIVE_JUNK = [
    "Daeron's Secret Research",
    "Cersei's Private Study",
    "Jaime's Golden Hand",
    "Tyrion's Wine Collection",
    "Daeron's Camp",
    "Rhaella's Letter",
    // kinship possessives are now rejected too (per policy)
    "Cersei's father",
    "Daeron's mother",
    "Jaime's son",
  ];
  for (const n of POSSESSIVE_JUNK) {
    it(`rejects "${n}" as a character`, () => { expect(notAName(n)).toBe(true); });
  }
  // curly-apostrophe variant must also be caught
  it('rejects a curly-apostrophe possessive', () => { expect(notAName('Daeron\u2019s Camp')).toBe(true); });
});

describe('multi-word possessive descriptions are rejected as factions too', () => {
  const FACTION_JUNK = ["Daeron's Secret Research", "Tyrion's Wine Collection"];
  for (const n of FACTION_JUNK) {
    it(`rejects "${n}" as a faction`, () => { expect(notAFactionName(n)).toBe(true); });
  }
});

describe('hypothetical/abstract "with" concepts must be rejected', () => {
  for (const n of ["The Future With Children", "Cersei's Bond with Jaime"]) {
    it(`rejects "${n}" as a character`, () => { expect(notAName(n)).toBe(true); });
  }
});

describe('project/topic phrases must be rejected as characters', () => {
  const TOPIC_JUNK = [
    'Harrenhal Restoration',
    'Harrenhal Restoration Scope',
    'Harrenhal Restoration Plans',
    'Harrenhal Plumbing',
    'The Wall Reconstruction',
    'Winterfell Repairs',
  ];
  for (const n of TOPIC_JUNK) {
    it(`rejects "${n}" as a character`, () => { expect(notAName(n)).toBe(true); });
  }
});

describe('legitimate names must still pass', () => {
  // proper-noun possessive FACTIONS still resolve
  for (const n of ["The Night's Watch", "King's Landing"]) {
    it(`keeps faction "${n}"`, () => { expect(notAFactionName(n)).toBe(false); });
  }
  // a plain personal name with a middle initial (no apostrophe) is unaffected
  for (const n of ['George S Patton', 'Daeron', 'Anne', 'Daeron Targaryen', 'Robert Baratheon']) {
    it(`keeps character "${n}"`, () => { expect(notAName(n)).toBe(false); });
  }
  // a lone topic word is NOT a character phrase — it still resolves as a faction
  // (e.g. "The Restoration" as a political movement)
  for (const n of ['The Restoration', 'Restoration']) {
    it(`keeps faction "${n}"`, () => { expect(notAFactionName(n)).toBe(false); });
  }
});

describe('end-to-end: possessive junk does not mint cast cards', () => {
  it('rejects "Daeron\'s Secret Research" from present list', () => {
    const parsed: ParsedState = { present: [{ name: "Daeron's Secret Research" }], delta: {} };
    const ctx = { state: freshState(), seq: nextSeq, turn: 1, day: 1 };
    const events = coreFeature.extract!(parsed, ctx);
    const s = reduce(events, ctx.state);
    // No cast card should exist for the junk phrase
    expect(Object.keys(s.cast)).not.toContain('daeron_s_secret_research');
    expect(Object.values(s.cast).map(c => c.name)).not.toContain("Daeron S Secret Research");
  });

  it('rejects "Cersei\'s Private Study" from a bond endpoint', () => {
    const parsed: ParsedState = {
      present: [{ name: 'Daeron' }],
      delta: { bonds: [{ a: 'Daeron', b: "Cersei's Private Study", aff: 5 }] },
    };
    const ctx = { state: freshState(), seq: nextSeq, turn: 1, day: 1 };
    const events = coreFeature.extract!(parsed, ctx);
    const s = reduce(events, ctx.state);
    // Daeron should exist, but not the junk phrase
    expect(s.cast.daeron).toBeDefined();
    expect(Object.keys(s.cast)).not.toContain('cersei_s_private_study');
    // No bond should be created (one endpoint was rejected)
    expect(s.relations).toHaveLength(0);
  });

  it('rejects "Daeron\'s Camp" from present list (no junk card)', () => {
    const parsed: ParsedState = { present: [{ name: "Daeron's Camp" }], delta: {} };
    const ctx = { state: freshState(), seq: nextSeq, turn: 1, day: 1 };
    const events = coreFeature.extract!(parsed, ctx);
    const s = reduce(events, ctx.state);
    expect(Object.keys(s.cast)).not.toContain('daeron_s_camp');
    expect(Object.values(s.cast).map((c) => c.name)).not.toContain('Daeron S Camp');
  });

  it('rejects "Cersei\'s father" as a character (kinship possessive)', () => {
    const parsed: ParsedState = { present: [{ name: "Cersei's father" }], delta: {} };
    const ctx = { state: freshState(), seq: nextSeq, turn: 1, day: 1 };
    const events = coreFeature.extract!(parsed, ctx);
    const s = reduce(events, ctx.state);
    // No longer mints a card — a person is never named with a possessive
    expect(s.cast.cersei_s_father).toBeUndefined();
  });
});

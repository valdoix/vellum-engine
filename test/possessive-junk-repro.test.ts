import { describe, it, expect } from 'vitest';
import { notAName, notAFactionName } from '../src/domain/identity.js';
import { reduce } from '../src/core/reduce.js';
import { freshState } from '../src/domain/types.js';
import { coreFeature } from '../src/domain/core-feature.js';
import type { ParsedState } from '../src/parse/parsed.js';
import { nextSeq } from '../src/core/ids.js';

// Repro: the AI model sometimes emits possessive DESCRIPTIONS (e.g. "Daeron's
// Secret Research", "Cersei's Private Study") as if they were character names,
// minting junk cast cards like "Daeron S Secret Research". The fix rejects any
// possessive phrase where the thing described is 2+ words (contains underscore
// after "_s_" in the canonical id), while still allowing legitimate single-word
// possessives like "Cersei's father" (a distinct person) or "The Night's Watch"
// (a proper-noun faction).

describe('possessive junk phrases must be rejected', () => {
  const POSSESSIVE_JUNK = [
    "Daeron's Secret Research",
    "Cersei's Private Study",
    "Jaime's Golden Hand",
    "Tyrion's Wine Collection",
  ];
  for (const n of POSSESSIVE_JUNK) {
    it(`rejects "${n}" as a character`, () => { expect(notAName(n)).toBe(true); });
    it(`rejects "${n}" as a faction`, () => { expect(notAFactionName(n)).toBe(true); });
  }
});

describe('legitimate possessive names must still pass', () => {
  const VALID_POSSESSIVES_CHAR = ["Cersei's father", "Daeron's mother", "Jaime's son"];
  const VALID_POSSESSIVES_FACTION = ["The Night's Watch", "King's Landing"];
  for (const n of VALID_POSSESSIVES_CHAR) {
    it(`keeps character "${n}"`, () => { expect(notAName(n)).toBe(false); });
  }
  for (const n of VALID_POSSESSIVES_FACTION) {
    it(`keeps faction "${n}"`, () => { expect(notAFactionName(n)).toBe(false); });
  }
});

describe('end-to-end: possessive junk does not mint cast cards', () => {
  it('rejects "Daeron\'s Secret Research" from present list', () => {
    const parsed: ParsedState = { present: [{ name: "Daeron's Secret Research" }], delta: {} };
    const ctx = { state: freshState(), seq: nextSeq, turn: 1, day: 1 };
    const events = coreFeature.extract(parsed, ctx);
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
    const events = coreFeature.extract(parsed, ctx);
    const s = reduce(events, ctx.state);
    // Daeron should exist, but not the junk phrase
    expect(s.cast.daeron).toBeDefined();
    expect(Object.keys(s.cast)).not.toContain('cersei_s_private_study');
    // No bond should be created (one endpoint was rejected)
    expect(s.relations).toHaveLength(0);
  });

  it('allows "Cersei\'s father" as a legitimate distinct character', () => {
    const parsed: ParsedState = { present: [{ name: "Cersei's father" }], delta: {} };
    const ctx = { state: freshState(), seq: nextSeq, turn: 1, day: 1 };
    const events = coreFeature.extract(parsed, ctx);
    const s = reduce(events, ctx.state);
    // This SHOULD mint a cast card (it's a valid, distinct person)
    expect(s.cast.cersei_s_father).toBeDefined();
    expect(s.cast.cersei_s_father!.name).toBe("Cersei's father");
  });
});

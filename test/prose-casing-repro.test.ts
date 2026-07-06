import { describe, it, expect } from 'vitest';
import { mapExtracted } from '../src/bus/extract.js';
import { freshState } from '../src/domain/types.js';

// Repro for the mis-segmented prose-run junk cards the extractor kept minting:
//   "Daeron Partially"  (name + trailing adverb)
//   "The Research Box"  (common-noun phrase)
//   "The Castle Morning" (two fragments jammed across a sentence break)
// The denylist (notAName) can't catch these — their head words aren't enumerated
// — so a POSITIVE casing validator in inProse rejects any candidate whose word
// appears in the prose only lowercase (a common noun/adverb, never a name part).
let seq = 0;
const sf = () => ++seq;
const names = { user: 'Anne', char: 'Cersei' };

describe('prose-casing validator — rejects mis-segmented common-noun runs', () => {
  it('drops "Daeron Partially" (trailing adverb is lowercase in prose)', () => {
    const prose = 'Daeron partially turned away, unwilling to meet her eyes.';
    const evs = mapExtracted({ present: [{ who: 'Daeron Partially', mood: 'evasive' }] }, 5, 1, names, sf, freshState(), undefined, prose);
    expect(evs.some((e) => e.kind === 'cast.seen' && (e as any).id === 'daeron_partially')).toBe(false);
    expect(evs.some((e) => e.kind === 'scene.set')).toBe(false);
  });

  it('drops "The Research Box" (common-noun phrase, all lowercase in prose)', () => {
    const prose = 'He opened the research box and lifted out the sealed letter.';
    const evs = mapExtracted({ knowledge: [{ who: 'The Research Box', fact: 'held the letter' }] }, 5, 1, names, sf, freshState(), undefined, prose);
    expect(evs.filter((e) => e.kind === 'knowledge.learn')).toHaveLength(0);
  });

  it('drops "The Castle Morning" (fragments split across a sentence break)', () => {
    const prose = 'They reached the castle at last. Morning came slowly over the walls.';
    const evs = mapExtracted({ present: [{ who: 'The Castle Morning', mood: 'still' }] }, 5, 1, names, sf, freshState(), undefined, prose);
    expect(evs.some((e) => e.kind === 'cast.seen')).toBe(false);
    expect(evs.some((e) => e.kind === 'scene.set')).toBe(false);
  });

  it('drops a junk endpoint in a bond so the bond itself is dropped', () => {
    const prose = 'Daeron partially closed the research box.';
    const evs = mapExtracted({ bonds: [{ a: 'Daeron', b: 'The Research Box', aff: 10 }] }, 5, 1, names, sf, freshState(), undefined, prose);
    expect(evs.filter((e) => e.kind === 'bond.delta')).toHaveLength(0);
  });
});

describe('prose-casing validator — preserves legitimate names', () => {
  const prose = 'Daeron knelt beside Cersei and confessed what he had done.';

  it('keeps a proper name capitalized in the prose ("Daeron")', () => {
    const evs = mapExtracted({ knowledge: [{ who: 'Daeron', fact: 'confessed the deed' }] }, 5, 1, names, sf, freshState(), undefined, prose);
    expect(evs.filter((e) => e.kind === 'knowledge.learn')).toHaveLength(1);
  });

  it('keeps a fuller supplied surname absent from the prose ("Daeron Targaryen")', () => {
    // "Targaryen" isn't in the prose at all → no lowercase signal → allowed.
    const evs = mapExtracted({ knowledge: [{ who: 'Daeron Targaryen', fact: 'x' }] }, 5, 1, names, sf, freshState(), undefined, prose);
    expect(evs.filter((e) => e.kind === 'knowledge.learn')).toHaveLength(1);
  });

  it('keeps a sentence-initial name (capitalized at least once)', () => {
    const evs = mapExtracted({ journal: [{ who: 'Daeron', memory: 'I told her the truth' }] }, 5, 1, names, sf, freshState(), undefined, prose);
    expect(evs.filter((e) => e.kind === 'journal.entry')).toHaveLength(1);
  });

  it('persona is still always allowed regardless of casing', () => {
    const evs = mapExtracted({ journal: [{ who: '{{user}}', memory: 'I watched it happen' }] }, 5, 1, names, sf, freshState(), undefined, 'a quiet room');
    expect(evs.filter((e) => e.kind === 'journal.entry')).toHaveLength(1);
  });

  it('no prose supplied → validator is a no-op (back-compat)', () => {
    const evs = mapExtracted({ knowledge: [{ who: 'Daeron Partially', fact: 'x' }] }, 5, 1, names, sf, freshState());
    expect(evs.filter((e) => e.kind === 'knowledge.learn')).toHaveLength(1);
  });
});

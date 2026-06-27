import { describe, it, expect } from 'vitest';
import { mapExtracted } from '../src/bus/extract.js';

let seq = 0;
const sf = () => ++seq;
const names = { user: 'Anne', char: 'Cersei' };

describe('mapExtracted — pure JSON → events', () => {
  it('maps a valid bond to a bond.delta (Fix 1: bad(b) typo no longer kills bonds)', () => {
    const evs = mapExtracted({ bonds: [{ a: 'Cersei', b: 'Jaime', aff: 20, trust: 10, cat: ['romantic'] }] }, 3, 1, names, sf);
    const bond = evs.find((e) => e.kind === 'bond.delta') as any;
    expect(bond).toBeDefined();
    expect(bond.a).toBe('cersei');
    expect(bond.b).toBe('jaime');
    expect(bond.aff).toBe(20);
    expect(bond.addCats).toContain('romantic');
  });

  it('Fix 15: "The Stranger" passes, bare "a guard"/"someone" fail, "Anne" passes', () => {
    const evs = mapExtracted({
      knowledge: [
        { who: 'The Stranger', fact: 'watches from the dark' },
        { who: 'a guard', fact: 'stands at the gate' },
        { who: 'someone', fact: 'whispered' },
        { who: 'Anne', fact: 'learned the truth' },
      ],
    }, 1, 1, names, sf);
    const whos = evs.filter((e) => e.kind === 'knowledge.learn').map((e: any) => e.who);
    expect(whos).toContain('the_stranger'); // "The Stranger" is a proper epithet, kept
    expect(whos).toContain('anne');
    expect(whos.some((w) => w.includes('guard'))).toBe(false);
    expect(whos.some((w) => w.includes('someone'))).toBe(false);
  });

  it('resolves {{user}}/you to the persona name', () => {
    const evs = mapExtracted({ journal: [{ who: '{{user}}', memory: 'I saw her cry' }] }, 2, 1, names, sf);
    const j = evs.find((e) => e.kind === 'journal.entry') as any;
    expect(j.who).toBe('anne');
  });

  it('returns [] for junk input', () => {
    expect(mapExtracted(null, 1, 1, names, sf)).toEqual([]);
    expect(mapExtracted({}, 1, 1, names, sf)).toEqual([]);
  });
});

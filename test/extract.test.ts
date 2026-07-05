import { describe, it, expect } from 'vitest';
import { mapExtracted } from '../src/bus/extract.js';
import { freshState } from '../src/domain/types.js';

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

  it('parses knowledge reliability/truth/source; clamps junk to undefined', () => {
    const evs = mapExtracted({
      knowledge: [
        { who: 'Cersei', fact: 'the children are not the king\u2019s', reliability: 'wrong', truth: 'false', source: 'her own denial' },
        { who: 'Ned', fact: 'the parentage', reliability: 'bogus', truth: 'nope' },
      ],
    }, 4, 1, names, sf);
    const k1 = evs.find((e: any) => e.who === 'cersei') as any;
    const k2 = evs.find((e: any) => e.who === 'ned') as any;
    expect(k1.reliability).toBe('wrong');
    expect(k1.truth).toBe('false');
    expect(k1.source).toBe('her own denial');
    expect(k2.reliability).toBeUndefined(); // junk dropped → reduce defaults to 'knows'
    expect(k2.truth).toBeUndefined();
  });

  it('resolves knowledge/secret who onto an existing cast id (no Cersei vs Cersei Lannister split)', () => {
    const state = freshState();
    state.cast.cersei_lannister = { id: 'cersei_lannister', name: 'Cersei Lannister', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false };
    const evs = mapExtracted({
      knowledge: [{ who: 'Cersei', fact: 'the truth' }],
      secrets: [{ keeper: 'Cersei', secret: 'incest', from: 'Robert' }],
    }, 4, 1, names, sf, state);
    const k = evs.find((e) => e.kind === 'knowledge.learn') as any;
    const s = evs.find((e) => e.kind === 'secret.form') as any;
    expect(k.who).toBe('cersei_lannister'); // merged, not a fresh `cersei`
    expect(s.keeper).toBe('cersei_lannister');
  });
});

describe('mapExtracted — prose gate (anti-hallucination / anti-misattribution)', () => {
  const prose = 'Daeron knelt beside Cersei and confessed what he had done. She wept.';

  it('drops a hallucinated subject not in the prose ("Aegon")', () => {
    const evs = mapExtracted({ knowledge: [{ who: 'Aegon', fact: 'plots in secret' }] }, 5, 1, names, sf, freshState(), undefined, prose);
    expect(evs.filter((e) => e.kind === 'knowledge.learn')).toHaveLength(0);
  });

  it('drops misattribution to an off-scene cast member ("Rhaegar" for a Daeron scene)', () => {
    const state = freshState();
    state.cast.rhaegar = { id: 'rhaegar', name: 'Rhaegar', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false } as any;
    const evs = mapExtracted({ journal: [{ who: 'Rhaegar', memory: 'I confessed' }] }, 5, 1, names, sf, state, undefined, prose);
    expect(evs.filter((e) => e.kind === 'journal.entry')).toHaveLength(0);
  });

  it('keeps a subject present in the prose (Daeron, by token)', () => {
    const evs = mapExtracted({ knowledge: [{ who: 'Daeron', fact: 'admitted the deed' }] }, 5, 1, names, sf, freshState(), undefined, prose);
    expect(evs.filter((e) => e.kind === 'knowledge.learn')).toHaveLength(1);
  });

  it('matches by token: "Daeron Targaryen" subject lands when prose says "Daeron"', () => {
    const evs = mapExtracted({ knowledge: [{ who: 'Daeron Targaryen', fact: 'x' }] }, 5, 1, names, sf, freshState(), undefined, prose);
    expect(evs.filter((e) => e.kind === 'knowledge.learn')).toHaveLength(1);
  });

  it('allows an OBJECT (about) to be someone absent from the prose', () => {
    const evs = mapExtracted({ knowledge: [{ who: 'Daeron', fact: 'Aegon is dead', about: 'Aegon' }] }, 5, 1, names, sf, freshState(), undefined, prose);
    const k = evs.find((e) => e.kind === 'knowledge.learn') as any;
    expect(k).toBeDefined();
    expect(k.about).toBe('aegon'); // topic can be absent; only the SUBJECT is gated
  });

  it('persona ({{user}}) is always allowed even if not literally in the prose', () => {
    const evs = mapExtracted({ journal: [{ who: '{{user}}', memory: 'I watched it happen' }] }, 5, 1, names, sf, freshState(), undefined, 'a quiet room with no names');
    expect(evs.filter((e) => e.kind === 'journal.entry')).toHaveLength(1);
  });

  it('no prose supplied → gate is a no-op (back-compat)', () => {
    const evs = mapExtracted({ knowledge: [{ who: 'Aegon', fact: 'x' }] }, 5, 1, names, sf, freshState());
    expect(evs.filter((e) => e.kind === 'knowledge.learn')).toHaveLength(1);
  });
});

describe('mapExtracted — present + inner-thought recovery', () => {
  const prose = 'Daeron knelt beside Cersei and confessed. She wept, thinking she would never forgive him.';

  it('recovers a present character\'s inner thought as a mergeDetail scene.set', () => {
    const evs = mapExtracted({
      present: [{ who: 'Cersei', mood: 'shattered', doing: 'weeping', thought: 'I will never forgive him.' }],
    }, 6, 1, names, sf, freshState(), undefined, prose);
    const scene = evs.find((e) => e.kind === 'scene.set') as any;
    expect(scene).toBeDefined();
    expect(scene.mergeDetail).toBe(true);
    expect(scene.present).toContain('cersei');
    const d = scene.detail.find((x: any) => x.id === 'cersei');
    expect(d.thought).toBe('I will never forgive him.');
    expect(d.mood).toBe('shattered');
    // a first-seen on-stage character is also seeded as cast
    expect(evs.some((e) => e.kind === 'cast.seen' && (e as any).id === 'cersei')).toBe(true);
  });

  it('never emits present interiority for the player ({{user}}/persona)', () => {
    const evs = mapExtracted({
      present: [{ who: '{{user}}', mood: 'furious', thought: 'I should have known.' }, { who: 'Daeron', thought: 'She saw through me.' }],
    }, 6, 1, names, sf, freshState(), undefined, prose);
    const scene = evs.find((e) => e.kind === 'scene.set') as any;
    expect(scene.present).not.toContain('anne'); // persona excluded
    expect(scene.detail.some((d: any) => d.id === 'anne')).toBe(false);
    expect(scene.detail.some((d: any) => d.id === 'daeron' && d.thought)).toBe(true);
  });

  it('drops a present entry hallucinated / not in the prose', () => {
    const evs = mapExtracted({ present: [{ who: 'Aegon', thought: 'plotting' }] }, 6, 1, names, sf, freshState(), undefined, prose);
    expect(evs.some((e) => e.kind === 'scene.set')).toBe(false);
  });

  it('never puts a group in present', () => {
    const evs = mapExtracted({ present: [{ who: 'the guards', mood: 'wary' }] }, 6, 1, names, sf, freshState(), undefined, 'the guards watched from the wall');
    expect(evs.some((e) => e.kind === 'scene.set')).toBe(false);
  });
});

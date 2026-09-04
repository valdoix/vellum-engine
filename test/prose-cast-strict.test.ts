import { describe, expect, it } from 'vitest';
import { mapExtracted } from '../src/bus/extract.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';

let seq = 0;
const sf = () => ++seq;
const names = { user: 'Anne', char: 'Cersei Lannister' };

function roster(): ChronicleState {
  const state = freshState();
  state.cast.cersei_lannister = {
    id: 'cersei_lannister', name: 'Cersei Lannister', aka: ['The Lioness'],
    status: 'present', source: 'auto', firstTurn: 1, lastTurn: 4, userEdited: false,
  };
  state.cast.jaime_lannister = {
    id: 'jaime_lannister', name: 'Jaime Lannister', aka: ['Kingslayer'],
    status: 'present', source: 'auto', firstTurn: 1, lastTurn: 4, userEdited: false,
  };
  state.cast.annette = {
    id: 'annette', name: 'Annette', aka: [],
    status: 'active', source: 'auto', firstTurn: 1, lastTurn: 4, userEdited: false,
  };
  return state;
}

describe('prose cast extraction — closed roster', () => {
  it('rejects a plausible proper name that appears in prose but is not rostered', () => {
    const evs = mapExtracted({ present: [{ who: 'Alaric', mood: 'wary' }] }, 5, 1, names, sf, roster(), undefined, 'Alaric waited by the gate.');
    expect(evs.some((e) => e.kind === 'cast.seen')).toBe(false);
    expect(evs.some((e) => e.kind === 'scene.set')).toBe(false);
  });

  it('rejects a roster-prefix phrase instead of fuzzily resolving it', () => {
    const evs = mapExtracted({ present: [{ who: 'Cersei Slowly', mood: 'guarded' }] }, 5, 1, names, sf, roster(), undefined, 'Cersei slowly crossed the room.');
    expect(evs.some((e) => e.kind === 'cast.seen')).toBe(false);
  });

  it('accepts an unambiguous given name derived from a canonical full name', () => {
    const evs = mapExtracted({ knowledge: [{ who: 'Cersei', fact: 'Jaime is lying' }] }, 5, 1, names, sf, roster(), undefined, 'Cersei watched him lie.');
    expect((evs.find((e) => e.kind === 'knowledge.learn') as any)?.who).toBe('cersei_lannister');
  });

  it('accepts an exact declared alias and refreshes cast under its canonical name', () => {
    const evs = mapExtracted({ present: [{ who: 'The Lioness', mood: 'cold' }] }, 5, 1, names, sf, roster(), undefined, 'The Lioness entered without a word.');
    const seen = evs.find((e) => e.kind === 'cast.seen') as any;
    expect(seen).toMatchObject({ id: 'cersei_lannister', name: 'Cersei Lannister' });
  });

  it('does not derive or accept a surname-only mention', () => {
    const evs = mapExtracted({ knowledge: [{ who: 'Jaime Lannister', fact: 'the gate is open' }] }, 5, 1, names, sf, roster(), undefined, 'Lannister checked the gate.');
    expect(evs.some((e) => e.kind === 'knowledge.learn')).toBe(false);
  });

  it('uses whole-name boundaries (Ann does not match Annette)', () => {
    const state = roster();
    state.cast.ann = {
      id: 'ann', name: 'Ann', aka: [], status: 'active', source: 'auto',
      firstTurn: 1, lastTurn: 4, userEdited: false,
    };
    const evs = mapExtracted({ journal: [{ who: 'Ann', memory: 'I arrived.' }] }, 5, 1, names, sf, state, undefined, 'Annette arrived first.');
    expect(evs.some((e) => e.kind === 'journal.entry')).toBe(false);
  });

  it('requires the primary character to be named in prose; only the player is exempt', () => {
    const state = roster();
    const obj = { journal: [
      { who: 'Cersei Lannister', memory: 'I remained elsewhere.' },
      { who: '{{user}}', memory: 'I watched in silence.' },
    ] };
    const evs = mapExtracted(obj, 5, 1, names, sf, state, undefined, 'The empty hall remained silent.');
    const whos = evs.filter((e) => e.kind === 'journal.entry').map((e: any) => e.who);
    expect(whos).toEqual(['anne']);
  });

  it('applies exact roster admission to objects, bond endpoints, and faction members', () => {
    const evs = mapExtracted({
      knowledge: [{ who: 'Cersei', fact: 'the letter is forged', about: 'The Letter' }],
      bonds: [{ a: 'Cersei', b: 'Royal Guard', aff: 10 }],
      factions: [{ name: 'Citadel', members: ['Jaime', 'Royal Guard'] }],
    }, 5, 1, names, sf, roster(), undefined, 'Cersei confronted Jaime beside the letter and the royal guard.');
    const knowledge = evs.find((e) => e.kind === 'knowledge.learn') as any;
    expect(knowledge?.about).toBeUndefined();
    expect(evs.some((e) => e.kind === 'bond.delta')).toBe(false);
    expect(evs.filter((e) => e.kind === 'faction.member').map((e: any) => e.char)).toEqual(['jaime_lannister']);
  });

  it('rejects an ambiguous derived first name', () => {
    const state = roster();
    state.cast.jaime_reyne = {
      id: 'jaime_reyne', name: 'Jaime Reyne', aka: [], status: 'active', source: 'auto',
      firstTurn: 1, lastTurn: 4, userEdited: false,
    };
    const evs = mapExtracted({ knowledge: [{ who: 'Jaime', fact: 'the gate is open' }] }, 5, 1, names, sf, state, undefined, 'Jaime checked the gate.');
    expect(evs.some((e) => e.kind === 'knowledge.learn')).toBe(false);
  });
});

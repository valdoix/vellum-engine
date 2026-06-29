import { describe, it, expect } from 'vitest';
import { resolveCastId, notAName, mergeCastDuplicates, nameConflict } from '../src/domain/identity.js';
import { coreFeature } from '../src/domain/core-feature.js';
import { reduce } from '../src/core/reduce.js';
import { freshState, type ChronicleState, type CastCard, type Relation } from '../src/domain/types.js';

function withCast(...names: Array<[string, string[]?]>): ChronicleState {
  const s = freshState();
  for (const [name, aka] of names) {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    s.cast[id] = { id, name, aka: aka ?? [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false };
  }
  return s;
}

describe('resolveCastId — alias / identity merge', () => {
  it('exact id hit returns that id', () => {
    expect(resolveCastId(withCast(['Cersei Lannister']), 'Cersei Lannister')).toBe('cersei_lannister');
  });

  it('merges a short name onto an existing fuller name (token prefix)', () => {
    const s = withCast(['Cersei Lannister']);
    expect(resolveCastId(s, 'Cersei')).toBe('cersei_lannister'); // not a new `cersei`
  });

  it('merges a fuller name onto an existing short name', () => {
    const s = withCast(['Cersei']);
    expect(resolveCastId(s, 'Cersei Lannister')).toBe('cersei');
  });

  it('does NOT merge on a non-token substring (jon ⊄ jonas)', () => {
    const s = withCast(['Jonas']);
    expect(resolveCastId(s, 'Jon')).toBe('jon'); // distinct
  });

  it('does NOT merge when the prefix is ambiguous (two candidates)', () => {
    const s = withCast(['Cersei Lannister'], ); // single
    s.cast.cersei_baratheon = { id: 'cersei_baratheon', name: 'Cersei Baratheon', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false };
    expect(resolveCastId(s, 'Cersei')).toBe('cersei'); // ambiguous → fresh id, no wrong merge
  });

  it('resolves via aka', () => {
    const s = withCast(['Daeron Targaryen', ['the stranger']]);
    expect(resolveCastId(s, 'The Stranger')).toBe('daeron_targaryen');
  });
});

describe('fold dedup — bonds do not split a character across two ids', () => {
  let seq = 0;
  const ctx = (state: ChronicleState, turn: number) => ({ turn, day: 1, state, seq: () => ++seq });

  it('a bond using the short name targets the same id as the established full name', () => {
    // turn 1: full name seen + bond
    let s = reduce(coreFeature.extract!({
      present: [{ name: 'Cersei Lannister' }, { name: 'Daeron' }],
      delta: { bonds: [{ a: 'Cersei Lannister', b: 'Daeron', aff: 10 }] },
    } as any, ctx(freshState(), 1)));
    expect(s.relations).toHaveLength(1);

    // turn 2: model uses the SHORT name for the same person + same partner
    s = reduce(coreFeature.extract!({
      delta: { bonds: [{ a: 'Cersei', b: 'Daeron', aff: 5 }] },
    } as any, ctx(s, 2)), s, 0);

    // still ONE relation (cersei_lannister → daeron), accumulated — not a duplicate
    expect(s.relations).toHaveLength(1);
    expect(s.relations[0]!.a).toBe('cersei_lannister');
    expect(s.relations[0]!.affection).toBe(15);
    expect(Object.keys(s.cast).sort()).toEqual(['cersei_lannister', 'daeron']);
  });

  it('same-turn: present uses full names, bond uses short names → no split within the turn', () => {
    // both characters first seen THIS turn by full name, bond references them short.
    // prior state is empty, so without turn-id awareness this would mint cersei + daeron.
    const s = reduce(coreFeature.extract!({
      present: [{ name: 'Cersei Lannister' }, { name: 'Daeron Targaryen' }],
      delta: { bonds: [{ a: 'Cersei', b: 'Daeron', aff: 6, cat: ['romantic'] }] },
    } as any, ctx(freshState(), 1)));
    expect(s.relations).toHaveLength(1);
    expect(s.relations[0]!.a).toBe('cersei_lannister');
    expect(s.relations[0]!.b).toBe('daeron_targaryen');
    expect(Object.keys(s.cast).sort()).toEqual(['cersei_lannister', 'daeron_targaryen']);
  });
});

describe('notAName — reject pronouns / deixis / bare generics', () => {
  it('rejects pronouns regardless of case', () => {
    for (const p of ['she', 'She', 'her', 'Her', 'he', 'they', 'it', 'someone', 'you']) expect(notAName(p)).toBe(true);
  });
  it('rejects bare lowercase generics, passes capitalized epithets + proper names', () => {
    expect(notAName('a guard')).toBe(true);
    expect(notAName('stranger')).toBe(true);
    expect(notAName('The Stranger')).toBe(false);
    expect(notAName('Anne')).toBe(false);
    expect(notAName('Cersei Lannister')).toBe(false);
  });
  it('rejects empty / placeholder', () => {
    expect(notAName('')).toBe(true);
    expect(notAName('{{user}}')).toBe(true);
  });
  it('rejects free-text phrases / pronoun-bearing clauses (secret `from` junk)', () => {
    expect(notAName('everyone, including herself until now')).toBe(true); // clause, not a name
    expect(notAName('everyone')).toBe(true);
    expect(notAName('the lady and her maid')).toBe(true); // contains a pronoun token
    expect(notAName("Cersei's father")).toBe(false); // a real (distinct) name still passes
  });
  it('rejects narration/meta role labels (Narrator POV Character)', () => {
    expect(notAName('Narrator POV Character')).toBe(true);
    expect(notAName('the protagonist')).toBe(true);
    expect(notAName('Main Character')).toBe(true);
    expect(notAName('Cersei Lannister')).toBe(false); // real name unaffected
    expect(notAName('Daeron')).toBe(false);
  });
});

describe('mergeCastDuplicates — possessive/kinship is NOT the same person', () => {
  const card = (id: string, name: string): CastCard => ({ id, name, aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false });
  it('cersei does NOT merge into cersei_s_father (the catastrophic mis-merge)', () => {
    const s = freshState();
    s.cast.cersei = card('cersei', 'Cersei');
    s.cast.cersei_s_father = card('cersei_s_father', "Cersei's father");
    const m = mergeCastDuplicates(s);
    expect(Object.keys(m.cast).sort()).toEqual(['cersei', 'cersei_s_father']);
  });
  it('cersei does NOT merge into cersei_mother (kinship token)', () => {
    const s = freshState();
    s.cast.cersei = card('cersei', 'Cersei');
    s.cast.cersei_mother = card('cersei_mother', 'Cersei Mother');
    const m = mergeCastDuplicates(s);
    expect(Object.keys(m.cast).sort()).toEqual(['cersei', 'cersei_mother']);
  });
  it('still merges a genuine fuller spelling (cersei → cersei_lannister)', () => {
    const s = freshState();
    s.cast.cersei = card('cersei', 'Cersei');
    s.cast.cersei_lannister = card('cersei_lannister', 'Cersei Lannister');
    const m = mergeCastDuplicates(s);
    expect(Object.keys(m.cast)).toEqual(['cersei_lannister']);
  });
});

describe('fold — pronoun bond endpoints are dropped (no "she → Daeron")', () => {
  let seq = 0;
  const ctx = (state: ChronicleState) => ({ turn: 1, day: 1, state, seq: () => ++seq });
  it('a bond using "she" as an endpoint mints no node', () => {
    const s = reduce(coreFeature.extract!({
      present: [{ name: 'Daeron Targaryen' }],
      delta: { bonds: [{ a: 'she', b: 'Daeron', aff: 5, cat: ['romantic'] }] },
    } as any, ctx(freshState())));
    expect(s.relations).toHaveLength(0);
    expect(Object.keys(s.cast)).not.toContain('she');
  });
});

describe('mergeCastDuplicates — self-heal split nodes across EVERY section', () => {
  const card = (id: string, name: string): CastCard => ({ id, name, aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 5, userEdited: false });
  const rel = (a: string, b: string, aff = 0, trust = 0): Relation =>
    ({ a, b, label: '', categories: ['neutral'], category: 'neutral', affection: aff, trust, sentiment: 'neutral', status: 'active', source: 'auto', userEdited: false, firstTurn: 1, lastTurn: 5, firstDay: 1, history: [], categoryHistory: [] });

  it('"cersei", "cersei_lannister" (and "Cersei Lannister" → same id) merge everywhere', () => {
    // canonId('Cersei Lannister') === canonId('cersei_lannister') === 'cersei_lannister',
    // so the genuine split is the short `cersei` vs the full `cersei_lannister`.
    const s = freshState();
    s.cast.cersei = card('cersei', 'Cersei');
    s.cast.cersei_lannister = card('cersei_lannister', 'Cersei Lannister');
    s.cast.daeron = card('daeron', 'Daeron');

    s.relations = [rel('cersei', 'daeron', 5, 1), rel('cersei_lannister', 'daeron', 9, -2)];
    s.knowledge = [
      { id: 'k1', who: 'cersei', fact: 'a', turn: 1, reliability: 'knows', truth: 'unknown' },
      { id: 'k2', who: 'daeron', about: 'cersei', fact: 'b', turn: 1, reliability: 'knows', truth: 'unknown' },
    ];
    s.secrets = [{ id: 's1', keeper: 'cersei', from: ['cersei_lannister', 'daeron'], text: 't', revealed: false, revealedTo: ['cersei'], formedTurn: 1 }];
    s.journal = [{ id: 'j1', who: 'cersei', about: 'daeron', memory: 'm', kind: 'interaction', weight: 'minor', sentiment: 'neutral', turn: 1, day: 1 }];
    s.parallel = [{ who: 'cersei', activity: 'plotting', turn: 1, day: 1 }];
    s.scene = { location: 'x', time: '', tension: 0, weather: '', present: ['cersei', 'cersei_lannister', 'daeron'], detail: [{ id: 'cersei' }, { id: 'cersei_lannister' }] };

    const m = mergeCastDuplicates(s);
    const KEEP = 'cersei_lannister';

    // cast: one Cersei, short name folded into aka
    expect(Object.keys(m.cast).sort()).toEqual(['cersei_lannister', 'daeron']);
    expect(m.cast[KEEP]!.aka).toContain('Cersei');

    // relations: the two cersei→daeron edges collapse into one, scores summed
    expect(m.relations).toHaveLength(1);
    expect(m.relations[0]!.a).toBe(KEEP);
    expect(m.relations[0]!.affection).toBe(14); // 5 + 9
    expect(m.relations[0]!.trust).toBe(-1); // 1 + (-2)

    // knowledge
    expect(m.knowledge.find((k) => k.id === 'k1')!.who).toBe(KEEP);
    expect(m.knowledge.find((k) => k.id === 'k2')!.about).toBe(KEEP);

    // secrets (keeper / from / revealedTo); from de-dupes after remap
    expect(m.secrets[0]!.keeper).toBe(KEEP);
    expect(m.secrets[0]!.from).toContain(KEEP);
    expect(m.secrets[0]!.revealedTo).toEqual([KEEP]);

    // journal (who + about)
    expect(m.journal[0]!.who).toBe(KEEP);
    expect(m.journal[0]!.about).toBe('daeron');

    // parallel
    expect(m.parallel[0]!.who).toBe(KEEP);

    // scene present + detail de-duped
    expect(m.scene.present.sort()).toEqual(['cersei_lannister', 'daeron']);
    expect(m.scene.detail.map((d) => d.id)).toEqual([KEEP]);
  });

  it('is idempotent and leaves distinct characters alone', () => {
    const s = freshState();
    s.cast.cersei = card('cersei', 'Cersei');
    s.cast.cersei_lannister = card('cersei_lannister', 'Cersei Lannister');
    s.cast.jon = card('jon', 'Jon');
    const once = mergeCastDuplicates(s);
    const twice = mergeCastDuplicates(once);
    expect(Object.keys(twice.cast).sort()).toEqual(['cersei_lannister', 'jon']);
    expect(twice.cast.jon).toBeDefined(); // untouched
  });

  it('does NOT merge an ambiguous prefix (two candidates)', () => {
    const s = freshState();
    s.cast.cersei = card('cersei', 'Cersei');
    s.cast.cersei_lannister = card('cersei_lannister', 'Cersei Lannister');
    s.cast.cersei_baratheon = card('cersei_baratheon', 'Cersei Baratheon');
    const m = mergeCastDuplicates(s);
    expect(Object.keys(m.cast).sort()).toEqual(['cersei', 'cersei_baratheon', 'cersei_lannister']);
  });
});

describe('nameConflict — same surname, different given name', () => {
  it('flags two full names sharing only the surname', () => {
    expect(nameConflict('daeron_targaryen', 'rhaegar_targaryen')).toBe(true);
    expect(nameConflict('robb_stark', 'arya_stark')).toBe(true);
  });
  it('does NOT flag the legitimate short↔full case', () => {
    expect(nameConflict('daeron', 'daeron_targaryen')).toBe(false);
    expect(nameConflict('targaryen', 'daeron_targaryen')).toBe(false); // single token
  });
  it('does NOT flag same given name (a real fuller spelling)', () => {
    expect(nameConflict('cersei_lannister', 'cersei_baratheon')).toBe(false); // different surname, same given
  });
});

describe('resolveCastId — never collapses distinct same-surname people', () => {
  it('a corrupted aka cannot route "Daeron Targaryen" onto Rhaegar', () => {
    const s = withCast(['Rhaegar Targaryen', ['Daeron Targaryen']]); // poisoned aka
    expect(resolveCastId(s, 'Daeron Targaryen')).toBe('daeron_targaryen'); // fresh, not rhaegar
  });
  it('still merges a true alias that is not a name-conflict', () => {
    const s = withCast(['Cersei Lannister', ['The Queen']]);
    expect(resolveCastId(s, 'The Queen')).toBe('cersei_lannister');
  });
  it('mergeCastDuplicates never collapses same-surname distinct people', () => {
    const s = withCast(['Daeron Targaryen'], ['Rhaegar Targaryen']);
    const m = mergeCastDuplicates(s);
    expect(Object.keys(m.cast).sort()).toEqual(['daeron_targaryen', 'rhaegar_targaryen']);
  });
});

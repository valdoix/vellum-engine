import { describe, it, expect } from 'vitest';
import { mapExtracted } from '../src/bus/extract.js';
import { freshState } from '../src/domain/types.js';

// Reproduce the reported bug: a journal/knowledge entry that should be
// Cersei Lannister's gets recorded under Tywin Lannister.
let seq = 0;
const sf = () => ++seq;
const names = { user: 'Anne', char: 'Cersei Lannister' };

describe('misattribution repro — same-surname characters', () => {
  it('does NOT collapse Cersei Lannister into Tywin Lannister (id layer is safe)', () => {
    const state = freshState();
    state.cast.tywin_lannister = { id: 'tywin_lannister', name: 'Tywin Lannister', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false } as any;
    const prose = 'Cersei Lannister poured the wine and said nothing. Tywin Lannister watched.';
    const evs = mapExtracted({ journal: [{ who: 'Cersei Lannister', memory: 'I held my tongue before my father' }] }, 5, 1, names, sf, state, undefined, prose);
    const j = evs.find((e) => e.kind === 'journal.entry') as any;
    expect(j?.who).toBe('cersei_lannister'); // must NOT be tywin_lannister
  });

  it('BUG SURFACE: when prose calls her only "Cersei" but a "Cersei" card was never made, a bare token still resolves right', () => {
    const state = freshState();
    state.cast.cersei_lannister = { id: 'cersei_lannister', name: 'Cersei Lannister', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false } as any;
    const prose = 'Cersei drank alone.';
    const evs = mapExtracted({ journal: [{ who: 'Cersei', memory: 'I drank alone' }] }, 6, 1, names, sf, state, undefined, prose);
    const j = evs.find((e) => e.kind === 'journal.entry') as any;
    expect(j?.who).toBe('cersei_lannister');
  });

  it('FIXED: an OFF-SCENE same-surname character is NOT admitted via a shared surname token', () => {
    // Tywin is NOT in this prose. Cersei is. The shared token "lannister" must
    // not admit a Tywin entry now that the gate requires the given name (or a
    // surname unique to one cast member).
    const state = freshState();
    state.cast.cersei_lannister = { id: 'cersei_lannister', name: 'Cersei Lannister', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false } as any;
    state.cast.tywin_lannister = { id: 'tywin_lannister', name: 'Tywin Lannister', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false } as any;
    const prose = 'Cersei Lannister poured the wine and drank alone.';
    const evs = mapExtracted({ journal: [{ who: 'Tywin Lannister', memory: 'I drank alone' }] }, 8, 1, names, sf, state, undefined, prose);
    const j = evs.find((e) => e.kind === 'journal.entry') as any;
    expect(j).toBeUndefined(); // dropped — only the shared surname matched
  });

  it('FIXED: the right same-surname character (given name in prose) is still kept', () => {
    const state = freshState();
    state.cast.cersei_lannister = { id: 'cersei_lannister', name: 'Cersei Lannister', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false } as any;
    state.cast.tywin_lannister = { id: 'tywin_lannister', name: 'Tywin Lannister', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false } as any;
    const prose = 'Cersei Lannister poured the wine and drank alone.';
    const evs = mapExtracted({ journal: [{ who: 'Cersei Lannister', memory: 'I drank alone' }] }, 9, 1, names, sf, state, undefined, prose);
    const j = evs.find((e) => e.kind === 'journal.entry') as any;
    expect(j?.who).toBe('cersei_lannister');
  });

  it('FIXED: a unique surname-only match still lands (no contention)', () => {
    const state = freshState();
    state.cast.petyr_baelish = { id: 'petyr_baelish', name: 'Petyr Baelish', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false } as any;
    const prose = 'Baelish smiled his thin smile.'; // only the surname appears
    const evs = mapExtracted({ knowledge: [{ who: 'Petyr Baelish', fact: 'he schemes' }] }, 10, 1, names, sf, state, undefined, prose);
    const k = evs.find((e) => e.kind === 'knowledge.learn') as any;
    expect(k?.who).toBe('petyr_baelish'); // unique surname → still admitted
  });

  it('CANDIDATE BUG: extractor returns the WRONG name (model misattributes who); engine trusts it', () => {
    // The model/extractor LLM itself swaps the name — writes Tywin where prose meant Cersei.
    // The prose gate only checks PRESENCE, not correctness: Tywin IS in the prose, so it passes.
    const state = freshState();
    state.cast.cersei_lannister = { id: 'cersei_lannister', name: 'Cersei Lannister', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false } as any;
    state.cast.tywin_lannister = { id: 'tywin_lannister', name: 'Tywin Lannister', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false } as any;
    const prose = 'Cersei wept while Tywin looked on, unmoved.';
    // extractor (LLM) wrongly attributes Cersei's grief to Tywin
    const evs = mapExtracted({ journal: [{ who: 'Tywin', memory: 'I wept at the news' }] }, 7, 1, names, sf, state, undefined, prose);
    const j = evs.find((e) => e.kind === 'journal.entry') as any;
    // The engine cannot know this is wrong — Tywin is present, so it records it under Tywin.
    expect(j?.who).toBe('tywin_lannister');
  });
});

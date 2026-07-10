import { describe, it, expect } from 'vitest';
import { buildIndex, collectItems } from '../src/retrieval/invindex.js';
import { lexicalSearch } from '../src/retrieval/lexical.js';
import { allocate, fitLines } from '../src/retrieval/budget.js';
import { buildInjection } from '../src/retrieval/recall.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';

function stateWith(): ChronicleState {
  const s = freshState();
  s.turns = 20;
  s.knowledge = [
    { id: 'k1', who: 'cersei', fact: 'Cersei knows the children are not Robert\u2019s heirs', turn: 5, reliability: 'knows', truth: 'true' },
    { id: 'k2', who: 'ned', fact: 'Ned discovered the truth of the Lannister incest', turn: 12, reliability: 'knows', truth: 'true' },
    { id: 'k3', who: 'jon', fact: 'Jon trains daily at the Wall with the Night\u2019s Watch', turn: 8, reliability: 'knows', truth: 'true' },
  ];
  s.memories = [
    { id: 'm1', tier: 'chapter', text: 'The betrothal between Sansa and Joffrey was announced at court', keys: ['betrothal', 'Sansa', 'Joffrey'], turn: 10 },
  ];
  return s;
}

describe('inverted index + lexical (BM25)', () => {
  it('ranks rare proper nouns above filler — continuity precision', () => {
    const idx = buildIndex(collectItems(stateWith()));
    const hits = lexicalSearch(idx, 'what does Ned know about the Lannister incest?');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.id).toBe('k2'); // Ned + Lannister + incest beats generic words
  });

  it('journal entries are retrievable items', () => {
    const s = stateWith();
    s.journal = [{ id: 'j1', who: 'cersei', memory: 'the golden rose he offered at the godswood', kind: 'gift', weight: 'significant', sentiment: 'complex', turn: 6, day: 1 }] as any;
    const idx = buildIndex(collectItems(s));
    const hits = lexicalSearch(idx, 'golden rose godswood');
    expect(hits.map((h) => h.id)).toContain('j1');
  });

  it('matches the betrothal memory by its keys', () => {
    const idx = buildIndex(collectItems(stateWith()));
    const hits = lexicalSearch(idx, 'the betrothal to Joffrey');
    expect(hits.map((h) => h.id)).toContain('m1');
  });

  it('returns nothing for an empty/irrelevant query', () => {
    const idx = buildIndex(collectItems(stateWith()));
    expect(lexicalSearch(idx, 'xyzzy qwerty')).toHaveLength(0);
  });

  it('only touches docs containing query tokens (postings, not full scan)', () => {
    const idx = buildIndex(collectItems(stateWith()));
    expect(idx.postings.get('incest')).toBeDefined();
    expect(idx.postings.get('lannister')!.size).toBeGreaterThan(0);
  });
});

describe('budget allocator', () => {
  it('splits caps and scales down when over total', () => {
    const a = allocate({ total: 100, caps: { x: 80, y: 80 }, phaseMult: 1 });
    expect(a.x! + a.y!).toBeLessThanOrEqual(100);
  });
  it('applies the phase multiplier to recall only', () => {
    const a = allocate({ total: 10000, caps: { structured: 100, recall: 100 }, phaseMult: 2 });
    expect(a.recall).toBe(200);
    expect(a.structured).toBe(100);
  });
  it('fitLines keeps whole lines under budget', () => {
    expect(fitLines(['aaaa', 'bbbb', 'cccc'], 10)).toEqual(['aaaa', 'bbbb']);
  });
  it('Fix 8: recall CAPS sum ≤ TOTAL → returned unscaled', () => {
    const caps = { structured: 1400, recall: 1800 };
    const a = allocate({ total: 3600, caps, phaseMult: 1 });
    expect(a.structured).toBe(1400);
    expect(a.recall).toBe(1800); // not down-scaled
  });
});

describe('chapter summaries in recall', () => {
  function withChapterAndTurn(): ChronicleState {
    const s = freshState();
    s.turns = 30;
    s.memories = [
      { id: 'chap_1', tier: 'chapter', text: 'Cersei arrived at Harrenhal and Daeron offered marriage on equal terms.', keys: ['harrenhal', 'marriage'], turn: 8, covers: [1, 8] },
      { id: 'turn_30', tier: 'turn', text: 'Cersei walked the Harrenhal corridor at dusk.', keys: [], turn: 30 },
    ] as any;
    return s;
  }
  it('injects a chapter summary into the recall block', () => {
    const inj = buildInjection('cChap', withChapterAndTurn(), 'Harrenhal marriage Daeron');
    expect(inj.text).toContain('Daeron offered marriage on equal terms');
    expect(inj.recallIds).toContain('chap_1');
  });
  it('prioritizes the chapter over an equally-matching turn-memory (tier boost)', () => {
    const inj = buildInjection('cChap2', withChapterAndTurn(), 'Harrenhal');
    const ci = inj.recallIds.indexOf('chap_1');
    const ti = inj.recallIds.indexOf('turn_30');
    expect(ci).toBeGreaterThanOrEqual(0);
    if (ti !== -1) expect(ci).toBeLessThan(ti);
  });
});

describe('Fix 20 — index staleness', () => {
  it('reflects an in-place content edit when version bumps (counts unchanged)', () => {
    const s = stateWith();
    s.cast = { ned: { id: 'ned', name: 'Ned Stark', aka: [], status: 'present', source: 'auto', firstTurn: 1, lastTurn: 20, userEdited: false } };
    s.scene = { location: 'Winterfell', tension: 4, time: 'dusk', weather: 'rain', present: ['ned'], detail: [] };
    const first = buildInjection('chatV', s, 'dragons circling Winterfell', 1, 1);
    expect(first.text).not.toContain('dragons circling');
    // edit k1 text in place — same row count, same version → cached (stale)
    s.knowledge[0]!.fact = 'Ned saw dragons circling above Winterfell';
    const stale = buildInjection('chatV', s, 'dragons circling Winterfell', 1, 1);
    expect(stale.text).not.toContain('dragons circling');
    const fresh = buildInjection('chatV', s, 'dragons circling Winterfell', 1, 2); // bumped → rebuilt
    expect(fresh.text).toContain('dragons circling');
  });
});

describe('buildInjection — continuity guardrail', () => {
  it('injects authoritative cast/bonds verbatim and scene-relevant recall', () => {
    const s = stateWith();
    s.cast = { ned: { id: 'ned', name: 'Ned Stark', aka: [], status: 'present', source: 'auto', firstTurn: 1, lastTurn: 20, userEdited: false } };
    s.scene = { location: 'Winterfell', tension: 4, time: 'dusk', weather: 'rain', present: ['ned'], detail: [] };
    const inj = buildInjection('chat1', s, 'Ned thinks about the Lannister incest');
    expect(inj.text).toContain('CAST & BONDS');
    expect(inj.text).toContain('Ned Stark'); // structured = verbatim
    expect(inj.text).toContain('CHRONICLE RECALL');
    expect(inj.recallIds).toContain('k2'); // relevant prose retrieved
  });

  it('reflects an off-screen subplot back onto its matching plot thread', () => {
    const s = stateWith();
    s.cast = { ned: { id: 'ned', name: 'Ned Stark', aka: [], status: 'present', source: 'auto', firstTurn: 1, lastTurn: 20, userEdited: false } };
    s.scene = { location: 'Winterfell', tension: 4, time: 'dusk', weather: '', present: ['ned'], detail: [] };
    s.threads = [{ id: 'thr_the_letter', name: 'The Letter', status: 'advance', beats: [], firstTurn: 3, lastTurn: 8 }];
    s.offscreen = [{ id: 'appt', name: 'The Appointment', status: 'active', gist: 'B opens the letter and rides north', beats: ['B opens the letter and rides north'], firstTurn: 8, lastTurn: 9 }];
    const inj = buildInjection('chatBridge', s, 'the letter');
    expect(inj.text).toContain('OPEN THREADS & ARCS');
    expect(inj.text).toContain('The Letter');
    expect(inj.text).toContain('off-screen: B opens the letter and rides north'); // reflected onto the thread
  });

  it('leads with an authoritative NOW clock line stating day + time', () => {
    const s = stateWith();
    s.day = 47;
    s.cast = { ned: { id: 'ned', name: 'Ned Stark', aka: [], status: 'present', source: 'auto', firstTurn: 1, lastTurn: 20, userEdited: false } };
    s.scene = { location: 'Harrenhal', tension: 4, time: 'dusk', weather: '', present: ['ned'], detail: [] };
    const inj = buildInjection('chatNow', s, 'what happens next');
    expect(inj.text).toContain('[NOW');
    expect(inj.text).toContain('Day 47');
    expect(inj.text).toContain('dusk');
    // NOW sits ahead of the structured cast block (highest salience)
    expect(inj.text.indexOf('[NOW')).toBeLessThan(inj.text.indexOf('CAST & BONDS'));
  });

  it('states the elapsed span since the previous scene when days advanced', () => {
    const s = stateWith();
    s.day = 40;
    s.sceneDay = 40;
    s.prevSceneDay = 5;   // ~5 weeks earlier
    s.cast = { ned: { id: 'ned', name: 'Ned Stark', aka: [], status: 'present', source: 'auto', firstTurn: 1, lastTurn: 20, userEdited: false } };
    s.scene = { location: 'Harrenhal', tension: 4, time: 'morning', weather: '', present: ['ned'], detail: [] };
    const inj = buildInjection('chatNowSpan', s, 'what happens next');
    expect(inj.text).toContain('since the previous scene');
    expect(inj.text).toContain('month(s)'); // 35 days → ~1 month
  });
});

describe('buildInjection — arc <-> thread bridge', () => {
  it('rolls an arc\u2019s linked threads\u2019 latest beats into the OPEN ARCS line', () => {
    const s = stateWith();
    s.cast = { ned: { id: 'ned', name: 'Ned Stark', aka: [], status: 'present', source: 'auto', firstTurn: 1, lastTurn: 20, userEdited: false } };
    s.scene = { location: 'Winterfell', tension: 4, time: 'dusk', weather: '', present: ['ned'], detail: [] };
    s.arcs = [{ id: 'arc_the_letter', name: 'The Letter', status: 'advance', beats: ['the letter arrives sealed'], firstTurn: 2, lastTurn: 10 }];
    s.threads = [
      { id: 'thr_a', name: 'The Letter arrives', status: 'advance', beats: ['earlier beat', 'a courier rides first light at dawn'], firstTurn: 2, lastTurn: 6, arc: 'arc_the_letter' },
      { id: 'thr_b', name: 'The letter burns', status: 'advance', beats: ['the fire is lit', 'B burns it before reading'], firstTurn: 3, lastTurn: 7, arc: 'arc_the_letter' },
    ];
    const inj = buildInjection('chatArc', s, 'the letter');
    expect(inj.text).toContain('OPEN THREADS & ARCS');
    // the linked threads are enumerated under the arc line, each with its LATEST beat
    expect(inj.text).toContain('The Letter arrives');
    expect(inj.text).toContain('a courier rides first light at dawn');
    expect(inj.text).toContain('The letter burns');
    expect(inj.text).toContain('B burns it before reading');
    // the off-screen reflection also still works for threads
    expect(inj.text).not.toContain('off-screen:');
  });

  it('soft-matches threads to an arc by shared tokens when no explicit link exists', () => {
    const s = stateWith();
    s.cast = { ned: { id: 'ned', name: 'Ned Stark', aka: [], status: 'present', source: 'auto', firstTurn: 1, lastTurn: 20, userEdited: false } };
    s.scene = { location: 'Winterfell', tension: 4, time: 'dusk', weather: '', present: ['ned'], detail: [] };
    s.arcs = [{ id: 'arc_siege', name: 'The Siege of Winterfell', status: 'advance', beats: [], firstTurn: 2, lastTurn: 10 }];
    // no arc= link, but the thread name contains the arc's tokens → soft match
    s.threads = [{ id: 'thr_x', name: 'The Siege of Winterfell escalates at the gate', status: 'advance', beats: ['catapults roll at dawn'], firstTurn: 2, lastTurn: 8 }];
    const inj = buildInjection('chatArcSoft', s, 'the siege');
    expect(inj.text).toContain('The Siege of Winterfell escalates at the gate');
    expect(inj.text).toContain('catapults roll at dawn');
  });
});

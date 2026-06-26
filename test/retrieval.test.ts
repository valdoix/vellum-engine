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
    { id: 'k1', who: 'cersei', fact: 'Cersei knows the children are not Robert\u2019s heirs', turn: 5 },
    { id: 'k2', who: 'ned', fact: 'Ned discovered the truth of the Lannister incest', turn: 12 },
    { id: 'k3', who: 'jon', fact: 'Jon trains daily at the Wall with the Night\u2019s Watch', turn: 8 },
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
});

describe('buildInjection — continuity guardrail', () => {
  it('injects authoritative cast/bonds verbatim and scene-relevant recall', () => {
    const s = stateWith();
    s.cast = { ned: { id: 'ned', name: 'Ned Stark', aka: [], status: 'present', source: 'auto', firstTurn: 1, lastTurn: 20, userEdited: false } };
    s.scene = { location: 'Winterfell', tension: 4, weather: 'rain', present: ['ned'] };
    const inj = buildInjection('chat1', s, 'Ned thinks about the Lannister incest');
    expect(inj.text).toContain('CAST & BONDS');
    expect(inj.text).toContain('Ned Stark'); // structured = verbatim
    expect(inj.text).toContain('CHRONICLE RECALL');
    expect(inj.recallIds).toContain('k2'); // relevant prose retrieved
  });
});

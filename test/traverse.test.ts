import { describe, it, expect } from 'vitest';
import { buildIndex, collectItems } from '../src/retrieval/invindex.js';
import { buildInjection } from '../src/retrieval/recall.js';
import { parseSelection, validateSelection, traverseRanked, buildScene, type CallModel } from '../src/retrieval/traverse.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';
import { Ok, Err } from '../src/core/result.js';

function stateWith(): ChronicleState {
  const s = freshState();
  s.turns = 20;
  s.knowledge = [
    { id: 'k1', who: 'cersei', fact: 'Cersei knows the children are not Robert\u2019s heirs', turn: 5, reliability: 'knows', truth: 'true' },
    { id: 'k2', who: 'ned', fact: 'Ned discovered the truth of the Lannister incest', turn: 12, reliability: 'knows', truth: 'true' },
    { id: 'k3', who: 'jon', fact: 'Jon trains daily at the Wall with the Night\u2019s Watch', turn: 8, reliability: 'knows', truth: 'true' },
  ];
  s.cast = {
    ned: { id: 'ned', name: 'Ned Stark', aka: [], status: 'present', source: 'auto', firstTurn: 1, lastTurn: 20, userEdited: false },
  };
  s.scene = { location: 'Winterfell', tension: 6, time: 'dusk', weather: '', present: ['ned'], detail: [] };
  return s;
}

describe('traverse — pure helpers', () => {
  it('parseSelection accepts {ids:[...]}, bare array, and fenced json', () => {
    expect(parseSelection('{"ids":["k1","k2"]}')).toEqual(['k1', 'k2']);
    expect(parseSelection('["k3"]')).toEqual(['k3']);
    expect(parseSelection('```json\n{"ids":["k1"]}\n```')).toEqual(['k1']);
    expect(parseSelection('not json at all')).toBeNull();
  });

  it('validateSelection keeps only real candidate ids, order + dedup, null when empty', () => {
    const cands = [{ id: 'k1' }, { id: 'k2' }];
    expect(validateSelection(cands, ['k2', 'k1', 'k2', 'bogus'])).toEqual(['k2', 'k1']);
    expect(validateSelection(cands, ['bogus'])).toBeNull();
    expect(validateSelection(cands, null)).toBeNull();
  });

  it('buildScene summarizes present cast + location deterministically', () => {
    const sc = buildScene(stateWith());
    expect(sc).toContain('Ned Stark');
    expect(sc).toContain('Winterfell');
    expect(sc).toContain('Turn 20');
  });
});

describe('traverseRanked — controller selection + fallback', () => {
  const s = stateWith();
  const index = buildIndex(collectItems(s));
  const lexIds = ['k2', 'k1', 'k3'];

  it('returns the controller-selected ids with a trace', async () => {
    const model: CallModel = async () => Ok('{"ids":["k1"]}');
    const r = await traverseRanked(index, s, lexIds, model);
    expect(r).not.toBeNull();
    expect(r!.ids).toEqual(['k1']);
    expect(r!.trace.candidateIds).toEqual(lexIds);
    expect(r!.trace.selectedIds).toEqual(['k1']);
  });

  it('falls back (null) on model error', async () => {
    const model: CallModel = async () => Err('timeout');
    expect(await traverseRanked(index, s, lexIds, model)).toBeNull();
  });

  it('falls back (null) on unparseable or empty/invalid selection', async () => {
    expect(await traverseRanked(index, s, lexIds, async () => Ok('garbage'))).toBeNull();
    expect(await traverseRanked(index, s, lexIds, async () => Ok('{"ids":["nope"]}'))).toBeNull();
  });

  it('falls back (null) when there are no candidates', async () => {
    const empty = buildIndex(collectItems(freshState()));
    expect(await traverseRanked(empty, freshState(), [], async () => Ok('{"ids":[]}'))).toBeNull();
  });
});

describe('recall integration — traversal vs deterministic', () => {
  it('buildInjection (no controller) is unchanged by the traversal seam', () => {
    const s = stateWith();
    const inj = buildInjection('chatT', s, 'Ned thinks about the Lannister incest');
    expect(inj.source).toBe('lexical');
    expect(inj.recallIds).toContain('k2');
    expect(inj.trace).toBeUndefined();
  });
});

import { describe, it, expect } from 'vitest';
import { buildMemoryTree, buildCharacterTree, buildHybridTree } from '../src/retrieval/tree.js';
import { traverseTree } from '../src/retrieval/traverse-tree.js';
import { buildInjection, buildInjectionHybrid } from '../src/retrieval/recall.js';
import { Ok, Err } from '../src/core/result.js';
import type { CallModel } from '../src/retrieval/traverse.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';
import { collectItems, buildIndex } from '../src/retrieval/invindex.js';

function storyState(): ChronicleState {
  const s = freshState();
  s.turns = 30;
  s.memories = [
    { id: 'arc1', tier: 'arc', text: 'The Harrenhal courtship arc.', detail: 'Across turns 1-16 Cersei came to Harrenhal and slowly bonded with Daeron over letters and a golden rose.', keys: [], covers: [1, 16], turn: 16 },
    { id: 'chapA', tier: 'chapter', text: 'Arrival and the golden rose.', detail: 'Turns 1-8: Cersei arrived; Daeron gave her a golden rose; her contempt softened.', keys: ['golden rose', 'Harrenhal'], covers: [1, 8], turn: 8 },
    { id: 'chapB', tier: 'chapter', text: 'The letters and the study.', detail: 'Turns 9-16: Cersei read every letter Daeron wrote her servants; she went to his study.', keys: ['letters', 'study'], covers: [9, 16], turn: 16 },
  ] as any;
  s.knowledge = [
    { id: 'k_rose', who: 'cersei', fact: 'Daeron learned her favorite flower is the golden rose', turn: 4, reliability: 'knows', truth: 'true' },
    { id: 'k_letters', who: 'cersei', fact: 'Daeron wrote to her servants about her comfort', turn: 12, reliability: 'knows', truth: 'true' },
  ] as any;
  return s;
}

describe('buildMemoryTree', () => {
  it('nests arc → chapter → leaf by covers/turn', () => {
    const s = storyState();
    const tree = buildMemoryTree(s, collectItems(s));
    expect(tree.rootIds).toContain('arc1'); // arc at root
    const arc = tree.nodes.get('arc1')!;
    expect(arc.childrenIds.sort()).toEqual(['chapA', 'chapB']); // chapters under the arc
    const chA = tree.nodes.get('chapA')!;
    expect(chA.childrenIds).toContain('k_rose'); // turn-4 fact under turns 1-8 chapter
    const chB = tree.nodes.get('chapB')!;
    expect(chB.childrenIds).toContain('k_letters'); // turn-12 fact under turns 9-16
    // chapters are NOT at root (they're under the arc)
    expect(tree.rootIds).not.toContain('chapA');
  });

  it('puts loose leaves (no chapter) at root', () => {
    const s = freshState();
    s.turns = 3;
    s.knowledge = [{ id: 'k1', who: 'a', fact: 'loose fact', turn: 2, reliability: 'knows', truth: 'unknown' }] as any;
    const tree = buildMemoryTree(s, collectItems(s));
    expect(tree.rootIds).toContain('k1');
  });
});

describe('traverseTree — drill loop', () => {
  const s = storyState();
  const index = buildIndex(collectItems(s));

  it('drills arc → chapter and selects a chapter (detail injected later)', async () => {
    // step 1: expand the arc; step 2: select chapter B
    const calls: string[] = [];
    const model: CallModel = async (p) => {
      calls.push(p.user);
      if (calls.length === 1) return Ok('{"expand":["arc1"],"select":[]}');
      return Ok('{"expand":[],"select":["chapB"]}');
    };
    const r = await traverseTree(index, s, model, { stepLimit: 4, depthLimit: 3 });
    expect(r).not.toBeNull();
    expect(r!.ids).toContain('chapB');
    expect(r!.summaryIds).toContain('chapB'); // chapter → marked for detailed injection
    expect(r!.trace.steps.length).toBe(2);
  });

  it('respects the step limit', async () => {
    let n = 0;
    const model: CallModel = async () => { n++; return Ok('{"expand":["arc1"],"select":[]}'); };
    await traverseTree(index, s, model, { stepLimit: 2 });
    expect(n).toBeLessThanOrEqual(2);
  });

  it('falls back (null) on controller error / unparseable / empty', async () => {
    expect(await traverseTree(index, s, async () => Err('timeout'))).toBeNull();
    expect(await traverseTree(index, s, async () => Ok('garbage'))).toBeNull();
    expect(await traverseTree(index, s, async () => Ok('{"expand":[],"select":[]}'))).toBeNull();
  });
});

describe('buildCharacterTree (PR2)', () => {
  function charState(): ChronicleState {
    const s = freshState();
    s.turns = 10;
    s.cast = {
      cersei: { id: 'cersei', name: 'Cersei', role: 'queen', aka: [], status: 'present', source: 'auto', firstTurn: 1, lastTurn: 10, userEdited: false },
      ned: { id: 'ned', name: 'Ned', aka: [], status: 'mentioned', source: 'auto', firstTurn: 1, lastTurn: 3, userEdited: false },
    } as any;
    s.knowledge = [
      { id: 'k1', who: 'cersei', fact: 'knows a secret tunnel', turn: 4, reliability: 'knows', truth: 'true' },
      { id: 'k2', who: 'ned', fact: 'discovered the truth', turn: 3, reliability: 'knows', truth: 'true' },
    ] as any;
    s.journal = [{ id: 'j1', who: 'cersei', memory: 'the look across the hall', kind: 'interaction', weight: 'minor', sentiment: 'complex', turn: 5, day: 1 }] as any;
    return s;
  }

  it('roots cast (present first) with their facts/journal as children', () => {
    const s = charState();
    const tree = buildCharacterTree(s, collectItems(s));
    expect(tree.rootIds).toContain('char:cersei');
    expect(tree.rootIds.indexOf('char:cersei')).toBeLessThan(tree.rootIds.indexOf('char:ned')); // present before mentioned
    const c = tree.nodes.get('char:cersei')!;
    expect(c.childrenIds).toEqual(expect.arrayContaining(['k1', 'j1'])); // knowledge + journal are drillable leaves
    expect(tree.nodes.get('char:ned')!.childrenIds).toContain('k2');
  });

  it('traverseTree axis:character drills a character node', async () => {
    const s = charState();
    const index = buildIndex(collectItems(s));
    let n = 0;
    const model: CallModel = async () => { n++; return n === 1 ? Ok('{"expand":["char:cersei"],"select":[]}') : Ok('{"expand":[],"select":["k1"]}'); };
    const r = await traverseTree(index, s, model, { axis: 'character' });
    expect(r).not.toBeNull();
    expect(r!.ids).toContain('k1');
  });
});

describe('buildHybridTree (PR3)', () => {
  function hybridState(): ChronicleState {
    const s = freshState();
    s.turns = 30;
    s.cast = {
      cersei: { id: 'cersei', name: 'Cersei', role: 'queen', aka: [], status: 'present', source: 'auto', firstTurn: 1, lastTurn: 16, userEdited: false },
      ned: { id: 'ned', name: 'Ned', aka: [], status: 'mentioned', source: 'auto', firstTurn: 1, lastTurn: 3, userEdited: false },
    } as any;
    s.memories = [
      { id: 'arc1', tier: 'arc', text: 'The Harrenhal arc.', detail: 'Arc detail.', keys: [], covers: [1, 16], turn: 16 },
      { id: 'chapA', tier: 'chapter', text: 'Arrival.', detail: 'Chapter A detail.', keys: [], covers: [1, 8], turn: 8 },
      { id: 'chapB', tier: 'chapter', text: 'The letters.', detail: 'Chapter B detail.', keys: [], covers: [9, 16], turn: 16 },
    ] as any;
    s.knowledge = [
      { id: 'k_rose', who: 'cersei', fact: 'the golden rose', turn: 4, reliability: 'knows', truth: 'true' },
      { id: 'k_letters', who: 'cersei', fact: 'the letters', turn: 12, reliability: 'knows', truth: 'true' },
      { id: 'k_ned', who: 'ned', fact: 'the truth', turn: 3, reliability: 'knows', truth: 'true' },
    ] as any;
    return s;
  }

  it('nests character → arc → chapter → leaf, scoped per character', () => {
    const s = hybridState();
    const tree = buildHybridTree(s, collectItems(s));
    expect(tree.rootIds).toContain('char:cersei');
    const cersei = tree.nodes.get('char:cersei')!;
    // Cersei's branch holds the scoped arc (namespaced id, sourceId = bare arc)
    const arcId = cersei.childrenIds.find((id) => id.startsWith('h:cersei:arc1'))!;
    expect(arcId).toBeTruthy();
    const arc = tree.nodes.get(arcId)!;
    expect(arc.sourceId).toBe('arc1');
    // chapter A (turns 1-8) holds the turn-4 rose fact; chapter B holds turn-12 letters
    const chIds = arc.childrenIds.map((id) => tree.nodes.get(id)!);
    const chA = chIds.find((n) => n.sourceId === 'chapA')!;
    expect(chA.childrenIds).toContain('k_rose'); // leaf id stays bare
    const chB = chIds.find((n) => n.sourceId === 'chapB')!;
    expect(chB.childrenIds).toContain('k_letters');
  });

  it('omits characters with no leaves and keeps only their own branches', () => {
    const s = hybridState();
    const tree = buildHybridTree(s, collectItems(s));
    // Ned has only k_ned (turn 3 → chapter A). Cersei's branch must not carry k_ned.
    const ned = tree.nodes.get('char:ned')!;
    const nedArc = tree.nodes.get(ned.childrenIds.find((id) => id.startsWith('h:ned:'))!)!;
    const nedLeaves = nedArc.childrenIds.flatMap((cid) => tree.nodes.get(cid)!.childrenIds);
    expect(nedLeaves).toContain('k_ned');
    expect(nedLeaves).not.toContain('k_rose');
  });

  it('axis:hybrid drills char → arc → chapter → leaf and resolves bare ids', async () => {
    const s = hybridState();
    const index = buildIndex(collectItems(s));
    const seq = [
      '{"expand":["char:cersei"],"select":[]}',
      `{"expand":["${'h:cersei:arc1'}"],"select":[]}`,
      `{"expand":["${'h:cersei:chapB'}"],"select":[]}`,
      '{"expand":[],"select":["k_letters"]}',
    ];
    let n = 0;
    const model: CallModel = async () => Ok(seq[n++] ?? '{"expand":[],"select":[]}');
    const r = await traverseTree(index, s, model, { axis: 'hybrid' });
    expect(r).not.toBeNull();
    expect(r!.ids).toContain('k_letters'); // bare leaf id, assemble-ready
  });

  it('selecting a scoped chapter resolves to its bare memory id as a summary', async () => {
    const s = hybridState();
    const index = buildIndex(collectItems(s));
    const seq = ['{"expand":["char:cersei"],"select":[]}', '{"expand":["h:cersei:arc1"],"select":[]}', '{"expand":[],"select":["h:cersei:chapB"]}'];
    let n = 0;
    const model: CallModel = async () => Ok(seq[n++] ?? '{"expand":[],"select":[]}');
    const r = await traverseTree(index, s, model, { axis: 'hybrid' });
    expect(r).not.toBeNull();
    expect(r!.summaryIds).toContain('chapB'); // bare id → detail lookup + assemble match
    expect(r!.ids).toContain('chapB');
  });
});

describe('recall wiring — tree mode', () => {
  it('tree selection of a chapter injects its DETAILED summary', async () => {
    const s = storyState();
    let n = 0;
    const model: CallModel = async () => { n++; return n === 1 ? Ok('{"expand":["arc1"],"select":[]}') : Ok('{"expand":[],"select":["chapB"]}'); };
    const inj = await buildInjectionHybrid('cTree', s, 'the letters', null, 1, 1, model, 'tree');
    expect(inj.source).toBe('traversal-tree');
    expect(inj.text).toContain('read every letter'); // detail, not the gist
    expect(inj.treeTrace).toBeTruthy();
  });

  it('no controller → identical to deterministic path (mode ignored)', async () => {
    const s = storyState();
    const a = await buildInjectionHybrid('cT2', s, 'golden rose', null, 1, 1, undefined, 'tree');
    expect(a.source).not.toBe('traversal-tree'); // fell through
  });
});

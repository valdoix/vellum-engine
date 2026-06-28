import { describe, it, expect } from 'vitest';
import { buildMemoryTree } from '../src/retrieval/tree.js';
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

import { describe, expect, it } from 'vitest';
import { coreFeature } from '../src/domain/core-feature.js';
import { freshState } from '../src/domain/types.js';
import { reduce } from '../src/core/reduce.js';
import { auditCompiledEvents, type StateCandidate } from '../src/domain/state-compiler.js';
import { VellumEvent as VellumEventSchema, type VellumEvent } from '../src/core/events.js';

describe('validated Engine materialization', () => {
  it('persists a same-pass arc -> thread -> subplot graph and trusted travel', () => {
    const prior = freshState(); prior.day = 1; prior.turns = 1;
    prior.scene = { location: 'Archive', time: '10:00', clock: 600, tension: 1, weather: '', present: ['mara'], detail: [] };
    prior.cast.mara = { id: 'mara', name: 'Mara', aka: [], status: 'present', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false };
    prior.cast.ada = { id: 'ada', name: 'Ada', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false, lastLocation: 'Courtyard', lastLocationTurn: 1 };
    const parsed: any = {
      day: 1,
      scene: { loc: 'Archive', time: '10:01', clock: 601 },
      present: [{ id: 'Mara', thought: 'The bell should have rung.' }],
      delta: {
        arcs: [{ op: 'new', name: 'The City Conspiracy', note: 'The conspiracy reaches the city gates' }],
        threads: [{ op: 'new', name: 'The Missing Seal', note: 'The missing seal leaves the gate exposed', arc: 'The City Conspiracy' }],
        offscreen: [{ op: 'new', id: 'east_gate_search', name: 'East Gate Search', who: 'Ada', where: 'East Gate', gist: 'searches the East Gate for the missing seal', thread: 'The Missing Seal', arc: 'The City Conspiracy' }],
        parallel: [{ who: 'Ada', where: 'East Gate', activity: 'searches the East Gate for the missing seal' }],
      },
    };
    let seq = 0;
    const events = coreFeature.extract!(parsed, { turn: 2, day: 1, state: prior, prose: 'validated prose', livingWorld: 'active', validatedCompiler: true, seq: () => ++seq });
    const next = reduce(events, structuredClone(prior));
    const arc = next.arcs.find(row => row.name === 'The City Conspiracy')!;
    const thread = next.threads.find(row => row.name === 'The Missing Seal')!;
    expect(thread.arc).toBe(arc.id);
    expect(next.offscreen).toEqual([expect.objectContaining({ id: 'east_gate_search', where: 'East Gate', thread: thread.id })]);
    expect(next.parallel).toEqual([expect.objectContaining({ who: 'ada', where: 'East Gate' })]);

    const candidate = { state: { ...parsed, turn: 2, ext: {} }, parallelOps: [], parallelWorldOps: [], parallelReviewed: [], evidence: [], trackEvidence: [], genesis: false } as StateCandidate;
    expect(auditCompiledEvents(candidate, events)).toEqual([]);
  });

  it('stores and dismisses a rejected plot suggestion through the event log', () => {
    const add = VellumEventSchema.parse({ seq: 1, turn: 3, day: 1, src: 'system', kind: 'plot.suggest', id: 'suggest_3_thread_x', skind: 'thread', row: { op: 'new', name: 'The Unproven Door', note: 'The door may open' }, reason: 'plot proof is not grounded' }) as VellumEvent;
    const drop = VellumEventSchema.parse({ seq: 2, turn: 3, day: 1, src: 'user', kind: 'plot.suggest.drop', id: 'suggest_3_thread_x' }) as VellumEvent;
    const suggested = reduce([add]);
    expect(suggested.plotSuggestions).toEqual([expect.objectContaining({ kind: 'thread', reason: 'plot proof is not grounded' })]);
    expect(reduce([drop], suggested).plotSuggestions).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import type { VellumEvent } from '../src/core/events.js';
import { reduce } from '../src/core/reduce.js';
import { coreFeature } from '../src/domain/core-feature.js';
import { freshState } from '../src/domain/types.js';

let seq = 0;
function ev(e: Partial<VellumEvent> & { kind: VellumEvent['kind'] }): VellumEvent {
  return { seq: ++seq, turn: 1, day: 1, src: 'model', ...(e as object) } as VellumEvent;
}

describe('parallel T1 synchronization', () => {
  it('clears the previous parallel snapshot when a new authoritative scene arrives', () => {
    const state = reduce([
      ev({ kind: 'parallel.set', items: [{ who: 'mara', where: 'Place A', activity: 'waits' }] }),
      ev({ kind: 'scene.set', turn: 2, location: 'Place B', time: '07:45', clock: 465, present: ['mara'] }),
    ]);

    expect(state.scene.location).toBe('Place B');
    expect(state.parallel).toEqual([]);
  });

  it('rejects a same-turn parallel row for a character already in scene.present', () => {
    const state = reduce([
      ev({ kind: 'scene.set', location: 'Place B', present: ['mara'] }),
      ev({ kind: 'parallel.set', items: [
        { who: 'mara', where: 'Place A', activity: 'waits at the old location' },
        { who: 'elara', where: 'Place C', activity: 'closes the gate' },
      ] }),
    ]);

    expect(state.parallel).toEqual([
      expect.objectContaining({ who: 'elara', where: 'Place C', activity: 'closes the gate' }),
    ]);
  });

  it('keeps only the final row when one absent actor is emitted in two places', () => {
    const state = reduce([
      ev({ kind: 'scene.set', location: 'Place C', present: [] }),
      ev({ kind: 'parallel.set', items: [
        { who: 'mara', where: 'Place A', activity: 'starts walking' },
        { who: 'mara', where: 'Place B', activity: 'opens the west door' },
      ] }),
    ]);

    expect(state.parallel).toHaveLength(1);
    expect(state.parallel[0]).toEqual(expect.objectContaining({
      who: 'mara',
      where: 'Place B',
      activity: 'opens the west door',
    }));
  });

  it('preserves an explicit empty parallel array as a clearing event', () => {
    let nextSeq = 0;
    const events = coreFeature.extract!({
      scene: { loc: 'Place B', time: '07:45', clock: 465 },
      present: [{ id: 'Mara' }],
      delta: { parallel: [] },
    } as never, {
      turn: 2,
      day: 1,
      state: freshState(),
      seq: () => ++nextSeq,
    } as never);

    const parallel = events.find((event) => event.kind === 'parallel.set');
    expect(parallel).toBeDefined();
    expect(parallel).toMatchObject({ kind: 'parallel.set', items: [] });
  });

  it('drops the exact stale-location contradiction from a parsed model snapshot', () => {
    let nextSeq = 0;
    const events = coreFeature.extract!({
      scene: { loc: 'Place B', time: '07:45', clock: 465 },
      present: [{ id: 'Mara', doing: 'opens the west door' }],
      delta: { parallel: [
        { who: 'Mara', where: 'Place A', activity: 'waits by the old gate' },
        { who: 'Elara', where: 'Place C', activity: 'reads the dispatch' },
      ] },
    } as never, {
      turn: 3,
      day: 1,
      state: freshState(),
      prose: 'Elara reads the dispatch at Place C while Mara opens the west door at Place B.',
      seq: () => ++nextSeq,
    } as never);

    const state = reduce(events);
    expect(state.scene.present).toContain('mara');
    expect(state.parallel.some((item) => item.who === 'mara')).toBe(false);
    expect(state.parallel).toEqual([
      expect.objectContaining({ who: 'elara', where: 'Place C', activity: 'reads the dispatch' }),
    ]);
  });

  it('preserves a prior actor row when inline state tries to relocate them without travel', () => {
    const prior = freshState();
    prior.scene = { location: 'Archive', time: '07:45', clock: 465, tension: 1, weather: '', present: ['mara'], detail: [] };
    prior.cast.ada = { id: 'ada', name: 'Ada', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, lastLocation: 'Courtyard', lastLocationTurn: 1, userEdited: false };
    prior.parallel = [{ who: 'ada', where: 'Courtyard', activity: 'waits by the fountain', day: 1, turn: 1 }];
    let nextSeq = 0;
    const events = coreFeature.extract!({
      scene: { loc: 'Archive', time: '07:46', clock: 466 },
      present: [{ id: 'Mara' }],
      delta: { parallel: [{ who: 'Ada', where: 'East Gate', activity: 'reads the dispatch' }] },
    } as never, { turn: 2, day: 1, state: prior, prose: 'Mara turns one page in the Archive.', seq: () => ++nextSeq } as never);
    const row = (events.find(event => event.kind === 'parallel.set') as any).items[0];
    expect(row).toMatchObject({ who: 'ada', where: 'Courtyard', activity: 'waits by the fountain' });
  });

  it('accepts an inline location change only when the prose depicts the actor traveling there', () => {
    const prior = freshState();
    prior.scene = { location: 'Archive', time: '07:45', clock: 465, tension: 1, weather: '', present: ['mara'], detail: [] };
    prior.cast.ada = { id: 'ada', name: 'Ada', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, lastLocation: 'Courtyard', lastLocationTurn: 1, userEdited: false };
    prior.parallel = [{ who: 'ada', where: 'Courtyard', activity: 'waits by the fountain', day: 1, turn: 1 }];
    let nextSeq = 0;
    const events = coreFeature.extract!({
      scene: { loc: 'Archive', time: '08:15', clock: 495 },
      present: [{ id: 'Mara' }],
      delta: { parallel: [{ who: 'Ada', where: 'East Gate', activity: 'reads the dispatch' }] },
    } as never, { turn: 2, day: 1, state: prior, prose: 'Ada leaves the Courtyard, walks to the East Gate, and reads the dispatch at the East Gate.', seq: () => ++nextSeq } as never);
    const next = reduce(events, structuredClone(prior));
    expect(next.parallel[0]).toMatchObject({ who: 'ada', where: 'East Gate', activity: 'reads the dispatch' });
    expect(next.cast.ada).toMatchObject({ lastLocation: 'East Gate', lastLocationTurn: 2 });
  });

  it('replaces one grounded anonymous event at the same place instead of retaining stale T0 activity', () => {
    const prior = freshState();
    prior.parallel = [{ where: 'Harbor', activity: 'The ferry channel remains closed', day: 1, turn: 1 }];
    let nextSeq = 0;
    const events = coreFeature.extract!({
      scene: { loc: 'Archive', time: '08:15', clock: 495 },
      present: [],
      delta: { parallel: [{ where: 'Harbor', activity: 'Ferries depart through the reopened channel' }] },
    } as never, { turn: 2, day: 1, state: prior, prose: 'At the Harbor, ferries depart through the reopened channel.', seq: () => ++nextSeq } as never);
    const row = (events.find(event => event.kind === 'parallel.set') as any).items;
    expect(row).toEqual([{ where: 'Harbor', activity: 'Ferries depart through the reopened channel' }]);
  });

  it('accepts ordinary off-screen NPC acts when social autonomy is autonomous', () => {
    const prior = freshState();
    prior.cast.willow = { id: 'willow', name: 'Willow', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false } as any;
    prior.cast.spike = { id: 'spike', name: 'Spike', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false } as any;
    let nextSeq = 0;
    const parsed = {
      scene: { loc: 'Living Room' }, present: [],
      delta: { parallel: [
        { who: 'Willow', where: "Spike's crypt", activity: 'sitting quietly; has told Spike the resurrection news' },
        { who: 'Spike', where: "Spike's crypt", activity: 'processing that Buffy is alive' },
      ] },
    } as never;

    const strict = coreFeature.extract!(parsed, { turn: 2, day: 1, state: prior, prose: 'The living room is quiet.', seq: () => ++nextSeq } as never);
    expect((strict.find(event => event.kind === 'parallel.set') as any).items).toEqual([]);

    const autonomous = coreFeature.extract!(parsed, {
      turn: 2, day: 1, state: prior, prose: 'The living room is quiet.',
      tone: { social: 'autonomous' }, seq: () => ++nextSeq,
    } as never);
    expect((autonomous.find(event => event.kind === 'parallel.set') as any).items).toEqual([
      { who: 'willow', where: "Spike's crypt", activity: 'sitting quietly; has told Spike the resurrection news' },
      { who: 'spike', where: "Spike's crypt", activity: 'processing that Buffy is alive' },
    ]);
  });

  it('autonomous NPCs still cannot teleport or assert irreversible outcomes without grounding', () => {
    const prior = freshState();
    prior.cast.ada = { id: 'ada', name: 'Ada', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, lastLocation: 'Courtyard', lastLocationTurn: 1, userEdited: false } as any;
    let nextSeq = 0;
    const events = coreFeature.extract!({
      scene: { loc: 'Archive' }, present: [], delta: { parallel: [
        { who: 'Ada', where: 'East Gate', activity: 'kills the king' },
      ] },
    } as never, {
      turn: 2, day: 1, state: prior, prose: 'The archive remains quiet.',
      tone: { social: 'autonomous' }, seq: () => ++nextSeq,
    } as never);
    expect((events.find(event => event.kind === 'parallel.set') as any).items).toEqual([]);
  });
});

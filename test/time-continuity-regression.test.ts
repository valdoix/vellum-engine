import { describe, expect, it, vi } from 'vitest';
import { registerFeature } from '../src/bus/registry.js';
import { compileState } from '../src/bus/state-compiler.js';
import { foldTurn } from '../src/bus/lifecycle.js';
import type { VellumEvent } from '../src/core/events.js';
import { reduce } from '../src/core/reduce.js';
import { coreFeature } from '../src/domain/core-feature.js';
import { validateCompilation, type StateCandidate } from '../src/domain/state-compiler.js';
import { freshState } from '../src/domain/types.js';
import { parseState } from '../src/parse/state-block.js';

registerFeature(coreFeature);

const staleInline = '<vellum>{"turn":8,"day":11,"scene":{"loc":"a deliberately longer stale location label","time":"night","clock":1320},"present":[],"delta":{}}</vellum>';
const currentInline = '<vellum>{"turn":9,"day":2,"scene":{"loc":"hall","time":"morning","clock":540},"present":[],"delta":{}}</vellum>';

function compilerCandidate(day: number, time: string, clock: number): StateCandidate {
  return {
    state: {
      turn: 2,
      day,
      scene: { loc: 'Hall', time, clock },
      present: [{ id: 'Player', thought: '' }],
      delta: {},
      ext: {},
    },
    parallelOps: [],
    parallelWorldOps: [],
    parallelReviewed: [],
    evidence: [{ path: 'scene.time', quote: 'Morning' }],
    trackEvidence: [],
    genesis: false,
  };
}

describe('time continuity candidate precedence', () => {
  it('uses the final inline block instead of a larger stale draft', () => {
    const content = `${staleInline}\nThe corrected turn follows.\n${currentInline}`;
    expect(parseState(content).state).toMatchObject({ day: 2, scene: { time: 'morning', clock: 540 } });

    const prior = freshState();
    prior.day = 2;
    prior.scene = { location: 'Hall', time: '09:00', clock: 540, tension: 0, weather: '', present: [], detail: [] };
    prior.sceneDay = 2;
    const folded = foldTurn(content, prior, 9);
    expect(folded.events.find(event => event.kind === 'turn.fold')).toMatchObject({ day: 2 });
    expect(folded.events.find(event => event.kind === 'scene.set')).toMatchObject({ day: 2, time: '09:00', clock: 540 });
  });

  it('orders mixed inline fence spellings by their actual source position', () => {
    const stale = '‹vellum›{"turn":8,"day":11,"scene":{"time":"night","clock":1320},"present":[],"delta":{}}‹/vellum›';
    expect(parseState(`${stale}\n${currentInline}`).state).toMatchObject({ day: 2, scene: { clock: 540 } });
  });

  it('advances a frozen inline clock for completed live action and preserves static instants', () => {
    const prior = freshState();
    prior.day = 2;
    prior.scene = { location: 'Hall', time: '09:00', clock: 540, tension: 0, weather: '', present: [], detail: [] };
    const active = foldTurn(`Mara closes the ledger and asks Ada a question.\n${currentInline}`, prior, 9);
    expect(active.events.find(event => event.kind === 'scene.set')).toMatchObject({ day: 2, time: '09:01', clock: 541 });
    const staticTurn = foldTurn(`The hall is old and cold.\n${currentInline}`, prior, 9);
    expect(staticTurn.events.find(event => event.kind === 'scene.set')).toMatchObject({ day: 2, time: '09:00', clock: 540 });
  });

  it('rolls a frozen live minute across midnight in both the clock and story day', () => {
    const prior = freshState();
    prior.day = 2;
    prior.scene = { location: 'Hall', time: '23:59', clock: 1439, tension: 0, weather: '', present: [], detail: [] };
    const folded = foldTurn('Mara closes the ledger.\n<vellum>{"day":2,"scene":{"loc":"Hall","time":"23:59","clock":1439},"present":[],"delta":{}}</vellum>', prior, 9);
    expect(folded.events.find(event => event.kind === 'turn.fold')).toMatchObject({ day: 3 });
    expect(folded.events.find(event => event.kind === 'scene.set')).toMatchObject({ day: 3, time: '00:00', clock: 0 });
  });

  it('commits the final valid Engine Pass object when a stale draft precedes it', async () => {
    const prior = freshState();
    prior.day = 2;
    prior.scene = { location: 'Hall', time: '08:59', clock: 539, tension: 0, weather: '', present: [], detail: [] };
    const stale = compilerCandidate(2, '09:00', 540);
    const current = compilerCandidate(2, '09:01', 541);
    const generate = vi.fn().mockResolvedValue({ ok: true, value: `${JSON.stringify(stale)}\n${JSON.stringify(current)}` });
    const result = await compileState({ prior, turn: 2, prose: 'Morning arrives.', userName: 'Player', genesisAllowed: false }, null, undefined, generate);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.candidate.state.scene).toMatchObject({ time: '09:01', clock: 541 });
  });

  it('rejects an Engine Pass Day 11/night candidate backed only by Day 11 morning prose', () => {
    const prior = freshState();
    prior.day = 2;
    prior.scene = { location: 'Hall', time: '09:00', clock: 540, tension: 0, weather: '', present: [], detail: [] };
    const wrong = compilerCandidate(11, '22:00', 1320);
    wrong.evidence = [{ path: 'scene.time', quote: 'Day 11. Morning' }];
    const result = validateCompilation(wrong, {
      prior,
      turn: 2,
      prose: 'Day 11. Morning light fills the hall.',
      userName: 'Player',
      genesisAllowed: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('scene.time evidence disagrees with compiled clock');
  });

  it('keeps an absolute day repair and the scene clock in one canonical timeline', () => {
    const corrupted: VellumEvent[] = [
      { seq: 1, turn: 8, day: 11, src: 'system', kind: 'turn.fold', sig: 'bad-turn' },
      { seq: 2, turn: 8, day: 11, src: 'model', kind: 'scene.set', location: 'Hall', time: '22:00', clock: 1320, present: [], detail: [] },
      { seq: 3, turn: 8, day: 2, src: 'user', kind: 'day.set', absolute: true },
    ];
    const repaired = reduce(corrupted);
    expect(repaired).toMatchObject({ day: 2, sceneDay: 2, scene: { clock: 1320 } });

    const next = foldTurn(currentInline, repaired, 9);
    const final = reduce([...corrupted, ...next.events]);
    expect(final).toMatchObject({ day: 2, sceneDay: 2, scene: { time: '09:00', clock: 540 } });
  });

  it('drops only an impossible future previous-scene anchor during repair', () => {
    const state = freshState();
    state.day = 17;
    state.sceneDay = 17;
    state.prevSceneDay = 16;
    const repaired = reduce([
      { seq: 1, turn: 4, day: 3, src: 'user', kind: 'day.set', absolute: true },
    ], state);
    expect(repaired.day).toBe(3);
    expect(repaired.sceneDay).toBe(3);
    expect(repaired.prevSceneDay).toBeUndefined();
  });

  it('does not open a clock-repair window when an absolute day set is a no-op', () => {
    const events: VellumEvent[] = [
      { seq: 1, turn: 3, day: 3, src: 'system', kind: 'turn.fold', sig: 'turn-3' },
      { seq: 2, turn: 3, day: 3, src: 'model', kind: 'scene.set', time: '22:00', clock: 1320, present: [], detail: [] },
      { seq: 3, turn: 3, day: 3, src: 'user', kind: 'day.set', absolute: true },
      { seq: 4, turn: 4, day: 3, src: 'model', kind: 'scene.set', time: '09:00', clock: 540, present: [], detail: [] },
    ];
    expect(reduce(events).scene).toMatchObject({ time: '22:00', clock: 1320 });
  });
});

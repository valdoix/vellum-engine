import { describe, expect, it, vi } from 'vitest';
import { registerFeature } from '../src/bus/registry.js';
import { compileState } from '../src/bus/state-compiler.js';
import { foldTurn } from '../src/bus/lifecycle.js';
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
});

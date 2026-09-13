import { describe, expect, it } from 'vitest';
import { foldTurn } from '../src/bus/lifecycle.js';
import { reduce } from '../src/core/reduce.js';
import { freshState } from '../src/domain/types.js';
import { parseSceneCommand, stripSceneCommand } from '../src/domain/scene-transition.js';
import { STATE_COMPILER_SYSTEM } from '../src/bus/state-compiler.js';

describe('scene transitions', () => {
  it('parses and removes explicit new-scene and time-skip commands', () => {
    expect(parseSceneCommand('((next scene | title=Ash at Dawn | location=North Gate | time=06:10))')).toMatchObject({
      kind: 'scene', title: 'Ash at Dawn', location: 'North Gate', time: '06:10', source: 'command',
    });
    expect(parseSceneCommand('((time skip: three days | title=The Long Return))')).toMatchObject({
      kind: 'time_skip', duration: 'three days', title: 'The Long Return',
    });
    expect(stripSceneCommand('Go on.\n((next scene | title=Ash at Dawn))')).toBe('Go on.');
  });

  it('opens and titles the first scene from model state', () => {
    const prior = freshState();
    const content = 'Rain silvered the North Gate.\n<vellum>{"turn":1,"day":0,"scene":{"title":"Ash at Dawn","transition":"scene","loc":"North Gate","time":"06:10","clock":370},"present":[],"delta":{}}</vellum>';
    const folded = foldTurn(content, prior, 1);
    expect(folded.events.some(event => event.kind === 'scene.open')).toBe(true);
    const state = reduce(folded.events, prior);
    expect(state.scene.title).toBe('Ash at Dawn');
    expect(state.scene.titleSource).toBe('model');
    expect(state.scenes).toHaveLength(1);
  });

  it('reuses a pending new-chat scene and preserves a user title over the model', () => {
    let state = reduce([{ seq: 1, turn: 0, day: 0, src: 'system', kind: 'scene.open', id: 'scn_pending', reason: 'new_chat', pending: true }], freshState());
    const content = 'The shutters opened.\n<vellum>{"turn":1,"day":0,"scene":{"title":"Model Draft","transition":"scene","loc":"Solar","time":"08:00","clock":480},"present":[],"delta":{}}</vellum>';
    const folded = foldTurn(content, state, 1, { userInput: '((next scene | title=The Waking House))' });
    expect(folded.events.filter(event => event.kind === 'scene.open')).toHaveLength(1);
    state = reduce(folded.events, state);
    expect(state.scene.id).toBe('scn_pending');
    expect(state.scene.title).toBe('The Waking House');
  });

  it('asks the compiler to inspect plots from turn one without inventing cadence', () => {
    expect(STATE_COMPILER_SYSTEM).toContain('including turn 1');
    expect(STATE_COMPILER_SYSTEM).toContain('Do not impose a fixed cadence or fabricate movement');
  });

  it('applies a Director time skip to canonical scene time and day', () => {
    const prior = freshState();
    prior.day = 2;
    prior.scene = { id: 'old', location: 'Harbor', time: '08:00', clock: 480, tension: 1, weather: 'clear', present: [], detail: [] };
    const content = 'The road ended beneath the western tower.\n<vellum>{"turn":2,"day":2,"scene":{"loc":"Harbor","time":"08:01","clock":481},"present":[],"delta":{}}</vellum>';
    const folded = foldTurn(content, prior, 2, { sceneIntent: { kind: 'time_skip', source: 'director', title: 'The Long Return', location: 'Western Tower', day: 5, time: '17:30', duration: 'three days' } });
    const state = reduce(folded.events, prior);
    expect(state.day).toBe(5);
    expect(state.scene).toMatchObject({ title: 'The Long Return', titleSource: 'user', reason: 'time_skip' });
    expect(folded.events.some(event => event.kind === 'continuity.flag')).toBe(false);
  });
});

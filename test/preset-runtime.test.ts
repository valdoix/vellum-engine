import { describe, expect, it } from 'vitest';
import { resolveTurnContract } from '../src/domain/preset-runtime.js';

function argent(values: Record<string, unknown> = {}) {
  return {
    id: 'imported-id',
    name: 'VELLUM II — ARGENT LOOM',
    metadata: { promptVariables: { 'arg-control': values } },
    prompt_order: [
      {
        id: 'arg-control', variables: [
          { name: 'state_on', type: 'switch', defaultValue: 1 },
          { name: 'dialogue_color', type: 'switch', defaultValue: 1 },
          { name: 'reasoning_route', type: 'select', defaultValue: 'compact', options: [] },
          { name: 'state_compiler', type: 'select', defaultValue: 'engine', options: [] },
          { name: 'state_verbosity', type: 'select', defaultValue: 'lean', options: [] },
          { name: 'codex', type: 'switch', defaultValue: 1 },
          { name: 'inventory', type: 'switch', defaultValue: 1 },
        ],
      },
      { id: 'arg-output-contract' },
    ],
  } as any;
}

describe('active preset turn contract', () => {
  it('uses ARGENT defaults when the preset has no stored overrides', () => {
    expect(resolveTurnContract(argent())).toMatchObject({
      active: true, argent: true, state: true, reverie: true, dialogueColor: true,
      reasoningRoute: 'compact', stateCompiler: 'engine', stateVerbosity: 'lean', codex: true, inventory: true,
    });
  });

  it('honors state and dialogue controls from the active preset', () => {
    expect(resolveTurnContract(argent({ state_on: 0, dialogue_color: 0, reasoning_route: 'silent' })))
      .toMatchObject({ state: false, reverie: false, dialogueColor: false });
  });

  it('expects a visible reverie for both compact and verbose routes', () => {
    expect(resolveTurnContract(argent({ reasoning_route: 'verbose' }))?.reverie).toBe(true);
    expect(resolveTurnContract(argent({ reasoning_route: 'native' }))?.reverie).toBe(false);
  });

  it('does not activate for an unrelated preset', () => {
    expect(resolveTurnContract({ id: 'other', name: 'Other', prompt_order: [], metadata: {} } as any)).toBeNull();
  });
});

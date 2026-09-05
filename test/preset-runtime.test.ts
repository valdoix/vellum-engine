import { describe, expect, it } from 'vitest';
import { applyArgentPolicy, compileArgentPolicy } from '../src/domain/argent-policy.js';
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
          { name: 'reasoning_route', type: 'select', defaultValue: 'compact', options: [
            { id: 'compact', label: 'Compact Reverie', value: 'compact-contract' },
            { id: 'verbose', label: 'Verbose Reverie', value: 'verbose-contract' },
            { id: 'native', label: 'Native Private Reasoning', value: 'native-contract' },
            { id: 'silent', label: 'Silent One-Pass', value: 'silent-contract' },
          ] },
          { name: 'state_compiler', type: 'select', defaultValue: 'engine', options: [
            { id: 'engine', label: 'Engine Second Pass', value: 'compile separately' },
            { id: 'inline', label: 'Inline Compatibility', value: 'write state inline' },
          ] },
          { name: 'state_verbosity', type: 'select', defaultValue: 'lean', options: [
            { id: 'lean', label: 'Lean', value: 'compact schema' },
            { id: 'full', label: 'Full', value: 'complete schema' },
          ] },
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

  it('canonicalizes stored select labels or expanded values before resolving the contract', () => {
    expect(resolveTurnContract(argent({
      reasoning_route: 'Verbose Reverie',
      state_compiler: 'compile separately',
      state_verbosity: 'complete schema',
    }))).toMatchObject({
      reverie: true,
      reasoningRoute: 'verbose',
      stateCompiler: 'engine',
      stateVerbosity: 'full',
    });
  });

  it('makes a selected Reverie a literal visible prefix in Engine Second Pass', () => {
    const preset = argent({ reasoning_route: 'compact', state_compiler: 'engine' });
    const policy = compileArgentPolicy(preset.prompt_order, preset.metadata.promptVariables);
    expect(policy).toContain('visible response MUST begin with the literal <reverie> tag');
    expect(policy).toContain('engine compiles state separately');
    expect(policy).toContain('Do not emit JSON or a <vellum> block');
  });

  it('can append the resolved policy when a host strips ARGENT source comments', () => {
    const messages = [{ role: 'system', content: 'assembled ARGENT doctrine without source comments' }];
    const out = applyArgentPolicy(messages, '[ARGENT EFFECTIVE POLICY]', true);
    expect(out).toHaveLength(2);
    expect(out.at(-1)?.content).toBe('[ARGENT EFFECTIVE POLICY]');
  });

  it('does not activate for an unrelated preset', () => {
    expect(resolveTurnContract({ id: 'other', name: 'Other', prompt_order: [], metadata: {} } as any)).toBeNull();
  });
});

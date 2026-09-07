import { describe, expect, it } from 'vitest';
import { applyArgentPolicy, compileArgentPolicy } from '../src/domain/argent-policy.js';
import { agencyAtTurn, parseTurnAgencyLedger, prospectiveAssistantTurn, recordTurnAgency, resolveTurnContract, resolveTurnContractFromMessages, serializeTurnAgencyLedger } from '../src/domain/preset-runtime.js';

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
          { name: 'living_world', type: 'select', defaultValue: 'active', options: [
            { id: 'off', label: 'Off', value: 'off' },
            { id: 'minimal', label: 'Minimal', value: 'minimal' },
            { id: 'active', label: 'Active', value: 'active' },
            { id: 'sandbox', label: 'Sandbox', value: 'sandbox' },
          ] },
          { name: 'agency', type: 'select', defaultValue: 'protected', options: [
            { id: 'protected', label: 'Forbidden', value: 'protected' },
            { id: 'continuity', label: 'Minor Continuity', value: 'continuity' },
            { id: 'director', label: 'Director', value: 'director' },
          ] },
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
      livingWorld: 'active', agency: 'protected',
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
    expect(policy).toContain('Do not emit any state tag, JSON, ledger or state commentary');
    expect(policy).not.toContain('<vellum>');
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

  it('uses the effective profile marker from the assembled host prompt', () => {
    const contract = resolveTurnContractFromMessages(argent({ state_on: 1, reasoning_route: 'compact' }), [{
      role: 'system',
      content: '<!--VELLUM-EFFECTIVE {"state":0,"compiler":"inline","verbosity":"full","reasoning":"silent","agency":"director","dialogueColor":0,"codex":0,"inventory":0,"worldgen":1,"livingWorld":"sandbox"}-->',
    }]);
    expect(contract).toMatchObject({
      state: false, stateCompiler: 'inline', stateVerbosity: 'full', reasoningRoute: 'silent', reverie: false,
      dialogueColor: false, codex: false, inventory: false, worldgen: true, livingWorld: 'sandbox', agency: 'director',
    });
  });

  it('resolves agency from each turn marker without carrying the prior turn forward', () => {
    const preset = argent({ agency: 'protected' });
    const forbidden = resolveTurnContractFromMessages(preset, [{ role: 'system', content: '<!--VELLUM-EFFECTIVE {"agency":"protected"}-->' }]);
    const continuity = resolveTurnContractFromMessages(preset, [{ role: 'system', content: '<!--VELLUM-EFFECTIVE {"agency":"continuity"}-->' }]);
    const director = resolveTurnContractFromMessages(preset, [{ role: 'system', content: '<!--VELLUM-EFFECTIVE {"agency":"director"}-->' }]);
    expect(forbidden?.agency).toBe('protected');
    expect(continuity?.agency).toBe('continuity');
    expect(director?.agency).toBe('director');
  });

  it('records compact per-turn agency runs and preserves later turns during a refold', () => {
    let ledger = parseTurnAgencyLedger('');
    ledger = recordTurnAgency(ledger, 1, 'protected');
    ledger = recordTurnAgency(ledger, 2, 'director');
    ledger = recordTurnAgency(ledger, 3, 'director');
    expect(ledger).toEqual({ through: 3, runs: [[2, 'director']] });
    ledger = recordTurnAgency(ledger, 1, 'continuity');
    expect(agencyAtTurn(ledger, 1)).toBe('continuity');
    expect(agencyAtTurn(ledger, 2)).toBe('director');
    expect(parseTurnAgencyLedger(serializeTurnAgencyLedger(ledger))).toEqual(ledger);
  });

  it('targets the next assistant turn from chat history only', () => {
    expect(prospectiveAssistantTurn([
      { role: 'assistant', content: 'instructional example', __isChatHistory: false },
      { role: 'assistant', content: 'turn one', __isChatHistory: true },
      { role: 'user', content: 'next', __isChatHistory: true },
    ])).toBe(2);
  });

  it('infers Living World mode from an expanded legacy prompt when no marker exists', () => {
    const contract = resolveTurnContractFromMessages(argent({ living_world: 'off' }), [{
      role: 'system',
      content: '[LIVING WORLD]\nThe world does not pause when Player looks away. Absent characters pursue established goals.\n[OUTPUT — FOLLOW EXACTLY]',
    }]);
    expect(contract?.livingWorld).toBe('active');
  });

  it('infers effective expanded controls for older ARGENT presets without a marker', () => {
    const contract = resolveTurnContractFromMessages(argent({ reasoning_route: 'compact', state_compiler: 'engine' }), [{
      role: 'system',
      content: '[ARGENT — PRIVATE]\n[OUTPUT — FOLLOW EXACTLY]\n[VELLUM STATE — FULL CONTRACT]\n[COLORED DIALOGUE — CONTRACT]\n[THE CODEX]\next.codex\n[POSSESSIONS]\next.inventory',
    }]);
    expect(contract).toMatchObject({
      reasoningRoute: 'native', reverie: false, state: true, stateCompiler: 'inline', stateVerbosity: 'full',
      dialogueColor: true, codex: true, inventory: true,
    });
  });

  it('keeps Engine Second Pass active when an older host strips the effective marker', () => {
    const contract = resolveTurnContractFromMessages(argent({ state_on: 1, state_compiler: 'inline' }), [{
      role: 'system',
      content: '[OUTPUT — FOLLOW EXACTLY]\n[ENGINE SECOND PASS] Finish story prose. The engine compiles and validates state separately.\n[FINAL AGENCY ANCHOR — director]',
    }]);
    expect(contract).toMatchObject({ state: true, stateCompiler: 'engine', agency: 'director' });
  });
});

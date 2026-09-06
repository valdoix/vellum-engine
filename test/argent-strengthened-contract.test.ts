import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expandMacros } from '../src/domain/preset-macro-lite.js';

interface PromptVariable {
  name: string;
  defaultValue: unknown;
  description?: string;
  separator?: string;
  options?: Array<{ id: string; value?: unknown }>;
}

interface PromptBlock {
  id: string;
  content: string;
  variables?: PromptVariable[];
}

const preset = JSON.parse(
  readFileSync(new URL('../presets/argent-loom.json', import.meta.url), 'utf8'),
) as { presetVersion: string; blocks: PromptBlock[] };

function block(id: string): string {
  const found = preset.blocks.find((entry) => entry.id === id);
  if (!found) throw new Error(`ARGENT block not found: ${id}`);
  return found.content;
}

function variable(name: string): PromptVariable {
  const found = preset.blocks.flatMap((entry) => entry.variables ?? []).find((entry) => entry.name === name);
  if (!found) throw new Error(`ARGENT variable not found: ${name}`);
  return found;
}

function promptValues(overrides: Record<string, unknown> = {}): Record<string, string> {
  const values: Record<string, string> = {};
  for (const def of preset.blocks.flatMap((entry) => entry.variables ?? [])) {
    const raw = Object.prototype.hasOwnProperty.call(overrides, def.name) ? overrides[def.name] : def.defaultValue;
    const expandOption = (value: unknown) => def.options?.find((option) => option.id === String(value))?.value ?? value;
    values[def.name] = Array.isArray(raw)
      ? raw.map(expandOption).join(def.separator ?? ', ')
      : String(expandOption(raw) ?? '');
  }
  return values;
}

function expandedBlock(id: string, overrides: Record<string, unknown> = {}): string {
  return expandMacros(block(id), promptValues(overrides)).replace(/<!--\/?ARGENT-SOURCE[^>]*-->/g, '').trim();
}

describe('ARGENT strengthened invariants', () => {
  it('ships the 1.2 control surface without Guided Choices', () => {
    expect(preset.presetVersion).toBe('1.2.1');
    expect(() => variable('guided_choices')).toThrow();
    expect(preset.blocks.some((entry) => entry.content.includes('<argent-choices>'))).toBe(false);
  });

  it('makes the protected player boundary explicit at the main and final layers', () => {
    expect(block('arg-channel-agency')).toContain('An attempted action authorizes only the stated attempt');
    expect(block('arg-channel-agency')).toContain('Second-person grammar is not permission');
    expect(block('arg-final-anchor')).toContain('PROTECTED-AGENCY FORBIDDEN-PREDICATE GATE');
    expect(block('arg-output-contract')).toContain('PLAYER AUTHORSHIP — NON-NEGOTIABLE FINAL GATE');
    expect(block('arg-state-final')).toContain('state must not invent player behavior');
  });

  it('requires an exact 24-hour clock and matching minutes in every active scene', () => {
    const reality = block('arg-reality-time');
    const schema = block('arg-state-schema');
    const output = block('arg-output-contract');
    expect(reality).toContain('one exact zero-padded 24-hour live clock');
    expect(reality).toContain('scene.clock is the same instant as integer minutes after midnight');
    expect(reality).toContain('Never store a narrative period in scene.time');
    expect(schema).toContain('"time":"07:45","clock":465');
    expect(output).toContain('EXACT CLOCK — REQUIRED FINAL GATE');
    expect(variable('time_continuity').description).toContain('07:45');
    expect(reality.indexOf('{{/if}}\n\n[WORLD LAW]')).toBeGreaterThan(0);
  });

  it('activates ambient world texture at all three levels', () => {
    const texture = block('arg-world-texture');
    expect(texture).toContain('[AMBIENT WORLD PRESSURE]');
    expect(texture).toContain('{{var::world_broadsheet}}');
    expect(expandedBlock('arg-world-texture', { world_texture: 'backdrop' })).toContain('restrained scenery');
    expect(expandedBlock('arg-world-texture', { world_texture: 'living' })).toContain('one concrete ambient pressure');
    expect(expandedBlock('arg-world-texture', { world_texture: 'insistent' })).toContain('materially intrude');
    expect(expandedBlock('arg-world-texture', { world_texture: 'insistent', world_broadsheet: 1, vtk_cards: 1 })).toContain('[BROADSHEET|body]');
    expect(expandedBlock('arg-world-texture', { world_texture: 'living', world_broadsheet: 1, vtk_cards: 1 })).not.toContain('[BROADSHEET|body]');
  });

  it('uses genuinely separate Lean and Full state contracts while retaining every NPC thought', () => {
    const schema = block('arg-state-schema');
    const compiler = block('arg-state-final');
    expect(schema).toContain('{{eq::{{var::state_verbosity}}::lean}}');
    expect(schema).toContain('{{eq::{{var::state_verbosity}}::full}}');
    expect(schema).toContain('[VELLUM STATE — LEAN CONTRACT]');
    expect(schema).toContain('[VELLUM STATE — FULL CONTRACT]');
    expect(compiler).toContain('[FINAL STATE COMPILER — LEAN, ATOMIC AND MANDATORY]');
    expect(compiler).toContain('[FINAL STATE COMPILER — FULL, ATOMIC AND MANDATORY]');
    expect(schema).toContain('List every named on-stage NPC and give each a concise first-person private thought');
    expect(compiler).toContain('Include every named on-stage NPC with a concise private first-person thought');
    expect(expandedBlock('arg-state-schema', { state_verbosity: 'lean' })).toContain('VELLUM STATE — LEAN CONTRACT');
    expect(expandedBlock('arg-state-schema', { state_verbosity: 'lean' })).not.toContain('VELLUM STATE — FULL CONTRACT');
    expect(expandedBlock('arg-state-schema', { state_verbosity: 'full' })).toContain('VELLUM STATE — FULL CONTRACT');
    expect(expandedBlock('arg-state-schema', { state_verbosity: 'full' })).not.toContain('VELLUM STATE — LEAN CONTRACT');
  });

  it('offers a bounded eight-section Verbose Reverie route', () => {
    const route = variable('reasoning_route') as PromptVariable & { options?: Array<{ id: string }> };
    const controller = block('arg-controller');
    const output = block('arg-output-contract');
    expect(route.options?.some((option) => option.id === 'verbose')).toBe(true);
    expect(controller).toContain('[ARGENT — VERBOSE REVERIE]');
    expect(controller).toContain('roughly 250–500 words');
    expect(controller).toContain('X — Final checks');
    expect(output).toContain('eight detailed Verbose audit sections');
  });

  it('assembles every planning route correctly with state on and off', () => {
    for (const stateOn of [0, 1]) {
      for (const route of ['compact', 'verbose', 'native', 'silent']) {
        const output = expandedBlock('arg-output-contract', { state_on: stateOn, reasoning_route: route });
        const visibleReverie = route === 'compact' || route === 'verbose';
        expect(output.includes('<reverie>'), `${route}, state=${stateOn}`).toBe(visibleReverie);
        expect(output.includes('<vellum>'), `${route}, state=${stateOn}`).toBe(stateOn === 1);
      }
    }
    const verbose = expandedBlock('arg-controller', { reasoning_route: 'verbose', state_on: 1 });
    for (const label of ['A — Authority', 'R — Reality', 'G — Gnosis', 'E — Embodiment', 'N — Narrative', 'T — Truthful deltas', 'V — Voice', 'X — Final checks']) {
      expect(verbose).toContain(label);
    }
  });

  it('enables colored dialogue by default and enforces a one-speaker/one-wrapper audit', () => {
    const dialogue = block('arg-colored-dialogue-contract');
    const output = block('arg-output-contract');
    expect(variable('dialogue_color').defaultValue).toBe(1);
    expect(dialogue).toContain('[spk=Canonical Cast Name]');
    expect(dialogue).toContain('Never nest wrappers or place two speakers in one wrapper');
    expect(dialogue).toContain('FINAL COLOR AUDIT');
    expect(output).toContain('Never leave eligible direct speech bare');
    expect(expandedBlock('arg-colored-dialogue-contract', { dialogue_color: 0 })).toBe('');
    expect(expandedBlock('arg-output-contract', { dialogue_color: 0 })).not.toContain('COLORED DIALOGUE');
  });

  it('makes prose-only mode a genuinely state-free output contract', () => {
    const output = expandedBlock('arg-output-contract', { state_on: 0, reasoning_route: 'silent' });
    expect(output).toContain('Story prose only');
    expect(output).not.toContain('<vellum>');
    expect(output).not.toContain('STATE SERIALIZATION');
    expect(output).not.toContain('final scene snapshot');
    expect(expandedBlock('arg-state-schema', { state_on: 0 }).trim()).toBe('');
    expect(expandedBlock('arg-state-final', { state_on: 0 }).trim()).toBe('');
    const assembled = preset.blocks.map((entry) => expandMacros(entry.content, promptValues({ state_on: 0 }))).join('\n');
    expect(assembled).not.toContain('<vellum>');
    expect(assembled).not.toContain('</vellum>');
    expect(assembled).not.toContain('[VELLUM STATE');
  });

  it('reaches Living World parallel gates using expanded option values', () => {
    expect(expandedBlock('arg-output-contract', { state_on: 1, living_world: 'active' })).toContain('PARALLEL EVENTS — CURRENT T1 SNAPSHOT GATE');
    expect(expandedBlock('arg-output-contract', { state_on: 1, living_world: 'sandbox' })).toContain('PARALLEL EVENTS — CURRENT T1 SNAPSHOT GATE');
    expect(expandedBlock('arg-output-contract', { state_on: 1, living_world: 'off' })).not.toContain('PARALLEL EVENTS — CURRENT T1 SNAPSHOT GATE');
  });

  it('reconciles parallel events as a final T1 snapshot instead of stale history', () => {
    const world = block('arg-world-factions');
    const schema = block('arg-state-schema');
    const compiler = block('arg-state-final');
    const output = block('arg-output-contract');
    expect(world).toContain('[PARALLEL T1 RECONCILIATION]');
    expect(world).toContain('MUST NOT appear in parallel');
    expect(world).toContain('moved from Place A to Place B');
    expect(schema).toContain('complete current T1 snapshot');
    expect(schema).toContain('Use [] to clear stale items');
    expect(compiler).toContain('PARALLEL RECONCILIATION');
    expect(output).toContain('[PARALLEL EVENTS — CURRENT T1 SNAPSHOT GATE]');
  });

  it('keeps off-scene conversations partitioned by witness and transmission path', () => {
    const knowledge = block('arg-knowledge');
    const controller = block('arg-controller');
    const compiler = block('arg-state-final');
    const output = block('arg-output-contract');
    expect(knowledge).toContain('[SCENE-PRESENCE FIREWALL — PER CHARACTER, PER FACT]');
    expect(knowledge).toContain('If B and C speak while A is absent');
    expect(knowledge).toContain('Entering later grants access only from the moment of entry');
    expect(knowledge).toContain('A visible aftermath may justify a coarse suspicion, never the hidden transcript');
    expect(controller).toContain('per-character witness or transmission paths');
    expect(compiler).toContain('KNOWLEDGE PARTITION');
    expect(compiler).toContain('remains unaware until an explicit bridge reaches them');
    expect(output).toContain('[OFF-SCENE KNOWLEDGE — NON-NEGOTIABLE FINAL GATE]');
    expect(output).toContain('Later entry never grants retroactive hearing');
    expect(output).toContain('if no access path can be named, keep A unaware');
  });

  it('enables causal NPC-to-NPC dialogue without weakening agency or knowledge', () => {
    const groupScene = block('arg-interiority-groups');
    const output = block('arg-output-contract');
    expect(variable('npc_dialogue').defaultValue).toBe(1);
    expect(groupScene).toContain('[NPC-TO-NPC DIALOGUE — ACTIVE]');
    expect(groupScene).toContain('without waiting for {{user}} to prompt each exchange');
    expect(groupScene).toContain('Absent characters cannot join');
    expect(groupScene).toContain('NPC dialogue never supplies speech, thought, reaction, or consent for {{user}}');
    expect(groupScene).toContain('[NPC-TO-NPC DIALOGUE — MINIMAL]');
    expect(output).toContain('[NPC-TO-NPC DIALOGUE — ACTIVE FINAL GATE]');
    expect(output).toContain('let them address and respond to one another directly');
    expect(output).toContain('no filler, round-robin quota, shared omniscience, absent speaker, or invented player response');
  });

  it('keeps all conditional prompt macros balanced', () => {
    for (const entry of preset.blocks) {
      const opens = entry.content.match(/\{\{if::/g)?.length ?? 0;
      const closes = entry.content.match(/\{\{\/if\}\}/g)?.length ?? 0;
      expect(closes, entry.id).toBe(opens);
    }
  });
});

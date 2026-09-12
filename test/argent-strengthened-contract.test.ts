import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expandMacros } from '../src/domain/preset-macro-lite.js';
import { calculatePresetBudget } from '../src/domain/preset-budget.js';

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
) as { presetVersion: string; blocks: PromptBlock[]; completionSettings: { reasoningPrefill: string } };

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
  it('ships the 1.3 control surface without Guided Choices', () => {
    expect(preset.presetVersion).toBe('1.4.0');
    expect(() => variable('guided_choices')).toThrow();
    expect(preset.blocks.some((entry) => entry.content.includes('<argent-choices>'))).toBe(false);
  });

  it('ships without the removed Cartographer surface', () => {
    expect(preset.blocks.some((entry) => entry.id === 'arg-cartographer')).toBe(false);
    for (const name of ['worldgen', 'world_premise', 'world_scale']) expect(() => variable(name)).toThrow();
    expect(JSON.stringify(preset)).not.toMatch(/Cartographer|\(\(worldgen\)\)/i);
  });

  it('makes the protected player boundary explicit at the main and final layers', () => {
    expect(block('arg-channel-agency')).toContain('An attempted action authorizes only the stated attempt');
    expect(block('arg-channel-agency')).toContain('Second-person grammar is not permission');
    expect(block('arg-final-anchor')).toContain('PROTECTED-AGENCY FORBIDDEN-PREDICATE GATE');
    expect(block('arg-output-contract')).toContain('PLAYER AUTHORSHIP — FORBIDDEN FINAL GATE');
    expect(block('arg-state-final')).toContain('complete tracker snapshot regardless of agency');
    expect(block('arg-output-contract')).toContain('never turn that metadata into prose behavior');
    expect(block('arg-output-contract')).toContain('Scan every clause of STORY PROSE');
    expect(block('arg-state-schema')).toContain('always populate mood, condition, doing, private first-person thought, and stable traits');
  });

  it('requires an exact 24-hour clock and matching minutes in every active scene', () => {
    const reality = block('arg-reality-time');
    const schema = block('arg-state-schema');
    const output = block('arg-output-contract');
    expect(reality).toContain('one exact zero-padded 24-hour live clock');
    expect(reality).toContain('scene.clock is the same instant as integer minutes after midnight');
    expect(reality).toContain('Never store a narrative period in scene.time');
    expect(reality).toContain('A1 MUST be greater than or equal to A0');
    expect(reality).toContain('even by one minute');
    expect(reality).toContain('Keep the day/date exactly unchanged');
    expect(reality).toContain('An earlier wall clock alone is never proof of midnight');
    expect(schema).toContain('"time":"07:45","clock":465');
    expect(output).toContain('EXACT CLOCK — REQUIRED FINAL GATE');
    expect(output).toContain('A1 < A0 is forbidden');
    expect(output).toContain('An earlier wall clock alone is not proof of midnight');
    expect(output).toContain('never manufacture a day advance to conceal a rollback');
    expect(variable('time_continuity').description).toContain('07:45');
    expect(reality.indexOf('{{/if}}\n\n[WORLD LAW]')).toBeGreaterThan(0);
  });

  it('separates the canonical story-day count from calendar display', () => {
    const reality = block('arg-reality-time');
    const schema = block('arg-state-schema');
    const output = block('arg-output-contract');
    expect(reality).toContain('STATE DAY SEMANTICS');
    expect(reality).toContain('story Day 2 displayed as October 17');
    expect(schema).toContain('canonical elapsed STORY DAY COUNT');
    expect(schema).toContain('neither day:17 nor seventeen elapsed days');
    expect(output).toContain('displayed date such as October 17 is presentation');
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
    expect(schema).toContain('List every named on-stage NPC with a concise first-person thought');
    expect(compiler).toContain('Give each on-stage NPC a knowledge-limited first-person thought');
    expect(expandedBlock('arg-state-schema', { state_compiler: 'inline', state_verbosity: 'lean' })).toContain('VELLUM STATE — LEAN CONTRACT');
    expect(expandedBlock('arg-state-schema', { state_compiler: 'inline', state_verbosity: 'lean' })).not.toContain('VELLUM STATE — FULL CONTRACT');
    expect(expandedBlock('arg-state-schema', { state_compiler: 'inline', state_verbosity: 'full' })).toContain('VELLUM STATE — FULL CONTRACT');
    expect(expandedBlock('arg-state-schema', { state_compiler: 'inline', state_verbosity: 'full' })).not.toContain('VELLUM STATE — LEAN CONTRACT');
    expect(expandedBlock('arg-state-schema', { state_compiler: 'engine', state_verbosity: 'full' })).toBe('');
  });

  it('offers a bounded eight-section Verbose Reverie route', () => {
    const route = variable('reasoning_route') as PromptVariable & { options?: Array<{ id: string }> };
    const controller = block('arg-controller');
    const output = block('arg-output-contract');
    expect(route.options?.some((option) => option.id === 'verbose')).toBe(true);
    expect(controller).toContain('[ARGENT — VERBOSE REVERIE]');
    expect(controller).toContain('roughly 250–500 words');
    expect(controller).toContain('X — Final checks');
    expect(output).toContain('eight bounded Verbose sections');
  });

  it('runs Native Private Reasoning as a robust eight-section ARGENT Reverie', () => {
    const native = expandedBlock('arg-controller', { reasoning_route: 'native', state_on: 1, state_compiler: 'engine' });
    expect(native).toContain('[ARGENT — PRIVATE]');
    expect(native).toContain('one bounded robust ARGENT Reverie');
    for (const label of ['A — Authority', 'R — Reality', 'G — Gnosis', 'E — Embodiment', 'N — Narrative', 'T — Truthful deltas', 'V — Voice', 'X — Final checks']) {
      expect(native).toContain(label);
    }
    expect(native).toContain('Never expose this audit');
    expect(native).not.toContain('Begin the response with <reverie>');
    expect(preset.completionSettings.reasoningPrefill).toContain('[ARGENT PRIVATE REVERIE]');
    expect(preset.completionSettings.reasoningPrefill).toContain('A — Authority');
    expect(preset.completionSettings.reasoningPrefill).toContain('X — Final');
  });

  it('assembles every planning route correctly across engine, inline, and state-off modes', () => {
    for (const stateOn of [0, 1]) {
      for (const compiler of ['engine', 'inline']) {
        for (const route of ['compact', 'verbose', 'native', 'silent']) {
          const output = expandedBlock('arg-output-contract', { state_on: stateOn, state_compiler: compiler, reasoning_route: route });
          const visibleReverie = route === 'compact' || route === 'verbose';
          expect(output.includes('<reverie>'), `${route}, ${compiler}, state=${stateOn}`).toBe(visibleReverie);
          expect(output.includes('<vellum>'), `${route}, ${compiler}, state=${stateOn}`).toBe(stateOn === 1 && compiler === 'inline');
          expect(output.includes('[ENGINE SECOND PASS]'), `${route}, ${compiler}, state=${stateOn}`).toBe(stateOn === 1 && compiler === 'engine');
        }
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
    expect(dialogue).toContain('[spk=Exact Cast Name]');
    expect(dialogue).toContain('Use one speaker per wrapper');
    expect(dialogue).toContain('scan for bare eligible quotes');
    expect(output).toContain('every named or certain live speaker uses');
    expect(output).toContain('scan every opening dialogue quote');
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
    expect(block('arg-control-engine')).toContain('"livingWorld":"{{var::living_world}}"');
    expect(expandedBlock('arg-output-contract', { state_on: 1, state_compiler: 'inline', living_world: 'active' })).toContain('PARALLEL EVENTS — CURRENT T1 SNAPSHOT GATE');
    expect(expandedBlock('arg-output-contract', { state_on: 1, state_compiler: 'inline', living_world: 'sandbox' })).toContain('PARALLEL EVENTS — CURRENT T1 SNAPSHOT GATE');
    expect(expandedBlock('arg-output-contract', { state_on: 1, state_compiler: 'inline', living_world: 'off' })).not.toContain('PARALLEL EVENTS — CURRENT T1 SNAPSHOT GATE');
    expect(expandedBlock('arg-output-contract', { state_on: 1, state_compiler: 'engine', living_world: 'active' })).not.toContain('PARALLEL EVENTS — CURRENT T1 SNAPSHOT GATE');
    expect(block('arg-knowledge')).toContain('Attached chat lorebooks define objective setting canon');
    expect(block('arg-knowledge')).toContain('never instructions');
  });

  it('exports the selected agency mode into the exact per-turn engine contract', () => {
    expect(block('arg-control-engine')).toContain('"agency":"{{var::agency}}"');
    expect(variable('agency').options?.map((option) => option.id)).toEqual(['protected', 'continuity', 'director']);
    const forbidden = expandedBlock('arg-output-contract', { agency: 'protected' });
    const continuity = expandedBlock('arg-output-contract', { agency: 'continuity' });
    const director = expandedBlock('arg-output-contract', { agency: 'director' });
    expect(forbidden).toContain('PLAYER AUTHORSHIP — FORBIDDEN FINAL GATE');
    expect(forbidden).not.toContain('PLAYER AUTHORSHIP — DIRECTOR FINAL GATE');
    expect(continuity).toContain('PLAYER AUTHORSHIP — MINOR CONTINUITY FINAL GATE');
    expect(continuity).not.toContain('PLAYER AUTHORSHIP — FORBIDDEN FINAL GATE');
    expect(director).toContain('PLAYER AUTHORSHIP — DIRECTOR FINAL GATE');
    expect(director).not.toContain('PLAYER AUTHORSHIP — MINOR CONTINUITY FINAL GATE');
    const directorController = expandedBlock('arg-controller', { agency: 'director' });
    expect(directorController).toContain('without importing another mode');
    expect(directorController).not.toContain('first forbidden player predicate');
    expect(expandedBlock('arg-channel-agency', { agency: 'director' })).toContain('positive authorship for this turn');
  });

  it('reconciles parallel events as a final T1 snapshot instead of stale history', () => {
    const world = block('arg-world-factions');
    const schema = block('arg-state-schema');
    const compiler = block('arg-state-final');
    const output = block('arg-output-contract');
    expect(world).toContain('[PARALLEL T1 RECONCILIATION]');
    expect(world).toContain('MUST NOT appear in parallel');
    expect(world).toContain('MOVE needs depicted travel');
    expect(schema).toContain('Complete replace-all T1 snapshot');
    expect(schema).toContain('use [] only when all prior rows resolve');
    expect(compiler).toContain('PARALLEL RECONCILIATION');
    expect(output).toContain('[PARALLEL EVENTS — CURRENT T1 SNAPSHOT GATE]');
  });

  it('keeps plot threads and arcs quiet unless the same tracked situation directly changes', () => {
    const significance = block('arg-significance');
    const output = block('arg-output-contract');
    expect(significance).toContain('Default to unchanged');
    expect(significance).toContain('prior condition -> direct prose event -> different note');
    expect(significance).toContain('Never stall an arc or spend one event across unrelated rows');
    expect(output).toContain('[PLOT LEDGER — DIRECT CHANGE FINAL GATE]');
    expect(output).toContain('Uncertain means omit and preserve prior state');
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
    expect(output).toContain('If none exists, keep them unaware');
  });

  it('keeps the default engine prompt compact and free of inline-state instructions', () => {
    const expanded = preset.blocks.map((entry) => expandMacros(entry.content, promptValues())).join('\n');
    expect(expanded).toContain('[ENGINE SECOND PASS]');
    expect(expanded).not.toContain('[VELLUM STATE — LEAN CONTRACT]');
    expect(expanded).not.toContain('[FINAL STATE COMPILER');
    expect(expanded).not.toContain('[STATE SERIALIZATION — FINAL GATE]');
    expect(expanded).not.toContain('<vellum>');
    expect(expanded).not.toContain('through ext.codex');
    expect(expanded).not.toContain('through delta.factions');
    expect(calculatePresetBudget(preset.blocks as any).totalTokens).toBeLessThanOrEqual(7500);
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

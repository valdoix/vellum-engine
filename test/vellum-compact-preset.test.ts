import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calculatePresetBudget } from '../src/domain/preset-budget.js';
import { expandMacros } from '../src/domain/preset-macro-lite.js';
import { assessVellumStateContract } from '../src/domain/preset-health.js';
import { resolveTurnContract } from '../src/domain/preset-runtime.js';

interface Variable {
  name: string;
  defaultValue: unknown;
  options?: Array<{ id: string; value?: unknown }>;
}
interface Block {
  id: string;
  name: string;
  enabled: boolean;
  content: string;
  marker?: string | null;
  position: string;
  variables?: Variable[];
}

const preset = JSON.parse(readFileSync(new URL('../presets/vellum-compact.json', import.meta.url), 'utf8')) as {
  id: string;
  name: string;
  presetVersion: string;
  blocks: Block[];
  metadata: { vellum_engine: { compactPreset: boolean; promptTokenCeiling: number } };
  extensions: { regex_scripts: Array<{ script_id: string }> };
};
const regexExport = JSON.parse(readFileSync(new URL('../presets/vellum-compact-regex.json', import.meta.url), 'utf8')) as {
  type: string;
  scripts: Array<{ script_id: string }>;
};

const defs = preset.blocks.flatMap((entry) => entry.variables ?? []);
const def = (name: string): Variable => {
  const value = defs.find((entry) => entry.name === name);
  if (!value) throw new Error(`Missing compact variable ${name}`);
  return value;
};
const values = (overrides: Record<string, unknown> = {}): Record<string, string> => Object.fromEntries(defs.map((entry) => {
  const raw = Object.prototype.hasOwnProperty.call(overrides, entry.name) ? overrides[entry.name] : entry.defaultValue;
  const option = entry.options?.find((candidate) => candidate.id === raw);
  return [entry.name, String(option && Object.prototype.hasOwnProperty.call(option, 'value') ? option.value : raw ?? '')];
}));
const expanded = (id: string, overrides: Record<string, unknown> = {}): string => {
  const source = preset.blocks.find((entry) => entry.id === id)?.content ?? '';
  return expandMacros(source, values(overrides));
};

describe('VELLUM II — COMPACT preset', () => {
  it('ships as a distinct VELLUM-linked preset with a hard 5,000-token ceiling', () => {
    expect(preset).toMatchObject({
      id: 'vellum-ii-compact',
      name: 'VELLUM II — COMPACT',
      presetVersion: '1.0.0',
      metadata: { vellum_engine: { compactPreset: true, promptTokenCeiling: 5000 } },
    });
    expect(preset.id).not.toBe('vellum-ii-engine');
    expect(preset.id).not.toBe('vellum-ii-argent-loom');
    const budget = calculatePresetBudget(preset.blocks as any);
    expect(budget.totalTokens).toBeLessThanOrEqual(5000);
  });

  it('keeps every runtime configuration below 5,000 estimated tokens', () => {
    const longest = Object.fromEntries(defs.filter((entry) => entry.options?.length).map((entry) => {
      const option = [...entry.options!].sort((a, b) => String(b.value ?? b.id).length - String(a.value ?? a.id).length)[0]!;
      return [entry.name, option.id];
    }));
    const outputChoices = {
      state_on: [0, 1],
      state_compiler: ['engine', 'inline'],
      reasoning_route: ['silent', 'native', 'compact'],
      agency: ['protected', 'continuity', 'director'],
      living_world: ['off', 'minimal', 'active', 'sandbox'],
      dialogue_color: [0, 1],
      npc_dialogue: [0, 1],
      time_continuity: [0, 1],
      codex: [0, 1],
      inventory: [0, 1],
    } as const;
    let worst = 0;
    for (const state_on of outputChoices.state_on)
      for (const state_compiler of outputChoices.state_compiler)
        for (const reasoning_route of outputChoices.reasoning_route)
          for (const agency of outputChoices.agency)
            for (const living_world of outputChoices.living_world)
              for (const dialogue_color of outputChoices.dialogue_color)
                for (const npc_dialogue of outputChoices.npc_dialogue)
                  for (const time_continuity of outputChoices.time_continuity) {
                    const selected = { ...longest, state_on, state_compiler, reasoning_route, agency, living_world, dialogue_color, npc_dialogue, time_continuity };
                    const budget = calculatePresetBudget(preset.blocks as any, { 'arg-control': selected });
                    worst = Math.max(worst, budget.totalTokens);
                  }
    expect(worst).toBeLessThanOrEqual(5000);
  });

  it('keeps VELLUM engine integration, native context markers, and final ordering intact', () => {
    expect(assessVellumStateContract(preset.blocks as any)).toMatchObject({ status: 'healthy', kind: 'argent' });
    expect(preset.blocks.at(-1)?.id).toBe('arg-output-contract');
    for (const marker of ['system_prompt', 'char_description', 'char_personality', 'scenario', 'persona', 'world_info_before', 'mes_examples', 'chat_history', 'world_info_after', 'post_history_instructions']) {
      expect(preset.blocks.some((entry) => entry.marker === marker), marker).toBe(true);
    }
    expect(resolveTurnContract(preset as any)).toMatchObject({
      active: true,
      argent: true,
      state: true,
      stateCompiler: 'engine',
      stateVerbosity: 'lean',
      dialogueColor: true,
      codex: true,
      inventory: true,
      agency: 'protected',
      livingWorld: 'active',
    });
  });

  it('serializes an elapsed story-day count instead of a displayed date component', () => {
    const reality = expanded('compact-reality', { time_continuity: 1 });
    const schema = expanded('arg-state-schema', { state_on: 1, state_compiler: 'inline' });
    const output = expanded('arg-output-contract', { time_continuity: 1 });
    expect(reality).toContain('STORY DAY COUNT');
    expect(reality).toContain('October 17 but remains day:2');
    expect(schema).toContain('canonical elapsed STORY DAY COUNT');
    expect(output).toContain('never copy a displayed date component');
  });

  it('routes agency independently and never mixes the three final gates', () => {
    for (const [mode, expected, absent] of [
      ['protected', 'PLAYER AUTHORSHIP — FORBIDDEN FINAL GATE', 'DIRECTOR FINAL GATE'],
      ['continuity', 'PLAYER AUTHORSHIP — MINOR CONTINUITY FINAL GATE', 'FORBIDDEN FINAL GATE'],
      ['director', 'PLAYER AUTHORSHIP — DIRECTOR FINAL GATE', 'MINOR CONTINUITY FINAL GATE'],
    ]) {
      const output = expanded('arg-output-contract', { agency: mode });
      expect(output).toContain(expected);
      expect(output).not.toContain(absent);
      expect(output).toContain('In STORY PROSE');
      if (mode !== 'director') {
        expect(output).toContain('Enabled PERSONA STATE may still populate private tracker metadata');
        expect(output).toContain('never turn it into prose behavior');
      }
    }
  });

  it('uses prose-only Engine Second Pass and a complete Inline Compatibility schema', () => {
    const engine = expanded('arg-output-contract', { state_on: 1, state_compiler: 'engine' });
    expect(engine).toContain('[ENGINE SECOND PASS]');
    expect(engine).toContain('The engine compiles and validates state separately');
    expect(engine).not.toContain('Finish with exactly one complete raw-JSON <vellum>');

    const inlineSchema = expanded('arg-state-schema', { state_on: 1, state_compiler: 'inline' });
    for (const term of ['scene', 'present', 'threads', 'arcs', 'knowledge', 'secrets', 'secretReveals', 'parallel', 'scars', 'codex', 'inventory', 'timeline', 'plant', 'payoff']) {
      expect(inlineSchema.toLowerCase()).toContain(term.toLowerCase());
    }
    expect(inlineSchema).toContain('always populate mood, condition, doing, private first-person thought, and stable traits');
    expect(inlineSchema).toContain('regardless of player-agency mode');
    expect(expanded('arg-state-schema', { state_on: 1, state_compiler: 'engine' }).replace(/<!--\/?ARGENT-SOURCE[^>]*-->/g, '').trim()).toBe('');
  });

  it('retains the continuity gates that protect long sessions', () => {
    const all = preset.blocks.map((entry) => entry.content).join('\n');
    expect(all).toContain('A1 must never be below A0');
    expect(all.toLowerCase()).toContain('later arrival gives no retroactive hearing');
    expect(all).toContain('One event cannot advance unrelated rows');
    expect(all).toContain('refresh that exact secret rather than duplicate it');
    expect(all).toContain('complete final T1 off-stage snapshot');
    expect(all).toContain('Attached chat lorebooks define objective setting canon');
    expect(all).toContain('never grant character knowledge');
    expect(all).toContain('[spk=Exact Cast Name]');
    expect(preset.extensions.regex_scripts).toHaveLength(12);
    expect(regexExport).toMatchObject({ type: 'lumiverse_regex_scripts' });
    expect(regexExport.scripts).toEqual(preset.extensions.regex_scripts);
  });
});

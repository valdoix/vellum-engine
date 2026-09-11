import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SPEAKER_SPAN_REPLACEMENT,
  dialogueMarkupGuidance,
  repairDialogueSpeakerTags,
  speakerColorCss,
} from '../src/domain/dialogue-colors.js';
import { expandMacros } from '../src/domain/preset-macro-lite.js';

interface RegexScriptFixture {
  script_id: string;
  find_regex: string;
  replace_string: string;
  flags: string;
  placement: string[];
  target: string[];
  disabled: boolean;
  substitute_macros: string;
  metadata?: Record<string, unknown>;
}

interface PromptBlockFixture {
  id: string;
  position: string;
  content: string;
}

interface ArgentPresetFixture {
  presetVersion: string;
  blocks: PromptBlockFixture[];
  samplerOverrides: { maxTokens: number };
  extensions: { regex_scripts: RegexScriptFixture[] };
}

const preset = JSON.parse(
  readFileSync(new URL('../presets/argent-loom.json', import.meta.url), 'utf8'),
) as ArgentPresetFixture;
const vellumRegex = JSON.parse(
  readFileSync(new URL('../presets/vellum-ii-regex.json', import.meta.url), 'utf8'),
) as RegexScriptFixture[];

function script(id: string): RegexScriptFixture {
  const found = preset.extensions.regex_scripts.find((entry) => entry.script_id === id);
  if (!found) throw new Error(`ARGENT regex not found: ${id}`);
  return found;
}

function block(id: string): PromptBlockFixture {
  const found = preset.blocks.find((entry) => entry.id === id);
  if (!found) throw new Error(`ARGENT block not found: ${id}`);
  return found;
}

function apply(id: string, input: string, controls: Record<string, string> = { dialogue_color: '1', reasoning_route: 'compact' }): string {
  const entry = script(id);
  const find = entry.substitute_macros === 'find' ? expandMacros(entry.find_regex, controls) : entry.find_regex;
  return input.replace(new RegExp(find, entry.flags), entry.replace_string);
}

function applyWithColor(id: string, input: string, enabled: boolean): string {
  return apply(id, input, { dialogue_color: enabled ? '1' : '0', reasoning_route: 'compact' });
}

describe('ARGENT dialogue-color bridge', () => {
  it('repeats mandatory speaker markup in the final post-history contract', () => {
    const output = block('arg-output-contract');
    expect(output?.position).toBe('post_history');
    expect(preset.blocks.at(-1)?.id).toBe('arg-output-contract');
    expect(output?.content).toContain('[COLORED DIALOGUE — REQUIRED OUTPUT MARKUP]');
    expect(output?.content).toContain('every named or certain live speaker uses');
    expect(output?.content).toContain('both Inline Compatibility and Engine Second Pass');
    expect(output?.content).toContain('scan every opening dialogue quote');
    expect(output?.content).toContain('repair bare eligible speech');
    expect(output?.content).toContain('[GLM FINAL COMPLIANCE GATE]');
    expect(output?.content).toContain('No bare named-speaker quote');
  });

  it('uses the exact VELLUM display contract and remains enabled', () => {
    const entry = script('argent-speaker-display');
    expect(entry.placement).toEqual(['ai_output']);
    expect(entry.target).toEqual(['display']);
    expect(entry.disabled).toBe(false);
    expect(entry.replace_string).toBe(SPEAKER_SPAN_REPLACEMENT);
    const vellumEntry = vellumRegex.find((candidate) => candidate.script_id === 'vellum2-spk-display');
    expect(entry.find_regex).not.toContain('argent-choices');
    expect(vellumEntry?.replace_string).toBe(entry.replace_string);
  });

  it.each([
    ['[spk=Mara]"Plain."[/spk]', 'Mara', '"Plain."'],
    ['[spk = Mara ]"Padded."[/spk]', 'Mara', '"Padded."'],
    ['[spk="Mara"]"Double quoted."[/spk]', 'Mara', '"Double quoted."'],
    ["[spk='Mara']\"Single quoted.\"[/spk]", 'Mara', '"Single quoted."'],
    ['[SPK=mara]"Case insensitive."[/SPK]', 'mara', '"Case insensitive."'],
    ['[spk=Mara]"Streaming fallback."', 'Mara', '"Streaming fallback."'],
  ])('normalizes %s to a clean data-spk identity', (input, identity, dialogue) => {
    expect(apply('argent-speaker-display', input))
      .toBe(`<span class="v-spk" data-spk="${identity}" style="color:var(--vle-spk-color,inherit)">${dialogue}</span>`);
  });

  it('wraps adjacent speakers independently when the first close tag is missing', () => {
    const input = '[spk=Mara]"First."[spk=Elara]"Second."[/spk]';
    expect(apply('argent-speaker-display', input)).toBe(
      '<span class="v-spk" data-spk="Mara" style="color:var(--vle-spk-color,inherit)">"First."</span>'
      + '<span class="v-spk" data-spk="Elara" style="color:var(--vle-spk-color,inherit)">"Second."</span>',
    );
  });

  it('produces an identity matched by the extension cast-color stylesheet', () => {
    const html = apply('argent-speaker-display', '[spk="Mara"]"Matched."[/spk]');
    const css = speakerColorCss([{ name: 'Mara', aka: ['Captain'], color: '#c0ffee' }]);
    expect(html).toContain('class="v-spk" data-spk="Mara" style="color:var(--vle-spk-color,inherit)"');
    expect(css).toContain('.v-spk[data-spk="Mara" i]{--vle-spk-color:#c0ffee}');
  });

  it.each([
    ['argent-speaker-recover-leading-attribution', 'Mara said, "Wait."', 'Mara said, [spk=Mara]"Wait."[/spk]'],
    ['argent-speaker-recover-trailing-attribution', '"Wait," Mara said.', '[spk=Mara]"Wait,"[/spk] Mara said.'],
    ['argent-speaker-recover-colon-attribution', 'Mara: "Wait."', 'Mara: [spk=Mara]"Wait."[/spk]'],
  ])('recovers explicit bare dialogue with %s', (id, input, expected) => {
    const entry = script(id);
    expect(entry.placement).toEqual(['ai_output']);
    expect(entry.target).toEqual(['response']);
    expect(entry.substitute_macros).toBe('find');
    expect(entry.metadata?.active_preset_sentinel).toBe('reasoning_route');
    expect(entry.metadata?.gated_by_active_preset_control).toBe('dialogue_color');
    expect(apply(id, input)).toBe(expected);
    expect(apply('argent-speaker-display', expected)).toContain('data-spk="Mara"');
  });

  it('does not guess a speaker from a pronoun-only attribution', () => {
    const input = '"Wait," she said.';
    expect(apply('argent-speaker-recover-trailing-attribution', input)).toBe(input);
  });

  it('does not run response recovery when the active ARGENT control is off', () => {
    expect(applyWithColor('argent-speaker-recover-leading-attribution', 'Mara said, "Wait."', false))
      .toBe('Mara said, "Wait."');
  });

  it('does not run response recovery for a non-ARGENT preset with a same-named color control', () => {
    expect(apply('argent-speaker-recover-leading-attribution', 'Mara said, "Wait."', { dialogue_color: '1', reasoning_route: 'other' }))
      .toBe('Mara said, "Wait."');
  });

  it.each(['She said, "Wait."', 'The Captain said, "Wait."'])(
    'does not guess a proper-name identity from %s',
    (input) => expect(apply('argent-speaker-recover-leading-attribution', input)).toBe(input),
  );

  it('never rewrites dialogue-like text inside VELLUM JSON', () => {
    const input = '<vellum>\n{"delta":{"journal":[{"memory":"Mara said, \\"Wait.\\""}]}}\n</vellum>';
    expect(apply('argent-speaker-recover-leading-attribution', input)).toBe(input);
    expect(apply('argent-speaker-recover-trailing-attribution', input)).toBe(input);
    expect(apply('argent-speaker-recover-colon-attribution', input)).toBe(input);
  });

  it.each(['<vellum>', '‹vellum›', '```vellum', '[VELLUM]', '<reverie>'])(
    'stops an unclosed streaming wrapper before the private boundary %s',
    (boundary) => {
      const input = `[spk=Mara]"Run."\n${boundary}\nprivate`;
      expect(apply('argent-speaker-display', input)).toBe(
        '<span class="v-spk" data-spk="Mara" style="color:var(--vle-spk-color,inherit)">"Run."\n</span>'
        + `${boundary}\nprivate`,
      );
    },
  );

  it('removes speaker markup from prompt and memory copies but preserves dialogue', () => {
    const entry = script('argent-speaker-semantic-pipeline');
    expect(entry.placement).toEqual(['ai_output', 'memory']);
    expect(entry.target).toEqual(['prompt']);
    expect(apply(entry.script_id, '[spk = "Mara" ]"Keep me."[/spk]')).toBe('"Keep me."');
  });
});

describe('VELLUM runtime dialogue-markup backstop', () => {
  it('places the exact live cast roster beside the per-turn markup rule', () => {
    const guidance = dialogueMarkupGuidance(true, [
      { name: 'Mara Vey', aka: ['Mara'] },
      { name: 'Elara' },
    ]);
    expect(guidance).toContain('Speaker labels: Mara Vey; Elara.');
    expect(guidance).toContain('[spk=Canonical Name]"speech"[/spk]');
    expect(guidance).toContain('including Engine Second Pass mode');
    expect(dialogueMarkupGuidance(false, [{ name: 'Mara' }])).toBe('');
  });

  it.each([
    ['Mara said, "Wait."', 'Mara said, [spk=Mara Vey]"Wait."[/spk]'],
    ['"Wait," Mara said.', '[spk=Mara Vey]"Wait,"[/spk] Mara said.'],
    ['"Wait," said Mara.', '[spk=Mara Vey]"Wait,"[/spk] said Mara.'],
    ['Mara: "Wait."', 'Mara: [spk=Mara Vey]"Wait."[/spk]'],
  ])('repairs explicit attribution and canonicalizes a unique alias: %s', (input, expected) => {
    expect(repairDialogueSpeakerTags(input, [{ name: 'Mara Vey', aka: ['Mara'] }])).toBe(expected);
  });

  it('leaves ambiguous dialogue and private state untouched', () => {
    const input = '"Wait," she said.\n<reverie>Mara said, "Think."</reverie>\n<vellum>\n{"thought":"Mara said, \\"Hide.\\""}\n</vellum>';
    expect(repairDialogueSpeakerTags(input, [{ name: 'Mara' }])).toBe(input);
  });

  it('preserves existing wrappers while repairing a later explicit line', () => {
    const input = '[spk=Mara]"First."[/spk]\nElara asked, "Second?"';
    expect(repairDialogueSpeakerTags(input, [{ name: 'Mara' }, { name: 'Elara' }])).toBe(
      '[spk=Mara]"First."[/spk]\nElara asked, [spk=Elara]"Second?"[/spk]',
    );
  });
});

describe('ARGENT state and player-agency final gates', () => {
  it('ships the atomic state compiler and repeats its completion gate last', () => {
    expect(preset.presetVersion).toBe('1.3.1');
    expect(preset.samplerOverrides.maxTokens).toBe(20000);

    const compiler = block('arg-state-final');
    expect(compiler.position).toBe('post_history');
    expect(compiler.content).toContain('[FINAL STATE COMPILER — LEAN, ATOMIC AND MANDATORY]');
    expect(compiler.content).toContain('[FINAL STATE COMPILER — FULL, ATOMIC AND MANDATORY]');
    expect(compiler.content).toContain('Reserve ~700 output tokens');
    expect(compiler.content).toContain('shorten the prose; never abbreviate, omit, or truncate <vellum>');
    expect(compiler.content).toContain('CORE SNAPSHOT');
    expect(compiler.content).toContain('DELTA AUDIT');
    expect(compiler.content).toContain('SCHEMA PRUNE');
    expect(compiler.content).toContain('SERIALIZE');
    expect(compiler.content).toContain('Once <vellum> opens');

    const output = block('arg-output-contract');
    expect(output.position).toBe('post_history');
    expect(output.content).toContain('[STATE SERIALIZATION — FINAL GATE]');
    expect(output.content).toContain('A reply ending anywhere else is incomplete');
  });

  it('reinforces protected agency for every model near generation', () => {
    const adapter = block('arg-model-adapter');
    expect(adapter.content).toContain('[CLAUDE]');
    expect(adapter.content).toContain('{{matches::{{model}}::claude::i}}');
    expect(adapter.content).toContain('Do not complete a natural causal chain through an unsupplied player predicate');

    const anchor = block('arg-final-anchor');
    expect(anchor.position).toBe('post_history');
    expect(anchor.content).toContain('[FINAL AGENCY ANCHOR — {{var::agency}}]');
    expect(anchor.content).toContain('[PROTECTED-AGENCY FORBIDDEN-PREDICATE GATE]');
    expect(anchor.content).toContain('{{eq::{{var::agency}}::protected}}');
    expect(anchor.content).toContain('Scan every sentence whose subject is {{user}} or “you”');
    expect(anchor.content).toContain('or state{{/if}} to smuggle a player result');
  });

  it('auto-detects GLM and gives it an explicit prose and state budget', () => {
    const adapter = block('arg-model-adapter');
    expect(adapter.content).toContain('[GLM — ceiling {{maxResponse}}]');
    expect(adapter.content).toContain('{{matches::{{model}}::glm::i}}');
    expect(adapter.content).toContain('Reserve at least ~1,200 tokens for state');
    expect(adapter.content).toContain('end prose by two-thirds');
    expect(adapter.content).toContain('Open each [spk=Exact Name] before its quotation');
    expect(adapter.content).toContain('never trade </vellum> for more prose');
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const argent = JSON.parse(readFileSync(new URL('../presets/argent-loom.json', import.meta.url), 'utf8')) as any;
const compact = JSON.parse(readFileSync(new URL('../presets/vellum-compact.json', import.meta.url), 'utf8')) as any;

describe('prose scene header regex', () => {
  it.each([['ARGENT', argent], ['Compact', compact]])('%s ships the optional display and semantic lanes', (_name, preset) => {
    const display = preset.extensions.regex_scripts.find((row: any) => row.script_id === 'argent-scene-header-display');
    const semantic = preset.extensions.regex_scripts.find((row: any) => row.script_id === 'argent-scene-header-semantic-pipeline');
    expect(display).toMatchObject({ disabled: false, placement: ['ai_output'], target: ['display'], substitute_macros: 'find' });
    expect(display.find_regex).toContain('SCENE');
    expect(display.replace_string).toContain('class="arg-scene"');
    expect(display.replace_string).toContain('linear-gradient');
    expect(semantic).toMatchObject({ placement: ['ai_output', 'memory'], target: ['prompt'] });
    expect(semantic.replace_string).toContain('SCENE — $1');

    const controls = preset.blocks.flatMap((block: any) => block.variables ?? []);
    expect(controls.find((control: any) => control.name === 'scene_header')).toMatchObject({ type: 'switch' });
    expect(preset.blocks.some((block: any) => block.content.includes('[SCENE|Concise Title|Location · Time]'))).toBe(true);
  });
});

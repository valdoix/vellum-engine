import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface PresetVariable {
  id: string;
  name: string;
}

interface PresetBlock {
  id: string;
  enabled: boolean;
  content: string;
  variables?: PresetVariable[];
}

interface VellumPreset {
  presetVersion: string;
  blocks: PresetBlock[];
}

const preset = JSON.parse(
  readFileSync(new URL('../presets/vellum-ii.json', import.meta.url), 'utf8'),
) as VellumPreset;

function block(id: string): PresetBlock {
  const found = preset.blocks.find((candidate) => candidate.id === id);
  if (!found) throw new Error('missing preset block: ' + id);
  return found;
}

describe('VELLUM II preset 2.3 contract', () => {
  it('keeps the canonical v2-state block byte-for-byte intact', () => {
    const state = block('v2-state').content;
    expect(state).toHaveLength(3883);
    expect(createHash('sha256').update(state, 'utf8').digest('hex')).toBe(
      'e282747c7abcddfc2933aff2eb6705d2c52b0ed9ddd55d28888c2f55f7ea7614',
    );
  });

  it('ships the bounded controller and its supporting doctrine blocks', () => {
    expect(preset.presetVersion).toBe('2.3.0');
    for (const id of [
      'v2-knowledge',
      'v2-cast',
      'v2-time',
      'v2-causality',
      'v2-romance',
      'v2-interiority',
      'v2-reverie',
    ]) {
      expect(block(id).enabled, id).toBe(true);
    }
  });

  it('makes Augury presentational and removes message-count plot phases', () => {
    const reverie = block('v2-reverie').content;
    expect(reverie).toContain('[REVERIE — ONE BOUNDED PASS]');
    expect(reverie).toContain('[AUGURY — PRESENTATION ONLY]');
    expect(reverie).toContain('They cannot create facts, permission, outcomes, costs');
    expect(reverie).not.toContain('messageCount');
    expect(reverie).not.toContain('ECLIPSED');
    expect(reverie).not.toContain('this beat SPENDS');
  });

  it('specifies forward endpoint time, concurrency, rollovers, and flashback isolation', () => {
    const time = block('v2-time').content;
    expect(time).toContain('T0 + elapsed = T1');
    expect(time).toContain('SERIAL VS CONCURRENT');
    expect(time).toContain('scene.time describes when THIS response ends');
    expect(time).toContain('Roll day forward at midnight');
    expect(time).toContain('does NOT overwrite the present-day clock');
    expect(time).toContain('OFF-SCREEN SYNCHRONIZATION');
    expect(time).toContain('SPACE COSTS TIME');
  });

  it('keeps the worked turn example inside the declared state schema', () => {
    const example = block('v2-turn-example').content;
    const match = example.match(/<vellum>\n(\{[\s\S]*?\})\n<\/vellum>/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]!) as {
      scene: { time?: string; clock?: number };
      present: Array<Record<string, unknown>>;
    };

    expect(parsed.scene.time).toBe('10:07 pm');
    expect(parsed.scene.clock).toBe(1327);
    expect(parsed.present[0]).toMatchObject({
      id: '{{user}}',
      mood: '',
      condition: '',
      doing: '',
      thought: '',
      traits: [],
    });
    expect(parsed.present[1]?.thought).toBe("They're buying time. Why?");
  });

  it('keeps ids unique and the default prompt within its compact budget', () => {
    const blockIds = preset.blocks.map((candidate) => candidate.id);
    expect(new Set(blockIds).size).toBe(blockIds.length);

    const variables = preset.blocks.flatMap((candidate) => candidate.variables ?? []);
    expect(new Set(variables.map((variable) => variable.id)).size).toBe(variables.length);
    expect(new Set(variables.map((variable) => variable.name)).size).toBe(variables.length);

    const enabledChars = preset.blocks
      .filter((candidate) => candidate.enabled)
      .reduce((total, candidate) => total + candidate.content.length, 0);
    expect(Math.ceil(enabledChars / 4)).toBeLessThanOrEqual(13_000);
  });
});

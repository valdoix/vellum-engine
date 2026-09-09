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
    expect(state).toHaveLength(4283);
    expect(createHash('sha256').update(state, 'utf8').digest('hex')).toBe(
      'c0c1db996729c613f1dbab8298d376f940853616e3f6416680d8ca596c92674b',
    );
  });

  it('tracks enabled persona state independently from story-prose agency', () => {
    const state = block('v2-state').content;
    const reverie = block('v2-reverie').content;
    const example = block('v2-turn-example').content;
    const agencyReminder = block('v2-agency-reminder').content;
    expect(state).toContain('always populate mood, condition, doing, one concise first-person thought, and stable traits');
    expect(state).toContain('private tracker metadata in every agency mode');
    expect(state).toContain('never authorizes player behavior in story prose');
    expect(reverie).toContain('tracker blank when PERSONA STATE is OFF and full in every agency when ON');
    expect(reverie).toContain('Do not plan unstated player behavior for STORY PROSE');
    expect(reverie).toContain('enabled PERSONA STATE still fills private tracker metadata');
    expect(agencyReminder).toContain('[BEFORE YOU WRITE — STORY PROSE]');
    expect(agencyReminder).toContain('Enabled PERSONA STATE still fills private tracker metadata');
    expect(example).toContain('when ON, fill every {{user}} tracker field in every agency');
  });

  it('ships the bounded controller and its supporting doctrine blocks', () => {
    expect(preset.presetVersion).toBe('2.3.2');
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

  it('does not treat open plot rows as a per-turn advancement quota', () => {
    const causality = block('v2-causality').content;
    const reverie = block('v2-reverie').content;
    expect(causality).toContain('Begin with zero thread/arc updates');
    expect(causality).toContain('may remain unchanged indefinitely');
    expect(causality).toContain('latest injected condition');
    expect(causality).toContain('One event cannot advance unrelated rows');
    expect(reverie).toContain('exact prior condition → direct event in this prose → different after-condition');
  });

  it('specifies forward endpoint time, concurrency, rollovers, and flashback isolation', () => {
    const time = block('v2-time').content;
    expect(time).toContain('T0 + elapsed = T1');
    expect(time).toContain('SERIAL VS CONCURRENT');
    expect(time).toContain('scene.time describes when THIS response ends');
    expect(time).toContain('ABSOLUTE MONOTONIC GATE');
    expect(time).toContain('A1 must be greater than or equal to A0');
    expect(time).toContain('invalid even by one minute');
    expect(time).toContain('Never add a day merely to conceal a rollback');
    expect(time).toContain('scene.time as exact zero-padded 24-hour HH:MM');
    expect(time).toContain('Roll day forward at midnight');
    expect(time).toContain('does NOT overwrite the present-day clock');
    expect(time).toContain('OFF-SCREEN SYNCHRONIZATION');
    expect(time).toContain('SPACE COSTS TIME');
  });

  it('keeps the story-day count independent from calendar rendering', () => {
    const time = block('v2-time').content;
    const state = block('v2-state').content;
    expect(time).toContain('canonical STORY DAY COUNT');
    expect(time).toContain('story Day 2');
    expect(time).toContain('October 17');
    expect(time).toContain('state remains day:2');
    expect(state).toContain('day = elapsed STORY DAY COUNT');
    expect(state).toContain('VELLUM formats display');
  });

  it('keeps the worked turn example inside the declared state schema', () => {
    const example = block('v2-turn-example').content;
    const match = example.match(/<vellum>\n(\{[\s\S]*?\})\n<\/vellum>/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]!) as {
      scene: { time?: string; clock?: number };
      present: Array<Record<string, unknown>>;
    };

    expect(parsed.scene.time).toBe('22:07');
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

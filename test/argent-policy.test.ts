import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { collapseAssembledArgentPolicy, compileArgentPolicy, applyArgentPolicy, applyProfile, ARGENT_PROFILES, dependencyIssues, policyValues } from '../src/domain/argent-policy.js';
import { renderArtifact, artifactText } from '../src/domain/artifacts.js';
const preset = JSON.parse(readFileSync(new URL('../presets/argent-loom.json', import.meta.url), 'utf8'));
const blocks = preset.blocks;
describe('effective policy compilation and profiles', () => {
  it.each(Object.keys(ARGENT_PROFILES))('resolves every option in the %s profile', profile => {
    const values = applyProfile(blocks, {}, ARGENT_PROFILES[profile]!);
    for (const [k, v] of Object.entries(ARGENT_PROFILES[profile]!)) expect(policyValues(blocks, values)[k]).toEqual(v);
  });
  it('replaces only owned instruction regions, preserving history, native context and media', () => {
    const image = { role: 'user', content: [{ type: 'image', data: 'image' }] };
    const history = { role: 'assistant', __isChatHistory: true, content: '<!--ARGENT-SOURCE:arg-state-final-->quoted<!--/ARGENT-SOURCE-->' };
    const messages = [{ role: 'system', content: 'Worldbook stays.<!--ARGENT-SOURCE:arg-state-final-->redundant<!--/ARGENT-SOURCE-->' }, history, image];
    const next = applyArgentPolicy(messages, 'capsule');
    expect(next).toEqual([{ role: 'system', content: 'Worldbook stays.' }, history, image, { role: 'system', content: 'capsule' }]);
    expect(messages[0]!.content).toContain('redundant');
    expect(applyArgentPolicy([history], 'capsule')).toEqual([history]);
  });
  it('collapses already-expanded source regions without recompiling base defaults', () => {
    const history = { role: 'assistant', __isChatHistory: true, content: '<!--ARGENT-SOURCE:arg-one-->quoted marker<!--/ARGENT-SOURCE-->' };
    const messages = [
      { role: 'system', content: 'Native context\n<!--ARGENT-SOURCE:arg-one--><!--VELLUM-EFFECTIVE {"state":0}-->PROFILE-OVERRIDDEN POLICY<!--/ARGENT-SOURCE-->' },
      history,
    ];
    const next = collapseAssembledArgentPolicy(messages, 'Genesis is eligible.');
    expect(next[0]?.content).toBe('Native context');
    expect(next[1]).toBe(history);
    expect(next.at(-1)?.content).toContain('PROFILE-OVERRIDDEN POLICY');
    expect(next.at(-1)?.content).toContain('Genesis is eligible.');
    expect(next.at(-1)?.content).not.toContain('VELLUM-EFFECTIVE');
  });
  it('leaves older assembled prompts intact when source markers are unavailable', () => {
    const messages = [{ role: 'system', content: 'Already expanded by the host' }];
    expect(collapseAssembledArgentPolicy(messages)).toBe(messages);
  });
  it.each(['auto', 'generic', 'claude', 'gemini', 'deepseek', 'kimi', 'glm', 'reasoning'])('assembles route/state/color matrix for %s without competing output plans', adapter => {
    for (const route of ['compact', 'verbose', 'native', 'silent']) for (const state of [0, 1]) for (const color of [0, 1]) {
      const selected = applyProfile(blocks, {}, { model_adapter: adapter, reasoning_route: route, state_on: state, dialogue_color: color, state_compiler: 'engine' });
      const capsule = compileArgentPolicy(blocks, selected);
      const output = capsule.split('[OUTPUT CONTRACT — FINAL]')[1]!;
      expect(output).not.toContain('append one complete');
      expect(output.includes('engine compiles')).toBe(state === 1);
      expect(capsule.includes('[spk=Exact Cast Name]')).toBe(color === 1);
      expect(capsule.includes('250–500')).toBe(route === 'verbose');
    }
  });
  it('keeps engine default policy materially smaller than source doctrine', () => {
    const capsule = compileArgentPolicy(blocks);
    expect(capsule.length).toBeLessThan(blocks.reduce((n: number, b: any) => n + b.content.length, 0) / 2);
  });
  it.each([
    ['protected', 'FORBIDDEN FINAL GATE'],
    ['continuity', 'MINOR CONTINUITY FINAL GATE'],
    ['director', 'DIRECTOR FINAL GATE'],
  ])('ends the compact %s policy with its own per-turn agency gate', (agency, gate) => {
    const selected = applyProfile(blocks, {}, { agency });
    const capsule = compileArgentPolicy(blocks, selected);
    expect(capsule).toContain(gate);
    expect(capsule).toContain(`Player agency this turn:`);
  });
  it('never promotes legacy raw-HTML VTK instructions into the runtime policy', () => {
    const selected = applyProfile(blocks, {}, { vtk: 'rare', vtk_cards: 1 });
    const capsule = compileArgentPolicy(blocks, selected);
    expect(capsule).toContain('<artifact>');
    expect(capsule).not.toContain('VIS_START');
    expect(capsule).not.toContain('visual HTML');
  });
  it('explains dependency gates and respects state-off', () => {
    expect(dependencyIssues({ state_on: 0, vtk_cards: 0, antislop: 0 })).toHaveProperty('worldgen');
    expect(dependencyIssues({ state_on: 1, vtk_cards: 1, antislop: 1 })).not.toHaveProperty('vtk_spectacle');
  });
});
describe('declarative presentation renderer', () => {
  it('escapes hostile text and enforces a closed schema', () => {
    const raw = JSON.stringify({ type: 'letter', title: '<img src=x onerror=alert(1)>', body: '</p><script>steal()</script>', tone: 'warning' });
    const html = renderArtifact(raw)!;
    expect(html).not.toContain('<script>'); expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;'); expect(html).toContain('default-src');
    expect(artifactText(raw)).toContain('steal()');
    expect(renderArtifact(JSON.stringify({ type: 'letter', title: '', body: 'x', html: '<script>' }))).toBeNull();
    expect(renderArtifact('{truncated')).toBeNull();
  });
});

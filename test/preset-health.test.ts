import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { assessVellumStateContract, VELLUM_STATE_BLOCK_CONTENT } from '../src/domain/preset-health.js';
import { STATE_PROTOCOL_VERSION } from '../src/domain/state-protocol.js';

const block = (value: Record<string, unknown>) => ({
  id: 'state', name: 'State', role: 'system', position: 'post_history', enabled: true, content: '', ...value,
}) as any;

describe('preset state-contract health', () => {
  it('accepts the exact canonical compatibility contract', () => {
    const health = assessVellumStateContract([block({ name: 'VELLUM — State Block', content: VELLUM_STATE_BLOCK_CONTENT })]);
    expect(health).toMatchObject({ status: 'healthy', kind: 'compatibility', version: `${STATE_PROTOCOL_VERSION}.0` });
    expect(health.issues).toEqual([]);
    expect(VELLUM_STATE_BLOCK_CONTENT).toContain('Audit threads and arcs every turn, including turn 1');
    expect(VELLUM_STATE_BLOCK_CONTENT).toContain('elapsed time are not progress');
    expect(VELLUM_STATE_BLOCK_CONTENT).toContain('regardless of player-agency mode');
    expect(VELLUM_STATE_BLOCK_CONTENT).toContain('tracker-only metadata');
  });

  it('does not treat an incidental vellum mention as a state block', () => {
    const health = assessVellumStateContract([block({ id: 'style', name: 'Style', content: 'Discuss <vellum> only as an example.' })]);
    expect(health.status).toBe('missing');
  });

  it('offers a bounded repair for a stale compatibility block', () => {
    const health = assessVellumStateContract([block({ name: 'VELLUM — State Block', enabled: false, role: 'user', position: 'pre_history', content: '[VELLUM STATE] old' })]);
    expect(health.status).toBe('repairable');
    expect(health.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['disabled', 'role', 'position', 'hash']));
  });

  it('requires review instead of guessing across duplicate primary blocks', () => {
    const health = assessVellumStateContract([
      block({ id: 'a', name: 'VELLUM — State Block', content: VELLUM_STATE_BLOCK_CONTENT }),
      block({ id: 'b', name: 'VELLUM - State Block', content: VELLUM_STATE_BLOCK_CONTENT }),
    ]);
    expect(health).toMatchObject({ status: 'invalid' });
    expect(health.issues[0]?.code).toBe('duplicate');
  });

  it('validates the complete ARGENT state/output graph and final ordering', () => {
    const graph = [
      block({ id: 'arg-state-schema', position: 'pre_history', content: `[VELLUM STATE — LEAN CONTRACT] {v:${STATE_PROTOCOL_VERSION},turn?} <vellum></vellum>` }),
      block({ id: 'arg-state-final', content: `[FINAL STATE COMPILER — LEAN, ATOMIC AND MANDATORY] begin with "v":${STATE_PROTOCOL_VERSION}` }),
      block({ id: 'arg-output-contract', content: `[OUTPUT — FOLLOW EXACTLY] begin with "v":${STATE_PROTOCOL_VERSION}` }),
    ];
    expect(assessVellumStateContract(graph)).toMatchObject({ status: 'healthy', kind: 'argent' });
    expect(assessVellumStateContract([...graph, block({ id: 'later', content: 'later instruction' })]).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'argent_output_order' })]));
  });

  it('accepts the generated ARGENT preset shipped with VELLUM', () => {
    const preset = JSON.parse(readFileSync(new URL('../presets/argent-loom.json', import.meta.url), 'utf8'));
    expect(assessVellumStateContract(preset.blocks)).toMatchObject({ status: 'healthy', kind: 'argent' });
  });
});

import { describe, expect, it } from 'vitest';
import { freshState } from '../src/domain/types.js';
import { auditChronicle } from '../src/domain/workbench-health.js';

describe('Workbench Chronicle health audit', () => {
  it('detects location, epistemic, custody, and time integrity failures', () => {
    const state = freshState();
    state.cast.alice = { id: 'alice', name: 'Alice', status: 'present', firstTurn: 1, lastTurn: 2, traits: [], aka: [] } as any;
    state.scene.present = ['alice', 'alice', 'ghost'];
    state.parallel = [{ who: 'alice', where: 'Elsewhere', activity: 'waiting' }] as any;
    state.knowledge = [{ id: 'k', who: 'ghost', fact: 'x', reliability: 'knows', truth: 'true', turn: 1 }] as any;
    state.items = [{ id: 'i', who: 'ghost', item: 'key', turn: 1 }];
    state.turnDays = { '1': 3, '2': 2 };
    const audit = auditChronicle(state);
    expect(audit.score).toBeLessThan(100);
    expect(audit.findings.map((f) => f.code)).toEqual(expect.arrayContaining(['duplicate_present', 'unknown_present', 'present_elsewhere', 'unknown_knowledge_owner', 'knowledge_without_source', 'unknown_item_holder', 'day_regression']));
  });

  it('returns a clean structural report for an empty chronicle', () => {
    expect(auditChronicle(freshState())).toMatchObject({ score: 100, findings: [] });
  });
});

import { describe, expect, it } from 'vitest';
import { coreFeature } from '../src/domain/core-feature.js';
import { npcContinuityInjection } from '../src/domain/npc-continuity.js';
import { freshState } from '../src/domain/types.js';
import { reduce } from '../src/core/reduce.js';

describe('NPC continuity ledger', () => {
  it('persists presence tier, intent, affect, and a grounded introduction packet', () => {
    const prior = freshState();
    prior.cast.mara = { id: 'mara', name: 'Mara', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false };
    let seq = 0;
    const events = coreFeature.extract!({
      scene: { loc: 'Gatehouse', time: '09:00', clock: 540 },
      present: [{ id: 'Mara', presence: 'spotlight', thought: 'The watch is thin.' }],
      ext: {
        intent: [{ who: 'Mara', goal: 'deliver the warrant', nextStep: 'secure a horse', constraints: ['the east gate is watched'], destination: 'Old Road', status: 'active' }],
        affect: [{ who: 'Mara', valence: -1, arousal: 2, control: 1, direction: 'the gate captain', cause: 'the delay' }],
        introduction: [{ who: 'Mara', role: 'court courier', want: 'to finish before noon', constraint: 'a damaged boot', counterTrait: 'soft-hearted under pressure', voiceTell: 'clips ceremonial titles', culturalAnchor: 'road-post etiquette', physicalDetail: 'ink on her left thumb' }],
      },
    } as any, { turn: 2, day: 1, state: prior, seq: () => ++seq } as any);
    const next = reduce(events, prior);
    expect(next.scene.detail[0]).toMatchObject({ id: 'mara', presence: 'spotlight' });
    expect(next.cast.mara?.intent).toMatchObject({ goal: 'deliver the warrant', nextStep: 'secure a horse', status: 'active', updatedTurn: 2 });
    expect(next.cast.mara?.affect).toMatchObject({ valence: -1, arousal: 2, control: 1, direction: 'the gate captain' });
    expect(next.cast.mara?.introduction).toMatchObject({ role: 'court courier', voiceTell: 'clips ceremonial titles' });
  });

  it('injects NPC autonomy as pressure rather than a guaranteed outcome', () => {
    const state = freshState();
    state.cast.mara = { id: 'mara', name: 'Mara', aka: [], status: 'present', source: 'auto', firstTurn: 1, lastTurn: 2, userEdited: false,
      intent: { goal: 'deliver the warrant', nextStep: 'secure a horse', constraints: ['the gate is watched'], status: 'active', updatedTurn: 2 },
      affect: { valence: -1, arousal: 2, control: 1, direction: 'the captain', turn: 2 } };
    state.scene.present = ['mara'];
    state.scene.detail = [{ id: 'mara', presence: 'periphery' }];
    const text = npcContinuityInjection(state, state.scene.present);
    expect(text).toContain('intent as pressure, never guaranteed success');
    expect(text).toContain('periphery characters need not speak');
    expect(text).toContain('deliver the warrant');
  });
});

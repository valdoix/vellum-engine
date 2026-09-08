import { describe, it, expect } from 'vitest';
import { dashboardHtml, latestKnowledge, latestSecret } from '../src/ui/dashboard.js';
import { freshState } from '../src/domain/types.js';

describe('Fix 23 — dashboard latest by turn (not array tail)', () => {
  it('latestKnowledge picks max turn regardless of insertion order', () => {
    const s = freshState();
    s.knowledge = [
      { id: 'k1', who: 'a', fact: 'old', turn: 2, reliability: 'knows', truth: 'unknown' },
      { id: 'k2', who: 'b', fact: 'newest', turn: 9, reliability: 'knows', truth: 'unknown' },
      { id: 'k3', who: 'c', fact: 'mid', turn: 5, reliability: 'knows', truth: 'unknown' }, // tail, but not newest by turn
    ];
    expect(latestKnowledge(s)?.id).toBe('k2');
  });

  it('latestSecret picks max formedTurn', () => {
    const s = freshState();
    s.secrets = [
      { id: 's1', keeper: 'a', from: [], text: 'old', revealed: false, revealedTo: [], formedTurn: 3 },
      { id: 's2', keeper: 'b', from: [], text: 'newest', revealed: false, revealedTo: [], formedTurn: 8 },
      { id: 's3', keeper: 'c', from: [], text: 'mid', revealed: false, revealedTo: [], formedTurn: 6 },
    ];
    expect(latestSecret(s)?.id).toBe('s2');
  });

  it('returns undefined when empty', () => {
    const s = freshState();
    expect(latestKnowledge(s)).toBeUndefined();
    expect(latestSecret(s)).toBeUndefined();
  });

  it('renders every present actor when persona detail has not been extracted yet', () => {
    const s = freshState();
    s.scene.present = ['gabriel_winters', 'buffy_summers'];
    s.scene.detail = [{ id: 'buffy_summers', mood: 'watchful', thought: 'He looks exhausted.' }];
    s.cast.gabriel_winters = { id: 'gabriel_winters', name: 'Gabriel Winters', aka: [], status: 'present', source: 'user', firstTurn: 1, lastTurn: 1, userEdited: false };
    s.cast.buffy_summers = { id: 'buffy_summers', name: 'Buffy Summers', aka: [], status: 'present', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false };
    const html = dashboardHtml(s);
    expect(html).toContain('Gabriel Winters');
    expect(html).toContain('Buffy Summers');
    expect(html).toContain('Present <span class="vld-n">2</span>');
  });
});

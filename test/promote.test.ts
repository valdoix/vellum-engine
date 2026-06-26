import { describe, it, expect } from 'vitest';
import { buildPromotion, reconcileCategory } from '../src/domain/promote.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';

function st(): ChronicleState {
  const s = freshState();
  s.cast.cersei = { id: 'cersei', name: 'Cersei Lannister', aka: ['the Queen'], status: 'active', role: 'Queen Regent', source: 'auto', firstTurn: 1, lastTurn: 5, userEdited: false } as any;
  s.relations.push({ a: 'cersei', b: 'jaime', label: 'twin', categories: ['familial', 'romantic'], category: 'romantic', affection: 80, trust: 60, sentiment: 'warm', status: 'active', source: 'auto', userEdited: false, firstTurn: 1, lastTurn: 5, firstDay: 1, history: [], categoryHistory: [] });
  s.secrets.push({ id: 's1', keeper: 'cersei', from: ['robert'], text: 'incest', revealed: false, revealedTo: [], formedTurn: 2 });
  return s;
}

describe('vault promotion', () => {
  it('promotes a cast member with name+aka keywords and role content', () => {
    const p = buildPromotion(st(), 'cast', 'cersei')!;
    expect(p.category).toBe('characters');
    expect(p.key).toContain('Cersei Lannister');
    expect(p.key).toContain('the Queen');
    expect(p.content).toContain('Queen Regent');
    expect(p.link).toBe('cast:cersei');
    expect(p.hash).toBeTruthy();
  });

  it('promotes a relation and a secret', () => {
    const s = st();
    const r = buildPromotion(s, 'relation', 'cersei|jaime')!;
    expect(r.category).toBe('relationships');
    expect(r.content).toContain('familial');
    const sec = buildPromotion(s, 'secret', 's1')!;
    expect(sec.content).toContain('incest');
    expect(sec.link).toBe('secret:s1');
  });

  it('returns null for missing records', () => {
    expect(buildPromotion(st(), 'cast', 'nobody')).toBeNull();
  });
});

describe('Tier-B reconcile', () => {
  it('updates a linked entry when the source content changed', () => {
    const s = st();
    const stale = [{ id: 'e1', link: 'cast:cersei', hash: 'OLD' }];
    const plan = reconcileCategory(s, 'cast', stale);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0]!.entryId).toBe('e1');
    expect(plan.update[0]!.promotion.content).toContain('Cersei');
  });

  it('noops when the hash matches (no change)', () => {
    const s = st();
    const current = buildPromotion(s, 'cast', 'cersei')!;
    const plan = reconcileCategory(s, 'cast', [{ id: 'e1', link: 'cast:cersei', hash: current.hash }]);
    expect(plan.update).toHaveLength(0);
  });

  it('ignores links whose source no longer exists (never errors)', () => {
    const plan = reconcileCategory(st(), 'cast', [{ id: 'e9', link: 'cast:ghost', hash: 'x' }]);
    expect(plan.update).toHaveLength(0);
  });
});

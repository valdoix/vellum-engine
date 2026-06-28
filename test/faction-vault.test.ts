import { describe, it, expect } from 'vitest';
import { planFactionEntry, reconcileFactionEntries } from '../src/domain/faction-vault.js';
import { freshState, type ChronicleState, type Faction } from '../src/domain/types.js';
import type { LiteEntry } from '../src/host/worldbooks.js';

function st(): ChronicleState {
  const s = freshState();
  s.factions['fac:household'] = { id: 'fac:household', name: 'The Household', aka: ['staff'], kind: 'household', status: 'active', standing: -20, trust: -5, source: 'auto', firstTurn: 1, lastTurn: 5, userEdited: false } as Faction;
  s.cast.martha = { id: 'martha', name: 'Martha', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 5, userEdited: false } as any;
  s.memberships = [{ char: 'martha', faction: 'fac:household', role: 'head maid' }];
  return s;
}
const lite = (over: Partial<LiteEntry>): LiteEntry => ({ id: 'e1', bookId: 'b1', key: [], keysecondary: [], content: '', comment: '', position: 0, depth: 5, order_value: 50, constant: false, disabled: false, vellum: true, category: 'factions', source: 'faction', link: 'faction:fac:household', pending: false, hash: '', ...over });

describe('planFactionEntry', () => {
  it('builds a group lore sheet with roster + standing + member keys', () => {
    const input = planFactionEntry(st(), st().factions['fac:household']!);
    expect(input.link).toBe('faction:fac:household');
    expect(input.category).toBe('factions');
    expect(input.content).toContain('Martha (head maid)');
    expect(input.content).toContain('wary'); // standing -20
    expect(input.key).toEqual(expect.arrayContaining(['The Household', 'staff', 'Martha']));
  });
});

describe('reconcileFactionEntries', () => {
  it('creates an entry for an unprojected faction', () => {
    const plan = reconcileFactionEntries(st(), [], 'keyed');
    expect(plan.create.map((c) => c.facId)).toEqual(['fac:household']);
  });
  it('removes an orphaned faction entry', () => {
    const plan = reconcileFactionEntries(freshState(), [lite({ id: 'orphan', link: 'faction:fac:gone' })], 'keyed');
    expect(plan.remove).toEqual(['orphan']);
  });
  it('never touches non-faction or non-vellum entries', () => {
    const plan = reconcileFactionEntries(freshState(), [lite({ id: 'u', vellum: false, link: 'x' }), lite({ id: 'c', link: 'chapter:1' })], 'keyed');
    expect(plan.remove).toEqual([]);
  });
  it('respects a user-edited body (no clobber)', () => {
    const plan = reconcileFactionEntries(st(), [lite({ content: 'MY EDIT', source: 'manual' })], 'keyed');
    expect(plan.update).toHaveLength(0);
  });
  it('mode off → no actions', () => {
    expect(reconcileFactionEntries(st(), [], 'off')).toEqual({ create: [], update: [], remove: [] });
  });
});

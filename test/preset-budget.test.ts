import { describe, it, expect } from 'vitest';
import { expandMacros } from '../src/domain/preset-macro-lite.js';
import { calculatePresetBudget } from '../src/domain/preset-budget.js';

describe('expandMacros', () => {
  it('substitutes a known {{var::name}} with its value', () => {
    expect(expandMacros('{{var::prose}}', { prose: 'Literary' })).toBe('Literary');
  });

  it('leaves an unknown {{var::name}} unexpanded', () => {
    expect(expandMacros('{{var::missing}}', {})).toBe('{{var::missing}}');
  });

  it('picks the if-branch of {{if}}...{{else}}...{{/if}}', () => {
    expect(expandMacros('{{if::x}}enabled{{else}}disabled{{/if}}', {})).toBe('enabled');
  });

  it('picks the if-branch of {{if}}...{{/if}} with no else', () => {
    expect(expandMacros('a{{if::x}}on{{/if}}b', {})).toBe('aonb');
  });

  it('picks the first option of {{pick::a::b::c}}', () => {
    expect(expandMacros('{{pick::foo::bar::baz}}', {})).toBe('foo');
  });

  it('handles a mix of macros in one string', () => {
    const out = expandMacros('The style is {{var::prose}}, {{if::adv}}with depth{{else}}plain{{/if}}.', { prose: 'literary' });
    expect(out).toBe('The style is literary, with depth.');
  });

  it('is a no-op on plain text', () => {
    expect(expandMacros('just words', {})).toBe('just words');
  });
});

describe('calculatePresetBudget', () => {
  it('counts only enabled blocks', () => {
    const b = calculatePresetBudget([
      { id: 'a', enabled: true, content: 'aaaa', group: 'core' },
      { id: 'b', enabled: false, content: 'bbbbbbbb', group: 'core' },
    ]);
    expect(b.enabledCount).toBe(1);
    expect(b.disabledCount).toBe(1);
    expect(b.totalChars).toBe(4);
    expect(b.totalTokens).toBe(1); // ceil(4/4)
  });

  it('groups tokens by category and the categories sum to the total', () => {
    const b = calculatePresetBudget([
      { id: 'a', enabled: true, content: 'x'.repeat(40), group: 'core' },
      { id: 'b', enabled: true, content: 'y'.repeat(20), group: 'tone' },
    ]);
    expect(b.byCategory.core?.tokens).toBe(10);
    expect(b.byCategory.tone?.tokens).toBe(5);
    const catSum = Object.values(b.byCategory).reduce((n, c) => n + c.chars, 0);
    expect(catSum).toBe(b.totalChars);
  });

  it('expands macros before counting (so var refs are measured by value)', () => {
    const b = calculatePresetBudget([
      { id: 'a', enabled: true, content: '{{var::p}}', group: 'core', variables: [{ name: 'p', options: [{ value: 'x'.repeat(100), selected: true }] }] },
    ]);
    expect(b.totalChars).toBe(100);
  });

  it('returns at most 5 heaviest blocks, sorted descending', () => {
    const blocks = Array.from({ length: 8 }, (_, i) => ({ id: String(i), enabled: true, content: 'z'.repeat((i + 1) * 4), group: 'core' }));
    const b = calculatePresetBudget(blocks);
    expect(b.heaviest.length).toBe(5);
    expect(b.heaviest[0]!.tokens).toBeGreaterThanOrEqual(b.heaviest[1]!.tokens);
    expect(b.heaviest[0]!.id).toBe('7'); // largest
  });

  it('falls back to "other" when a block has no group', () => {
    const b = calculatePresetBudget([{ id: 'a', enabled: true, content: 'abcd' }]);
    expect(b.byCategory.other?.count).toBe(1);
  });

  it('handles an empty block list', () => {
    const b = calculatePresetBudget([]);
    expect(b.totalTokens).toBe(0);
    expect(b.enabledCount).toBe(0);
    expect(b.heaviest).toEqual([]);
  });
});

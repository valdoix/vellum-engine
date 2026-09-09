import { describe, expect, it } from 'vitest';
import { selectLorebookCanon } from '../src/domain/lorebook-canon.js';

describe('attached lorebook canon selection', () => {
  it('keeps constant canon and ranks keyed live-story matches ahead of unrelated entries', () => {
    const selected = selectLorebookCanon([
      { id: 'unrelated', bookId: 'book', keys: ['Western Sea'], content: 'The western sea freezes in winter.' },
      { id: 'moon', bookId: 'book', keys: ['Moon Gate'], content: 'The Moon Gate crosses the eastern ridge.' },
      { id: 'law', bookId: 'book', constant: true, content: 'Magic always leaves a visible mark.' },
    ], 'Mara approaches the Moon Gate.', 2, 10_000);
    expect(selected.map(entry => entry.id)).toEqual(['law', 'moon']);
  });

  it('bounds the number and size of lore entries sent to a model', () => {
    const selected = selectLorebookCanon(Array.from({ length: 10 }, (_, index) => ({
      id: `entry-${index}`, bookId: 'book', constant: true, content: 'x'.repeat(5000),
    })), '', 3, 3000);
    expect(selected.length).toBeLessThanOrEqual(3);
    expect(selected.every(entry => entry.content.length <= 2400)).toBe(true);
    expect(selected.reduce((sum, entry) => sum + entry.content.length + 32, 0)).toBeLessThanOrEqual(3000);
  });
});

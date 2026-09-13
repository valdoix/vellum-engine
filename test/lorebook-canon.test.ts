import { describe, expect, it } from 'vitest';
import { scanOpeningLorebook, selectLorebookCanon } from '../src/domain/lorebook-canon.js';

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

describe('opening lorebook scan', () => {
  it('records explicitly current situations and only their relevant characters', () => {
    const scan = scanOpeningLorebook([
      { id: 'opening', bookId: 'buffy', title: 'Current Situation', category: 'scenario', content: 'At present, Buffy Summers has just climbed from her grave while Willow Rosenberg flees the cemetery.' },
      { id: 'buffy', bookId: 'buffy', title: 'Buffy Summers', category: 'characters', keys: ['Buffy Summers'], content: 'She is the Slayer and recently returned from death.' },
      { id: 'willow', bookId: 'buffy', title: 'Willow Rosenberg', category: 'characters', keys: ['Willow Rosenberg'], content: 'She is a powerful witch.' },
      { id: 'giles', bookId: 'buffy', title: 'Rupert Giles', category: 'characters', keys: ['Rupert Giles'], content: 'He is a Watcher living abroad.' },
      { id: 'old', bookId: 'buffy', title: 'Ancient History', content: 'A battle happened centuries ago.' },
    ], 'Open at the Sunnydale cemetery with Buffy Summers.');
    expect(scan.situations).toEqual([expect.objectContaining({ fact: expect.stringContaining('has just climbed') })]);
    expect(scan.characters.map(row => row.name)).toEqual(['Buffy Summers', 'Willow Rosenberg']);
    expect(scan.characters.map(row => row.name)).not.toContain('Rupert Giles');
  });
});

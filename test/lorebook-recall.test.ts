import { describe, expect, it } from 'vitest';
import { buildLorebookRecall } from '../src/retrieval/lorebook.js';

describe('active lorebook recall', () => {
  it('retrieves a current entity and tightly linked support without filling with unrelated lore', () => {
    const result = buildLorebookRecall([
      {
        id: 'willow', bookId: 'buffy', title: 'Willow Rosenberg', keys: ['Willow'],
        content: 'Willow is a gifted witch. Her ritual notes refer to the Orb of Thessulah.',
      },
      {
        id: 'orb', bookId: 'buffy', title: 'Orb of Thessulah', keys: ['Thessulah'],
        content: 'A fragile crystal used in soul-restoration rites.',
      },
      {
        id: 'tax', bookId: 'city', title: 'Council Tax Code', keys: ['tax'],
        content: 'The western wards assess market tolls every winter.',
      },
    ], { focus: 'Willow studies the ritual notes.', recent: '', anchors: [] }, { maxDynamicEntries: 3 });

    expect(result.dynamicIds).toContain('lorebook:buffy:willow');
    expect(result.dynamicIds).toContain('lorebook:buffy:orb');
    expect(result.dynamicIds).not.toContain('lorebook:city:tax');
    expect(result.text).toContain('not proof that any character knows it');
  });

  it('weights the newest exchange above an older background mention', () => {
    const result = buildLorebookRecall([
      { id: 'willow', bookId: 'b', title: 'Willow Rosenberg', keys: ['Willow'], content: 'Willow practices witchcraft.' },
      { id: 'spike', bookId: 'b', title: 'Spike', keys: ['Spike'], content: 'Spike is a vampire in Sunnydale.' },
    ], { focus: 'Spike reaches the crypt.', recent: 'Earlier, Willow left the library.' }, { maxDynamicEntries: 1 });

    expect(result.dynamicIds).toEqual(['lorebook:b:spike']);
  });

  it('does not duplicate entries already injected by native world info', () => {
    const result = buildLorebookRecall([
      { id: 'spike', bookId: 'b', title: 'Spike', keys: ['Spike'], content: 'Spike is a vampire.', constant: true },
      { id: 'crypt', bookId: 'b', title: 'Spike crypt', keys: ['crypt'], content: 'The crypt lies in Restfield Cemetery.' },
    ], { focus: 'Spike enters the crypt.' }, { activatedIds: new Set(['lorebook:b:spike']) });

    expect(result.ids).toEqual(['lorebook:b:crypt']);
    expect(result.skippedActivatedIds).toEqual(['lorebook:b:spike']);
    expect(result.text.match(/Spike is a vampire/g)).toBeNull();
  });

  it('keeps same-shaped entry IDs from different books independent', () => {
    const result = buildLorebookRecall([
      { id: '1', bookId: 'people', title: 'Spike', keys: ['Spike'], content: 'Spike is a vampire.' },
      { id: '1', bookId: 'places', title: 'The Crypt', keys: ['crypt'], content: 'The crypt lies in Restfield Cemetery.' },
    ], { focus: 'Spike enters the crypt.' }, { activatedIds: new Set(['lorebook:people:1']) });

    expect(result.skippedActivatedIds).toEqual(['lorebook:people:1']);
    expect(result.dynamicIds).toEqual(['lorebook:places:1']);
  });

  it('keeps non-native constants on a fresh chat but never pads with zero-relevance entries', () => {
    const result = buildLorebookRecall([
      { id: 'law', bookId: 'b', title: 'World law', content: 'Magic always leaves a visible mark.', constant: true },
      { id: 'sea', bookId: 'b', title: 'Western Sea', keys: ['Western Sea'], content: 'The western sea freezes in winter.' },
    ], { focus: '', recent: '', anchors: [] });

    expect(result.ids).toEqual(['lorebook:b:law']);
    expect(result.text).toContain('Magic always leaves a visible mark.');
    expect(result.text).not.toContain('western sea freezes');
  });

  it('uses canonical scene anchors even when the newest prose uses only pronouns', () => {
    const result = buildLorebookRecall([
      { id: 'moon', bookId: 'b', title: 'Moon Gate', keys: ['Moon Gate'], content: 'The Moon Gate crosses the eastern ridge.' },
    ], { focus: 'She steps through it.', anchors: ['Moon Gate', 'Mara Venn'] });

    expect(result.ids).toEqual(['lorebook:b:moon']);
  });
});

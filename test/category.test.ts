import { describe, it, expect } from 'vitest';
import { normalizeCategorySet, primaryCategory, catRank } from '../src/domain/category.js';

describe('category set', () => {
  it('drops neutral once a real bond exists', () => {
    expect(normalizeCategorySet(['neutral', 'social'])).toEqual(['social']);
  });

  it('dedupes and orders by rank desc', () => {
    expect(normalizeCategorySet(['social', 'familial', 'social'])).toEqual(['familial', 'social']);
  });

  it('never returns empty', () => {
    expect(normalizeCategorySet([])).toEqual(['neutral']);
    expect(normalizeCategorySet(['garbage'])).toEqual(['neutral']);
  });

  it('allows coexisting facets (kin + rivals)', () => {
    const set = normalizeCategorySet(['familial', 'rivalry']);
    expect(set).toContain('familial');
    expect(set).toContain('rivalry');
  });

  it('primary picks highest rank', () => {
    expect(primaryCategory(['social', 'romantic'])).toBe('romantic');
    expect(primaryCategory(['familial', 'rivalry'])).toBe('familial');
    expect(primaryCategory(['neutral'])).toBe('neutral');
  });

  it('rank ordering is sane', () => {
    expect(catRank('familial')).toBeGreaterThan(catRank('social'));
    expect(catRank('neutral')).toBe(0);
  });
});

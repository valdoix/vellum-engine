import { describe, it, expect } from 'vitest';
import { importLegacy } from '../src/store/import-legacy.js';
import { reduce } from '../src/core/reduce.js';

const LEGACY = {
  version: 3,
  turns: 42,
  lastDay: 6,
  cast: {
    cersei: { id: 'cersei', name: 'Cersei Lannister', aka: ['the Queen'], role: 'Queen Regent', status: 'present' },
    jaime: { id: 'jaime', name: 'Jaime Lannister', status: 'active' },
  },
  relations: [
    { a: 'Cersei Lannister', b: 'Jaime Lannister', categories: ['familial', 'romantic'], affection: 80, trust: 60, label: 'twin' },
  ],
  knowledge: [{ who: 'Cersei Lannister', fact: 'the children are not Robert\u2019s' }],
  secrets: [{ id: 's1', keeper: 'Cersei Lannister', from: ['Robert'], secret: 'incest', revealed: false }],
  memories: [{ id: 'm1', title: 'The Hand\u2019s death', gist: 'Jon Arryn died suspiciously', keywords: ['Arryn', 'death'] }],
  threads: { succession: { title: 'The succession', status: 'advancing' } },
  arcs: {},
};

describe('legacy importer', () => {
  it('replays a 1.x chronicle into events that reduce to equivalent state', () => {
    const events = importLegacy(LEGACY);
    const s = reduce(events);
    expect(s.turns).toBe(42);
    expect(s.day).toBe(6);
    // cast preserved with metadata (id is canonicalized from the full name)
    expect(s.cast.cersei_lannister?.name).toBe('Cersei Lannister');
    expect(s.cast.cersei_lannister?.role).toBe('Queen Regent');
    expect(s.cast.cersei_lannister?.aka).toContain('the Queen');
    // relation: one edge, both facets, absolute scores
    expect(s.relations).toHaveLength(1);
    expect(s.relations[0]!.categories).toContain('familial');
    expect(s.relations[0]!.categories).toContain('romantic');
    expect(s.relations[0]!.affection).toBe(80);
    // knowledge, secret, memory, thread carried over
    expect(s.knowledge).toHaveLength(1);
    expect(s.secrets[0]!.keeper).toBe('cersei_lannister');
    expect(s.memories.find((m) => m.text.includes('Jon Arryn'))).toBeTruthy();
    expect(s.threads.find((t) => /succession/i.test(t.name))).toBeTruthy();
  });

  it('handles an empty/garbage blob without throwing', () => {
    expect(() => reduce(importLegacy(null))).not.toThrow();
    expect(() => reduce(importLegacy({}))).not.toThrow();
    expect(reduce(importLegacy({})).turns).toBe(0);
  });
});

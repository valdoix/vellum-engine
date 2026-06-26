import { describe, it, expect } from 'vitest';
import { autoAuthorDrafts, findDupe, textSimilarity } from '../src/domain/vault-intel.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';

function st(): ChronicleState {
  const s = freshState();
  s.turns = 10;
  s.cast.selene = { id: 'selene', name: 'Selene', aka: [], status: 'present', role: 'priestess', source: 'auto', firstTurn: 1, lastTurn: 8, userEdited: false } as any;
  s.cast.passerby = { id: 'passerby', name: 'A Passerby', aka: [], status: 'active', role: '', source: 'auto', firstTurn: 9, lastTurn: 9, userEdited: false } as any;
  return s;
}

describe('Tier-C auto-author', () => {
  it('drafts salient uncovered cast, skips one-off mentions', () => {
    const d = autoAuthorDrafts(st(), new Set());
    expect(d.find((x) => x.id === 'selene')).toBeTruthy(); // present + recurring
    expect(d.find((x) => x.id === 'passerby')).toBeFalsy(); // active but 1-turn
  });
  it('skips already-covered cast', () => {
    const d = autoAuthorDrafts(st(), new Set(['cast:selene']));
    expect(d.find((x) => x.id === 'selene')).toBeFalsy();
  });
});

describe('dupe guard', () => {
  it('flags near-duplicate content', () => {
    const entries = [{ id: 'e1', key: [], content: 'Selene is the priestess of the moon temple', link: '', category: 'characters', disabled: false }] as any;
    const dupe = findDupe('Selene, priestess of the moon temple', entries);
    expect(dupe?.entryId).toBe('e1');
  });
  it('passes unique content', () => {
    const entries = [{ id: 'e1', key: [], content: 'Thornfield Castle sits on the moor', link: '', category: 'locations', disabled: false }] as any;
    expect(findDupe('Selene is a priestess', entries)).toBeNull();
  });
  it('similarity is 0..1', () => {
    expect(textSimilarity('Selene priestess moon temple', 'Selene priestess moon temple')).toBeGreaterThan(0.9);
    expect(textSimilarity('apple', 'orange')).toBe(0);
  });
});

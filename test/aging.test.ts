import { describe, it, expect } from 'vitest';
import { agingInjection, LIVING_SKIP_MIN } from '../src/domain/aging.js';
import { freshState } from '../src/domain/types.js';

describe('agingInjection — living clock decay', () => {
  it('is silent when the skip is below the minimum', () => {
    const s = freshState();
    s.day = 5;
    s.scene.detail = [{ id: 'ned', condition: 'gash on the arm' }];
    expect(agingInjection(s, 5, LIVING_SKIP_MIN - 1)).toBe('');
  });

  it('surfaces a present character\'s stale condition across a week skip', () => {
    const s = freshState();
    s.day = 12;
    s.cast = { ned: { id: 'ned', name: 'Ned', aka: [], status: 'present', source: 'auto', firstTurn: 1, lastTurn: 5, userEdited: false } };
    s.scene.detail = [{ id: 'ned', condition: 'gash on the arm' }];
    const out = agingInjection(s, 12, 7);
    expect(out).toContain('LIVING CLOCK');
    expect(out).toContain('Ned');
    expect(out).toContain('gash on the arm');
    expect(out).toContain('7 days');
  });

  it('nudges an overdue plant using its planted day', () => {
    const s = freshState();
    s.day = 40;
    s.plants = [{ id: 'p1', what: 'a locked drawer', status: 'planted', plantedTurn: 2, plantedDay: 5 }];
    const out = agingInjection(s, 40, 20);
    expect(out).toContain('a locked drawer');
    expect(out).toContain('month'); // ~35 days since planted
  });

  it('flags distant defining beats as distant', () => {
    const s = freshState();
    s.day = 60;
    s.memories = [{ id: 'b1', tier: 'beat', text: 'The oath at Winterfell', keys: [], turn: 1, beatDay: 5 } as any];
    const out = agingInjection(s, 60, 30);
    expect(out).toContain('The oath at Winterfell');
    expect(out).toContain('ago');
  });

  it('notes character aging on a months-plus skip when age is numeric', () => {
    const s = freshState();
    s.day = 200;
    s.cast = { ned: { id: 'ned', name: 'Ned', aka: [], status: 'present', age: '35', source: 'auto', firstTurn: 1, lastTurn: 5, userEdited: false } };
    const out = agingInjection(s, 200, 90);
    expect(out).toContain('older');
  });
});

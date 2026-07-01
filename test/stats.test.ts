import { describe, it, expect } from 'vitest';
import { storyStats } from '../src/domain/stats.js';
import { freshState } from '../src/domain/types.js';

describe('storyStats', () => {
  it('counts turns/days/cast/bonds/chapters and ranks connected characters', () => {
    const s = freshState();
    s.turns = 40; s.day = 6;
    for (const id of ['cersei', 'jaime', 'tyrion']) s.cast[id] = { id, name: id, aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 40, userEdited: false } as any;
    s.memories.push({ id: 'c1', tier: 'chapter', text: 'x', keys: [], turn: 8 } as any);
    s.relations.push({ a: 'cersei', b: 'jaime', label: '', categories: ['romantic'], category: 'romantic', affection: 60, trust: 20, sentiment: 'warm', status: 'active', source: 'auto', userEdited: false, firstTurn: 1, lastTurn: 40, firstDay: 1, history: [{ turn: 1, day: 1, affection: 10, trust: 0 }, { turn: 40, day: 6, affection: 60, trust: 20 }], categoryHistory: [] } as any);
    s.relations.push({ a: 'cersei', b: 'tyrion', label: '', categories: ['rivalry'], category: 'rivalry', affection: -30, trust: -10, sentiment: 'hostile', status: 'active', source: 'auto', userEdited: false, firstTurn: 1, lastTurn: 40, firstDay: 1, history: [], categoryHistory: [] } as any);
    const st = storyStats(s);
    expect(st).toMatchObject({ turns: 40, days: 6, cast: 3, bonds: 2, chapters: 1 });
    expect(st.topCharacters[0]!.name).toBe('cersei'); // 2 bonds
    expect(st.biggestSwings[0]).toMatchObject({ pair: 'cersei \u2192 jaime', delta: 50 });
  });

  it('empty state yields zeroes and no swings', () => {
    const st = storyStats(freshState());
    expect(st).toMatchObject({ turns: 0, cast: 0, bonds: 0 });
    expect(st.biggestSwings).toEqual([]);
  });
});

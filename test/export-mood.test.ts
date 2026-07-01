import { describe, it, expect } from 'vitest';
import { toMarkdown } from '../src/domain/markdown.js';
import { moodRuns, moodInjection } from '../src/domain/mood.js';
import { freshState } from '../src/domain/types.js';
import type { VellumEvent } from '../src/core/events.js';

const nm = (id: string): string => (({ cersei: 'Cersei' }) as Record<string, string>)[id] ?? id;
const ss = (turn: number, detail: Array<{ id: string; mood?: string }>): VellumEvent => ({ seq: turn, turn, day: 1, src: 'model', kind: 'scene.set', present: detail.map((d) => d.id), detail } as any);

describe('toMarkdown', () => {
  it('renders title, cast, and codex; omits empty sections', () => {
    const s = freshState();
    s.turns = 12; s.day = 3;
    s.cast.cersei = { id: 'cersei', name: 'Cersei', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 12, userEdited: false, role: 'Queen', traits: ['guarded', 'proud'] } as any;
    s.lore.push({ id: 'l1', fact: 'The Salt Guild brands initiates.', turn: 2 });
    const md = toMarkdown(s, 'Test');
    expect(md).toContain('# Test');
    expect(md).toContain('## Cast');
    expect(md).toContain('### Cersei');
    expect(md).toContain('**Traits:** guarded, proud');
    expect(md).toContain('## Codex');
    expect(md).toContain('Salt Guild');
    expect(md).not.toContain('## Story So Far'); // no chapters/arcs
  });
});

describe('mood recency', () => {
  it('reports a mood that has persisted 2+ consecutive scenes', () => {
    const evs = [ss(1, [{ id: 'cersei', mood: 'grieving' }]), ss(2, [{ id: 'cersei', mood: 'grieving' }]), ss(3, [{ id: 'cersei', mood: 'grieving' }])];
    const runs = moodRuns(evs, ['cersei']);
    expect(runs[0]).toMatchObject({ who: 'cersei', mood: 'grieving', turns: 3 });
    expect(moodInjection(evs, ['cersei'], nm)).toContain('grieving for 3 turns');
  });

  it('does not report a mood that just changed (run of 1)', () => {
    const evs = [ss(1, [{ id: 'cersei', mood: 'calm' }]), ss(2, [{ id: 'cersei', mood: 'furious' }])];
    expect(moodRuns(evs, ['cersei'])).toHaveLength(0);
    expect(moodInjection(evs, ['cersei'], nm)).toBe('');
  });

  it('only considers present characters', () => {
    const evs = [ss(1, [{ id: 'cersei', mood: 'sad' }]), ss(2, [{ id: 'cersei', mood: 'sad' }])];
    expect(moodRuns(evs, ['jaime'])).toHaveLength(0);
  });
});

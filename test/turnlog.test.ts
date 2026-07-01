import { describe, it, expect } from 'vitest';
import { turnLog } from '../src/domain/turnlog.js';
import type { VellumEvent } from '../src/core/events.js';

const nm = (id: string): string => (({ cersei: 'Cersei', jaime: 'Jaime' }) as Record<string, string>)[id] ?? id;
const ev = (o: Partial<VellumEvent>): VellumEvent => ({ seq: 1, turn: 1, day: 1, src: 'model', ...(o as object) } as VellumEvent);

describe('turnLog (Turn Inspector)', () => {
  it('groups meaningful changes by turn, newest first', () => {
    const out = turnLog([
      ev({ turn: 1, kind: 'bond.delta', a: 'cersei', b: 'jaime', aff: 5, why: 'a look' } as any),
      ev({ turn: 2, kind: 'knowledge.learn', who: 'cersei', fact: 'the letter is forged' } as any),
      ev({ turn: 2, kind: 'scar.form', who: 'jaime', was: 'trusted her' } as any),
    ], nm);
    expect(out.map((t) => t.turn)).toEqual([2, 1]); // newest first
    expect(out[0]!.changes).toHaveLength(2);
    expect(out[1]!.changes[0]!.text).toContain('Cersei');
    expect(out[1]!.changes[0]!.text).toContain('Jaime');
  });

  it('omits structural/noise events and empty turns', () => {
    const out = turnLog([
      ev({ turn: 1, kind: 'turn.fold', sig: 'x' } as any),
      ev({ turn: 1, kind: 'cast.seen', id: 'cersei', name: 'Cersei', status: 'present' } as any),
      ev({ turn: 1, kind: 'scene.set', present: [] } as any),
      ev({ turn: 1, kind: 'location.set', id: 'l', name: 'The Solar', auto: true } as any), // auto loc = noise
    ], nm);
    expect(out).toHaveLength(0);
  });

  it('drops turn 0 / unturned events', () => {
    const out = turnLog([ev({ turn: 0, kind: 'bond.delta', a: 'cersei', b: 'jaime', aff: 1 } as any)], nm);
    expect(out).toHaveLength(0);
  });

  it('renders trait drift and item changes', () => {
    const out = turnLog([
      ev({ turn: 3, kind: 'trait.drift', who: 'cersei', trait: 'guarded', op: 'reverse', from: 'trusting' } as any),
      ev({ turn: 3, kind: 'item.change', who: 'cersei', item: 'the letter', op: 'gain' } as any),
    ], nm);
    expect(out[0]!.changes.some((c) => c.text.includes('guarded'))).toBe(true);
    expect(out[0]!.changes.some((c) => c.text.includes('the letter'))).toBe(true);
  });
});

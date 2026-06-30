import { describe, it, expect } from 'vitest';
import { reduce } from '../src/core/reduce.js';
import type { VellumEvent } from '../src/core/events.js';
import { coreFeature } from '../src/domain/core-feature.js';
import { cmdEvents } from '../src/domain/commands.js';
import { buildPromotion } from '../src/domain/promote.js';
import { allocate } from '../src/retrieval/budget.js';
import { buildInjection } from '../src/retrieval/recall.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';

let seq = 0;
function ev(e: Partial<VellumEvent> & { kind: VellumEvent['kind'] }): VellumEvent {
  return { seq: ++seq, turn: 1, day: 1, src: 'model', ...(e as object) } as VellumEvent;
}

describe('personality — reducer (Phase 1)', () => {
  it('cast.edit sets disposition and traits', () => {
    const s = reduce([
      ev({ kind: 'cast.seen', id: 'cersei', name: 'Cersei', status: 'present' } as any),
      ev({ kind: 'cast.edit', id: 'cersei', patch: { disposition: 'proud, never forgets a slight', traits: ['guarded', 'sharp-tongued'] } } as any),
    ]);
    expect(s.cast.cersei!.disposition).toBe('proud, never forgets a slight');
    expect(s.cast.cersei!.traits).toEqual(['guarded', 'sharp-tongued']);
  });

  it('empty disposition string and empty traits array clear the fields', () => {
    const s = reduce([
      ev({ kind: 'cast.seen', id: 'c', name: 'C', status: 'present' } as any),
      ev({ kind: 'cast.edit', id: 'c', patch: { disposition: 'x', traits: ['a'] } } as any),
      ev({ kind: 'cast.edit', id: 'c', patch: { disposition: '', traits: [] } } as any),
    ]);
    expect(s.cast.c!.disposition).toBeUndefined();
    expect(s.cast.c!.traits).toBeUndefined();
  });

  it('traits are trimmed, deduped (case-insensitive) and capped at 6', () => {
    const s = reduce([
      ev({ kind: 'cast.seen', id: 'c', name: 'C', status: 'present' } as any),
      ev({ kind: 'cast.edit', id: 'c', patch: { traits: [' Guarded ', 'guarded', 'a', 'b', 'c', 'd', 'e', 'f', 'g'] } } as any),
    ]);
    expect(s.cast.c!.traits).toEqual(['Guarded', 'a', 'b', 'c', 'd', 'e']); // dedupe then cap 6
  });

  it('a later model edit cannot overwrite a user-set card field', () => {
    const s = reduce([
      ev({ kind: 'cast.seen', id: 'c', name: 'C', status: 'present' } as any),
      ev({ kind: 'cast.edit', id: 'c', patch: { traits: ['stoic'] }, src: 'user' } as any),
    ]);
    expect(s.cast.c!.userEdited).toBe(true);
    expect(s.cast.c!.traits).toEqual(['stoic']);
  });
});

describe('personality — model emission via present (Phase 2)', () => {
  const ctx = (state: ChronicleState, turn: number) => ({ turn, day: 1, state, seq: () => ++seq });

  it('a present entry with traits emits a cast.edit that lands on the card', () => {
    const s = reduce(coreFeature.extract!({
      present: [{ name: 'Cersei Lannister', traits: ['guarded', 'proud'] }],
    } as any, ctx(freshState(), 1)));
    expect(s.cast.cersei_lannister!.traits).toEqual(['guarded', 'proud']);
  });

  it('a pronoun present entry never emits a traits cast.edit', () => {
    const out = coreFeature.extract!({
      present: [{ name: 'She', traits: ['mysterious'] }],
    } as any, ctx(freshState(), 1));
    expect(out.some((e) => e.kind === 'cast.edit')).toBe(false);
    expect(out.some((e) => e.kind === 'cast.seen')).toBe(false);
  });
});

describe('personality — command layer (Phase 5)', () => {
  const ctx = { turn: 5, day: 2 };
  it('cast_upsert parses comma-string traits into an array and sets disposition', () => {
    const s = reduce(cmdEvents('cast_upsert', { entry: { name: 'Cersei', disposition: 'cold', traits: 'guarded, proud , sharp-tongued' } }, freshState(), ctx));
    const c = s.cast.cersei!;
    expect(c.disposition).toBe('cold');
    expect(c.traits).toEqual(['guarded', 'proud', 'sharp-tongued']);
  });
});

describe('personality — promotion (Phase 5)', () => {
  it('castContent includes disposition and traits; hash changes when traits change', () => {
    const s = freshState();
    s.cast.cersei = { id: 'cersei', name: 'Cersei', aka: [], status: 'active', role: 'Queen', disposition: 'proud', traits: ['guarded'], source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false } as any;
    const p1 = buildPromotion(s, 'cast', 'cersei')!;
    expect(p1.content).toContain('proud');
    expect(p1.content).toContain('guarded');
    s.cast.cersei!.traits = ['guarded', 'ruthless'];
    const p2 = buildPromotion(s, 'cast', 'cersei')!;
    expect(p2.hash).not.toBe(p1.hash);
  });
});

describe('personality — recall feed-back + budget (Phase 4/5)', () => {
  it('structured cast line carries a capped (top-3) traits clause', () => {
    const s = freshState();
    s.turns = 3;
    s.scene.present = ['cersei'];
    s.cast.cersei = { id: 'cersei', name: 'Cersei', aka: [], status: 'present', role: 'Queen', traits: ['guarded', 'proud', 'sharp', 'extra'], source: 'auto', firstTurn: 1, lastTurn: 3, userEdited: false } as any;
    const { text } = buildInjection('chat-x', s, 'Cersei in the solar');
    expect(text).toContain('Queen; guarded, proud, sharp');
    expect(text).not.toContain('extra'); // capped at 3
  });

  it('raised budget caps allocate unscaled (invariant structured + recall ≤ TOTAL)', () => {
    const out = allocate({ total: 4400, caps: { structured: 1800, recall: 2600 } });
    expect(out.structured).toBe(1800);
    expect(out.recall).toBe(2600);
  });
});

import { describe, it, expect, beforeAll } from 'vitest';

// chronicle.ts touches `spindle` (storage/log). Provide a no-op global so the
// in-memory cache path works without a host. No storage → stays in memory.
beforeAll(() => { (globalThis as any).spindle = (globalThis as any).spindle ?? {}; });

const ev = (turn: number, seq: number, extra: Record<string, unknown>) => ({ seq, turn, day: 1, src: 'model' as const, ...extra });

describe('Fix 10 — truncateAfterTurn (undo)', () => {
  it('drops events past the kept turn and re-reduces; respects scrub semantics', async () => {
    const { append, truncateAfterTurn, loadState } = await import('../src/store/chronicle.js');
    const chatId = 'undo_test_' + Math.random().toString(36).slice(2);
    await append(chatId, [
      ev(1, 1, { kind: 'cast.seen', id: 'a', name: 'A', status: 'present' }) as any,
      ev(1, 2, { kind: 'bond.delta', a: 'a', b: 'b', aff: 10 }) as any,
      ev(2, 3, { kind: 'bond.delta', a: 'a', b: 'b', aff: 20 }) as any,
      ev(3, 4, { kind: 'bond.delta', a: 'a', b: 'b', aff: 30 }) as any,
    ]);
    let s = await loadState(chatId);
    expect(s.relations[0]!.affection).toBe(60); // 10+20+30

    s = await truncateAfterTurn(chatId, 2); // undo turn 3
    expect(s.relations[0]!.affection).toBe(30); // 10+20

    // reduce at turn 1 only
    s = await truncateAfterTurn(chatId, 1);
    expect(s.relations[0]!.affection).toBe(10);
  });

  it('truncating to a future turn is a no-op', async () => {
    const { append, truncateAfterTurn } = await import('../src/store/chronicle.js');
    const chatId = 'undo_noop_' + Math.random().toString(36).slice(2);
    await append(chatId, [ev(1, 1, { kind: 'bond.delta', a: 'a', b: 'b', aff: 10 }) as any]);
    const s = await truncateAfterTurn(chatId, 99);
    expect(s.relations[0]!.affection).toBe(10);
  });
});

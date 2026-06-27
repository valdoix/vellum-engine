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

describe('regeneration reconcile — turnSigs + rollback/re-fold', () => {
  const fold = (turn: number, seq0: number, sig: string, aff: number) => [
    ev(turn, seq0, { kind: 'turn.fold', sig }) as any,
    ev(turn, seq0 + 1, { kind: 'bond.delta', a: 'a', b: 'b', aff }) as any,
  ];

  it('turnSigs maps each turn to its latest fold signature', async () => {
    const { append, turnSigs } = await import('../src/store/chronicle.js');
    const chatId = 'sig_' + Math.random().toString(36).slice(2);
    await append(chatId, [...fold(1, 1, 'sigT1', 10), ...fold(2, 3, 'sigT2', 20)]);
    const sigs = await turnSigs(chatId);
    expect(sigs.get(1)).toBe('sigT1');
    expect(sigs.get(2)).toBe('sigT2');
  });

  it('regenerating turn 2: roll back to turn 1, re-fold → old turn-2 delta is gone', async () => {
    const { append, truncateAfterTurn, turnSigs, loadState } = await import('../src/store/chronicle.js');
    const chatId = 'regen_' + Math.random().toString(36).slice(2);
    await append(chatId, [...fold(1, 1, 'sigT1', 10), ...fold(2, 3, 'OLD', 20)]);
    expect((await loadState(chatId)).relations[0]!.affection).toBe(30); // 10 + 20

    // turn 2 regenerated: current sig 'NEW' != stored 'OLD' → divergence at turn 2,
    // keep up to turn 1, then re-fold the new turn-2 content (aff -5 instead of 20).
    const sigs = await turnSigs(chatId);
    let rollback: number | null = null;
    for (const t of [1, 2]) { if (sigs.get(t) !== (t === 2 ? 'NEW' : 'sigT1')) { rollback = t - 1; break; } }
    expect(rollback).toBe(1);

    await truncateAfterTurn(chatId, rollback!);
    await append(chatId, [...fold(2, 5, 'NEW', -5)]);
    expect((await loadState(chatId)).relations[0]!.affection).toBe(5); // 10 + (-5), old +20 dropped
  });
});

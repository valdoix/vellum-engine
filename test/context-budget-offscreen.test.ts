import { describe, it, expect } from 'vitest';
import { sanitizeBudget, resolveBudget, DEFAULT_BUDGET } from '../src/domain/context-budget.js';
import { readyToIntersect, offscreenInjection } from '../src/domain/offscreen.js';
import { freshState } from '../src/domain/types.js';

describe('context budget', () => {
  it('defaults to balanced == historical caps', () => {
    const caps = resolveBudget(DEFAULT_BUDGET);
    expect(caps).toMatchObject({ spine: 14, locations: 12, drift: 6, mood: 5, locks: 6, plants: 6, recallDepth: 12, simInterval: 4, autoSummaryAt: 16 });
  });

  it('lean and rich scale caps down/up', () => {
    const lean = resolveBudget(sanitizeBudget({ preset: 'lean' }));
    const rich = resolveBudget(sanitizeBudget({ preset: 'rich' }));
    expect(lean.spine).toBeLessThan(14);
    expect(rich.spine).toBeGreaterThan(14);
  });

  it('preset honors user sim/summary overrides', () => {
    const caps = resolveBudget(sanitizeBudget({ preset: 'balanced', simInterval: 8, autoSummaryAt: 30 }));
    expect(caps.simInterval).toBe(8);
    expect(caps.autoSummaryAt).toBe(30);
  });

  it('custom uses fields; a 0 cap / off toggle disables that injector', () => {
    const caps = resolveBudget(sanitizeBudget({ preset: 'custom', spine: 5, drift: 8, injectDrift: false, plants: 0, mood: 4 }));
    expect(caps.spine).toBe(5);
    expect(caps.drift).toBe(0);   // toggle off wins
    expect(caps.plants).toBe(0);  // 0 cap
    expect(caps.mood).toBe(4);
  });

  it('sanitize clamps out-of-range + junk to defaults', () => {
    const c = sanitizeBudget({ spine: 9999, drift: -5, preset: 'nonsense' });
    expect(c.preset).toBe('balanced');
    expect(c.spine).toBeLessThanOrEqual(40);
    expect(c.drift).toBeGreaterThanOrEqual(0);
  });
});

describe('offscreen convergence', () => {
  const thread = (o: Partial<ReturnType<typeof freshState>['offscreen'][number]>) => ({ id: 'a', name: 'X', status: 'active', gist: 'g', beats: [], firstTurn: 1, lastTurn: 1, ...o } as any);

  it('ripe when >= 3 beats', () => {
    const s = freshState();
    expect(readyToIntersect(s, thread({ beats: ['a', 'b', 'c'] }))).toBe(true);
    expect(readyToIntersect(s, thread({ beats: ['a'] }))).toBe(false);
  });

  it('ripe when where matches current scene location', () => {
    const s = freshState(); s.scene.location = 'The Docks';
    expect(readyToIntersect(s, thread({ where: 'the docks' }))).toBe(true);
    expect(readyToIntersect(s, thread({ where: 'the keep' }))).toBe(false);
  });

  it('resolved threads are never ripe', () => {
    expect(readyToIntersect(freshState(), thread({ status: 'resolved', beats: ['a', 'b', 'c'] }))).toBe(false);
  });

  it('injection lists ripe threads, empty when none', () => {
    const s = freshState();
    s.offscreen.push(thread({ id: 'r', name: 'The March', beats: ['x', 'y', 'z'], gist: 'nearing the gate' }));
    s.offscreen.push(thread({ id: 'q', name: 'Quiet', beats: ['x'] }));
    const inj = offscreenInjection(s);
    expect(inj).toContain('OFF-SCREEN');
    expect(inj).toContain('The March');
    expect(inj).not.toContain('Quiet');
    expect(offscreenInjection(freshState())).toBe('');
  });
});

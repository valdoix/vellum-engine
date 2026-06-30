import { describe, it, expect } from 'vitest';
import { sanitizeSummarizerCfg, DEFAULT_CFG, resolvePrompt, DEFAULT_CHAPTER_PROMPT, DEFAULT_ARC_PROMPT } from '../src/domain/summarizer-config.js';
import { planChapterFrom, planChapter } from '../src/domain/memory.js';
import { freshState } from '../src/domain/types.js';
import type { Memory } from '../src/domain/types.js';

function withTurns(n: number): ReturnType<typeof freshState> {
  const s = freshState();
  for (let i = 1; i <= n; i++) s.memories.push({ id: 'turn_' + i, tier: 'turn', text: `Turn ${i} happened.`, keys: [], turn: i } as Memory);
  s.turns = n;
  return s;
}

describe('sanitizeSummarizerCfg', () => {
  it('returns generous defaults for empty/junk input', () => {
    expect(sanitizeSummarizerCfg(undefined)).toEqual(DEFAULT_CFG);
    expect(sanitizeSummarizerCfg('nonsense')).toEqual(DEFAULT_CFG);
    expect(DEFAULT_CFG.genMaxTokens).toBe(4000);
    expect(DEFAULT_CFG.detailCap).toBe(6000);
  });

  it('clamps out-of-range numbers to the allowed window', () => {
    const c = sanitizeSummarizerCfg({ genMaxTokens: 999999, detailCap: 10, gistCap: 100000, temperature: 5 });
    expect(c.genMaxTokens).toBe(32000);
    expect(c.detailCap).toBe(1000);
    expect(c.gistCap).toBe(4000);
    expect(c.temperature).toBe(1);
  });

  it('keeps minWindow <= autoWindow', () => {
    const c = sanitizeSummarizerCfg({ autoWindow: 5, minWindow: 40 });
    expect(c.minWindow).toBeLessThanOrEqual(c.autoWindow);
    expect(c.autoWindow).toBe(5);
  });

  it('caps custom prompt length and coerces the custom toggle', () => {
    const c = sanitizeSummarizerCfg({ useCustom: 1, chapterPrompt: 'x'.repeat(20000) });
    expect(c.useCustom).toBe(true);
    expect(c.chapterPrompt.length).toBeLessThanOrEqual(8000);
  });
});

describe('resolvePrompt', () => {
  it('uses the built-in default when custom is off', () => {
    const p = resolvePrompt('chapter', DEFAULT_CFG);
    expect(p.startsWith('You are a story archivist')).toBe(true);
  });

  it('uses the custom prompt only when useCustom AND non-empty', () => {
    const on = sanitizeSummarizerCfg({ useCustom: true, chapterPrompt: 'MY CUSTOM CHAPTER PROMPT' });
    expect(resolvePrompt('chapter', on)).toContain('MY CUSTOM CHAPTER PROMPT');
    const emptyCustom = sanitizeSummarizerCfg({ useCustom: true, chapterPrompt: '' });
    expect(resolvePrompt('chapter', emptyCustom)).toBe(DEFAULT_CHAPTER_PROMPT.replace(/\{\{\s*detailWords\s*\}\}/g, String(Math.round(emptyCustom.detailCap / 6))));
  });

  it('substitutes {{detailWords}} from the configured detailCap', () => {
    const c = sanitizeSummarizerCfg({ detailCap: 6000 });
    expect(resolvePrompt('chapter', c)).toContain(String(Math.round(6000 / 6)));
    expect(resolvePrompt('chapter', c)).not.toContain('{{detailWords}}');
  });

  it('selects the arc prompt for the arc kind', () => {
    expect(resolvePrompt('arc', DEFAULT_CFG).startsWith('You are a story archivist consolidating')).toBe(true);
  });
});

describe('planChapterFrom (manual turn-pick)', () => {
  it('folds an explicit set of turn ids, sorted, with the true span', () => {
    const s = withTurns(10);
    const plan = planChapterFrom(s, ['turn_5', 'turn_2', 'turn_8'], 2);
    expect(plan).not.toBeNull();
    expect(plan!.sourceIds).toEqual(['turn_2', 'turn_5', 'turn_8']); // sorted by turn
    expect(plan!.covers).toEqual([2, 8]);
  });

  it('returns null below minWindow', () => {
    const s = withTurns(10);
    expect(planChapterFrom(s, ['turn_3'], 3)).toBeNull();
    expect(planChapterFrom(s, ['turn_3', 'turn_4'], 3)).toBeNull();
  });

  it('ignores ids that are not turn-tier memories', () => {
    const s = withTurns(4);
    s.memories.push({ id: 'chap_x', tier: 'chapter', text: 'a chapter', keys: [], turn: 2 } as Memory);
    const plan = planChapterFrom(s, ['turn_1', 'chap_x', 'turn_2'], 2);
    expect(plan!.sourceIds).toEqual(['turn_1', 'turn_2']);
  });

  it('auto planChapter still takes the oldest window', () => {
    const s = withTurns(10);
    const plan = planChapter(s, 4);
    expect(plan!.covers).toEqual([1, 4]);
  });
});

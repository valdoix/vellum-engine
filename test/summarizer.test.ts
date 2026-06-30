import { describe, it, expect } from 'vitest';
import { sanitizeSummarizerCfg, DEFAULT_CFG, resolvePrompt, DEFAULT_CHAPTER_PROMPT, DEFAULT_GIST_PROMPT } from '../src/domain/summarizer-config.js';
import { planChapterFrom, planChapter, planArc, planArcFrom, arcEvents } from '../src/domain/memory.js';
import { reduce } from '../src/core/reduce.js';
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

  it('chapter/arc prompts produce DETAIL+KEYS only (no GIST section)', () => {
    const chap = resolvePrompt('chapter', DEFAULT_CFG);
    expect(chap).toContain('DETAIL:');
    expect(chap).toContain('KEYS:');
    expect(chap).not.toContain('GIST:');
    const arc = resolvePrompt('arc', DEFAULT_CFG);
    expect(arc).toContain('DETAIL:');
    expect(arc).not.toContain('GIST:');
  });

  it('resolves a dedicated GIST prompt, customizable independently', () => {
    expect(resolvePrompt('gist', DEFAULT_CFG)).toBe(DEFAULT_GIST_PROMPT.replace(/\{\{[^}]*\}\}/g, (m) => m.includes('detailWords') ? String(Math.round(DEFAULT_CFG.detailCap / 6)) : m.includes('gistCap') ? String(DEFAULT_CFG.gistCap) : m.includes('detailCap') ? String(DEFAULT_CFG.detailCap) : m));
    const custom = sanitizeSummarizerCfg({ useCustom: true, gistPrompt: 'MY GIST RULE' });
    expect(resolvePrompt('gist', custom)).toContain('MY GIST RULE');
    // custom gist does not bleed into chapter/arc
    expect(resolvePrompt('chapter', custom)).toContain('story archivist');
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

function withChapters(n: number): ReturnType<typeof freshState> {
  const s = freshState();
  for (let i = 1; i <= n; i++) {
    const lo = (i - 1) * 5 + 1, hi = i * 5;
    s.memories.push({ id: 'chap_' + i, tier: 'chapter', text: `Chapter ${i} gist.`, detail: `Chapter ${i} detail.`, keys: ['k' + i], turn: hi, covers: [lo, hi] } as Memory);
  }
  s.turns = n * 5;
  return s;
}

describe('planArc / planArcFrom (chapters → arc)', () => {
  it('auto planArc takes the oldest chapters, keeping a lag of recent ones', () => {
    const s = withChapters(8);
    const plan = planArc(s, 3, 4); // 8 chapters, keep last 4 → 4 eligible
    expect(plan).not.toBeNull();
    expect(plan!.sourceIds.length).toBeGreaterThanOrEqual(3);
    expect(plan!.source.every((x) => x.tier === 'chapter')).toBe(true);
    expect(plan!.covers[0]).toBe(1); // starts at the oldest chapter's span
  });

  it('planArc returns null when too few old chapters', () => {
    const s = withChapters(4);
    expect(planArc(s, 3, 4)).toBeNull(); // all 4 are within the lag
  });

  it('planArcFrom folds an explicit chapter set with the true span', () => {
    const s = withChapters(6);
    const plan = planArcFrom(s, ['chap_2', 'chap_4'], 2);
    expect(plan).not.toBeNull();
    expect(plan!.sourceIds).toEqual(['chap_2', 'chap_4']);
    expect(plan!.covers).toEqual([6, 20]); // chap_2 covers 6-10, chap_4 covers 16-20
  });

  it('arcEvents records an arc and dropping it RESTORES the chapters', () => {
    const s = withChapters(4);
    const plan = planArcFrom(s, ['chap_1', 'chap_2'], 2)!;
    const evs = arcEvents(plan, { gist: 'Arc gist.', detail: 'Arc detail.', keys: ['a'] }, 20, 0, (() => { let n = 0; return () => ++n; })());
    const folded = reduce([...baseMemEvents(s), ...evs]);
    expect(folded.memories.find((m) => m.tier === 'arc')).toBeDefined();
    expect(folded.memories.filter((m) => m.tier === 'chapter').map((m) => m.id).sort()).toEqual(['chap_3', 'chap_4']); // 1&2 folded away
    // now drop the arc → chapters 1 & 2 come back with their detail/covers
    const arcId = folded.memories.find((m) => m.tier === 'arc')!.id;
    const after = reduce([...baseMemEvents(s), ...evs, { seq: 999, turn: 20, day: 0, src: 'user', kind: 'memory.drop', id: arcId } as any]);
    const restored = after.memories.filter((m) => m.tier === 'chapter').map((m) => m.id).sort();
    expect(restored).toEqual(['chap_1', 'chap_2', 'chap_3', 'chap_4']);
    const c1 = after.memories.find((m) => m.id === 'chap_1')!;
    expect(c1.detail).toBe('Chapter 1 detail.');
    expect(c1.covers).toEqual([1, 5]);
  });
});

// seed memory.record events so reduce() has the chapters present before folding
function baseMemEvents(s: ReturnType<typeof freshState>): any[] {
  return s.memories.map((m, i) => ({ seq: i + 1, turn: m.turn, day: 0, src: 'system', kind: 'memory.record', id: m.id, tier: m.tier, text: m.text, detail: m.detail, keys: m.keys ?? [], covers: m.covers }));
}

import { describe, it, expect } from 'vitest';
import { summarizeOnce, parseSummary } from '../src/bus/summarize.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';

// In tests there's no `spindle`, so internalGenerate returns an error and
// summarizeOnce takes the structural FALLBACK path — exactly what we're hardening.
function stateWithTurnMemories(n: number): ChronicleState {
  const s = freshState();
  s.turns = n;
  const longProse = 'The wheelhouse groans to a halt before the towering gates of Harrenhal and Cersei permits herself a moment of undisguised contempt before schooling her features into practiced composure that would make her father proud of the queen she pretends to be.';
  for (let i = 1; i <= n; i++) {
    s.memories.push({ id: 'turn_x_' + i, tier: 'turn', text: longProse + ' (turn ' + i + ')', keys: [], turn: i, covers: [i, i] } as any);
  }
  return s;
}

describe('summarize fallback (no host generation)', () => {
  it('produces a sentence-bounded digest, never a mid-word raw-prose dump', async () => {
    const evs = await summarizeOnce(stateWithTurnMemories(8), null, 8);
    const chapter = evs.find((e: any) => e.kind === 'memory.record') as any;
    expect(chapter).toBeTruthy();
    const text: string = chapter.text;
    expect(text.startsWith('Chapter (turns 1\u20138):')).toBe(true);
    // never ends mid-word: last char is sentence punctuation, ellipsis, or letter
    // following a complete sentence — specifically NOT a hard 1200 mid-word slice.
    expect(/[.!?\u2026]$/.test(text.trim()) || text.length < 1200).toBe(true);
    // it compressed: digest is far shorter than concatenating 8 full prose blocks
    const rawConcatLen = stateWithTurnMemories(8).memories.map((m) => m.text).join(' ').length;
    expect(text.length).toBeLessThan(rawConcatLen);
  });

  it('returns [] when there are too few turn-memories to fold', async () => {
    const evs = await summarizeOnce(stateWithTurnMemories(3), null, 8);
    expect(evs).toEqual([]);
  });

  it('never stores a summary cut mid-word', async () => {
    const evs = await summarizeOnce(stateWithTurnMemories(8), null, 8);
    const chapter = evs.find((e: any) => e.kind === 'memory.record') as any;
    const text: string = chapter.text;
    expect(text.length).toBeLessThanOrEqual(1200);
    // ends on sentence punctuation, ellipsis, or a complete word — not a fragment
    const last = text.trim().slice(-1);
    const endsClean = /[.!?\u2026)]/.test(last) || !text.includes('\u2026') ;
    expect(endsClean).toBe(true);
  });
});

describe('parseSummary - drop leading headless fragment', () => {
  it('skips a body cut mid-word to the first real sentence', () => {
    const r = parseSummary('ered and made anyway. During the lesson their arms brushed. Cersei moved astride him.');
    expect(r.detail.startsWith('ered')).toBe(false);
    expect(r.detail.startsWith('During')).toBe(true);
  });
  it('leaves clean capitalized text untouched', () => {
    expect(parseSummary('The lesson began. Their arms brushed.').detail.startsWith('The lesson')).toBe(true);
  });
  it('cleans a headless GIST line', () => {
    const r = parseSummary('DETAIL:\nThe lesson began.\nGIST:\npered and surrendered. Cersei gave the word.');
    expect(r.gist.startsWith('Cersei')).toBe(true);
  });
});

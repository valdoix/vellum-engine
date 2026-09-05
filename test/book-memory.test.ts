import { describe, expect, it } from 'vitest';
import { reduce } from '../src/core/reduce.js';
import type { VellumEvent } from '../src/core/events.js';
import { freshState, type ChronicleState, type Memory } from '../src/domain/types.js';
import {
  archivedTurnNumbers,
  arcEvents,
  bookEvents,
  chapterEvents,
  planArcFrom,
  planBook,
  planBookFrom,
  planChapterFrom,
} from '../src/domain/memory.js';
import {
  DEFAULT_BOOK_PROMPT,
  DEFAULT_CFG,
  resolvePrompt,
  sanitizeSummarizerCfg,
} from '../src/domain/summarizer-config.js';
import { collectItems } from '../src/retrieval/invindex.js';
import { buildIndex } from '../src/retrieval/invindex.js';
import { buildMemoryTree } from '../src/retrieval/tree.js';
import { traverseTree } from '../src/retrieval/traverse-tree.js';
import { Ok } from '../src/core/result.js';

let seq = 0;
const next = (): number => ++seq;
const drop = (id: string, turn: number): VellumEvent => ({
  seq: next(), turn, day: 1, src: 'user', kind: 'memory.drop', id,
} as VellumEvent);

function withArcs(n: number): ChronicleState {
  const s = freshState();
  for (let i = 1; i <= n; i++) {
    const lo = (i - 1) * 10 + 1;
    const hi = i * 10;
    s.memories.push({
      id: `arc_${i}`,
      tier: 'arc',
      text: `Arc ${i} gist.`,
      detail: `Arc ${i} detail.`,
      keys: [`arc-${i}`],
      turn: hi,
      covers: [lo, hi],
    });
  }
  s.turns = n * 10;
  return s;
}

function foldedBookState(): ChronicleState {
  let s = freshState();
  s.memories = Array.from({ length: 8 }, (_, i): Memory => ({
    id: `turn_${i + 1}`, tier: 'turn', text: `Turn ${i + 1}.`, keys: [], turn: i + 1,
  }));
  s.turns = 8;

  for (let i = 0; i < 4; i++) {
    const ids = [`turn_${i * 2 + 1}`, `turn_${i * 2 + 2}`];
    const plan = planChapterFrom(s, ids)!;
    s = reduce(chapterEvents(plan, {
      gist: `Chapter ${i + 1}.`, detail: `Chapter ${i + 1} exact detail.`, keys: [],
    }, 9 + i, 1, next), s);
  }

  const chapters = s.memories.filter((m) => m.tier === 'chapter').sort((a, b) => a.turn - b.turn);
  for (let i = 0; i < 2; i++) {
    const ids = chapters.slice(i * 2, i * 2 + 2).map((m) => m.id);
    const plan = planArcFrom(s, ids)!;
    s = reduce(arcEvents(plan, {
      gist: `Arc ${i + 1}.`, detail: `Arc ${i + 1} exact detail.`, keys: [],
    }, 20 + i, 1, next), s);
  }

  const arcIds = s.memories.filter((m) => m.tier === 'arc').map((m) => m.id);
  const plan = planBookFrom(s, arcIds)!;
  return reduce(bookEvents(plan, {
    gist: 'The complete first book.',
    detail: 'The complete exact history of the first book.',
    keys: ['first book'],
  }, 30, 1, next), s);
}

describe('Book planning and archive ancestry', () => {
  it('plans explicit arcs in chronology and records their full span', () => {
    const s = withArcs(4);
    const plan = planBookFrom(s, ['arc_4', 'arc_2'], 2);
    expect(plan?.sourceIds).toEqual(['arc_2', 'arc_4']);
    expect(plan?.source.every((m) => m.tier === 'arc')).toBe(true);
    expect(plan?.covers).toEqual([11, 40]);
  });

  it('keeps the newest arc loose in the automatic plan', () => {
    const plan = planBook(withArcs(4), 2, 1);
    expect(plan?.sourceIds).toEqual(['arc_1', 'arc_2', 'arc_3']);
    expect(plan?.sourceIds).not.toContain('arc_4');
  });

  it('folds to one book and losslessly unfolds book, arcs, chapters, and turns', () => {
    let s = foldedBookState();
    const book = s.memories.find((m) => m.tier === 'book')!;
    expect(s.memories).toHaveLength(1);
    expect(book.subsumed).toHaveLength(2);
    expect([...archivedTurnNumbers(s)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    const items = collectItems(s);
    expect(items.find((i) => i.id === 'turn_1')?.parentIds).toHaveLength(3);
    const tree = buildMemoryTree(s, items);
    expect(tree.rootIds).toEqual([book.id]);
    expect(tree.nodes.get(book.id)?.kind).toBe('book');
    expect(tree.nodes.get(book.id)?.childrenIds).toHaveLength(2);

    s = reduce([drop(book.id, 31)], s);
    expect(s.memories.filter((m) => m.tier === 'arc')).toHaveLength(2);
    s = reduce(s.memories.filter((m) => m.tier === 'arc').map((m) => drop(m.id, 32)), s);
    expect(s.memories.filter((m) => m.tier === 'chapter')).toHaveLength(4);
    s = reduce(s.memories.filter((m) => m.tier === 'chapter').map((m) => drop(m.id, 33)), s);
    expect(s.memories.filter((m) => m.tier === 'turn').map((m) => m.id).sort()).toEqual([
      'turn_1', 'turn_2', 'turn_3', 'turn_4', 'turn_5', 'turn_6', 'turn_7', 'turn_8',
    ]);
  });

  it('marks a selected book for detailed recall', async () => {
    const s = foldedBookState();
    const bookId = s.memories[0]!.id;
    const index = buildIndex(collectItems(s));
    const result = await traverseTree(index, s, async () => Ok(JSON.stringify({ expand: [], select: [bookId] })));
    expect(result?.ids).toEqual([bookId]);
    expect(result?.summaryIds).toEqual([bookId]);
  });

  it('drills through all four archive levels to an exact original turn', async () => {
    const s = foldedBookState();
    const book = s.memories[0]!;
    const arc = book.subsumed![0]!;
    const chapter = arc.subsumed![0]!;
    const turn = chapter.subsumed![0]!;
    const answers = [
      { expand: [book.id], select: [] },
      { expand: [arc.id], select: [] },
      { expand: [chapter.id], select: [] },
      { expand: [], select: [turn.id] },
    ];
    let call = 0;
    const index = buildIndex(collectItems(s));
    const result = await traverseTree(index, s, async () => Ok(JSON.stringify(answers[call++]!)));
    expect(result?.ids).toEqual([turn.id]);
    expect(result?.trace.steps).toHaveLength(4);
  });
});

describe('Book summarizer prompt', () => {
  it('uses a dedicated canon-preserving default with an exact output contract', () => {
    const prompt = resolvePrompt('book', DEFAULT_CFG);
    expect(prompt).toContain('ONE BOOK');
    expect(prompt).toContain('which secrets became known to whom');
    expect(prompt).toContain('exact closing state');
    expect(prompt).toContain('DETAIL:');
    expect(prompt).toContain('KEYS:');
    expect(prompt).not.toContain('{{detailWords}}');
    expect(prompt).not.toContain('GIST:');
  });

  it('keeps a custom Book prompt independent from the other prompts', () => {
    const cfg = sanitizeSummarizerCfg({ useCustom: true, bookPrompt: 'CUSTOM BOOK {{detailCap}}' });
    expect(resolvePrompt('book', cfg)).toBe(`CUSTOM BOOK ${cfg.detailCap}`);
    expect(resolvePrompt('chapter', cfg)).not.toContain('CUSTOM BOOK');
    expect(DEFAULT_BOOK_PROMPT).toContain('mistaken belief remains attributed');
  });
});

import { describe, it, expect } from 'vitest';
import { planChapterEntry, reconcileChapterEntries, dedupeKeys, projectable, type ChapterVaultMode } from '../src/domain/chapter-vault.js';
import { parseSummary } from '../src/bus/summarize.js';
import { reduce } from '../src/core/reduce.js';
import { buildInjection } from '../src/retrieval/recall.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';
import type { VellumEvent } from '../src/core/events.js';
import type { LiteEntry } from '../src/host/worldbooks.js';

let seq = 0;
const ev = (e: any): VellumEvent => ({ seq: ++seq, turn: 1, day: 1, src: 'system', ...e } as VellumEvent);

function chapterState(): ChronicleState {
  const s = freshState();
  s.turns = 12;
  s.memories = [
    { id: 'chap_a', tier: 'chapter', text: 'Cersei reached Harrenhal and warmed to Daeron.', detail: 'Cersei arrived at Harrenhal. Daeron offered marriage on equal terms; she softened. Jaime slept.', keys: ['Harrenhal', 'golden rose', 'marriage terms'], covers: [1, 8], turn: 8 },
  ] as any;
  return s;
}

const lite = (over: Partial<LiteEntry>): LiteEntry => ({
  id: 'e1', bookId: 'b1', key: [], keysecondary: [], content: '', comment: '', position: 0, depth: 4, order_value: 100,
  constant: false, disabled: false, vellum: true, category: 'chapter', source: 'chapter', link: 'chapter:chap_a', pending: false, hash: '', ...over,
});

describe('parseSummary — DETAIL / GIST / KEYS', () => {
  it('splits the three sections', () => {
    const raw = 'DETAIL:\nA dense multi-sentence record. Beat two. Beat three.\nGIST:\nCersei warmed to Daeron at Harrenhal.\nKEYS:\nHarrenhal, golden rose, marriage terms';
    const p = parseSummary(raw);
    expect(p.detail).toContain('dense multi-sentence');
    expect(p.gist).toBe('Cersei warmed to Daeron at Harrenhal.');
    expect(p.keys).toEqual(['Harrenhal', 'golden rose', 'marriage terms']);
  });
  it('falls back to whole-body-as-detail when unlabeled', () => {
    const p = parseSummary('just some prose with no labels');
    expect(p.detail).toBe('just some prose with no labels');
    expect(p.gist).toBe('');
  });
  it('strips bullets from keys', () => {
    const p = parseSummary('KEYS:\n- Harrenhal\n- golden rose');
    expect(p.keys).toEqual(['Harrenhal', 'golden rose']);
  });
});

describe('planChapterEntry', () => {
  it('uses detail as content, keys, chapter: link, keyed by default', () => {
    const m = chapterState().memories[0]!;
    const input = planChapterEntry(m, 'keyed');
    expect(input.content).toContain('marriage on equal terms');
    expect(input.key).toContain('Harrenhal');
    expect(input.link).toBe('chapter:chap_a');
    expect(input.category).toBe('summary');
    expect(input.settings.constant).toBe(false);
  });
  it('constant mode sets constant:true', () => {
    expect(planChapterEntry(chapterState().memories[0]!, 'constant').settings.constant).toBe(true);
  });
});

describe('reconcileChapterEntries', () => {
  it('creates an entry for an unprojected chapter', () => {
    const plan = reconcileChapterEntries(chapterState(), [], 'keyed');
    expect(plan.create).toHaveLength(1);
    expect(plan.create[0]!.memId).toBe('chap_a');
  });
  it('removes an orphaned chapter entry (memory gone)', () => {
    const plan = reconcileChapterEntries(freshState(), [lite({ id: 'orphan', link: 'chapter:gone' })], 'keyed');
    expect(plan.remove).toEqual(['orphan']);
  });
  it('KEY SYNC: user-edited entry keys flow back to the chronicle', () => {
    const entry = lite({ key: ['Harrenhal', 'the betrothal', 'Daeron study'] }); // user added/changed
    const plan = reconcileChapterEntries(chapterState(), [entry], 'keyed');
    expect(plan.keySync).toHaveLength(1);
    expect(plan.keySync[0]!.entryId).toBe('e1');
    expect(plan.keySync[0]!.keys).toContain('the betrothal');
  });
  it('never touches non-VELLUM or non-chapter entries', () => {
    const userEntry = lite({ id: 'u', vellum: false, link: 'whatever' });
    const castEntry = lite({ id: 'c', link: 'cast:cersei' });
    const plan = reconcileChapterEntries(freshState(), [userEntry, castEntry], 'keyed');
    expect(plan.remove).toEqual([]);
  });
  it('respects a user-edited body (does not clobber content)', () => {
    const entry = lite({ key: ['Harrenhal', 'golden rose', 'marriage terms'], content: 'MY OWN EDIT', source: 'manual' });
    const plan = reconcileChapterEntries(chapterState(), [entry], 'keyed');
    expect(plan.update).toHaveLength(0);
  });
});

describe('reduce — memory.link', () => {
  it('sets vaultEntryId and round-trips keys', () => {
    const s = reduce([
      ev({ kind: 'memory.record', id: 'chap_a', tier: 'chapter', text: 'gist', detail: 'detail', keys: ['a'], turn: 8 }),
      ev({ kind: 'memory.link', id: 'chap_a', vaultEntryId: 'entry_9', keys: ['a', 'b'] }),
    ]);
    const m = s.memories.find((x) => x.id === 'chap_a')!;
    expect(m.vaultEntryId).toBe('entry_9');
    expect(m.keys).toEqual(['a', 'b']);
    expect(m.detail).toBe('detail');
  });
});

describe('recall shows the GIST, not the detail', () => {
  it('injects the lean gist text, never the detailed body', () => {
    const s = chapterState();
    const inj = buildInjection('cHV', s, 'Harrenhal marriage');
    expect(inj.text).toContain('warmed to Daeron'); // gist
    expect(inj.text).not.toContain('offered marriage on equal terms'); // detail stays in vault
  });
});

describe('dedupeKeys', () => {
  it('lowercases-compares, drops dups, caps at 16', () => {
    expect(dedupeKeys(['A', 'a', 'B', '', '  C  '])).toEqual(['A', 'B', 'C']);
  });
});

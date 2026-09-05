import { describe, expect, it } from 'vitest';
import { coreFeature } from '../src/domain/core-feature.js';
import { reduce } from '../src/core/reduce.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';
import { archivedTurnNumbers, arcEvents, chapterEvents, planArcFrom, planChapterFrom } from '../src/domain/memory.js';
import { planHide, type HideMsg } from '../src/host/hide.js';
import { buildIndex, collectItems } from '../src/retrieval/invindex.js';
import { lexicalSearch } from '../src/retrieval/lexical.js';
import type { ExtractCtx } from '../src/bus/registry.js';
import type { VellumEvent } from '../src/core/events.js';

let seq = 100;
const next = () => ++seq;
const base = (kind: string, rest: Record<string, unknown>, turn = 1): VellumEvent =>
  ({ seq: next(), turn, day: 1, src: 'system', kind, ...rest } as VellumEvent);
const ctx = (state: ChronicleState): ExtractCtx => ({ state, turn: 9, day: 3, seq: next });

function cast(state: ChronicleState, id: string, name: string): void {
  state.cast[id] = { id, name, aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 9, userEdited: false };
}

describe('long-session continuity pipeline', () => {
  it('turns learned hidden prose into a stable secret audience update', () => {
    const state = freshState();
    cast(state, 'alice', 'Alice'); cast(state, 'bob', 'Bob'); cast(state, 'cara', 'Cara');
    state.secrets = [{ id: 'sec_birth', keeper: 'alice', from: ['bob', 'cara'], text: 'Alice is the lost heir', revealed: false, revealedTo: [], formedTurn: 2 }];
    const events = coreFeature.extract!({
      delta: { knowledge: [{ who: 'Bob', fact: 'Alice is the lost heir', source: 'Alice confessed' }] },
    } as any, ctx(state));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'secret.reveal', id: 'sec_birth', to: ['bob'] }),
      expect.objectContaining({ kind: 'knowledge.learn', who: 'bob' }),
    ]));
    const folded = reduce(events, structuredClone(state));
    expect(folded.secrets[0]!.revealedTo).toContain('bob');
    expect(folded.secrets[0]!.from).toEqual(['cara']);
  });

  it('uses explicit secret ids and deterministically gives recipients knowledge', () => {
    const state = freshState();
    cast(state, 'alice', 'Alice'); cast(state, 'bob', 'Bob');
    state.secrets = [{ id: 'sec_map', keeper: 'alice', from: ['bob'], text: 'the map points beneath the chapel', revealed: false, revealedTo: [], formedTurn: 2 }];
    const events = coreFeature.extract!({ delta: { secretReveals: [{ id: 'sec_map', to: ['Bob'] }] } } as any, ctx(state));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'secret.reveal', id: 'sec_map', to: ['bob'] }),
      expect.objectContaining({ kind: 'knowledge.learn', who: 'bob', fact: 'the map points beneath the chapel' }),
    ]));
  });

  it('refreshes an existing Codex row and records durable timeline beats', () => {
    const state = freshState();
    cast(state, 'alice', 'Alice');
    state.lore = [{ id: 'lore_moon', fact: 'The moon is iron', source: 'user', status: 'confirmed', turn: 2 }];
    const events = coreFeature.extract!({ ext: {
      codex: [{ id: 'lore_moon', op: 'refresh', fact: 'The iron moon is cracked', tag: 'sky' }],
      timeline: [{ event: 'Alice shattered the moon seal', participants: ['Alice'], location: 'Observatory', time: '21:15', importance: 'critical' }],
    } } as any, ctx(state));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'lore.refresh', id: 'lore_moon', fact: 'The iron moon is cracked' }),
      expect.objectContaining({ kind: 'memory.record', tier: 'beat', text: 'Alice shattered the moon seal', spine: true }),
    ]));
    const folded = reduce(events, structuredClone(state));
    expect(folded.lore[0]).toMatchObject({ fact: 'The iron moon is cracked', source: 'user', status: 'confirmed' });
    expect(folded.lore[0]!.revisions).toEqual([{ fact: 'The moon is iron', turn: 9 }]);
  });

  it('hides only exact archived turns for a noncontiguous manual chapter', () => {
    const state = freshState();
    state.memories = [1, 3, 5].map((turn) => ({ id: `m${turn}`, tier: 'turn' as const, text: `turn ${turn}`, keys: [], turn }));
    const plan = planChapterFrom(state, ['m1', 'm5'])!;
    const archived = reduce(chapterEvents(plan, { gist: 'first and fifth', detail: 'Exact detail for turns one and five.', keys: [] }, 6, 1, next), structuredClone(state));
    expect([...archivedTurnNumbers(archived)].sort()).toEqual([1, 5]);
    const transcript: HideMsg[] = [
      { id: 'a1', role: 'assistant' }, { id: 'u2', role: 'user' }, { id: 'a2', role: 'assistant' },
      { id: 'u3', role: 'user' }, { id: 'a3', role: 'assistant' }, { id: 'u4', role: 'user' },
      { id: 'a4', role: 'assistant' }, { id: 'u5', role: 'user' }, { id: 'a5', role: 'assistant' },
    ];
    expect(planHide(transcript, archivedTurnNumbers(archived), 0, true).hide).toEqual(['a1', 'u5', 'a5']);
  });

  it('restores arc to chapters and then all exact turn descendants', () => {
    let state = freshState();
    state.memories = [1, 2, 3, 4].map((turn) => ({ id: `m${turn}`, tier: 'turn' as const, text: `turn ${turn}`, keys: [], turn }));
    const first = chapterEvents(planChapterFrom(state, ['m1', 'm2'])!, { gist: 'one-two', detail: 'turns one and two in detail', keys: [] }, 5, 1, next);
    state = reduce(first, state);
    const second = chapterEvents(planChapterFrom(state, ['m3', 'm4'])!, { gist: 'three-four', detail: 'turns three and four in detail', keys: [] }, 6, 1, next);
    state = reduce(second, state);
    const chapterIds = state.memories.filter((m) => m.tier === 'chapter').map((m) => m.id);
    const arc = arcEvents(planArcFrom(state, chapterIds)!, { gist: 'whole arc', detail: 'all four turns in detail', keys: [] }, 7, 1, next);
    state = reduce(arc, state);
    const arcId = state.memories.find((m) => m.tier === 'arc')!.id;
    state = reduce([base('memory.drop', { id: arcId }, 8)], state);
    expect(state.memories.filter((m) => m.tier === 'chapter')).toHaveLength(2);
    const drops = state.memories.filter((m) => m.tier === 'chapter').map((m) => base('memory.drop', { id: m.id }, 9));
    state = reduce(drops, state);
    expect(state.memories.filter((m) => m.tier === 'turn').map((m) => m.id).sort()).toEqual(['m1', 'm2', 'm3', 'm4']);
  });

  it('indexes every requested record family and exact archived descendants', () => {
    const state = freshState();
    cast(state, 'alice', 'Alice'); cast(state, 'bob', 'Bob');
    state.scars = [{ id: 'scar1', who: 'alice', was: 'Bob betrayed her', turn: 4 }];
    state.lore = [{ id: 'lore1', fact: 'The Azure Bell opens the northern vault', status: 'confirmed', source: 'user', turn: 3 }];
    state.items = [{ id: 'item1', who: 'alice', item: 'sapphire signet', turn: 5 }];
    state.itemHistory = [{ id: 'ih1', itemId: 'item1', item: 'sapphire signet', op: 'give', from: 'bob', to: 'alice', turn: 5, day: 2 }];
    state.secrets = [{ id: 'secret1', keeper: 'alice', from: ['bob'], text: 'the vault is beneath the river', revealed: false, revealedTo: [], formedTurn: 2 }];
    state.memories = [{
      id: 'arc1', tier: 'arc', text: 'The river arc', detail: 'A dense arc record.', keys: ['river'], turn: 8,
      subsumed: [{ id: 'chap1', tier: 'chapter', text: 'The vault chapter', keys: ['vault'], turn: 7, subsumed: [{ id: 'turn2', tier: 'turn', text: 'Alice hid the obsidian astrolabe behind the organ.', keys: ['astrolabe'], turn: 2 }] }],
    }];
    state.memories.push({ id: 'beat1', tier: 'beat', text: 'The bell cracked at midnight', keys: ['Alice'], turn: 9 });
    const items = collectItems(state);
    expect(new Set(items.map((i) => i.kind))).toEqual(new Set(['secret', 'memory', 'timeline', 'scar', 'codex', 'item']));
    expect(items.find((i) => i.id === 'secret1')!.text).toContain('Hidden from: Bob');
    expect(items.find((i) => i.id === 'turn2')!.parentIds).toEqual(['arc1', 'chap1']);
    const hits = lexicalSearch(buildIndex(items), 'obsidian astrolabe organ');
    expect(hits[0]!.id).toBe('turn2');
  });

  it('retrieves names and details written outside ASCII', () => {
    const state = freshState();
    state.lore = [{ id: 'unicode', fact: 'Éowyn hid the lantern in 東京', status: 'confirmed', source: 'user', turn: 1 }];
    const hits = lexicalSearch(buildIndex(collectItems(state)), '東京 Éowyn lantern');
    expect(hits[0]!.id).toBe('unicode');
  });
});

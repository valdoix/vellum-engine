import { describe, it, expect } from 'vitest';
import { reduce } from '../src/core/reduce.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';
import { parseFactMergeReply, validateFactMerges, mergeCandidates, buildFactMergePrompt } from '../src/domain/fact-merge.js';

let seq = 0; const sf = () => ++seq;
const know = (who: string, fact: string, over: any = {}) => ({ seq: sf(), turn: 5, day: 1, src: 'living', kind: 'knowledge.learn', who, fact, ...over });
const secret = (id: string, keeper: string, text: string, from: string[] = []) => ({ seq: sf(), turn: 5, day: 1, src: 'living', kind: 'secret.form', id, keeper, from, text });

describe('reducer dedup — near-duplicate knowledge', () => {
  it('folds three differently-worded "in love with Daeron" facts into one (richer kept)', () => {
    let s = freshState();
    s = reduce([
      know('cersei', 'she has fallen in love with Daeron'),
      know('cersei', 'she is in love with Daeron and has not said the words yet'),
      know('cersei', 'she is in love with Daeron'),
    ] as any, s);
    const cersei = s.knowledge.filter((k) => k.who === 'cersei');
    expect(cersei).toHaveLength(1);
    expect(cersei[0]!.fact).toContain('has not said the words yet'); // richer text kept
  });

  it('keeps genuinely distinct facts separate', () => {
    let s = freshState();
    s = reduce([
      know('cersei', 'she is in love with Daeron'),
      know('cersei', 'she poisoned the maester'),
    ] as any, s);
    expect(s.knowledge.filter((k) => k.who === 'cersei')).toHaveLength(2);
  });
});

describe('reducer dedup — near-duplicate secrets union the from-list', () => {
  it('merges same-keeper near-dup secrets, unioning who it is kept from', () => {
    let s = freshState();
    s = reduce([
      secret('s1', 'cersei', 'she loves Daeron', ['jaime']),
      secret('s2', 'cersei', 'she is in love with Daeron and has not said it', ['daeron']),
      secret('s3', 'cersei', 'she loves Daeron', ['tywin', 'jaime']),
    ] as any, s);
    const kept = s.secrets.filter((x) => x.keeper === 'cersei');
    expect(kept).toHaveLength(1);
    expect(kept[0]!.from.sort()).toEqual(['daeron', 'jaime', 'tywin']); // unioned
  });
});

describe('knowledge.merge / secret.merge events (Tidy)', () => {
  it('knowledge.merge folds from-ids into into, keeping richer text', () => {
    let s = freshState();
    s.knowledge = [
      { id: 'k1', who: 'cersei', fact: 'loves Daeron', turn: 1, reliability: 'knows', truth: 'true' },
      { id: 'k2', who: 'cersei', fact: 'is deeply, secretly in love with Daeron', turn: 2, reliability: 'knows', truth: 'true' },
    ] as any;
    s = reduce([{ seq: sf(), turn: 3, day: 1, src: 'system', kind: 'knowledge.merge', into: 'k1', from: ['k2'] }] as any, s);
    expect(s.knowledge).toHaveLength(1);
    expect(s.knowledge[0]!.fact).toContain('deeply'); // richer
  });
  it('secret.merge unions from + revealedTo', () => {
    let s = freshState();
    s.secrets = [
      { id: 's1', keeper: 'cersei', from: ['jaime'], text: 'loves him', revealed: false, revealedTo: [], formedTurn: 1 },
      { id: 's2', keeper: 'cersei', from: ['tywin'], text: 'loves him desperately', revealed: false, revealedTo: ['oberyn'], formedTurn: 1 },
    ] as any;
    s = reduce([{ seq: sf(), turn: 3, day: 1, src: 'system', kind: 'secret.merge', into: 's1', from: ['s2'] }] as any, s);
    expect(s.secrets).toHaveLength(1);
    expect(s.secrets[0]!.from.sort()).toEqual(['jaime', 'tywin']);
    expect(s.secrets[0]!.revealedTo).toContain('oberyn');
  });
});

describe('fact-merge module (Tidy controller mapping)', () => {
  function state(): ChronicleState {
    const s = freshState();
    s.cast.cersei = { id: 'cersei', name: 'Cersei', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false } as any;
    s.knowledge = [
      { id: 'k1', who: 'cersei', fact: 'A', turn: 1, reliability: 'knows', truth: 'true' },
      { id: 'k2', who: 'cersei', fact: 'B', turn: 1, reliability: 'knows', truth: 'true' },
    ] as any;
    return s;
  }
  it('mergeCandidates groups holders with >=2 entries', () => {
    const c = mergeCandidates(state(), 'knowledge');
    expect(c).toHaveLength(1);
    expect(c[0]!.entries.map((e) => e.id)).toEqual(['k1', 'k2']);
    expect(c[0]!.label).toContain('Cersei');
  });
  it('parse + validate keeps only real ids, drops self-merge', () => {
    const groups = validateFactMerges(parseFactMergeReply('{"merge":[{"into":"k1","from":["k2","ghost","k1"]}]}'), ['k1', 'k2']);
    expect(groups).toEqual([{ into: 'k1', from: ['k2'] }]);
  });
  it('buildFactMergePrompt numbers [id] text entries', () => {
    const p = buildFactMergePrompt('KNOWLEDGE held by Cersei:', [{ id: 'k1', text: 'A' }, { id: 'k2', text: 'B' }]);
    expect(p).toContain('[k1] A');
    expect(p).toContain('[k2] B');
  });
});

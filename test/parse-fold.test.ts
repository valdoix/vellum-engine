import { describe, it, expect } from 'vitest';
import { parseState } from '../src/parse/state-block.js';
import { foldTurn } from '../src/bus/lifecycle.js';
import { registerFeature } from '../src/bus/registry.js';
import { coreFeature } from '../src/domain/core-feature.js';
import { reduce } from '../src/core/reduce.js';
import { freshState } from '../src/domain/types.js';

registerFeature(coreFeature);

const JSON_TURN = [
  'She watched the door, saying nothing.',
  '\u2039vellum\u203a',
  JSON.stringify({
    v: 2, turn: 41, day: 3,
    scene: { loc: 'godswood', tension: 7 },
    present: [{ id: 'cersei', mood: 'wary', doing: 'watching' }, { name: 'Jaime Lannister' }],
    delta: {
      bonds: [{ a: 'cersei', b: 'Jaime Lannister', aff: 8, trust: -2, addCats: ['romantic'], why: 'the look' }],
      threads: [{ op: 'advance', name: 'the letter', note: 'sent' }],
    },
  }),
  '\u2039/vellum\u203a',
].join('\n');

describe('parseState', () => {
  it('parses a valid JSON state block', () => {
    const r = parseState(JSON_TURN);
    expect(r.source).toBe('json');
    expect(r.state?.scene?.loc).toBe('godswood');
    expect(r.state?.delta?.bonds?.[0]?.addCats).toContain('romantic');
  });

  it('normalizes preset bond grammar `cat` → `addCats` (would otherwise be dropped)', () => {
    // the <vellum> block teaches the model "cat":[...], but ParsedBond wants addCats
    const block = '\u2039vellum\u203a\n' + JSON.stringify({
      turn: 2, day: 1, delta: { bonds: [{ a: 'Cersei', b: 'Daeron', aff: 12, trust: 5, cat: ['romantic'] }] },
    }) + '\n\u2039/vellum\u203a';
    const r = parseState(block);
    expect(r.source).toBe('json');
    expect(r.state?.delta?.bonds?.[0]?.addCats).toContain('romantic');
    // and it survives the full fold into the relation's categories
    let seq = 0;
    const s = reduce(coreFeature.extract!(r.state as any, { turn: 2, day: 1, state: freshState(), seq: () => ++seq } as any));
    expect(s.relations[0]?.categories).toContain('romantic');
  });

  it('falls back to regex for terse [BTS]-style rel lines', () => {
    const r = parseState('Some prose.\nrelCersei \u2192 Jaime: aff +8, trust -2 cat:romantic (the look)');
    expect(r.source).toBe('regex');
    expect(r.state?.delta?.bonds?.[0]?.aff).toBe(8);
    expect(r.state?.delta?.bonds?.[0]?.addCats).toContain('romantic');
  });

  it('returns none when there is no state', () => {
    expect(parseState('just prose, nothing structured').source).toBe('none');
  });

  it('ignores malformed JSON and tries regex', () => {
    const r = parseState('\u2039vellum\u203a{ not json \u2039/vellum\u203a\nrelA \u2192 B: aff +5');
    expect(r.source).toBe('regex');
    expect(r.state?.delta?.bonds?.[0]?.a).toBe('A');
  });

  it('Fix 18: bare number is a delta, =/set/@ marks absolute', () => {
    const delta = parseState('relA -> B: aff 55');
    expect(delta.state?.delta?.bonds?.[0]?.aff).toBe(55);
    expect(delta.state?.delta?.bonds?.[0]?.absolute).toBeUndefined();

    const abs = parseState('relA -> B: aff =55');
    expect(abs.state?.delta?.bonds?.[0]?.aff).toBe(55);
    expect(abs.state?.delta?.bonds?.[0]?.absolute).toBe(true);

    const signed = parseState('relA -> B: aff +12');
    expect(signed.state?.delta?.bonds?.[0]?.aff).toBe(12);
    expect(signed.state?.delta?.bonds?.[0]?.absolute).toBeUndefined();
  });

  it('Fix 12: parses scene + present + thread + journal lines', () => {
    const blob = [
      'scene the godswood | time dusk | tension 7',
      'present Cersei(wary), Jaime Lannister',
      'thread advance the letter: sent at last',
      'relCersei -> Jaime: aff +8 cat:romantic',
      'journal Cersei: I felt his eyes across the hall',
    ].join('\n');
    const r = parseState(blob);
    expect(r.source).toBe('regex');
    expect(r.state?.scene?.loc).toBe('the godswood');
    expect(r.state?.scene?.tension).toBe(7);
    expect(r.state?.scene?.time).toBe('dusk');
    expect(r.state?.present?.length).toBe(2);
    expect(r.state?.delta?.threads?.[0]?.name).toBe('the letter');
    expect(r.state?.delta?.bonds?.[0]?.addCats).toContain('romantic');
    expect(r.state?.delta?.journal?.[0]?.who).toBe('Cersei');
  });
});

describe('foldTurn → events → reduce', () => {
  it('produces events that reduce to the expected state', () => {
    const { events, source } = foldTurn(JSON_TURN, freshState(), 41);
    expect(source).toBe('json');
    const s = reduce(events);
    expect(s.turns).toBe(41);
    expect(s.day).toBe(3);
    expect(s.scene.location).toBe('godswood');
    expect(s.scene.tension).toBe(7);
    expect(Object.keys(s.cast)).toContain('cersei');
    expect(s.relations).toHaveLength(1);
    expect(s.relations[0]!.categories).toContain('romantic');
    expect(s.relations[0]!.affection).toBe(8);
    expect(s.threads.find((t) => t.name === 'the letter')).toBeTruthy();
  });

  it('is idempotent by signature (same content → same sig)', () => {
    const a = foldTurn(JSON_TURN, freshState(), 41);
    const b = foldTurn(JSON_TURN, freshState(), 41);
    expect(a.sig).toBe(b.sig);
  });

  it('turn is POSITIONAL: ignores the model-supplied turn (prevents the t1 freeze + duplicate-delta bug)', () => {
    // a block that lies with "turn": 1 must still be stamped with the loop position
    const block = [
      '\u2039vellum\u203a',
      JSON.stringify({ v: 2, turn: 1, day: 2, delta: { bonds: [{ a: 'a', b: 'b', aff: 5 }] } }),
      '\u2039/vellum\u203a',
    ].join('\n');
    const { events } = foldTurn(block, freshState(), 7);
    expect(events.every((e) => e.turn === 7)).toBe(true); // not 1
    const fold = events.find((e) => e.kind === 'turn.fold');
    expect(fold?.turn).toBe(7);
  });

  it('empty content yields no events', () => {
    expect(foldTurn('', freshState(), 1).events).toHaveLength(0);
  });
});

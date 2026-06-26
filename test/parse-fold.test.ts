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

  it('empty content yields no events', () => {
    expect(foldTurn('', freshState(), 1).events).toHaveLength(0);
  });
});

import { describe, it, expect } from 'vitest';
import { parseState } from '../src/parse/state-block.js';
import { resolveCastId, isNameMash } from '../src/domain/identity.js';
import { coreFeature } from '../src/domain/core-feature.js';
import { freshState } from '../src/domain/types.js';
import type { ExtractCtx } from '../src/bus/registry.js';

let seq = 0;
const sf = () => ++seq;
const J = (body: string) => `She crossed the room.\n<vellum>\n${body}\n</vellum>`;

function twoPeople() {
  const s = freshState();
  s.cast.daeron = { id: 'daeron', name: 'Daeron', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false } as any;
  s.cast.cersei = { id: 'cersei', name: 'Cersei', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false } as any;
  return s;
}

describe('apostrophe corruption in the JSON-repair path (repro)', () => {
  it('keeps an apostrophe inside a value on the clean path', () => {
    const r = parseState(J('{ "turn": 5, "scene": { "loc": "Daeron\'s Chambers" } }'));
    expect(r.state?.scene?.loc).toBe("Daeron's Chambers");
  });

  it('keeps the apostrophe when the block needs REPAIR (trailing comma forces the repair scan)', () => {
    // the trailing comma trips JSON.parse, so lenientParse runs scanJson — where
    // the bug lives. The apostrophe in "Daeron's" must survive, not become a quote.
    const r = parseState(J('{ "turn": 5, "scene": { "loc": "Daeron\'s Chambers", }, }'));
    expect(r.state?.scene?.loc).toBe("Daeron's Chambers");
  });

  it('keeps apostrophes in a present.thought when repaired', () => {
    const r = parseState(J('{ "turn": 6, "present": [ { "id": "Daeron", "thought": "I won\'t kneel; it isn\'t in me", } ] }'));
    expect(r.state?.present?.[0]?.thought).toBe("I won't kneel; it isn't in me");
  });
});

describe('name-mashing: two distinct people must not become one card (repro)', () => {
  it('a bare given name does NOT get absorbed into a two-given-name mash', () => {
    const s = twoPeople();
    const id = resolveCastId(s, 'Daeron Cersei');
    expect(id).not.toBe('daeron');
    expect(id).not.toBe('cersei');
  });

  it('isNameMash flags two-known-people mashes, not real full names', () => {
    const known = ['daeron', 'cersei', 'jaime'];
    expect(isNameMash('Daeron Cersei', known)).toBe(true);
    expect(isNameMash('Daeron Jaime', known)).toBe(true);
    expect(isNameMash('Cersei Lannister', known)).toBe(false); // lannister is not a known person
    expect(isNameMash('Daeron', known)).toBe(false);           // single token
    expect(isNameMash('Daeron Targaryen', known)).toBe(false);  // targaryen unknown → real surname
  });

  it('the extractor drops a mashed bond endpoint instead of minting a junk card', () => {
    const state = twoPeople();
    const ctx: ExtractCtx = { turn: 5, day: 1, state, seq: sf };
    const out = coreFeature.extract!({ delta: { bonds: [{ a: 'Daeron Cersei', b: 'Jaime', aff: 5 }] } } as any, ctx);
    // the mashed endpoint kills the bond; no cast.seen for "daeron_cersei"
    expect(out.find((e) => e.kind === 'bond.delta')).toBeUndefined();
    expect(out.some((e: any) => e.id === 'daeron_cersei' || e.a === 'daeron_cersei')).toBe(false);
  });

  it('the extractor drops a mashed journal holder', () => {
    const state = twoPeople();
    const ctx: ExtractCtx = { turn: 5, day: 1, state, seq: sf };
    const out = coreFeature.extract!({ delta: { journal: [{ who: 'Daeron Cersei', memory: 'I felt torn' }] } } as any, ctx);
    expect(out.find((e) => e.kind === 'journal.entry')).toBeUndefined();
  });

  it('a real full name is still kept and resolves correctly', () => {
    const state = twoPeople();
    const ctx: ExtractCtx = { turn: 5, day: 1, state, seq: sf };
    const out = coreFeature.extract!({ delta: { bonds: [{ a: 'Daeron', b: 'Cersei', aff: 5, trust: 2 }] } } as any, ctx);
    const bond = out.find((e) => e.kind === 'bond.delta') as any;
    expect(bond?.a).toBe('daeron');
    expect(bond?.b).toBe('cersei');
  });
});

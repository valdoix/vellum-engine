import { describe, it, expect } from 'vitest';
import { parseState } from '../src/parse/state-block.js';

const wrap = (json: string): string => `<vellum>\n${json}\n</vellum>`;
const ok = (json: string): any => { const r = parseState(wrap(json)); expect(r.source).toBe('json'); return r.state; };

describe('lenientParse durability', () => {
  it('the real-world block with leading + numbers parses as JSON (not regex)', () => {
    const s = ok('{ "scene": { "loc": "Harrenhal corridor" }, "delta": { "bonds": [ { "a": "Cersei", "b": "Jaime", "aff": +2, "trust": +1 } ] } }');
    expect(s.scene.loc).toBe('Harrenhal corridor');
    expect(s.delta.bonds[0].aff).toBe(2);
  });

  it('trailing commas', () => {
    expect(ok('{ "turn": 5, "scene": { "loc": "X", }, }').scene.loc).toBe('X');
  });

  it('line + block comments outside strings', () => {
    const s = ok('{\n // the scene\n "scene": { "loc": "Hall" } /* tension later */ }');
    expect(s.scene.loc).toBe('Hall');
  });

  it('unquoted keys', () => {
    expect(ok('{ turn: 3, scene: { loc: "X" } }').scene.loc).toBe('X');
  });

  it('single-quoted strings', () => {
    expect(ok("{ 'scene': { 'loc': 'The Keep' } }").scene.loc).toBe('The Keep');
  });

  it('prose around the object is ignored (balanced extraction)', () => {
    expect(ok('Here is the state:\n{ "scene": { "loc": "X" } }\nhope that helps').scene.loc).toBe('X');
  });

  // --- the no-corruption guarantees: structure fixes must NOT touch string contents ---
  it('does NOT strip // inside a string value (URLs/prose)', () => {
    expect(ok('{ "scene": { "loc": "http://example.com/keep" } }').scene.loc).toBe('http://example.com/keep');
  });

  it('does NOT strip a comma or + inside a string value', () => {
    const s = ok('{ "delta": { "journal": [ { "who": "C", "memory": "Worth +2 to me, truly." } ] } }');
    expect(s.delta.journal[0].memory).toBe('Worth +2 to me, truly.');
  });

  it('does NOT misread a } inside a single-quoted string', () => {
    expect(ok("{ 'scene': { 'loc': 'a room (with a brace } in text)' } }").scene.loc).toBe('a room (with a brace } in text)');
  });

  it('handles an unescaped newline inside a string', () => {
    expect(ok('{ "scene": { "loc": "line one\nline two" } }').scene.loc).toContain('line one');
  });

  it('drops a leftover placeholder field', () => {
    const s = ok('{ "scene": { "loc": "X" }, "note": <fill this in>, "turn": 2 }');
    expect(s.scene.loc).toBe('X');
    expect(s.turn).toBe(2);
  });

  // --- truncation: model ran out of tokens mid-object (missing closing braces) ---
  it('closes a block truncated mid-array (one missing brace)', () => {
    // valid prefix, just missing the final } — the real-world bug
    const s = ok('{ "scene": { "loc": "Harrenhal" }, "delta": { "factions": [ { "name": "The Four", "standing": 94 } ] }');
    expect(s.scene.loc).toBe('Harrenhal');
    expect(s.delta.factions[0].name).toBe('The Four');
  });

  it('closes a block truncated mid-string + drops the dangling field', () => {
    const r = parseState('<vellum>{ "scene": { "loc": "Hall" }, "delta": { "journal": [ { "who": "C", "memory": "she said');
    expect(r.source).toBe('json');
    expect(r.state!.scene!.loc).toBe('Hall');
  });

  it('truncated with NO closing fence still parses (not regex fallback)', () => {
    const r = parseState('prose\n<vellum>\n{ "scene": { "loc": "Keep" }, "delta": { "bonds": [ { "a": "A", "b": "B", "aff": +1 } ]');
    expect(r.source).toBe('json');
    expect(r.state!.scene!.loc).toBe('Keep');
  });
});

describe('lenientParse — control chars + advanced mangles', () => {
  it('escapes a literal TAB inside a string', () => {
    expect(ok('{ "scene": { "loc": "a\tb" } }').scene.loc).toBe('a\tb');
  });

  it('escapes a literal CR inside a string', () => {
    expect(ok('{ "scene": { "loc": "a\rb" } }').scene.loc).toContain('a');
  });

  it('escapes a literal newline inside a string (non-truncated)', () => {
    expect(ok('{ "scene": { "loc": "line1\nline2" } }').scene.loc).toBe('line1\nline2');
  });

  it('handles a control char in a TRUNCATED tail (shared escaping)', () => {
    const r = parseState('<vellum>{ "scene": { "loc": "Hall" }, "delta": { "journal": [ { "who": "C", "memory": "a\tb and then');
    expect(r.source).toBe('json');
    expect(r.state!.scene!.loc).toBe('Hall');
  });

  it('closes truncation inside a nested array-of-objects', () => {
    const r = parseState('<vellum>{ "scene": { "loc": "X" }, "delta": { "bonds": [ { "a": "A", "b": "B", "aff": 2 }, { "a": "C", "b": "D"');
    expect(r.source).toBe('json');
    expect(r.state!.delta!.bonds!.length).toBeGreaterThanOrEqual(1);
  });

  it('picks the real block over an earlier example fence', () => {
    const content = 'Example: <vellum>{ "scene": { "loc": "EXAMPLE" } }</vellum>\nNow the real one:\n<vellum>{ "turn": 9, "scene": { "loc": "REAL", "time": "dawn" }, "delta": { "bonds": [] } }</vellum>';
    const r = parseState(content);
    expect(r.source).toBe('json');
    expect(r.state!.scene!.loc).toBe('REAL');
  });

  it('does NOT corrupt smart quotes used as apostrophes inside prose values', () => {
    // a value that needs NO repair keeps its content verbatim
    const s = ok('{ "delta": { "journal": [ { "who": "C", "memory": "it\u2019s hers, the \u2018rose\u2019" } ] } }');
    expect(s.delta.journal[0].memory).toContain('\u2019'); // apostrophe preserved
  });

  it('unwraps a double-nested delta.delta', () => {
    const s = ok('{ "scene": { "loc": "X" }, "delta": { "delta": { "bonds": [ { "a": "A", "b": "B", "aff": 1 } ] } } }');
    expect(s.delta.bonds[0].a).toBe('A');
  });

  it('does not choke on a 1MB pathological input', () => {
    const big = '{ "scene": { "loc": "X" }, "junk": "' + 'z'.repeat(1_200_000) + '" }';
    const r = parseState('<vellum>' + big + '</vellum>');
    // either parses (truncated junk) or falls back cleanly — must not hang/throw
    expect(r.source === 'json' || r.source === 'regex' || r.source === 'none').toBe(true);
  });
});

// ── Option 1: doubled-colon run-on ("k":"a":"b" — model dropped the '","') ──
describe('doubled-colon run-on fixup (Option 1)', () => {
  it('recovers the exact reported fragment: weight/sentiment fused', () => {
    // "weight":"significant" fused with the next key "sentiment"
    const json = '{ "scene": { "loc": "Tower" }, "delta": { "journal": [ { "who": "Oberyn", "memory": "the wink", "kind": "observation", "weight": "significantsentiment": "positive" } ] } }';
    const r = parseState(wrap(json));
    // parses as whole JSON (rung 2 repair), not lost to regex/none
    expect(r.source).toBe('json');
    const j = r.state!.delta!.journal![0]!;
    expect(j.who).toBe('Oberyn');           // sibling survives
    expect(j.memory).toBe('the wink');       // sibling survives
    expect(j.kind).toBe('observation');      // sibling survives
    // the fused field is nulled → Zod drops it; junk key stripped as unknown
    expect(j.weight).toBeUndefined();
  });

  it('handles a fused pair in the LAST field position (brace balance)', () => {
    const json = '{ "scene": { "loc": "Hall" }, "delta": { "journal": [ { "who": "C", "memory": "m", "weight": "significantsentiment": "positive" } ] } }';
    const r = parseState(wrap(json));
    expect(r.source).toBe('json');
    expect(r.state!.delta!.journal![0]!.who).toBe('C');
  });

  it('handles a fused pair in a MIDDLE field position', () => {
    const json = '{ "scene": { "loc": "Hall" }, "delta": { "journal": [ { "who": "C", "weight": "significantsentiment": "positive", "memory": "kept" } ] } }';
    const r = parseState(wrap(json));
    expect(r.source).toBe('json');
    const j = r.state!.delta!.journal![0]!;
    expect(j.who).toBe('C');
    expect(j.memory).toBe('kept');           // field AFTER the fused pair survives
  });

  it('does NOT alter a legitimate object (no-regression)', () => {
    const s = ok('{ "delta": { "journal": [ { "who": "a", "memory": "b" } ] } }');
    expect(s.delta.journal[0].who).toBe('a');
    expect(s.delta.journal[0].memory).toBe('b');
  });

  it('does NOT alter a URL-with-colon inside a string value', () => {
    // guards the string-safety assumption: the ':' after http is INSIDE a closed string
    expect(ok('{ "scene": { "loc": "http://example.com/x" } }').scene.loc).toBe('http://example.com/x');
  });
});

// ── Option 2: element-level salvage rung (recover valid siblings, drop corrupt) ──
describe('element salvage (Option 2, json-partial)', () => {
  // a genuinely unrecoverable element: an unquoted garbage token that no repair fixes
  const BAD = '{ "who": "X", "memory": @@@ }';

  it('drops a corrupt MIDDLE element, keeps the rest, reports json-partial', () => {
    const json = `{ "scene": { "loc": "Yard" }, "delta": { "journal": [ { "who": "A", "memory": "one" }, ${BAD}, { "who": "C", "memory": "three" } ] } }`;
    const r = parseState(wrap(json));
    expect(r.source).toBe('json-partial');
    const j = r.state!.delta!.journal!;
    expect(j.length).toBe(2);                       // corrupt middle dropped
    expect(j.map((e: any) => e.who)).toEqual(['A', 'C']);
    expect(r.dropped?.journal).toBe(1);              // honest count
  });

  it('drops a corrupt FIRST element', () => {
    const json = `{ "scene": { "loc": "Y" }, "delta": { "bonds": [ ${BAD.replace('"who"', '"a"').replace('"memory"', '"b"')}, { "a": "A", "b": "B", "aff": 2 } ] } }`;
    const r = parseState(wrap(json));
    expect(r.source).toBe('json-partial');
    expect(r.state!.delta!.bonds!.length).toBe(1);
    expect(r.state!.delta!.bonds![0]!.a).toBe('A');
  });

  it('drops a corrupt LAST element', () => {
    const json = `{ "scene": { "loc": "Y" }, "delta": { "journal": [ { "who": "A", "memory": "one" }, ${BAD} ] } }`;
    const r = parseState(wrap(json));
    expect(r.source).toBe('json-partial');
    expect(r.state!.delta!.journal!.length).toBe(1);
  });

  it('drops TWO corrupt elements in one array', () => {
    const json = `{ "scene": { "loc": "Y" }, "delta": { "journal": [ ${BAD}, { "who": "B", "memory": "keep" }, ${BAD} ] } }`;
    const r = parseState(wrap(json));
    expect(r.source).toBe('json-partial');
    expect(r.state!.delta!.journal!.length).toBe(1);
    expect(r.dropped?.journal).toBe(2);
  });

  it('salvages a corrupt element in a TOP-LEVEL array (present)', () => {
    const json = `{ "scene": { "loc": "Y" }, "present": [ { "id": "A", "mood": "calm" }, { "id": "B", "doing": @@@ } ] }`;
    const r = parseState(wrap(json));
    expect(r.source).toBe('json-partial');
    // B's whole element is unrecoverable → dropped; A survives
    expect(r.state!.present!.length).toBe(1);
    expect(r.state!.present![0]!.id).toBe('A');
  });

  it('omits a corrupt top-level SCALAR, keeps the rest', () => {
    // "day": 13x is not valid; salvage omits day, keeps scene
    const json = '{ "day": 13x, "scene": { "loc": "Keep" }, "present": [ { "id": "A" } ] }';
    const r = parseState(wrap(json));
    expect(r.source).toBe('json-partial');
    expect(r.state!.scene!.loc).toBe('Keep');
    expect(r.state!.present![0]!.id).toBe('A');
  });

  it('does NOT mis-split on commas/braces inside string values', () => {
    const json = `{ "scene": { "loc": "a, b, c" }, "delta": { "journal": [ { "who": "A", "memory": "he said {no}, then left" }, ${BAD} ] } }`;
    const r = parseState(wrap(json));
    expect(r.source).toBe('json-partial');
    expect(r.state!.delta!.journal![0]!.memory).toBe('he said {no}, then left');
  });

  it('an ALL-corrupt block still falls back (no false salvage)', () => {
    const r = parseState(wrap('{ "delta": { "journal": [ @@@, ### ] }, "scene": @@@ }'));
    // nothing valid survives → not json-partial; regex/none fallback
    expect(r.source === 'regex' || r.source === 'none').toBe(true);
  });
});

// ── Do-no-harm: salvage must NEVER trigger for blocks rungs 1-3 handle ──
describe('salvage do-no-harm (existing blocks stay source=json)', () => {
  const cases: string[] = [
    '{ "scene": { "loc": "X" } }',
    '{ "turn": 5, "scene": { "loc": "X", } }',                          // trailing comma
    '{ turn: 3, scene: { loc: "X" } }',                                 // unquoted keys
    "{ 'scene': { 'loc': 'Keep' } }",                                   // single quotes
    '{ "delta": { "bonds": [ { "a": "A", "b": "B", "aff": +2 } ] } }',   // leading +
  ];
  for (const c of cases) {
    it(`stays json: ${c.slice(0, 40)}`, () => {
      expect(parseState(wrap(c)).source).toBe('json');
    });
  }

  it('a truncated block still closes as json (not json-partial)', () => {
    const r = parseState('<vellum>{ "scene": { "loc": "Keep" }, "delta": { "bonds": [ { "a": "A", "b": "B", "aff": 1 } ]');
    expect(r.source).toBe('json');
  });
});

describe('regex fallback unchanged after stripScaffold rewire (B2)', () => {
  // These have NO valid <vellum> JSON, so parseState falls through to the regex
  // fallback. The B2 change swapped an ad-hoc reverie strip for stripScaffold;
  // these confirm the fallback still fires on post-prose ledger directives.
  it('still parses a terse ledger via regex when no JSON block exists', () => {
    const r = parseState('She crossed the room.\nSCENE: throne room, dusk\npresent: Cersei, Jaime');
    expect(r.source).toBe('regex');
  });

  it('reverie-wrapped planning does not leak into the regex fallback', () => {
    // the reverie SCENE: line must be stripped so the fallback reads the POST-prose
    // ledger, not the planning note.
    const r = parseState('<reverie>\nSCENE: planning note here\n</reverie>\nShe crossed the room.\nSCENE: throne room, dusk');
    // whether it lands scene from the real ledger or nothing, it must NOT be the
    // reverie's "planning note here"
    if (r.state?.scene?.loc) expect(r.state.scene.loc).not.toContain('planning note');
  });

  it('a well-formed block is still json, never regex (fallback not reached)', () => {
    const r = parseState('<reverie>\nSTATE: x\n</reverie>\nProse.\n<vellum>{ "scene": { "loc": "Keep" } }</vellum>');
    expect(r.source).toBe('json');
    expect(r.state?.scene?.loc).toBe('Keep');
  });
});

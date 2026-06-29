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

import { describe, it, expect } from 'vitest';
import { parseState } from '../src/parse/state-block.js';
const J = (b: string) => `prose\n<vellum>\n${b}\n</vellum>`;
describe('state-block drift: quotes + placeholders', () => {
  it('smart/curly double quotes', () => {
    const r = parseState(J('{ \u201Cturn\u201D: 5, \u201Cscene\u201D: { \u201Cloc\u201D: \u201Cthe hall\u201D } }'));
    expect(r.source).toBe('json'); expect(r.state?.turn).toBe(5);
  });
  it('single-quoted strings + unquoted keys', () => {
    const r = parseState(J("{ turn: 6, scene: { loc: 'tower' } }"));
    expect(r.source).toBe('json'); expect(r.state?.turn).toBe(6);
  });
  it('leftover <placeholder> values are dropped', () => {
    const r = parseState(J('{ "turn": 7, "scene": { "loc": "x", "tension": <0-10> }, "delta": { "bonds": [{ "a":"A","b":"B","aff": <int>, "trust": 5 }] } }'));
    expect(r.source).toBe('json'); expect(r.state?.turn).toBe(7);
    expect(r.state?.delta?.bonds?.[0]?.trust).toBe(5);
  });
});

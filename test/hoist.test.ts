import { describe, it, expect } from 'vitest';
import { parseState } from '../src/parse/state-block.js';
const J = (b: string) => `prose\n<vellum>\n${b}\n</vellum>`;
describe('hoist misplaced delta fields', () => {
  it('top-level parallel/bonds get hoisted into delta', () => {
    const r = parseState(J('{ "turn": 2, "delta": { "journal": [{ "who":"A","memory":"m" }] }, "parallel": [{ "who":"S","activity":"x" }], "bonds": [{ "a":"A","b":"B","aff":4 }] }'));
    expect(r.source).toBe('json');
    expect(r.state?.delta?.parallel?.length).toBe(1);
    expect(r.state?.delta?.bonds?.length).toBe(1);
    expect(r.state?.delta?.journal?.length).toBe(1);
  });
});

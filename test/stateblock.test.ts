import { describe, it, expect } from 'vitest';
import { parseState } from '../src/parse/state-block.js';

const J = (body: string) => `She watched the door.\n<vellum>\n${body}\n</vellum>`;

describe('state-block parse robustness', () => {
  it('plain JSON in the fence', () => {
    const r = parseState(J('{ "turn": 5, "scene": { "loc": "hall" }, "delta": { "bonds": [{ "a": "A", "b": "B", "aff": 10 }] } }'));
    expect(r.source).toBe('json'); expect(r.state?.turn).toBe(5);
  });
  it('inner ```json code fence', () => {
    const r = parseState(J('```json\n{ "turn": 6, "scene": { "loc": "x" } }\n```'));
    expect(r.source).toBe('json'); expect(r.state?.turn).toBe(6);
  });
  it('trailing commas + // comments', () => {
    const r = parseState(J('{ "turn": 7, // now\n "delta": { "bonds": [{ "a":"A","b":"B","aff":5, }], } }'));
    expect(r.source).toBe('json'); expect(r.state?.turn).toBe(7);
  });
  it('prose after the JSON inside the fence', () => {
    const r = parseState(J('{ "turn": 8, "scene": { "loc": "y" } }\nThat is the state.'));
    expect(r.source).toBe('json'); expect(r.state?.turn).toBe(8);
  });
  it('ignores leftover placeholder fields without dying (extra keys allowed)', () => {
    const r = parseState(J('{ "turn": 9, "extra": "junk", "scene": { "loc": "z", "tension": 4 } }'));
    expect(r.source).toBe('json'); expect(r.state?.scene?.tension).toBe(4);
  });
});

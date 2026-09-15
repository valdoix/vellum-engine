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
  it('normalizes ARGENT inline compatibility aliases without dropping plot data', () => {
    const r = parseState(J(JSON.stringify({
      v: 4,
      turn: 7,
      present: [{ id: 'buffy_summers', presence: 'on-stage', traits: 'brave, stubborn', thought: 'I need Dawn.' }],
      delta: {
        knowledge: [{ character: 'Buffy Summers', learns: 'Dawn is alive', source: 'Gabriel told her', truth: true }],
        secrets: [{ keeper: 'Buffy Summers', secret: 'The necklace is a promise', excluded: ['Dawn Summers'] }],
        offscreen: [{ id: 'dawn_search', name: 'Search For Dawn', type: 'subplot', actor: 'Spike', where: 'Sunnydale streets', impact: 'Spike guards Dawn from the raid', beatKind: 'progress', grounding: { evidence: 'Spike is already protecting Dawn', rationale: 'The established raid gives him an immediate reason to keep guarding her.' } }],
      },
    })));
    expect(r.state?.present?.[0]?.presence).toBe('spotlight');
    expect(r.state?.delta?.knowledge?.[0]?.fact).toBe('Dawn is alive');
    expect(r.state?.delta?.secrets?.[0]?.from).toEqual(['Dawn Summers']);
    expect(r.state?.delta?.offscreen?.[0]?.gist).toBe('Spike guards Dawn from the raid');
    expect(r.state?.delta?.offscreen?.[0]?.grounding?.basis).toContain('character');
    expect(r.state?.delta?.offscreen?.[0]?.grounding?.basis).toContain('location');
  });

  it('keeps legacy VELLUM II id/latest thread and arc updates', () => {
    const r = parseState(J(JSON.stringify({
      v: 4,
      delta: {
        threads: [{ id: 'thr_resurrection_aftermath', arc: 'thr_resurrection_aftermath', latest: 'Buffy has accepted Gabriel\'s plan to find Dawn.' }],
        arcs: [{ id: 'thr_buffy_s_return', latest: 'Buffy is beginning to surface through trauma.' }],
      },
    })));

    expect(r.source).toBe('json');
    expect(r.state?.delta?.threads).toEqual([expect.objectContaining({
      id: 'thr_resurrection_aftermath',
      name: 'thr_resurrection_aftermath',
      note: "Buffy has accepted Gabriel's plan to find Dawn.",
    })]);
    expect(r.state?.delta?.arcs).toEqual([expect.objectContaining({
      id: 'thr_buffy_s_return',
      name: 'thr_buffy_s_return',
      note: 'Buffy is beginning to surface through trauma.',
    })]);
  });
});

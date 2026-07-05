import { describe, it, expect } from 'vitest';
import { parseState } from '../src/parse/state-block.js';

/**
 * Repro + regression for: `present[].thought` (and sibling fields) sometimes
 * silently disappear. Root cause — ParsedPresent (and several sibling schemas)
 * lacked `.catch(undefined)` on their optional string fields, unlike `scene`.
 * Models routinely emit an explicit JSON `null` for a field that "didn't
 * change" instead of omitting the key (e.g. `"thought": null`). Without
 * `.catch`, zod fails that ONE field, which fails the array element, which
 * fails the WHOLE top-level `ParsedState.safeParse` — so `parseState()` drops
 * to the line-oriented regex fallback, which has no `thought` grammar at all
 * and silently loses every present character's inner voice for that turn.
 */

const J = (body: string) => `She watched the door.\n<vellum>\n${body}\n</vellum>`;

describe('present.thought (and sibling fields) survive a stray null', () => {
  it('an explicit null on thought no longer poisons the whole block', () => {
    const r = parseState(J('{ "turn": 5, "present": [{ "id": "Lira", "mood": "guarded", "thought": null }] }'));
    expect(r.source).toBe('json');
    expect(r.state?.present?.[0]).toEqual({ id: 'Lira', mood: 'guarded' });
  });

  it('a null on ONE character\'s field no longer drops a DIFFERENT character\'s genuine thought', () => {
    const r = parseState(J('{ "turn": 5, "present": [ { "id": "Lira", "thought": "she doubts him" }, { "id": "Coren", "doing": null } ] }'));
    expect(r.source).toBe('json');
    expect(r.state?.present?.find((p) => p.id === 'Lira')?.thought).toBe('she doubts him');
    expect(r.state?.present?.find((p) => p.id === 'Coren')).toEqual({ id: 'Coren' });
  });

  it('null on condition/doing/traits alongside a real thought all survive together', () => {
    const r = parseState(J('{ "turn": 5, "present": [{ "id": "Lira", "mood": null, "condition": null, "doing": "watching", "thought": "he is lying", "traits": null }] }'));
    expect(r.source).toBe('json');
    expect(r.state?.present?.[0]).toEqual({ id: 'Lira', doing: 'watching', thought: 'he is lying' });
  });

  it('a non-null, non-string thought (model sends a number) also degrades gracefully instead of failing the block', () => {
    const r = parseState(J('{ "turn": 5, "present": [{ "id": "Lira", "thought": 123 }] }'));
    expect(r.source).toBe('json');
    expect(r.state?.present?.[0]).toEqual({ id: 'Lira' });
  });

  it('sibling delta arrays (journal.about, knowledge.source, faction.why) also tolerate a stray null', () => {
    const r = parseState(J(JSON.stringify({
      turn: 5,
      delta: {
        journal: [{ who: 'Lira', memory: 'a moment', about: null }],
        knowledge: [{ who: 'Lira', fact: 'a fact', source: null }],
        factions: [{ name: 'The Watch', why: null }],
      },
    })));
    expect(r.source).toBe('json');
    expect(r.state?.delta?.journal?.[0]).toEqual({ who: 'Lira', memory: 'a moment' });
    expect(r.state?.delta?.knowledge?.[0]).toEqual({ who: 'Lira', fact: 'a fact' });
    expect(r.state?.delta?.factions?.[0]).toEqual({ name: 'The Watch' });
  });
});

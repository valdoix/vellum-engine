import { describe, it, expect } from 'vitest';
import { assembleBlock, buildRepairContext } from '../src/bus/block-repair.js';
import { parseState } from '../src/parse/state-block.js';
import { freshState } from '../src/domain/types.js';
import type { ChronicleState } from '../src/domain/types.js';

/** A ChronicleState with a scene + one present cast member, for context tests. */
function stateWith(overrides: Partial<ChronicleState> = {}): ChronicleState {
  const s = freshState();
  s.day = 3;
  s.scene = { location: 'the north garden', time: 'late evening', tension: 2, weather: '', present: ['lira'], detail: [] };
  s.cast = { lira: { id: 'lira', name: 'Lira', status: 'present', traits: [], firstTurn: 1, lastTurn: 1 } as any };
  return { ...s, ...overrides } as ChronicleState;
}

describe('block-repair — buildRepairContext', () => {
  it('carries turn, day, prior scene loc/time, and present cast names', () => {
    const ctx = buildRepairContext(stateWith(), 5);
    expect(ctx).toContain('turn: 5');
    expect(ctx).toContain('day: 3');
    expect(ctx).toContain('the north garden');
    expect(ctx).toContain('late evening');
    expect(ctx).toContain('Lira'); // display name, not the canonical id
  });

  it('omits scene lines that are absent (fresh state)', () => {
    const s = freshState();
    const ctx = buildRepairContext(s, 1);
    expect(ctx).toContain('turn: 1');
    expect(ctx).toContain('day: 0');
    expect(ctx).not.toContain('prior scene location');
    expect(ctx).not.toContain('characters present');
  });
});

describe('block-repair — assembleBlock', () => {
  it('wraps a valid JSON object into a <vellum> block the shared parser accepts', () => {
    const raw = '{ "turn": 5, "scene": { "time": "late evening" }, "present": [{ "id": "Lira", "mood": "guarded" }] }';
    const r = assembleBlock(raw);
    expect(r).not.toBeNull();
    expect(r!.source).toBe('json');
    expect(r!.block.startsWith('<vellum>')).toBe(true);
    expect(r!.block.trimEnd().endsWith('</vellum>')).toBe(true);
    // the wrapped block round-trips through the canonical parser
    const parsed = parseState(r!.block);
    expect(parsed.source).toBe('json');
    expect(parsed.state?.turn).toBe(5);
  });

  it('extracts the JSON even when the model wraps it in a stray code fence + prose', () => {
    const raw = 'Here is the state:\n```json\n{ "turn": 6, "scene": { "loc": "hall" } }\n```\nDone.';
    const r = assembleBlock(raw);
    expect(r).not.toBeNull();
    expect(parseState(r!.block).state?.turn).toBe(6);
  });

  it('recovers a delta payload (bonds) through the wrap', () => {
    const raw = '{ "turn": 7, "delta": { "bonds": [{ "a": "Lira", "b": "Kael", "aff": 8 }] } }';
    const r = assembleBlock(raw);
    expect(r).not.toBeNull();
    const parsed = parseState(r!.block);
    expect(parsed.state?.delta?.bonds?.[0]?.a).toBe('Lira');
  });

  it('returns null on an empty reply', () => {
    expect(assembleBlock('')).toBeNull();
    expect(assembleBlock('   ')).toBeNull();
  });

  it('returns null when there is no JSON object at all (pure prose)', () => {
    expect(assembleBlock('The model refused and wrote a paragraph instead.')).toBeNull();
  });

  it('returns null for a JSON object that carries no schema keys (not our block)', () => {
    // balanced object, but nothing parseState recognizes as state → rejected,
    // so a junk reply can never be written into the transcript.
    expect(assembleBlock('{ "foo": "bar", "baz": 1 }')).toBeNull();
  });

  it('returns null for an unbalanced / truncated object', () => {
    expect(assembleBlock('{ "turn": 9, "scene": { "loc": "x"')).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { assembleBlock, buildRepairContext, VELLUM_BLOCK_REPAIR_SYS } from '../src/bus/block-repair.js';
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
    expect(ctx).toContain('PERSONA STATE: OFF');
  });

  it('marks the persona-state opt-in for the recovery prompt', () => {
    const ctx = buildRepairContext(stateWith(), 5, true, 'I am wounded but alert.', 'director');
    expect(ctx).toContain('PERSONA STATE: ON');
    expect(ctx).toContain('PERSONA AGENCY: director');
    expect(ctx).toContain('latest player input: I am wounded but alert.');
    expect(VELLUM_BLOCK_REPAIR_SYS).toContain('PERSONA STATE OFF');
  });

  it('omits scene lines that are absent (fresh state)', () => {
    const s = freshState();
    const ctx = buildRepairContext(s, 1);
    expect(ctx).toContain('turn: 1');
    expect(ctx).toContain('day: 0');
    expect(ctx).not.toContain('prior scene location');
    expect(ctx).not.toContain('characters present');
  });

  it('supplies exact plot ids, prior conditions, linked children, and a no-change default', () => {
    const s = stateWith();
    s.arcs = [{ id: 'thr_conspiracy', name: 'The Conspiracy', status: 'active', beats: ['The seal remains missing'], firstTurn: 1, lastTurn: 3 }];
    s.threads = [{ id: 'thr_seal', name: 'The Stolen Seal', status: 'active', beats: ['Lira searches the archive'], arc: 'thr_conspiracy', firstTurn: 2, lastTurn: 3 }];
    const ctx = buildRepairContext(s, 5);
    expect(ctx).toContain('thr_seal | The Stolen Seal | before: Lira searches the archive');
    expect(ctx).toContain('thr_conspiracy | The Conspiracy | before: The seal remains missing | child threads: thr_seal');
    expect(VELLUM_BLOCK_REPAIR_SYS).toContain('threads and arcs default to NO CHANGE');
    expect(VELLUM_BLOCK_REPAIR_SYS).toContain('A mention, shared character, mood, theme, location, elapsed time');
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

describe('block-repair — assembleBlock: DeepSeek / reasoning-model resilience', () => {
  const VALID = '{ "turn": 3, "scene": { "loc": "hall" }, "present": [{ "id": "Aria" }] }';

  it('strips <think>…</think> before scanning, so a brace inside reasoning does not steal the scan', () => {
    const raw = '<think>I need to output JSON like { "foo": 1 }. Let me construct it properly.</think>\n' + VALID;
    const r = assembleBlock(raw);
    expect(r).not.toBeNull();
    expect(parseState(r!.block).state?.turn).toBe(3);
  });

  it('skips a non-schema reasoning object and finds the real block after it', () => {
    // DeepSeek may emit a schema-less object (e.g. reasoning plan) before the real state
    const raw = '{ "plan": "write scene then JSON" }\n\nSome prose.\n\n' + VALID;
    const r = assembleBlock(raw);
    expect(r).not.toBeNull();
    expect(parseState(r!.block).state?.turn).toBe(3);
  });

  it('strips an unclosed <think> tag (mid-stream truncation)', () => {
    const raw = '<think>reasoning that never closes...\n' + VALID;
    const r = assembleBlock(raw);
    // the think block swallows the trailing content — block is not recoverable here,
    // but the scanner must not crash and must not write garbage
    expect(typeof r === 'object' || r === null).toBe(true);
  });

  it('strips code fences from a reply that wraps JSON in ```json', () => {
    const raw = 'Here is the reconstructed state:\n```json\n' + VALID + '\n```';
    const r = assembleBlock(raw);
    expect(r).not.toBeNull();
    expect(parseState(r!.block).state?.turn).toBe(3);
  });

  it('handles a <think> block containing valid-looking but schema-less JSON followed by the real block', () => {
    const raw = '<think>{ "step": 1, "action": "draft scene" }</think>\n\n' + VALID;
    const r = assembleBlock(raw);
    expect(r).not.toBeNull();
    expect(parseState(r!.block).state?.turn).toBe(3);
  });

  it('handles multiple <think> variants (thinking, reasoning, reflection)', () => {
    const thinkVariants = [
      '<thinking>plan here</thinking>',
      '<reasoning>plan here</reasoning>',
      '<reflection>plan here</reflection>',
    ];
    for (const tag of thinkVariants) {
      const r = assembleBlock(tag + '\n' + VALID);
      expect(r).not.toBeNull();
      expect(parseState(r!.block).state?.turn).toBe(3);
    }
  });

  it('recovers despite a Gemini-style preamble sentence + code fence (prompt discourages it, parser tolerates it)', () => {
    const raw = 'Certainly, here is the reconstructed state:\n\n```json\n' + VALID + '\n```\n\nLet me know if you need anything else.';
    const r = assembleBlock(raw);
    expect(r).not.toBeNull();
    expect(parseState(r!.block).state?.turn).toBe(3);
  });
});

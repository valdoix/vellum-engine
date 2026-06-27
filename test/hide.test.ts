import { describe, it, expect } from 'vitest';
import { planHide, type HideMsg } from '../src/host/hide.js';

// user/assistant interleaved transcript; greeting-first (assistant before any user)
const transcript: HideMsg[] = [
  { id: 'g', role: 'assistant' },          // turn 1 (greeting, no preceding user)
  { id: 'u1', role: 'user' },              // belongs to turn 2
  { id: 'a1', role: 'assistant' },         // turn 2
  { id: 'u2', role: 'user' },              // belongs to turn 3
  { id: 'a2', role: 'assistant' },         // turn 3
  { id: 'u3', role: 'user' },              // belongs to turn 4
  { id: 'a3', role: 'assistant' },         // turn 4
];

describe('Fix 24 — planHide turn numbering', () => {
  it('a user message is owned by the assistant turn that follows it', () => {
    // cover up to turn 2, keep 0 recent → dropUpTo = min(2, 4-0) = 2
    const { hide, dropUpTo } = planHide(transcript, 2, 0, true);
    expect(dropUpTo).toBe(2);
    // turns ≤ 2 hidden: greeting(1), u1(→2), a1(2). u2(→3) and beyond stay.
    expect(hide).toEqual(['g', 'u1', 'a1']);
  });

  it('keepRecent keeps the most recent assistant turns visible', () => {
    // totalAsst = 4, keepRecent = 2 → dropUpTo = min(99, 4-2) = 2
    const { hide, dropUpTo } = planHide(transcript, 99, 2, true);
    expect(dropUpTo).toBe(2);
    expect(hide).toEqual(['g', 'u1', 'a1']);
  });

  it('a trailing user message with no following assistant is never hidden', () => {
    const t: HideMsg[] = [...transcript, { id: 'u4', role: 'user' }];
    const { hide } = planHide(t, 99, 0, true);
    expect(hide).not.toContain('u4');
  });

  it('disabled → shows anything currently hidden, hides nothing', () => {
    const t: HideMsg[] = [{ id: 'a', role: 'assistant', hidden: true }, { id: 'b', role: 'user', hidden: false }];
    const { hide, show } = planHide(t, 99, 0, false);
    expect(hide).toEqual([]);
    expect(show).toEqual(['a']);
  });
});

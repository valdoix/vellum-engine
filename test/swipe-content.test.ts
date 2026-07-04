import { describe, it, expect } from 'vitest';
import { activeContent } from '../src/host/chats.js';

/**
 * Swipe handling: a swipe replaces the visible reply in place (same message
 * slot / turn number) by selecting swipes[swipe_id]. Some hosts leave the OLD
 * text in m.content and only bump swipe_id, so activeContent must PREFER the
 * active swipe over m.content — otherwise the turn signature reads unchanged,
 * the fold reconcile never re-runs, and the chronicle keeps the discarded
 * swipe's deltas. This is the regression guard for that fix.
 */

describe('activeContent — swipe-aware current content', () => {
  it('plain message: returns m.content', () => {
    expect(activeContent({ content: 'hello' })).toBe('hello');
  });

  it('no swipes array: returns m.content', () => {
    expect(activeContent({ content: 'hi', swipes: undefined })).toBe('hi');
  });

  it('prefers the active swipe over a STALE m.content (the bug)', () => {
    // host left the first swipe in content but the user swiped to index 1
    const m = { content: 'FIRST swipe text', swipe_id: 1, swipes: ['FIRST swipe text', 'SECOND swipe text'] };
    expect(activeContent(m)).toBe('SECOND swipe text');
  });

  it('active swipe at index 0 matches content (host mirrors correctly)', () => {
    const m = { content: 'A', swipe_id: 0, swipes: ['A', 'B'] };
    expect(activeContent(m)).toBe('A');
  });

  it('swipe_id out of range falls back to content, then last swipe', () => {
    expect(activeContent({ content: 'keep', swipe_id: 9, swipes: ['a', 'b'] })).toBe('keep');
    expect(activeContent({ content: '', swipe_id: 9, swipes: ['a', 'b'] })).toBe('b');
  });

  it('empty content with swipes: uses the active swipe', () => {
    expect(activeContent({ content: '', swipe_id: 1, swipes: ['a', 'b'] })).toBe('b');
  });

  it('missing swipe_id with swipes: falls back to content then last swipe', () => {
    expect(activeContent({ content: 'c', swipes: ['a', 'b'] })).toBe('c');
    expect(activeContent({ content: '', swipes: ['a', 'b'] })).toBe('b');
  });

  it('empty/degenerate inputs never throw, return a string', () => {
    expect(activeContent(null)).toBe('');
    expect(activeContent({})).toBe('');
    expect(activeContent({ swipes: [] })).toBe('');
  });
});

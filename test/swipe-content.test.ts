import { describe, it, expect } from 'vitest';
import { activeContent, assistantSnapshotStatus, messagePartsAtTurn, turnContentsFromMessages, withAssistantSnapshot } from '../src/host/chats.js';

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

describe('messagePartsAtTurn', () => {
  it('pairs each assistant with only its immediately preceding player input', () => {
    const messages = [
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'I try the latch.' },
      { role: 'assistant', content: 'The latch resists.' },
      { role: 'user', content: 'OOC: Direct Mara to leave.' },
      { role: 'assistant', content: 'Mara leaves.' },
    ];
    expect(messagePartsAtTurn(messages, 1)).toEqual({ userInput: 'I try the latch.', assistant: 'The latch resists.' });
    expect(messagePartsAtTurn(messages, 2)).toEqual({ userInput: 'OOC: Direct Mara to leave.', assistant: 'Mara leaves.' });
  });
});

describe('GENERATION_ENDED transcript snapshot', () => {
  const snapshot = { messageId: 'a1', content: 'The latch opens.', generationId: 'g1' };

  it('fills a temporarily missing assistant message and preserves its pending user input', () => {
    const messages = [{ id: 'u1', role: 'user', content: 'I turn the key.' }];
    expect(assistantSnapshotStatus(messages, snapshot)).toBe('missing');
    expect(turnContentsFromMessages(messages, snapshot)).toEqual([
      '[Player action]\nI turn the key.\n\n[Scene]\nThe latch opens.',
    ]);
    expect(messagePartsAtTurn(messages, 1, snapshot)).toEqual({ userInput: 'I turn the key.', assistant: 'The latch opens.' });
  });

  it('does not overwrite a stored edit or swipe with an older generation snapshot', () => {
    const messages = [{ id: 'a1', role: 'assistant', content: 'Edited reply.', swipes: ['Old reply.', 'Edited reply.'], swipe_id: 1 }];
    expect(assistantSnapshotStatus(messages, snapshot)).toBe('different');
    expect(withAssistantSnapshot(messages, snapshot)).toHaveLength(1);
    expect(turnContentsFromMessages(messages, snapshot)).toEqual(['Edited reply.']);
  });

  it('recognizes a converged host transcript without duplicating the message', () => {
    const messages = [{ id: 'a1', role: 'assistant', content: snapshot.content }];
    expect(assistantSnapshotStatus(messages, snapshot)).toBe('match');
    expect(withAssistantSnapshot(messages, snapshot)).toHaveLength(1);
  });
});

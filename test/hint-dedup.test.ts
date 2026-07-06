import { describe, it, expect } from 'vitest';
import { appendHintTurn } from '../src/host/chats.js';

/**
 * The fold's GENERATION_ENDED hint is the RAW assistant reply, but
 * allTurnContents wraps each committed turn as "[Player action]…[Scene]<reply>".
 * A strict-equality dedup (msgs[last] !== hint) therefore stopped matching once
 * the wrapping was introduced, so the raw reply was pushed as a PHANTOM,
 * unwrapped duplicate turn on every fold. That inflated the turn high-water,
 * which made the next hint-less get_state roll the log back (divergedTurn) and
 * repeatedly truncate the freshly-extracted knowledge/secrets/journal events.
 * appendHintTurn dedups by containment instead. This is the regression guard.
 */

const wrap = (user: string, reply: string): string =>
  `[Player action]\n${user}\n\n[Scene]\n${reply}`;

describe('appendHintTurn — hint dedup against wrapped turns', () => {
  it('does NOT re-append a reply the last wrapped block already carries (the bug)', () => {
    const reply = 'The knight bowed and left the hall.';
    const msgs = [wrap('I nod.', reply)];
    // pre-fix behaviour pushed the raw reply as a phantom turn; must not now.
    expect(appendHintTurn(msgs, reply)).toEqual(msgs);
    expect(appendHintTurn(msgs, reply)).toHaveLength(1);
  });

  it('handles trailing/leading whitespace on the hint', () => {
    const reply = 'She drew the blade.';
    const msgs = [wrap('Go on.', reply)];
    expect(appendHintTurn(msgs, `\n  ${reply}  \n`)).toEqual(msgs);
  });

  it('appends an uncommitted new-chat turn (commit-race safety net)', () => {
    const msgs: string[] = [];
    const reply = 'The story begins at dawn.';
    expect(appendHintTurn(msgs, reply)).toEqual([reply]);
  });

  it('appends when the last block is a DIFFERENT (older) turn', () => {
    const msgs = [wrap('Hi.', 'Turn one reply.')];
    const fresh = 'Turn two reply, not yet committed.';
    expect(appendHintTurn(msgs, fresh)).toEqual([...msgs, fresh]);
  });

  it('empty / whitespace-only hint is a no-op', () => {
    const msgs = [wrap('a', 'b')];
    expect(appendHintTurn(msgs, '')).toBe(msgs);
    expect(appendHintTurn(msgs, '   ')).toBe(msgs);
    expect(appendHintTurn(msgs, undefined)).toBe(msgs);
  });

  it('never mutates the input array', () => {
    const msgs = [wrap('x', 'y')];
    const before = msgs.slice();
    appendHintTurn(msgs, 'a brand new uncommitted reply');
    expect(msgs).toEqual(before);
  });
});

import { afterEach, describe, it, expect } from 'vitest';
import { chatNames, looksLikeTimestamp } from '../src/host/chats.js';

describe('looksLikeTimestamp', () => {
  it('detects Lumiverse default chat title format (Mon DD, YYYY, HH:MM:SS AM/PM)', () => {
    expect(looksLikeTimestamp('Jul 19, 2026, 10:37:00 PM')).toBe(true);
    expect(looksLikeTimestamp('Jan 1, 2025, 9:00:00 AM')).toBe(true);
    expect(looksLikeTimestamp('Dec 31, 2024, 11:59:59 PM')).toBe(true);
  });

  it('detects bare clock strings', () => {
    expect(looksLikeTimestamp('10:37 PM')).toBe(true);
    expect(looksLikeTimestamp('09:00')).toBe(true);
  });

  it('detects ISO date strings', () => {
    expect(looksLikeTimestamp('2026-07-19')).toBe(true);
    expect(looksLikeTimestamp('07/19/2026')).toBe(true);
  });

  it('accepts real character names', () => {
    expect(looksLikeTimestamp('Cersei Lannister')).toBe(false);
    expect(looksLikeTimestamp('Aria')).toBe(false);
    expect(looksLikeTimestamp('Valentine')).toBe(false);
    expect(looksLikeTimestamp('Dr. Evelyn May')).toBe(false);
  });

  it('handles empty/null-ish input', () => {
    expect(looksLikeTimestamp('')).toBe(false);
    expect(looksLikeTimestamp(null as any)).toBe(false);
    expect(looksLikeTimestamp(undefined as any)).toBe(false);
  });
});

describe('chatNames persona identity', () => {
  afterEach(() => { delete (globalThis as any).spindle; });

  it('resolves the exact interceptor-bound persona on modern ChatDTO hosts', async () => {
    (globalThis as any).spindle = {
      chats: { get: async () => ({ id: 'c1', character_id: 'char1', name: 'Sep 8, 2026, 1:00:00 PM', metadata: {} }) },
      personas: { get: async (id: string) => id === 'persona-gabriel' ? { id, name: 'Gabriel Winters' } : null },
      chat: { getMessages: async () => [{ role: 'assistant', name: 'Buffy Summers', content: 'Hi' }] },
    };
    expect(await chatNames('c1', 'u1', 'persona-gabriel')).toEqual({ user: 'Gabriel Winters', char: 'Buffy Summers' });
  });

  it('uses the current persona API when no bound id is available', async () => {
    (globalThis as any).spindle = {
      chats: { get: async () => ({ id: 'c1', character_id: 'char1', name: 'Buffy Summers', metadata: {} }) },
      personas: { getActive: async () => ({ id: 'persona-gabriel', name: 'Gabriel Winters' }) },
      chat: { getMessages: async () => [] },
    };
    expect(await chatNames('c1', 'u1')).toEqual({ user: 'Gabriel Winters', char: 'Buffy Summers' });
  });
});

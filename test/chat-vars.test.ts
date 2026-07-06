import { describe, it, expect, afterEach, vi } from 'vitest';
import { getChatVar, setChatVar, invalidateChatVars } from '../src/host/chats.js';

describe('chat var cache', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).spindle;
    invalidateChatVars();
  });

  it('does not let a transient empty host read clobber a known non-empty setting', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const store = new Map<string, string>();
    (globalThis as any).spindle = {
      variables: {
        chat: {
          get: async (_chatId: string, key: string) => store.get(key) ?? '',
          set: async (_chatId: string, key: string, value: string) => { store.set(key, value); },
        },
      },
    };

    await setChatVar('chat1', 'vellum_romance', 'slow_burn');
    // Simulate the regenerate race: after the cache TTL expires, the host
    // temporarily reports the chat var as empty even though this extension's
    // write-through cache still holds the last value it set. The cache should
    // remain authoritative instead of broadcasting parseTone('') → default.
    store.delete('vellum_romance');
    vi.setSystemTime(31_000);

    expect(await getChatVar('chat1', 'vellum_romance')).toBe('slow_burn');
  });

  it('still allows an intentional clear via setChatVar empty string', async () => {
    const store = new Map<string, string>();
    (globalThis as any).spindle = {
      variables: {
        chat: {
          get: async (_chatId: string, key: string) => store.get(key) ?? '',
          set: async (_chatId: string, key: string, value: string) => { store.set(key, value); },
        },
      },
    };

    await setChatVar('chat1', 'vellum_hide_summarized', '1');
    await setChatVar('chat1', 'vellum_hide_summarized', '');

    expect(await getChatVar('chat1', 'vellum_hide_summarized')).toBe('');
  });
});

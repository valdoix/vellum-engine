import { type Result, Ok, Err, tryCatchAsync } from '../core/result.js';

declare const spindle: any;

/**
 * Chat + message host access. The regex-proof read path: stored message content
 * keeps the ‹vellum› block even when display regex hides it from the reader.
 */

export async function activeChatId(userId: string | null): Promise<string | null> {
  try {
    const c = await spindle.chats?.getActive?.(userId);
    return c?.id ?? null;
  } catch {
    return null;
  }
}

/** Read the newest assistant message's raw content (regex-proof). */
export async function latestAssistantContent(chatId: string): Promise<Result<string, string>> {
  return tryCatchAsync(async () => {
    const msgs = await spindle.chat?.getMessages?.(chatId);
    if (!Array.isArray(msgs)) throw new Error('no messages');
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (!m || m.role !== 'assistant') continue;
      let content = typeof m.content === 'string' ? m.content : '';
      if (!content && Array.isArray(m.swipes) && m.swipes.length) {
        const slot = typeof m.swipe_id === 'number' ? m.swipes[m.swipe_id] : null;
        content = String(slot ?? m.swipes[m.swipes.length - 1] ?? '');
      }
      return content;
    }
    throw new Error('no assistant message');
  });
}

/**
 * Read the latest assistant content, RETRYING briefly. On a new chat's first
 * turn, GENERATION_ENDED can fire before the message is committed to
 * getMessages — so a single read returns nothing and the fold is skipped (the
 * "doesn't update until I switch chats" bug). Retry with backoff to catch it.
 */
export async function latestAssistantContentRetry(chatId: string, tries = 5, delayMs = 180): Promise<Result<string, string>> {
  let last: Result<string, string> = Err('no assistant message');
  for (let i = 0; i < tries; i++) {
    last = await latestAssistantContent(chatId);
    if (last.ok && last.value && last.value.trim()) return last;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return last;
}

export function isPermDenied(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /permission|denied|not granted/i.test(msg);
}

export { Ok, Err };

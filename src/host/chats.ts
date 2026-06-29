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

/** All assistant message contents in order (regex-proof). Powers self-healing
 * reconcile-folding: fold any assistant turns not yet captured. */
export async function allAssistantContents(chatId: string): Promise<string[]> {
  try {
    const msgs = await spindle.chat?.getMessages?.(chatId);
    if (!Array.isArray(msgs)) return [];
    const out: string[] = [];
    for (const m of msgs) {
      if (!m || m.role !== 'assistant') continue;
      let content = typeof m.content === 'string' ? m.content : '';
      if (!content && Array.isArray(m.swipes) && m.swipes.length) {
        const slot = typeof m.swipe_id === 'number' ? m.swipes[m.swipe_id] : null;
        content = String(slot ?? m.swipes[m.swipes.length - 1] ?? '');
      }
      out.push(content);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * One folded text block per ASSISTANT turn, but INCLUDING the user message(s)
 * that immediately precede it. A "turn" stays keyed on the assistant reply (so
 * turn-count = assistant-count, the invariant the fold/rollback rely on), but
 * the content now carries what the PLAYER did + how the AI responded — so
 * memories and summaries reflect both sides, not just the assistant's words.
 * Leading user messages before the first assistant reply attach to that reply.
 *
 * Both sides get an explicit structural marker ([Player action] / [Scene]) so
 * the player's input and the AI's third-person narration are never blurred into
 * one voice. The markers are bracketed labels, not in-fiction speaker names, so
 * resolving {{user}} can't make narration read as the player's dialogue.
 */
export async function allTurnContents(chatId: string): Promise<string[]> {
  try {
    const msgs = await spindle.chat?.getMessages?.(chatId);
    if (!Array.isArray(msgs)) return [];
    const pickContent = (m: any): string => {
      let content = typeof m.content === 'string' ? m.content : '';
      if (!content && Array.isArray(m.swipes) && m.swipes.length) {
        const slot = typeof m.swipe_id === 'number' ? m.swipes[m.swipe_id] : null;
        content = String(slot ?? m.swipes[m.swipes.length - 1] ?? '');
      }
      return content;
    };
    const out: string[] = [];
    let pendingUser: string[] = []; // user lines awaiting the next assistant turn
    for (const m of msgs) {
      if (!m) continue;
      if (m.role === 'user') {
        const c = pickContent(m).trim();
        if (c) pendingUser.push(c);
      } else if (m.role === 'assistant') {
        const reply = pickContent(m).trim();
        const block = pendingUser.length
          ? pendingUser.map((u) => `[Player action]\n${u}`).join('\n\n') + (reply ? `\n\n[Scene]\n${reply}` : '')
          : reply;
        out.push(block);
        pendingUser = [];
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function isPermDenied(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /permission|denied|not granted/i.test(msg);
}

/**
 * Persisted per-chat variables (toggles like tone/traversal/hide/tidy). The host
 * exposes these via `spindle.variables.chat` (the @-prefixed macro family),
 * which survives regens/swipes/edits — NOT `spindle.chats.getVar` (which does
 * not exist; calling it silently no-ops, which is why toggles reset each turn).
 */
export async function getChatVar(chatId: string, key: string): Promise<string> {
  try { return String((await spindle.variables?.chat?.get?.(chatId, key)) ?? ''); } catch { return ''; }
}
export async function setChatVar(chatId: string, key: string, value: string): Promise<void> {
  try { await spindle.variables?.chat?.set?.(chatId, key, value); } catch { /* best effort */ }
}

/** Resolve the persona ({{user}}) + character ({{char}}) display names for the
 * active chat, so the prose extractor can replace placeholders with real names
 * and attribute knowledge/secrets/journal to the player too. Best-effort. */
export async function chatNames(chatId: string, userId: string | null): Promise<{ user: string; char: string }> {
  const out = { user: '', char: '' };
  try {
    const chat = await (spindle.chats?.get?.(chatId, userId) ?? spindle.chats?.get?.(chatId));
    out.user = String(chat?.persona?.name || chat?.personaName || chat?.user_name || chat?.metadata?.persona_name || '').trim();
    out.char = String(chat?.character?.name || chat?.characterName || chat?.char_name || chat?.metadata?.character_name || chat?.name || '').trim();
    // fallback: last USER message author / first ASSISTANT author
    if (!out.user || !out.char) {
      const msgs = await spindle.chat?.getMessages?.(chatId);
      if (Array.isArray(msgs)) {
        if (!out.user) { const um = [...msgs].reverse().find((m) => m?.role === 'user' && m?.name); out.user = String(um?.name || '').trim(); }
        if (!out.char) { const am = msgs.find((m) => m?.role === 'assistant' && m?.name); out.char = String(am?.name || '').trim(); }
      }
    }
  } catch { /* best effort */ }
  return out;
}

export { Ok, Err };

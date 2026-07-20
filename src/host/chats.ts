import { type Result, Ok, Err, tryCatchAsync } from '../core/result.js';

declare const spindle: any;

/**
 * Raw message fetch with IN-FLIGHT COALESCING. allTurnContents /
 * allAssistantContents / chatNames each read the transcript via
 * spindle.chat.getMessages; when they run concurrently (e.g. under Promise.all
 * in a fold pass) this returns the SAME in-flight promise instead of issuing
 * duplicate host round-trips. It deliberately does NOT cache the completed
 * result: retry paths (latestAssistantContentRetry) must be able to re-read a
 * freshly-committed message, so once a fetch settles the slot is cleared and the
 * next call fetches anew. Retries are sequential (awaited with delays) so they
 * never overlap and always get a fresh read — the commit-race fix is preserved.
 */
const _inflight = new Map<string, Promise<any[]>>();
export function getRawMessages(chatId: string): Promise<any[]> {
  const pending = _inflight.get(chatId);
  if (pending) return pending;
  const p = (async () => {
    const msgs = await spindle.chat?.getMessages?.(chatId);
    return Array.isArray(msgs) ? msgs : [];
  })();
  _inflight.set(chatId, p);
  // clear the slot once settled so a later (post-commit) read isn't served stale
  p.then(() => _inflight.delete(chatId), () => _inflight.delete(chatId));
  return p;
}

/**
 * The CURRENTLY-ACTIVE content of a message, swipe-aware. A swipe replaces the
 * visible reply in place (same message slot, same turn number) by bumping
 * `swipe_id` into `swipes[]` — but some hosts leave the old text in `m.content`
 * and only update `swipe_id`. So we PREFER the active swipe (swipes[swipe_id])
 * and fall back to m.content, not the other way round. Getting this wrong makes
 * a swipe read as unchanged, so the fold reconcile never re-runs and the
 * chronicle keeps the discarded swipe's bonds/knowledge/scene state. Every read
 * path that feeds a turn signature MUST agree on this, so it lives here once.
 */
export function activeContent(m: any): string {
  if (!m) return '';
  const swipes = Array.isArray(m.swipes) ? m.swipes : null;
  if (swipes && swipes.length) {
    const active = typeof m.swipe_id === 'number' ? swipes[m.swipe_id] : undefined;
    const picked = active ?? (typeof m.content === 'string' && m.content ? m.content : swipes[swipes.length - 1]);
    return String(picked ?? '');
  }
  return typeof m.content === 'string' ? m.content : '';
}

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
      return activeContent(m);
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
    const msgs = await getRawMessages(chatId);
    if (!Array.isArray(msgs)) return [];
    const out: string[] = [];
    for (const m of msgs) {
      if (!m || m.role !== 'assistant') continue;
      out.push(activeContent(m));
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
    const msgs = await getRawMessages(chatId);
    if (!Array.isArray(msgs)) return [];
    const out: string[] = [];
    let pendingUser: string[] = []; // user lines awaiting the next assistant turn
    for (const m of msgs) {
      if (!m) continue;
      if (m.role === 'user') {
        const c = activeContent(m).trim();
        if (c) pendingUser.push(c);
      } else if (m.role === 'assistant') {
        const reply = activeContent(m).trim();
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
 *
 * WRITE-THROUGH CACHE: these vars are written ONLY by this extension's own
 * dispatch handlers (every mutation goes through setChatVar below), so a
 * write-through in-memory cache stays authoritative without a host round-trip on
 * reads. The interceptor + broadcastState read ~10 vars each per turn; serving
 * those from memory removes ~20 serialized host IPCs per turn. A short TTL is a
 * safety net in case a future host path mutates them out-of-band, and the cache
 * is cleared on CHAT_SWITCHED (see invalidateChatVars).
 */
interface VarEntry { value: string; at: number }
const _varCache = new Map<string, VarEntry>();
const VAR_TTL = 30_000; // ms; re-probe the host at most this often per key
function _vk(chatId: string, key: string): string { return chatId + '\u0000' + key; }

/** Clear cached chat vars (all, or one chat). Call on CHAT_SWITCHED. */
export function invalidateChatVars(chatId?: string): void {
  if (!chatId) { _varCache.clear(); return; }
  const prefix = chatId + '\u0000';
  for (const k of _varCache.keys()) if (k.startsWith(prefix)) _varCache.delete(k);
}

export async function getChatVar(chatId: string, key: string): Promise<string> {
  const ck = _vk(chatId, key);
  const hit = _varCache.get(ck);
  if (hit && Date.now() - hit.at < VAR_TTL) return hit.value;
  try {
    const v = String((await spindle.variables?.chat?.get?.(chatId, key)) ?? '');
    // AUTHORITATIVE-CACHE GUARD: these vars are written ONLY through setChatVar
    // (write-through), so the cache is the source of truth. A TTL-expiry re-read
    // that comes back EMPTY while we hold a NON-empty cached value is almost
    // always the host transiently losing the var — e.g. on REGENERATE, where the
    // in-memory chat metadata is reset before our DB write is reflected back.
    // Honoring that empty read clobbered persisted settings (tone reverting to
    // default after a regen). So keep the known value and refresh its timestamp;
    // a genuine clear always arrives via setChatVar('') (write-through → cache '').
    if (v === '' && hit && hit.value !== '') {
      _varCache.set(ck, { value: hit.value, at: Date.now() });
      return hit.value;
    }
    _varCache.set(ck, { value: v, at: Date.now() });
    return v;
  } catch {
    // on a read error, prefer a (possibly stale) cached value over empty
    return hit?.value ?? '';
  }
}
export async function setChatVar(chatId: string, key: string, value: string): Promise<void> {
  // write-through: update the cache immediately so subsequent reads this turn
  // (and until the TTL) reflect the new value without a host round-trip.
  _varCache.set(_vk(chatId, key), { value, at: Date.now() });
  try { await spindle.variables?.chat?.set?.(chatId, key, value); } catch { /* best effort */ }
}

/** A chat TITLE / author string that is really a creation timestamp, not a
 * name — Lumiverse defaults untitled chats to their creation date (e.g.
 * "Jul 19, 2026, 10:37:00 PM"). Such strings must never be treated as the
 * character name: they poison the greeting-seed cast card and {{char}}
 * placeholder replacement. Best-effort structural match (locale-agnostic on
 * the numeric/clock parts). */
export function looksLikeTimestamp(s: string): boolean {
  const t = String(s || '').trim();
  if (!t) return false;
  if (/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\b/i.test(t)) return true; // clock time 10:37 / 10:37:00 PM
  if (/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}\b/i.test(t)) return true; // "Jul 19"
  if (/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/.test(t)) return true; // 2026-07-19
  if (/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/.test(t)) return true; // 07/19/2026
  return false;
}

/** Resolve the persona ({{user}}) + character ({{char}}) display names for the
 * active chat, so the prose extractor can replace placeholders with real names
 * and attribute knowledge/secrets/journal to the player too. Best-effort. */
export async function chatNames(chatId: string, userId: string | null): Promise<{ user: string; char: string }> {
  const out = { user: '', char: '' };
  try {
    const chat = await (spindle.chats?.get?.(chatId, userId) ?? spindle.chats?.get?.(chatId));
    out.user = String(chat?.persona?.name || chat?.personaName || chat?.user_name || chat?.metadata?.persona_name || '').trim();
    // Prefer the real character fields. chat?.name is the chat TITLE, which
    // defaults to a creation timestamp — only accept it as a last resort when
    // it isn't a date/time string (else the greeting seed makes a cast card
    // named "Jul 19, 2026, 10:37:00 PM").
    out.char = String(chat?.character?.name || chat?.characterName || chat?.char_name || chat?.metadata?.character_name || '').trim();
    if (!out.char) { const title = String(chat?.name || '').trim(); if (title && !looksLikeTimestamp(title)) out.char = title; }
    // fallback: last USER message author / first ASSISTANT author
    if (!out.user || !out.char) {
      const msgs = await getRawMessages(chatId);
      if (Array.isArray(msgs)) {
        if (!out.user) { const um = [...msgs].reverse().find((m) => m?.role === 'user' && m?.name); out.user = String(um?.name || '').trim(); }
        if (!out.char) { const am = msgs.find((m) => m?.role === 'assistant' && m?.name); const nm = String(am?.name || '').trim(); if (nm && !looksLikeTimestamp(nm)) out.char = nm; }
      }
    }
  } catch { /* best effort */ }
  return out;
}

export { Ok, Err };

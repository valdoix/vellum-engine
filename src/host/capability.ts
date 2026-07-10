declare const spindle: any;

/**
 * Capability probing. Every optional feature (embeddings, world books,
 * generation, controller) checks here and degrades with a *visible reason*
 * rather than dying in a silent catch. Probed lazily and cached, so we don't
 * hammer the host every turn.
 */

export type Capability = 'generation' | 'generation_parameters' | 'world_books' | 'memories' | 'chats' | 'chat_mutation' | 'interceptor' | 'presets';

let _granted: Set<string> | null = null;

/** Which manifest permissions the user actually granted (cached). */
export async function grantedPermissions(): Promise<Set<string>> {
  if (_granted) return _granted;
  const out = new Set<string>();
  try {
    if (spindle.permissions?.getGranted) {
      const g = await spindle.permissions.getGranted();
      if (Array.isArray(g)) g.forEach((p: string) => out.add(p));
    } else if (spindle.permissions?.has) {
      for (const p of ['generation', 'generation_parameters', 'world_books', 'memories', 'chats', 'chat_mutation', 'interceptor', 'ui_panels', 'presets']) {
        try { if (spindle.permissions.has(p)) out.add(p); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  _granted = out;
  return out;
}

/** Invalidate the permission cache (call on PERMISSION_CHANGED). */
export function invalidatePermissions(): void {
  _granted = null;
}

export async function has(cap: Capability): Promise<boolean> {
  return (await grantedPermissions()).has(cap);
}

/**
 * Per-chat capability snapshot: does this chat have embeddings/vectorization
 * available? Cached per chat (TTL) so we probe `chatMemory.warm` at most once
 * in a while, not every turn.
 */
interface ChatCaps { embeddings: boolean; at: number }
const _chatCaps = new Map<string, ChatCaps>();
const CAP_TTL = 5 * 60 * 1000;

export async function embeddingsEnabled(chatId: string, userId: string | null): Promise<boolean> {
  const cached = _chatCaps.get(chatId);
  if (cached && Date.now() - cached.at < CAP_TTL) return cached.embeddings;
  let enabled = false;
  try {
    if ((await has('memories')) && spindle.memories?.chatMemory?.warm) {
      const w = await spindle.memories.chatMemory.warm(chatId, { force: false, userId });
      enabled = !(w && w.status === 'skipped');
    }
  } catch { enabled = false; }
  _chatCaps.set(chatId, { embeddings: enabled, at: Date.now() });
  return enabled;
}

export function invalidateChatCaps(chatId?: string): void {
  if (chatId) _chatCaps.delete(chatId);
  else _chatCaps.clear();
}

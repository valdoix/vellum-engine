import { tryCatchAsync } from '../core/result.js';
import { has } from './capability.js';

declare const spindle: any;

/**
 * Hide-on-file: once turns are folded into chapter memories, the raw messages
 * are redundant context. With the user's opt-in, hide everything up to the
 * covered point (keeping the most recent N visible as a bridge), so the host's
 * prompt assembler drops them — big token savings on long chats. Reversible:
 * un-hides anything we hid when the toggle is turned off.
 *
 * `coveredTurn` = the highest turn already captured by a chapter memory.
 */
const HIDE_KEEP_RECENT = 6;

export interface HideMsg { id?: string; role?: string; hidden?: boolean }

/**
 * PURE hide planner (Fix 24). A user message belongs to the exchange of the
 * assistant message that FOLLOWS it (that assistant's reply is turn N; the user
 * line is its prompt). We tag each message with its owning assistant turn in a
 * first pass, then decide hide/show by that tag — so interleaving (greeting-
 * first transcripts, consecutive user lines) can't skew the boundary the way
 * the old inline `asst+1` did.
 *
 * Returns the ids to hide and to show. `dropUpTo` keeps the most recent
 * `keepRecent` assistant turns visible as a bridge.
 */
export function planHide(messages: HideMsg[], coveredTurn: number, keepRecent: number, enabled: boolean): { hide: string[]; show: string[]; dropUpTo: number } {
  const totalAsst = messages.reduce((n, m) => n + (m.role === 'assistant' ? 1 : 0), 0);
  const dropUpTo = Math.min(coveredTurn, Math.max(0, totalAsst - keepRecent));

  // first pass: owning assistant turn per message
  const owning = new Array<number>(messages.length).fill(0);
  let asst = 0;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]!.role === 'assistant') { asst++; owning[i] = asst; }
  }
  // back-fill user messages with the NEXT assistant turn after them
  let nextAsst = totalAsst + 1; // none-following sentinel (> any dropUpTo → never hidden)
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'assistant') nextAsst = owning[i]!;
    else if (messages[i]!.role === 'user') owning[i] = nextAsst;
  }

  const hide: string[] = [], show: string[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (!m.id || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const shouldHide = enabled && owning[i]! <= dropUpTo;
    if (shouldHide) { if (!m.hidden) hide.push(m.id); }
    else if (m.hidden) { show.push(m.id); } // restore (toggle-off + scroll-back)
  }
  return { hide, show, dropUpTo };
}

export async function syncHideOnFile(chatId: string, enabled: boolean, coveredTurn: number): Promise<{ hid: number; shown: number }> {
  if (!(await has('chat_mutation')) || !spindle.chat?.setMessagesHidden || !spindle.chat?.getMessages) return { hid: 0, shown: 0 };
  const r = await tryCatchAsync(async () => {
    const msgs = await spindle.chat.getMessages(chatId);
    if (!Array.isArray(msgs) || !msgs.length) return { hid: 0, shown: 0 };
    const { hide, show } = planHide(msgs as HideMsg[], coveredTurn, HIDE_KEEP_RECENT, enabled);
    for (let i = 0; i < hide.length; i += 500) await spindle.chat.setMessagesHidden(chatId, hide.slice(i, i + 500), true);
    for (let i = 0; i < show.length; i += 500) await spindle.chat.setMessagesHidden(chatId, show.slice(i, i + 500), false);
    return { hid: hide.length, shown: show.length };
  });
  return r.ok ? r.value : { hid: 0, shown: 0 };
}

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

export async function syncHideOnFile(chatId: string, enabled: boolean, coveredTurn: number): Promise<{ hid: number; shown: number }> {
  if (!(await has('chat_mutation')) || !spindle.chat?.setMessagesHidden || !spindle.chat?.getMessages) return { hid: 0, shown: 0 };
  const r = await tryCatchAsync(async () => {
    const msgs = await spindle.chat.getMessages(chatId);
    if (!Array.isArray(msgs) || !msgs.length) return { hid: 0, shown: 0 };
    let totalAsst = 0; for (const m of msgs) if (m.role === 'assistant') totalAsst++;
    const dropUpTo = Math.min(coveredTurn, Math.max(0, totalAsst - HIDE_KEEP_RECENT));
    const toHide: string[] = [], toShow: string[] = [];
    let asst = 0;
    for (const m of msgs) {
      if (!m.id || (m.role !== 'user' && m.role !== 'assistant')) continue;
      const turn = asst + 1;
      if (m.role === 'assistant') asst++;
      const shouldHide = enabled && turn <= dropUpTo;
      if (shouldHide) { if (!m.hidden) toHide.push(m.id); }
      else if (m.hidden) { toShow.push(m.id); } // restore (covers toggle-off + scroll-back)
    }
    for (let i = 0; i < toHide.length; i += 500) await spindle.chat.setMessagesHidden(chatId, toHide.slice(i, i + 500), true);
    for (let i = 0; i < toShow.length; i += 500) await spindle.chat.setMessagesHidden(chatId, toShow.slice(i, i + 500), false);
    return { hid: toHide.length, shown: toShow.length };
  });
  return r.ok ? r.value : { hid: 0, shown: 0 };
}

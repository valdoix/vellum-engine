import type { VellumEvent } from '../core/events.js';
import type { ChronicleState } from '../domain/types.js';
import { planChapter, chapterEvents } from '../domain/memory.js';
import { internalGenerate } from '../host/generation.js';
import { nextSeq } from '../core/ids.js';

declare const spindle: any;

/**
 * Auto + manual summarization. Compresses the oldest window of turn-tier
 * memories into ONE chapter memory that is detail-dense yet compact, then drops
 * the sources (still recall-able via the chapter, through the same hybrid
 * fuser). LLM-written when generation is available; falls back to a structural
 * concatenation so it never silently no-ops.
 */

const SUMMARY_SYS =
  'You are a story archivist. Compress the given turn-by-turn notes into ONE dense chapter memory. '
  + 'PRESERVE EVERY CONCRETE DETAIL: names, places, objects, decisions, revealed facts, secrets, '
  + 'promises, betrayals, injuries, deaths, who-learned-what, and shifts in relationships. '
  + 'Omit only filler and repetition. Past tense, third person, factual - not prose, not commentary. '
  + 'Aim for one tight paragraph (or a few) that loses nothing a future scene would need. '
  + 'Then on a final line: KEYS: <6-12 comma-separated proper nouns / topics for retrieval>.';

/** Build the source text for the LLM from the memories being folded. */
function sourceText(state: ChronicleState, ids: string[]): string {
  const byId = new Map(state.memories.map((m) => [m.id, m]));
  return ids.map((id) => byId.get(id)).filter(Boolean).map((m) => `- (turn ${m!.turn}) ${m!.text}`).join('\n');
}

/**
 * Run one compression pass if a full window exists. Returns the events to
 * append (chapter record + source drops), or [] when nothing to compress.
 */
export async function summarizeOnce(state: ChronicleState, userId: string | null, windowSize = 8): Promise<VellumEvent[]> {
  const plan = planChapter(state, windowSize);
  if (!plan) return [];
  const src = sourceText(state, plan.sourceIds);
  let text = '';
  let keys: string[] = [];

  const gen = await internalGenerate(
    [{ role: 'system', content: SUMMARY_SYS }, { role: 'user', content: src }],
    { temperature: 0.3, max_tokens: 700 },
    userId,
  );
  if (gen.ok && gen.value.trim()) {
    const body = gen.value.trim();
    const km = body.match(/KEYS:\s*(.+)\s*$/i);
    if (km) { keys = km[1]!.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12); text = body.slice(0, km.index).trim(); }
    else text = body;
  } else {
    // fallback: structural concatenation (loses nothing, just not prose)
    text = 'Chapter (turns ' + plan.covers[0] + '-' + plan.covers[1] + '): '
      + plan.sourceIds.map((id) => state.memories.find((m) => m.id === id)?.text).filter(Boolean).join(' ');
  }
  return chapterEvents(plan, text.slice(0, 2000), keys, state.turns || plan.covers[1], state.day || 0, nextSeq);
}

/** Compress as many windows as exist (manual "summarize all"). A manual run uses
 * a smaller minimum window so it works even on shorter chats, and keeps the most
 * recent few turns verbatim. */
export async function summarizeAll(state: ChronicleState, userId: string | null, append: (evs: VellumEvent[]) => Promise<ChronicleState>, windowSize = 4): Promise<number> {
  let rounds = 0;
  let cur = state;
  for (let i = 0; i < 50; i++) {
    const evs = await summarizeOnce(cur, userId, windowSize);
    if (!evs.length) break;
    cur = await append(evs);
    rounds++;
  }
  return rounds;
}

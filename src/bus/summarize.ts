import type { VellumEvent } from '../core/events.js';
import type { ChronicleState } from '../domain/types.js';
import { planChapter, chapterEvents, type CompressPlan } from '../domain/memory.js';
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
  'You are a story archivist compressing a roleplay excerpt into ONE dense, factual chapter-memory for long-term recall. '
  + 'Write 3-6 tight PAST-TENSE sentences in plain third person. Capture only what MATTERS: who was involved, where, key '
  + 'actions, decisions, revelations, promises, and what CHANGED by the end (relationships, stakes, knowledge). '
  + 'Pack facts; DROP atmosphere, sensory description, interiority, and metaphor - this is a record, not prose. '
  + 'No run-on sentences and no em-dash pile-ups: one clear idea per sentence, each able to stand alone. '
  + 'Use the real character names; never write {{user}}/{{char}}/"you". End with a strong factual close on what the chapter '
  + 'leaves changed - not a lyrical flourish. Then a final line: KEYS: <6-12 comma-separated names/places/topics>.\n'
  + 'BAD (wordy, atmospheric, run-on): "She descended from the wheelhouse unaided, refusing a servant\u2019s hand, and took in '
  + 'the courtyard\u2014soldiers, servants, the oppressive weight of a castle she was told would soon be her home." '
  + 'GOOD (tight, factual): "Cersei arrived at Harrenhal and was received in the courtyard. Daeron presented her a golden rose '
  + 'and bluntly called the castle hard to look at, surprising her into a near-laugh. Jaime embraced her warmly. By the end '
  + 'her guarded contempt had softened toward both brothers."';

/** Build the source text for the LLM from the memories being folded. With the
 * resolved persona/char names, replace {{user}}/{{char}}/you so the summary uses
 * real names (more exact, and consistent with the prose extractor). */
function sourceText(state: ChronicleState, ids: string[], names?: { user: string; char: string }): string {
  const byId = new Map(state.memories.map((m) => [m.id, m]));
  const fix = (t: string): string => {
    let s = t;
    if (names?.user) s = s.replace(/\{\{\s*user\s*\}\}/gi, names.user);
    if (names?.char) s = s.replace(/\{\{\s*char\s*\}\}/gi, names.char);
    return s;
  };
  return ids.map((id) => byId.get(id)).filter(Boolean).map((m) => `- (turn ${m!.turn}) ${fix(m!.text)}`).join('\n');
}

/**
 * Run one compression pass if a full window exists. Returns the events to
 * append (chapter record + source drops), or [] when nothing to compress.
 */
export async function summarizeOnce(state: ChronicleState, userId: string | null, windowSize = 8, names?: { user: string; char: string }): Promise<VellumEvent[]> {
  const plan = planChapter(state, windowSize);
  if (!plan) return [];
  const src = sourceText(state, plan.sourceIds, names);
  let text = '';
  let keys: string[] = [];

  const nameHint = (names && (names.user || names.char))
    ? `\nThe player is "${names.user || '(unnamed)'}"; the focal character is "${names.char || '(unnamed)'}". Use these real names; never write {{user}}/{{char}}/"you".`
    : '';
  const gen = await internalGenerate(
    [{ role: 'system', content: SUMMARY_SYS + nameHint }, { role: 'user', content: src }],
    { temperature: 0.2, max_tokens: 500 },
    userId,
    { reasoningOff: true },
  );
  if (gen.ok && gen.value.trim()) {
    const body = gen.value.trim();
    const km = body.match(/KEYS:\s*(.+)\s*$/i);
    if (km) { keys = km[1]!.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12); text = body.slice(0, km.index).trim(); }
    else text = body;
    text = text.replace(/```[a-z]*\n?|```/gi, '').trim();
  } else {
    // fallback (LLM unavailable): a COMPACT structural digest, not raw prose.
    // Take the first sentence of each source memory so it reads as a record and
    // never cuts mid-word. Better than dumping concatenated narrative.
    text = fallbackDigest(state, plan);
  }
  return chapterEvents(plan, text.slice(0, 1200), keys, state.turns || plan.covers[1], state.day || 0, nextSeq);
}

/** Sentence-bounded structural digest used when host generation is unavailable.
 * One lead sentence per source turn, trimmed — readable, never mid-word, and
 * kept within the chapter budget so the downstream slice can't cut it. */
function fallbackDigest(state: ChronicleState, plan: CompressPlan): string {
  const firstSentence = (t: string): string => {
    const s = t.replace(/\s+/g, ' ').trim();
    const m = s.match(/^.*?[.!?](?=\s|$)/);
    let out = (m ? m[0] : s);
    if (out.length > 180) out = out.slice(0, 177).replace(/\s+\S*$/, '') + '\u2026'; // word-boundary trim
    return out.trim();
  };
  const prefix = `Chapter (turns ${plan.covers[0]}\u2013${plan.covers[1]}): `;
  const BUDGET = 1180; // leave headroom under the 1200 store cap
  const out: string[] = [];
  let len = prefix.length;
  for (const id of plan.sourceIds) {
    const t = state.memories.find((m) => m.id === id)?.text;
    if (!t || !t.trim()) continue;
    const sentence = firstSentence(t);
    if (len + sentence.length + 1 > BUDGET) break; // stop on a whole sentence, never mid-word
    out.push(sentence); len += sentence.length + 1;
  }
  return prefix + out.join(' ');
}

/** Compress as many windows as exist (manual "summarize all"). A manual run uses
 * a smaller minimum window so it works even on shorter chats, and keeps the most
 * recent few turns verbatim. */
export async function summarizeAll(state: ChronicleState, userId: string | null, append: (evs: VellumEvent[]) => Promise<ChronicleState>, windowSize = 4, names?: { user: string; char: string }): Promise<number> {
  let rounds = 0;
  let cur = state;
  for (let i = 0; i < 50; i++) {
    const evs = await summarizeOnce(cur, userId, windowSize, names);
    if (!evs.length) break;
    cur = await append(evs);
    rounds++;
  }
  return rounds;
}

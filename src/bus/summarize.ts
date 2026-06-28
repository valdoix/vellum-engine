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

// The hybrid prompt produces THREE things in one pass:
//   DETAIL — a dense, structured chapter record for the VAULT (durable, keyword-
//            activated, read for deep continuity). Beat-by-beat, past tense.
//   GIST   — one lean sentence for the CHRONICLE (recall/traversal + hide-on-file).
//   KEYS   — concrete retrieval keywords (LumiBooks doctrine: scene-specific
//            nouns/places/objects/actions; NOT abstract themes or character names).
const SUMMARY_SYS =
  'You are a story archivist. Compress the roleplay excerpt into a CHAPTER record for long-term memory. '
  + 'Respond in EXACTLY this layout, nothing before or after:\n'
  + 'DETAIL:\n'
  + '<a dense beat-by-beat record in PAST TENSE, third person, using real names. Lead with the day/time if known. '
  + 'Capture every plot-relevant beat: who was involved and where, decisions, revelations, promises, conflicts, '
  + 'emotional turns, and the cause->effect logic that links them. Include what each character now KNOWS, FEELS, or '
  + 'has COMMITTED to, and any unresolved thread left open. Be comprehensive but compact: concrete nouns over '
  + 'adjectives, one idea per sentence, no purple prose, no [OOC]/meta. 6-12 sentences (or tight bullet lines). '
  + 'This replaces reading the full scene, so lose nothing that future continuity needs.>\n'
  + 'GIST:\n'
  + '<ONE past-tense sentence naming who + the single most important change this chapter leaves. A reader should grasp '
  + 'the chapter from this line alone.>\n'
  + 'KEYS:\n'
  + '<8-16 comma-separated retrieval keywords: CONCRETE and scene-specific — places, objects, proper nouns, distinctive '
  + 'actions, unique phrases a later scene might echo. One concept each. NOT abstract themes (love, trust, betrayal), '
  + 'NOT bare character names, NOT multi-fact phrases.>\n'
  + 'Use real character names throughout; never write {{user}}/{{char}}/"you".';

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
  let gist = '';
  let detail = '';
  let keys: string[] = [];

  const nameHint = (names && (names.user || names.char))
    ? `\nThe player is "${names.user || '(unnamed)'}"; the focal character is "${names.char || '(unnamed)'}". Use these real names; never write {{user}}/{{char}}/"you".`
    : '';
  const gen = await internalGenerate(
    [{ role: 'system', content: SUMMARY_SYS + nameHint }, { role: 'user', content: src }],
    { temperature: 0.2, max_tokens: 1400 },
    userId,
    { reasoningOff: true },
  );
  if (gen.ok && gen.value.trim()) {
    const parsed = parseSummary(gen.value);
    detail = parsed.detail;
    gist = parsed.gist;
    keys = parsed.keys;
  }
  // fallback (LLM unavailable, or parse produced nothing usable): a compact
  // structural digest as the gist; no detail → no vault entry worth writing.
  if (!gist && !detail) gist = fallbackDigest(state, plan);
  if (!gist) gist = capText(detail, 200); // detail came through but no explicit gist
  if (!detail) detail = gist; // fallback path: chronicle-only chapter

  return chapterEvents(
    plan,
    { gist: capText(gist, 280), detail: capText(detail, 2000), keys },
    state.turns || plan.covers[1], state.day || 0, nextSeq,
  );
}

/** Parse the DETAIL / GIST / KEYS layout. Tolerant of missing sections, leaked
 * thinking, and fences. Falls back to treating the whole body as detail. */
export function parseSummary(raw: string): { detail: string; gist: string; keys: string[] } {
  let body = raw.replace(/<think[\s\S]*?<\/think>/gi, '').replace(/```[a-z]*\n?|```/gi, '').trim();
  // a reasoning model can return a fragment whose first "sentence" is actually
  // the tail of a cut-off one ("ered and made anyway."). Drop a leading partial:
  // if the body starts lowercase / mid-word (no capital, not a label), trim to
  // the first real sentence start so we never surface a headless fragment.
  body = dropLeadingFragment(body);
  const section = (label: string): string => {
    const re = new RegExp(label + '\\s*:?\\s*\\n?([\\s\\S]*?)(?=\\n\\s*(?:DETAIL|GIST|KEYS)\\s*:|$)', 'i');
    const m = body.match(re);
    return m ? dropLeadingFragment(m[1]!.trim()) : '';
  };
  let detail = section('DETAIL');
  const gist = section('GIST');
  const keysRaw = section('KEYS');
  // if no labeled sections at all, treat the whole thing as detail
  if (!detail && !gist && !keysRaw) detail = body;
  const keys = keysRaw.split(/[,\n]/).map((s) => s.replace(/^[-*\u2022\s]+/, '').trim()).filter(Boolean).slice(0, 16);
  return { detail, gist, keys };
}

/** If text begins mid-word / mid-sentence (a streamed-output cut), drop the
 * leading fragment up to the first capitalized sentence start. Leaves clean
 * text (already starting with a capital or a label) untouched. */
function dropLeadingFragment(t: string): string {
  const s = t.trim();
  if (!s) return s;
  // starts with a label, a capital letter, a quote, or a bullet → clean
  if (/^(DETAIL|GIST|KEYS)\b/i.test(s) || /^["'\u201c\u2018\-\u2022*]/.test(s) || /^[A-Z0-9]/.test(s)) return s;
  // otherwise it's a headless fragment ("ered and made anyway. The lesson…") —
  // skip to the first sentence that begins with a capital letter.
  const m = s.match(/[.!?]\s+([A-Z][\s\S]*)$/);
  return m ? m[1]!.trim() : s;
}

/** Cap to a length at a sentence boundary if possible, else a word boundary —
 * never mid-word. Keeps a long LLM summary from being hard-sliced ugly. */
function capText(t: string, max: number): string {
  const s = t.trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (lastStop > max * 0.6) return cut.slice(0, lastStop + 1).trim();
  return cut.replace(/\s+\S*$/, '').trim() + '\u2026';
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

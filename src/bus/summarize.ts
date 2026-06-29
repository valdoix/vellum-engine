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
//   GIST   — a compact factual recap of what happened (1-3 sentences) for the
//            CHRONICLE (recall/traversal + hide-on-file). Events, not mood.
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
  + '<2-4 flowing past-tense sentences of plain prose that recap WHAT HAPPENED this chapter in chronological order, '
  + 'continuing smoothly from the STORY SO FAR if one is given (do not repeat it; carry it forward). State the concrete '
  + 'events and their outcome — who did what, what was decided/revealed/changed, where it left things. Write it as a '
  + 'connected paragraph a reader skims to follow the plot. HARD RULES: no bullet points or dashes, no labels, no '
  + 'meta-commentary ("the thread left open", "she now knows", "the unresolved thread", "this chapter"), no analysis of '
  + 'feelings or themes — only events. Every sentence is complete and ends with a full stop.>\n'
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
  // CONTINUITY: feed the recent chapter gists so this chapter flows on from them.
  // The model reads them as "story so far" and carries the thread forward rather
  // than restating — what makes the chronicle read as one continuous account.
  const soFar = storySoFar(state, plan);
  const userMsg = soFar ? `STORY SO FAR (for continuity — do not repeat):\n${soFar}\n\n---\nNEW TURNS TO SUMMARIZE:\n${src}` : src;
  const gen = await internalGenerate(
    [{ role: 'system', content: SUMMARY_SYS + nameHint }, { role: 'user', content: userMsg }],
    { temperature: 0.2, max_tokens: 2000 },
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
    { gist: capText(cleanGist(gist), 600), detail: capText(detail, 2400), keys },
    state.turns || plan.covers[1], state.day || 0, nextSeq,
  );
}

/** The most recent chapter/arc gists BEFORE this window, oldest→newest, as the
 * continuity preamble. Capped so it stays a lightweight thread, not the whole
 * history (the vault holds the deep record). */
function storySoFar(state: ChronicleState, plan: CompressPlan): string {
  const priors = state.memories
    .filter((m) => (m.tier === 'chapter' || m.tier === 'arc') && (m.covers ? m.covers[1] : m.turn) <= plan.covers[0])
    .sort((a, b) => (a.covers ? a.covers[1] : a.turn) - (b.covers ? b.covers[1] : b.turn));
  if (!priors.length) return '';
  const recent = priors.slice(-3); // last few chapters give enough thread
  return recent.map((m) => `- ${m.text}`).join('\n');
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

// Meta-commentary openers the model slips into the gist despite the prompt —
// "the thread left open: …", "she now knows …", "unresolved: …". We cut the
// whole sentence that leads with one (it's analysis, not an event).
const META_SENTENCE = /^(the (unresolved )?thread( left open)?|unresolved|left (open|hanging)|what remains|the open beat|this chapter|the chapter|she now knows|he now knows|they now know|the merger|the lesson)\b[^.!?]*[.!?]\s*/i;

/**
 * Sanitize a GIST into clean flowing prose for the chronicle: drop a leading
 * cut-off fragment, strip bullet/dash list markers and turn the list into
 * sentences, remove meta-commentary sentences, and collapse whitespace. This is
 * the deterministic backstop for when the model ignores the "no bullets/meta"
 * rule (the symptom: "- She now knows…", "The thread left open: …").
 */
export function cleanGist(raw: string): string {
  let s = dropLeadingFragment(String(raw || '').trim());
  // a leading bullet/dash on the WHOLE gist, or list items: convert "- foo\n- bar"
  // into "foo. bar." by stripping markers; join lines into one paragraph.
  s = s
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*[-*\u2022\u2013\u2014]\s+/, '').trim()) // drop list markers
    .filter(Boolean)
    .map((line) => (/[.!?]["')\u201d]?$/.test(line) ? line : line + '.')) // ensure each ends as a sentence
    .join(' ');
  // drop meta-commentary sentences anywhere (iterate: there can be several)
  for (let i = 0; i < 6; i++) {
    const sentences = s.split(/(?<=[.!?])\s+/);
    const kept = sentences.filter((x) => x.trim() && !META_SENTENCE.test(x.trim()));
    const next = kept.join(' ').trim();
    if (next === s) break;
    s = next;
  }
  // a leftover inline "...: " analysis lead-in at the very start ("Outcome: …")
  s = s.replace(/^[A-Z][a-z]+( [a-z]+){0,3}:\s+/, '');
  return s.replace(/\s{2,}/g, ' ').trim();
}

/** Cap to a length at a sentence boundary if possible, else a word boundary —
 * never mid-word. Keeps a long LLM summary from being hard-sliced ugly. A text
 * that already ends in terminal punctuation is returned whole when within range,
 * so a complete one-sentence gist never gains a spurious "…". */
function capText(t: string, max: number): string {
  const s = t.trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (lastStop > max * 0.5) return cut.slice(0, lastStop + 1).trim(); // whole sentence(s)
  // no usable sentence boundary → trim at a word and mark the elision
  return cut.replace(/\s+\S*$/, '').trim().replace(/[\s,;:.\u2014-]+$/, '') + '\u2026';
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
 * recent few turns verbatim. `onRound` fires after EACH window is appended so the
 * UI can show summaries appear one-by-one + a progress count. `total` is the
 * up-front estimate of windows to process. */
export async function summarizeAll(
  state: ChronicleState,
  userId: string | null,
  append: (evs: VellumEvent[]) => Promise<ChronicleState>,
  windowSize = 4,
  names?: { user: string; char: string },
  onRound?: (done: number, total: number) => Promise<void> | void,
): Promise<number> {
  let rounds = 0;
  let cur = state;
  const turnCount = cur.memories.filter((m) => m.tier === 'turn').length;
  const total = Math.max(1, Math.floor(turnCount / windowSize));
  for (let i = 0; i < 50; i++) {
    const evs = await summarizeOnce(cur, userId, windowSize, names);
    if (!evs.length) break;
    cur = await append(evs);
    rounds++;
    if (onRound) await onRound(rounds, Math.max(rounds, total));
  }
  return rounds;
}

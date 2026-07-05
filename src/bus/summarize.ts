import type { VellumEvent } from '../core/events.js';
import type { ChronicleState } from '../domain/types.js';
import { planChapter, chapterEvents, arcEvents, type CompressPlan } from '../domain/memory.js';
import { internalGenerate } from '../host/generation.js';
import { nextSeq } from '../core/ids.js';
import { DEFAULT_CFG, resolvePrompt, type SummarizerCfg } from '../domain/summarizer-config.js';

declare const spindle: any;

/** Rough token estimate (chars/4) — used only for the live usage toast, never
 * for budgeting. Good enough to show the user "how much it's using". */
export function approxTokens(chars: number): number { return Math.max(0, Math.ceil(chars / 4)); }

/** One compression result, with a token estimate for the progress toast. */
export interface SummaryResult { events: VellumEvent[]; tokens: number; }

/**
 * Auto + manual summarization. Compresses the oldest window of turn-tier
 * memories into ONE chapter memory that is detail-dense yet compact, then drops
 * the sources (still recall-able via the chapter, through the same hybrid
 * fuser). LLM-written when generation is available; falls back to a structural
 * concatenation so it never silently no-ops.
 */

// The hybrid prompt (DETAIL for the vault, GIST for the chronicle, KEYS for
// retrieval) now lives in domain/summarizer-config.ts so it can be shown,
// overridden by the user, and reset. resolvePrompt() returns the active text.

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
  return ids.map((id) => byId.get(id)).filter(Boolean).map((m) => {
    // for chapter/arc sources (an arc fold), feed the richer DETAIL; for turns, the text.
    const body = (m!.tier === 'chapter' || m!.tier === 'arc') ? (m!.detail || m!.text) : m!.text;
    const label = m!.covers ? `turns ${m!.covers[0]}\u2013${m!.covers[1]}` : `turn ${m!.turn}`;
    return `- (${label}) ${fix(body)}`;
  }).join('\n');
}

/**
 * Run one AUTO compression pass if a full window exists. Returns just the events
 * (back-compat). Token-aware callers use summarizeWindow / summarizeFromPlan.
 */
export async function summarizeOnce(state: ChronicleState, userId: string | null, windowSize = 8, names?: { user: string; char: string }, cfg: SummarizerCfg = DEFAULT_CFG): Promise<VellumEvent[]> {
  return (await summarizeWindow(state, userId, windowSize, names, cfg)).events;
}

/** Auto pass with the token estimate (for the live usage toast). */
export async function summarizeWindow(state: ChronicleState, userId: string | null, windowSize = 8, names?: { user: string; char: string }, cfg: SummarizerCfg = DEFAULT_CFG): Promise<SummaryResult> {
  const plan = planChapter(state, windowSize);
  if (!plan) return { events: [], tokens: 0 };
  return summarizeFromPlan(state, userId, plan, names, cfg, 'chapter');
}

/**
 * Compress an explicit plan (auto window OR a manual pick) into a chapter/arc.
 *
 * TWO-PASS pipeline:
 *   1. DETAIL+KEYS — write the dense vault record from the source turns/chapters.
 *   2. GIST — condense the finished DETAIL into the lean chronicle line.
 * The gist is a summary of the clean detail (not the raw turns), so the two
 * layers can never disagree, and each call gets full attention + budget for one
 * job. Falls back to deriving the gist from the detail if the 2nd call fails,
 * and to a structural digest if generation is unavailable.
 */
export async function summarizeFromPlan(
  state: ChronicleState,
  userId: string | null,
  plan: CompressPlan,
  names: { user: string; char: string } | undefined,
  cfg: SummarizerCfg = DEFAULT_CFG,
  kind: 'chapter' | 'arc' = 'chapter',
): Promise<SummaryResult> {
  const src = sourceText(state, plan.sourceIds, names);
  let detail = '';
  let keys: string[] = [];
  let gist = '';
  let tokens = 0;

  // --- pass 1: DETAIL + KEYS (the dense record) ---
  const detailSys = resolvePrompt(kind, cfg, names);
  const gen1 = await generateDetail(detailSys, src, cfg, userId);
  tokens += gen1.tokens;
  if (gen1.text) {
    const parsed = parseDetailKeys(gen1.text);
    detail = parsed.detail;
    keys = parsed.keys;
  }

  // WINDOW-SPLIT FALLBACK: if the full window came back empty (a reasoning model
  // that couldn't think + write the whole span within budget), retry on just the
  // FIRST HALF of the sources before surrendering to the structural digest. A
  // real chapter over fewer turns beats a first-sentence concatenation. Only the
  // first half is summarized here (the caller re-runs on the remainder next pass,
  // since those turns stay un-covered); the covers/sources are narrowed to match.
  if (!detail.trim() && plan.sourceIds.length >= 4) {
    const half = narrowPlan(plan, Math.ceil(plan.sourceIds.length / 2));
    if (half) {
      if (typeof spindle !== 'undefined') spindle.log?.warn?.(`[vellum_engine] summarize: full window empty; retrying on first ${half.sourceIds.length}/${plan.sourceIds.length} turns`);
      const halfSrc = sourceText(state, half.sourceIds, names);
      const gen1b = await generateDetail(detailSys, halfSrc, cfg, userId);
      tokens += gen1b.tokens;
      if (gen1b.text) {
        const parsed = parseDetailKeys(gen1b.text);
        detail = parsed.detail;
        keys = parsed.keys;
        plan = half; // the chapter now covers only the half we successfully summarized
      }
    }
  }

  // --- pass 2: GIST (condensed FROM the finished detail) ---
  if (detail.trim()) {
    const gistSys = resolvePrompt('gist', cfg, names);
    const soFar = storySoFar(state, plan); // continuity belongs on the gist call
    const gistUser = (soFar ? `STORY SO FAR (for continuity — do not repeat):\n${soFar}\n\n---\n` : '')
      + `RECORD TO CONDENSE:\n${detail}`;
    // a gist is a short paragraph — cap output tight to save tokens/latency.
    const gistBudget = Math.min(cfg.genMaxTokens, Math.max(256, Math.ceil(cfg.gistCap / 3)));
    const gen2 = await internalGenerate(
      [{ role: 'system', content: gistSys }, { role: 'user', content: gistUser }],
      { temperature: cfg.temperature, max_tokens: gistBudget },
      userId,
      { reasoningOff: true },
    );
    tokens += approxTokens(gistSys.length + gistUser.length + (gen2.ok ? gen2.value.length : 0));
    if (gen2.ok && gen2.value.trim()) gist = stripToProse(gen2.value);
  }

  // fallbacks: no detail at all (generation down) → structural digest as gist;
  // detail but the gist call failed → derive the gist from the detail.
  if (!gist && !detail) {
    // every generation attempt (full window + escalation + half-window) came back
    // empty — surface the first-sentence structural digest. Log the shape of the
    // failure so this is diagnosable, not a mystery "bad summary".
    if (typeof spindle !== 'undefined') spindle.log?.warn?.(`[vellum_engine] summarize: all generation attempts returned no detail (${kind}, ${plan.sourceIds.length} sources, ~${tokens} tok spent); using structural digest`);
    gist = fallbackDigest(state, plan, cfg.gistCap);
  }
  if (!gist && detail) gist = cleanGist(detail);
  if (!detail) detail = gist; // chronicle-only chapter (no vault body)

  // final guard: never surface a headless fragment as the gist.
  let finalGist = cleanGist(gist);
  if (!finalGist || finalGist.length < 24 || /^[a-z]/.test(finalGist)) {
    const fromDetail = cleanGist(detail);
    if (fromDetail.length >= 24 && /^[A-Z0-9"'\u201c]/.test(fromDetail)) finalGist = fromDetail;
  }

  const build = kind === 'arc' ? arcEvents : chapterEvents;
  const events = build(
    plan,
    { gist: capText(finalGist || gist, cfg.gistCap), detail: capText(detail, cfg.detailCap), keys },
    state.turns || plan.covers[1], state.day || 0, nextSeq,
  );
  return { events, tokens };
}

/**
 * Run the DETAIL+KEYS pass with an ESCALATING retry. The first attempt is
 * cheap: reasoning OFF at the configured budget. If it comes back empty — the
 * dominant failure on providers that IGNORE `reasoning: off`, where the whole
 * token budget is spent on hidden thinking and `content` is empty — the retry
 * is NOT identical: it (a) raises the output budget substantially so think+write
 * both fit, and (b) STOPS forcing reasoning off, so the answer is allowed to
 * land in the reasoning channel that extractGenContent already harvests. A
 * generous wall-clock timeout on each attempt prevents a stalled provider from
 * hanging the pass. Returns the cleaned text ('' when both attempts fail) and a
 * token estimate for the usage toast.
 */
async function generateDetail(sys: string, src: string, cfg: SummarizerCfg, userId: string | null): Promise<{ text: string; tokens: number }> {
  const msgs = [{ role: 'system' as const, content: sys }, { role: 'user' as const, content: src }];
  let tokens = 0;
  // attempt 1 — cheap: reasoning off, configured budget, 45s wall-clock.
  const a1 = await internalGenerate(msgs, { temperature: cfg.temperature, max_tokens: cfg.genMaxTokens }, userId, { reasoningOff: true, timeoutMs: 45000 });
  tokens += approxTokens(sys.length + src.length + (a1.ok ? a1.value.length : 0));
  if (a1.ok && a1.value.trim()) return { text: a1.value, tokens };
  // attempt 2 — ESCALATE: 3× budget (floored for reasoning models) AND allow the
  // model to reason, so a provider that ignores `off` can complete its thinking
  // and the answer surfaces via extractGenContent's reasoning-channel read.
  const escalated = Math.max(cfg.genMaxTokens * 3, 8000);
  if (typeof spindle !== 'undefined') spindle.log?.warn?.(`[vellum_engine] summarize: attempt 1 empty (${a1.ok ? 'no content/reasoning' : a1.error}); escalating to max_tokens=${escalated} with reasoning allowed`);
  const a2 = await internalGenerate(msgs, { temperature: cfg.temperature, max_tokens: escalated }, userId, { reasoningOff: false, timeoutMs: 60000 });
  tokens += approxTokens(a2.ok ? a2.value.length : 0);
  if (a2.ok && a2.value.trim()) return { text: a2.value, tokens };
  if (typeof spindle !== 'undefined') spindle.log?.warn?.(`[vellum_engine] summarize: attempt 2 also empty (${a2.ok ? 'no content/reasoning' : a2.error})`);
  return { text: '', tokens };
}

/** Narrow a plan to its first `n` sources (by turn order), recomputing covers.
 * Used by the window-split fallback so a chapter that only summarized part of
 * the window still records the correct span and drops only those turns. */
function narrowPlan(plan: CompressPlan, n: number): CompressPlan | null {
  if (n <= 0 || n >= plan.source.length) return null;
  const source = plan.source.slice().sort((a, b) => a.turn - b.turn).slice(0, n);
  if (!source.length) return null;
  return {
    sourceIds: source.map((s) => s.id),
    source,
    covers: [source[0]!.turn, source[source.length - 1]!.turn],
  };
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

/** Parse a DETAIL+KEYS response (the pass-1 output). Tolerant of a missing KEYS
 * section, leaked thinking, fences, and an unlabeled body (treated as detail). */
export function parseDetailKeys(raw: string): { detail: string; keys: string[] } {
  let body = raw.replace(/<think[\s\S]*?<\/think>/gi, '').replace(/```[a-z]*\n?|```/gi, '').trim();
  body = dropLeadingFragment(body);
  const section = (label: string): string => {
    const re = new RegExp(label + '\\s*:?\\s*\\n?([\\s\\S]*?)(?=\\n\\s*(?:DETAIL|GIST|KEYS)\\s*:|$)', 'i');
    const m = body.match(re);
    return m ? dropLeadingFragment(m[1]!.trim()) : '';
  };
  let detail = section('DETAIL');
  const keysRaw = section('KEYS');
  if (!detail && !keysRaw) detail = body; // unlabeled → whole body is the detail
  const keys = keysRaw.split(/[,\n]/).map((s) => s.replace(/^[-*\u2022\s]+/, '').trim()).filter(Boolean).slice(0, 16);
  return { detail, keys };
}

/** Strip a gist response down to clean prose: remove leaked thinking, fences,
 * and a stray "GIST:"/"RECAP:" label the model may prepend. The deeper
 * list/meta cleanup is done by cleanGist downstream. */
export function stripToProse(raw: string): string {
  return raw
    .replace(/<think[\s\S]*?<\/think>/gi, '')
    .replace(/```[a-z]*\n?|```/gi, '')
    .replace(/^\s*(?:GIST|RECAP|SUMMARY)\s*:?\s*/i, '')
    .trim();
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
  // a cut fragment with no later capitalized sentence starts mid-word
  // ("ered the quality…"); drop the partial first word so the rest survives.
  if (/^[a-z]/.test(s) && !/[.!?]\s+[A-Z]/.test(s)) s = s.replace(/^[a-z]+\b[\s,;:]*/, '').trim();
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
function fallbackDigest(state: ChronicleState, plan: CompressPlan, gistCap = 600): string {
  const firstSentence = (t: string): string => {
    const s = t.replace(/\s+/g, ' ').trim();
    const m = s.match(/^.*?[.!?](?=\s|$)/);
    let out = (m ? m[0] : s);
    if (out.length > 180) out = out.slice(0, 177).replace(/\s+\S*$/, '') + '\u2026'; // word-boundary trim
    return out.trim();
  };
  const prefix = `Chapter (turns ${plan.covers[0]}\u2013${plan.covers[1]}): `;
  const BUDGET = Math.max(1180, gistCap * 2); // headroom; scales with the configured gist cap
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
  onRound?: (done: number, total: number, tokensSoFar: number) => Promise<void> | void,
  cfg: SummarizerCfg = DEFAULT_CFG,
): Promise<{ rounds: number; tokens: number }> {
  let rounds = 0;
  let tokens = 0;
  let cur = state;
  const turnCount = cur.memories.filter((m) => m.tier === 'turn').length;
  const total = Math.max(1, Math.floor(turnCount / windowSize));
  for (let i = 0; i < 50; i++) {
    const r = await summarizeWindow(cur, userId, windowSize, names, cfg);
    if (!r.events.length) break;
    cur = await append(r.events);
    rounds++;
    tokens += r.tokens;
    if (onRound) await onRound(rounds, Math.max(rounds, total), tokens);
  }
  return { rounds, tokens };
}

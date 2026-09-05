import type { VellumEvent } from '../core/events.js';
import type { ChronicleState } from '../domain/types.js';
import { planChapter, chapterEvents, arcEvents, bookEvents, archiveCoverageHash, type CompressPlan } from '../domain/memory.js';
import { internalGenerate } from '../host/generation.js';
import { nextSeq } from '../core/ids.js';
import { DEFAULT_CFG, resolvePrompt, type SummarizerCfg } from '../domain/summarizer-config.js';

declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

/** Rough token estimate (chars/4) — used only for the live usage toast, never
 * for budgeting. Good enough to show the user "how much it's using". */
export function approxTokens(chars: number): number { return Math.max(0, Math.ceil(chars / 4)); }

/** One compression result, with a token estimate for the progress toast. */
export interface SummaryResult { events: VellumEvent[]; tokens: number; }

export type SummaryPhase = 'prepare' | 'detail' | 'gist' | 'archive';
export interface SummaryProgress {
  phase: SummaryPhase;
  status: 'start' | 'chunk' | 'reasoning' | 'retry' | 'done' | 'failed';
  kind: 'chapter' | 'arc' | 'book';
  sourceCount: number;
  covers: [number, number];
  attempt?: number;
  delta?: string;
  text?: string;
  tokens?: number;
  message?: string;
}
export interface SummaryRunOptions {
  onProgress?: (progress: SummaryProgress) => void;
  signal?: AbortSignal;
}

function progress(run: SummaryRunOptions | undefined, update: SummaryProgress): void {
  try { run?.onProgress?.(update); } catch { /* reporting must never affect archival */ }
}

/**
 * Auto + manual summarization. Compresses the oldest window of turn-tier
 * memories into ONE chapter memory that is detail-dense yet compact, then drops
 * the sources (still recall-able via the chapter, through the same hybrid
 * fuser). A failed generation leaves the source turns visible and unfolded;
 * VELLUM never hides prose behind a structural digest that may omit details.
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
    // Summary sources feed their richer DETAIL; raw turns and beats use text.
    const body = (m!.tier === 'chapter' || m!.tier === 'arc' || m!.tier === 'book') ? (m!.detail || m!.text) : m!.text;
    const label = m!.covers ? `turns ${m!.covers[0]}\u2013${m!.covers[1]}` : `turn ${m!.turn}`;
    return `- (${label}) ${fix(body)}`;
  }).join('\n');
}

/**
 * Run one AUTO compression pass if a full window exists. Returns just the events
 * (back-compat). Token-aware callers use summarizeWindow / summarizeFromPlan.
 */
export async function summarizeOnce(state: ChronicleState, userId: string | null, windowSize = 8, names?: { user: string; char: string }, cfg: SummarizerCfg = DEFAULT_CFG, run?: SummaryRunOptions): Promise<VellumEvent[]> {
  return (await summarizeWindow(state, userId, windowSize, names, cfg, run)).events;
}

/** Auto pass with the token estimate (for the live usage toast). */
export async function summarizeWindow(state: ChronicleState, userId: string | null, windowSize = 8, names?: { user: string; char: string }, cfg: SummarizerCfg = DEFAULT_CFG, run?: SummaryRunOptions): Promise<SummaryResult> {
  const plan = planChapter(state, windowSize);
  if (!plan) return { events: [], tokens: 0 };
  return summarizeFromPlan(state, userId, plan, names, cfg, 'chapter', run);
}

/**
 * Compress an explicit plan into a chapter, arc, or book.
 *
 * TWO-PASS pipeline:
 *   1. DETAIL+KEYS — write the dense vault record from the source turns/chapters.
 *   2. GIST — condense the finished DETAIL into the lean chronicle line.
 * The gist is a summary of the clean detail (not the raw turns), so the two
 * layers can never disagree, and each call gets full attention + budget for one
 * job. Falls back to deriving the gist from the detail if the 2nd call fails.
 * If DETAIL never lands, the operation safely returns no archive events.
 */
export async function summarizeFromPlan(
  state: ChronicleState,
  userId: string | null,
  plan: CompressPlan,
  names: { user: string; char: string } | undefined,
  cfg: SummarizerCfg = DEFAULT_CFG,
  kind: 'chapter' | 'arc' | 'book' = 'chapter',
  run?: SummaryRunOptions,
): Promise<SummaryResult> {
  const src = sourceText(state, plan.sourceIds, names);
  let detail = '';
  let keys: string[] = [];
  let gist = '';
  let tokens = 0;
  progress(run, { phase: 'prepare', status: 'start', kind, sourceCount: plan.sourceIds.length, covers: plan.covers, message: `Preparing ${plan.sourceIds.length} source records` });

  // --- pass 1: DETAIL + KEYS (the dense record) ---
  const detailSys = resolvePrompt(kind, cfg, names);
  progress(run, { phase: 'detail', status: 'start', kind, sourceCount: plan.sourceIds.length, covers: plan.covers, attempt: 1 });
  const gen1 = await generateDetail(detailSys, src, cfg, userId, run, kind, plan, plan.sourceIds.length < 4);
  tokens += gen1.tokens;
  if (gen1.text) {
    const parsed = parseDetailKeys(gen1.text);
    detail = parsed.detail;
    keys = parsed.keys;
  }

  // WINDOW-SPLIT CONTINUATION: if a large window cannot complete, repeatedly
  // halve it. Once the source group is smaller than four records the default
  // completion policy keeps retrying that manageable unit until it lands. The
  // caller then resumes on the remaining uncovered turns in its next round.
  while (!detail.trim() && plan.sourceIds.length >= 4 && !run?.signal?.aborted) {
    const half = narrowPlan(plan, Math.ceil(plan.sourceIds.length / 2));
    if (half) {
      if (typeof spindle !== 'undefined') spindle.log?.warn?.(`[vellum_engine] summarize: full window empty; retrying on first ${half.sourceIds.length}/${plan.sourceIds.length} turns`);
      const halfSrc = sourceText(state, half.sourceIds, names);
      progress(run, { phase: 'detail', status: 'retry', kind, sourceCount: half.sourceIds.length, covers: half.covers, attempt: 1, tokens, message: `Full window was incomplete; continuing with ${half.sourceIds.length} sources` });
      plan = half;
      const gen1b = await generateDetail(detailSys, halfSrc, cfg, userId, run, kind, plan, plan.sourceIds.length < 4);
      tokens += gen1b.tokens;
      if (gen1b.text) {
        const parsed = parseDetailKeys(gen1b.text);
        detail = parsed.detail;
        keys = parsed.keys;
      }
    } else break;
  }

  // --- pass 2: GIST (condensed FROM the finished detail) ---
  if (detail.trim()) {
    const gistSys = resolvePrompt('gist', cfg, names);
    const soFar = storySoFar(state, plan); // continuity belongs on the gist call
    const gistUser = (soFar ? `STORY SO FAR (for continuity — do not repeat):\n${soFar}\n\n---\n` : '')
      + `RECORD TO CONDENSE:\n${detail}`;
    // a gist is a short paragraph — cap output tight to save tokens/latency.
    const gistBudget = Math.min(cfg.genMaxTokens, Math.max(256, Math.ceil(cfg.gistCap / 3)));
    progress(run, { phase: 'detail', status: 'done', kind, sourceCount: plan.sourceIds.length, covers: plan.covers, tokens, text: detail + (keys.length ? `\n\nKEYS:\n${keys.join(', ')}` : '') });
    progress(run, { phase: 'gist', status: 'start', kind, sourceCount: plan.sourceIds.length, covers: plan.covers, attempt: 1, tokens });
    let gistAttempt = 0;
    while (!gist.trim() && !run?.signal?.aborted) {
      gistAttempt++;
      const gen2 = await internalGenerate(
        [{ role: 'system', content: gistSys }, { role: 'user', content: gistUser }],
        { temperature: cfg.temperature, max_tokens: gistBudget },
        userId,
        {
          reasoningOff: true,
          signal: run?.signal,
          onStream: run?.onProgress ? (update) => progress(run, {
            phase: 'gist', status: update.type === 'content' ? 'chunk' : 'reasoning', kind,
            sourceCount: plan.sourceIds.length, covers: plan.covers, attempt: gistAttempt,
            ...(update.type === 'content' ? { delta: update.token } : {}),
          }) : undefined,
        },
      );
      tokens += approxTokens(gistSys.length + gistUser.length + (gen2.ok ? gen2.value.length : 0));
      if (gen2.ok && gen2.value.trim()) gist = stripToProse(gen2.value);
      if (gist || !cfg.complete || terminalGenerationFailure(gen2) || run?.signal?.aborted) break;
      progress(run, { phase: 'gist', status: 'retry', kind, sourceCount: plan.sourceIds.length, covers: plan.covers, attempt: gistAttempt + 1, tokens, message: 'Gist was incomplete; retrying' });
      await retryPause(gistAttempt, run?.signal);
    }
  }

  // No dense record means no compression. The raw turn memories remain in
  // state, and hide-on-file receives no new coverage proof.
  if (!detail.trim() || run?.signal?.aborted) {
    if (typeof spindle !== 'undefined') spindle.log?.warn?.(`[vellum_engine] summarize: no complete detail returned (${kind}, ${plan.sourceIds.length} sources, ~${tokens} tok spent); source turns left visible and unfolded`);
    progress(run, { phase: 'detail', status: 'failed', kind, sourceCount: plan.sourceIds.length, covers: plan.covers, tokens, message: run?.signal?.aborted ? 'Cancelled; source turns left intact' : 'No complete detail; source turns left intact' });
    return { events: [], tokens };
  }
  if (!gist && detail) gist = cleanGist(detail);

  // final guard: never surface a headless fragment as the gist.
  let finalGist = cleanGist(gist);
  if (!finalGist || finalGist.length < 24 || /^[a-z]/.test(finalGist)) {
    const fromDetail = cleanGist(detail);
    if (fromDetail.length >= 24 && /^[A-Z0-9"'\u201c]/.test(fromDetail)) finalGist = fromDetail;
  }

  const build = kind === 'book' ? bookEvents : kind === 'arc' ? arcEvents : chapterEvents;
  progress(run, { phase: 'gist', status: 'done', kind, sourceCount: plan.sourceIds.length, covers: plan.covers, tokens, text: finalGist || gist });
  progress(run, { phase: 'archive', status: 'start', kind, sourceCount: plan.sourceIds.length, covers: plan.covers, tokens, message: 'Writing the verified archive record' });
  const events = build(
    plan,
    { gist: capText(finalGist || gist, cfg.gistCap), detail: capText(detail, cfg.detailCap), keys },
    plan.covers[1], state.day || 0, nextSeq,
  );
  progress(run, { phase: 'archive', status: 'done', kind, sourceCount: plan.sourceIds.length, covers: plan.covers, tokens });
  return { events, tokens };
}

function terminalGenerationFailure(result: { ok: boolean; error?: string }): boolean {
  return !result.ok && /no_generation_permission|no_generate_api/i.test(result.error ?? '');
}

/** Small retry pause so a transient provider failure cannot become a tight,
 * expensive loop. The default completion policy keeps trying until a complete
 * record is returned or the user cancels from the live window. */
async function retryPause(attempt: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  const ms = Math.min(2000, 250 * Math.max(1, attempt));
  await new Promise<void>((resolve) => {
    const finish = (): void => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(finish, ms);
    const abort = (): void => { clearTimeout(timer); finish(); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/**
 * Run the DETAIL+KEYS pass. VELLUM imposes no wall-clock timeout here. With the
 * default completion policy a narrowed/non-splittable window retries until it
 * completes or the user cancels; a large full window gets two chances before
 * being split so progress can continue over smaller source groups.
 */
async function generateDetail(
  sys: string,
  src: string,
  cfg: SummarizerCfg,
  userId: string | null,
  run: SummaryRunOptions | undefined,
  kind: 'chapter' | 'arc' | 'book',
  plan: CompressPlan,
  keepTrying: boolean,
): Promise<{ text: string; tokens: number }> {
  const msgs = [{ role: 'system' as const, content: sys }, { role: 'user' as const, content: src }];
  let tokens = 0;
  const maxAttempts = cfg.complete && keepTrying ? Number.POSITIVE_INFINITY : 2;
  let budget = cfg.genMaxTokens;
  for (let attempt = 1; attempt <= maxAttempts && !run?.signal?.aborted; attempt++) {
    if (attempt > 1) {
      progress(run, { phase: 'detail', status: 'retry', kind, sourceCount: plan.sourceIds.length, covers: plan.covers, attempt, tokens, message: `Detail incomplete; continuing with up to ${budget} tokens` });
      await retryPause(attempt - 1, run?.signal);
      if (run?.signal?.aborted) break;
    }
    const result = await internalGenerate(
      msgs,
      { temperature: cfg.temperature, max_tokens: budget },
      userId,
      {
        reasoningOff: attempt === 1,
        signal: run?.signal,
        onStream: run?.onProgress ? (update) => progress(run, {
          phase: 'detail', status: update.type === 'content' ? 'chunk' : 'reasoning', kind,
          sourceCount: plan.sourceIds.length, covers: plan.covers, attempt,
          ...(update.type === 'content' ? { delta: update.token } : {}),
        }) : undefined,
      },
    );
    tokens += approxTokens(sys.length + src.length + (result.ok ? result.value.length : 0));
    if (result.ok && result.value.trim()) return { text: result.value, tokens };
    if (terminalGenerationFailure(result) || run?.signal?.aborted) break;
    // If the provider rejects the configured ceiling, adapt downward while
    // retaining the user's value as the maximum for future attempts.
    if (!result.ok && /max.?tokens|context|limit|too large|maximum/i.test(result.error)) {
      budget = Math.max(500, Math.floor(budget * 0.75));
    }
    if (typeof spindle !== 'undefined') spindle.log?.warn?.(`[vellum_engine] summarize: detail attempt ${attempt} incomplete (${result.ok ? 'empty response' : result.error}); ${attempt < maxAttempts ? 'continuing' : 'trying a smaller source window'}`);
  }
  return { text: '', tokens };
}

/** Narrow a plan to its first `n` sources (by turn order), recomputing covers.
 * Used by the window-split fallback so a chapter that only summarized part of
 * the window still records the correct span and drops only those turns. */
function narrowPlan(plan: CompressPlan, n: number): CompressPlan | null {
  if (n <= 0 || n >= plan.source.length) return null;
  const source = plan.source.slice().sort((a, b) => (a.covers?.[0] ?? a.turn) - (b.covers?.[0] ?? b.turn)).slice(0, n);
  if (!source.length) return null;
  return {
    sourceIds: source.map((s) => s.id),
    source,
    covers: [
      Math.min(...source.map((s) => s.covers?.[0] ?? s.turn)),
      Math.max(...source.map((s) => s.covers?.[1] ?? s.turn)),
    ],
    coverageHash: archiveCoverageHash(source),
  };
}

/** The most recent chapter/arc/book gists before this window, oldest→newest, as the
 * continuity preamble. Capped so it stays a lightweight thread, not the whole
 * history (the vault holds the deep record). */
function storySoFar(state: ChronicleState, plan: CompressPlan): string {
  const priors = state.memories
    .filter((m) => (m.tier === 'chapter' || m.tier === 'arc' || m.tier === 'book') && (m.covers ? m.covers[1] : m.turn) <= plan.covers[0])
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
  run?: SummaryRunOptions,
): Promise<{ rounds: number; tokens: number }> {
  let rounds = 0;
  let tokens = 0;
  let cur = state;
  const turnCount = cur.memories.filter((m) => m.tier === 'turn').length;
  const total = Math.max(1, Math.floor(turnCount / windowSize));
  while (!run?.signal?.aborted) {
    const before = cur.memories.filter((m) => m.tier === 'turn').length;
    const r = await summarizeWindow(cur, userId, windowSize, names, cfg, run);
    if (!r.events.length) break;
    cur = await append(r.events);
    rounds++;
    tokens += r.tokens;
    if (onRound) await onRound(rounds, Math.max(rounds, total), tokens);
    // A storage adapter that returned an unchanged state must not create an
    // unbounded paid loop. This is a persistence failure, not a token limit.
    const after = cur.memories.filter((m) => m.tier === 'turn').length;
    if (after >= before) break;
  }
  return { rounds, tokens };
}

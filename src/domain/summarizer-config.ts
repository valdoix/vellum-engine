/**
 * Summarizer configuration — PURE (no I/O). The single source of truth for the
 * summarizer's token caps, windowing, automation, and PROMPTS. Persisted by the
 * backend as one per-chat JSON chat var (`vellum_summarizer`) and read on every
 * summarize path; the UI edits a copy and sends it back.
 *
 * Prompts: VELLUM produces a hybrid chapter record in ONE pass — a dense DETAIL
 * (vault), a lean GIST (chronicle), and KEYS (retrieval). Users may keep the
 * tuned defaults or supply their own system prompt per kind (chapter & arc).
 * The placeholders {{detailCap}} / {{gistCap}} / {{names}} are resolved at build
 * time so a custom prompt can reference the active caps and the real names.
 */

export type PromptKind = 'chapter' | 'arc';

export interface SummarizerCfg {
  // --- token caps (generous defaults) ---
  genMaxTokens: number;   // model OUTPUT budget per summary
  detailCap: number;      // vault DETAIL length cap (chars)
  gistCap: number;        // chronicle GIST length cap (chars)
  // --- windowing / automation ---
  autoWindow: number;     // turns folded per AUTO chapter
  minWindow: number;      // smallest manual/auto fold
  auto: boolean;          // auto-summarize on each turn when a window is ready
  temperature: number;    // summary determinism
  // --- prompts ---
  useCustom: boolean;     // false = built-in defaults; true = the custom prompts below
  chapterPrompt: string;  // custom CHAPTER system prompt (used only when useCustom)
  arcPrompt: string;      // custom ARC system prompt (used only when useCustom)
}

// Generous, sane-ceilinged defaults. (Previously hard-coded: gen 2000, detail
// 2400, gist 600, window 8.)
export const DEFAULT_CFG: SummarizerCfg = {
  genMaxTokens: 4000,
  detailCap: 6000,
  gistCap: 800,
  autoWindow: 8,
  minWindow: 3,
  auto: true,
  temperature: 0.2,
  useCustom: false,
  chapterPrompt: '',
  arcPrompt: '',
};

const RANGES = {
  genMaxTokens: [500, 32000],
  detailCap: [1000, 20000],
  gistCap: [200, 4000],
  autoWindow: [2, 50],
  minWindow: [2, 50],
  temperature: [0, 1],
} as const;

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
function num(v: unknown, def: number, lo: number, hi: number): number {
  const n = typeof v === 'number' && isFinite(v) ? v : Number(v);
  return isFinite(n) ? clamp(Math.round(n), lo, hi) : def;
}

/** Validate/clamp an untrusted config blob into a safe SummarizerCfg. Never
 * throws — a junk field falls back to its default. Custom prompts are length-
 * capped to keep a runaway paste out of the prompt. */
export function sanitizeSummarizerCfg(raw: unknown): SummarizerCfg {
  const o = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const d = DEFAULT_CFG;
  // minWindow must not exceed autoWindow (a fold can't need more than it takes)
  const autoWindow = num(o.autoWindow, d.autoWindow, ...RANGES.autoWindow);
  const minWindow = Math.min(num(o.minWindow, d.minWindow, ...RANGES.minWindow), autoWindow);
  const str = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 8000) : '');
  return {
    genMaxTokens: num(o.genMaxTokens, d.genMaxTokens, ...RANGES.genMaxTokens),
    detailCap: num(o.detailCap, d.detailCap, ...RANGES.detailCap),
    gistCap: num(o.gistCap, d.gistCap, ...RANGES.gistCap),
    autoWindow,
    minWindow,
    auto: o.auto === undefined ? d.auto : !!o.auto,
    temperature: num(o.temperature, d.temperature, ...RANGES.temperature),
    useCustom: !!o.useCustom,
    chapterPrompt: str(o.chapterPrompt),
    arcPrompt: str(o.arcPrompt),
  };
}

// --- the built-in default prompts (centralized so the UI can show + reset to
// them). The CHAPTER prompt is VELLUM's tuned hybrid DETAIL/GIST/KEYS archivist;
// the ARC prompt compresses several chapters into one broader span. ------------

export const DEFAULT_CHAPTER_PROMPT =
  'You are a story archivist. Compress the roleplay excerpt into a CHAPTER record for long-term memory. '
  + 'GROUND EVERYTHING in the provided turns: record ONLY events, decisions, and revelations that actually occur in the '
  + 'excerpt. Do NOT invent, infer motives not stated, embellish, or add events that did not happen. If something is '
  + 'ambiguous, omit it rather than guess. Prefer the exact who/what/where as written. '
  + 'Each turn is tagged: "[Player action]" is what the PLAYER (the user character) did/said; "[Scene]" is the narrated '
  + 'response covering everyone else. Attribute actions to the correct side \u2014 never credit the narration\'s deeds to the '
  + 'player or vice-versa. Do NOT echo the "[Player action]"/"[Scene]" tags in your output. '
  + 'Respond in EXACTLY this layout, nothing before or after:\n'
  + 'DETAIL:\n'
  + '<a dense beat-by-beat record in PAST TENSE, third person, using real names. Lead with the day/time if known. '
  + 'Capture every plot-relevant beat: who was involved and where, decisions, revelations, promises, conflicts, '
  + 'emotional turns, and the cause->effect logic that links them. Include what each character now KNOWS, FEELS, or '
  + 'has COMMITTED to, and any unresolved thread left open. Be comprehensive but compact: concrete nouns over '
  + 'adjectives, one idea per sentence, no purple prose, no [OOC]/meta. Aim for up to ~{{detailWords}} words. '
  + 'This replaces reading the full scene, so lose nothing that future continuity needs.>\n'
  + 'GIST:\n'
  + '<2-4 flowing past-tense sentences of plain prose that recap WHAT HAPPENED this chapter in chronological order, '
  + 'continuing smoothly from the STORY SO FAR if one is given (do not repeat it; carry it forward). State the concrete '
  + 'events and their outcome \u2014 who did what, what was decided/revealed/changed, where it left things. Write it as a '
  + 'connected paragraph a reader skims to follow the plot. HARD RULES: no bullet points or dashes, no labels, no '
  + 'meta-commentary ("the thread left open", "she now knows", "the unresolved thread", "this chapter"), no analysis of '
  + 'feelings or themes \u2014 only events. Every sentence is complete and ends with a full stop.>\n'
  + 'KEYS:\n'
  + '<8-16 comma-separated retrieval keywords: CONCRETE and scene-specific \u2014 places, objects, proper nouns, distinctive '
  + 'actions, unique phrases a later scene might echo. One concept each. NOT abstract themes (love, trust, betrayal), '
  + 'NOT bare character names, NOT multi-fact phrases.>\n'
  + 'Use real character names throughout; never write {{user}}/{{char}}/"you".';

export const DEFAULT_ARC_PROMPT =
  'You are a story archivist consolidating several CHAPTER records into ONE broader ARC covering a long span of the '
  + 'story. GROUND EVERYTHING in the provided chapters: keep only the load-bearing throughline \u2014 the decisions, '
  + 'revelations, relationship shifts, and consequences that still matter going forward. Aggressively drop incidental '
  + 'detail; an arc is the shape of the story, not its every beat. Do NOT invent or embellish. '
  + 'Respond in EXACTLY this layout, nothing before or after:\n'
  + 'DETAIL:\n'
  + '<a compact past-tense, third-person account of the arc using real names: the major movements in order, what '
  + 'changed and why, and the state things are left in. Up to ~{{detailWords}} words; concrete over abstract, '
  + 'one idea per sentence, no meta.>\n'
  + 'GIST:\n'
  + '<2-3 flowing past-tense sentences naming the arc\'s throughline and outcome \u2014 events only, no analysis, no '
  + 'labels, each sentence ending in a full stop.>\n'
  + 'KEYS:\n'
  + '<8-16 comma-separated concrete retrieval keywords; one concept each; no abstract themes, no bare names.>\n'
  + 'Use real character names throughout; never write {{user}}/{{char}}/"you".';

/** Resolve the SYSTEM prompt for a summary kind: the custom one when enabled and
 * non-empty, else the built-in default. Placeholders are then substituted:
 *   {{detailCap}}  -> the detail char cap (number)
 *   {{detailWords}}-> ~detailCap/6 (a rough word budget)
 *   {{gistCap}}    -> the gist char cap
 *   {{names}}      -> a one-line "player X / focal Y" hint (or '')
 * Unknown placeholders are left untouched. */
export function resolvePrompt(kind: PromptKind, cfg: SummarizerCfg, names?: { user: string; char: string }): string {
  const custom = kind === 'arc' ? cfg.arcPrompt : cfg.chapterPrompt;
  const base = (cfg.useCustom && custom.trim()) ? custom : (kind === 'arc' ? DEFAULT_ARC_PROMPT : DEFAULT_CHAPTER_PROMPT);
  const nameHint = (names && (names.user || names.char))
    ? `The player is "${names.user || '(unnamed)'}"; the focal character is "${names.char || '(unnamed)'}". Use these real names; never write {{user}}/{{char}}/"you".`
    : '';
  return base
    .replace(/\{\{\s*detailCap\s*\}\}/g, String(cfg.detailCap))
    .replace(/\{\{\s*detailWords\s*\}\}/g, String(Math.round(cfg.detailCap / 6)))
    .replace(/\{\{\s*gistCap\s*\}\}/g, String(cfg.gistCap))
    .replace(/\{\{\s*names\s*\}\}/g, nameHint);
}

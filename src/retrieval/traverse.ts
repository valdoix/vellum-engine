import type { ChronicleState } from '../domain/types.js';
import type { InvertedIndex } from './invindex.js';
import { type Result } from '../core/result.js';

/**
 * Controller-guided traversal (variant A — one-shot structured selection).
 *
 * An opt-in alternate ranker: instead of pure lexical⊕embedding similarity, a
 * small/cheap LLM reads a compact scene summary + a bounded candidate frontier
 * and SELECTS which chronicle items the scene actually needs. Faithful to the
 * "reason over a tree of the chronicle" idea while staying single-call (no hop
 * loop) so it fits the synchronous interceptor path under a hard timeout.
 *
 * PURE except for the injected `callModel` — so the prompt build, JSON parse,
 * and selection validation are all unit-testable with a mock. The host text
 * call lives in `host/generation.ts`; this module never touches `spindle`.
 *
 * GUARDRAIL: candidates are RetrievableItems only (knowledge/secret/memory).
 * The structured authoritative block (cast/bonds) is never traversed.
 */

export interface TraversalPrompt { system: string; user: string }
/** Injected model call: prompt → raw text. Returns a Result so the caller can fall back. */
export type CallModel = (prompt: TraversalPrompt) => Promise<Result<string, string>>;

export interface TraversalTrace {
  scene: string;
  candidateIds: string[];
  selectedIds: string[];
}
export interface TraversalResult {
  ids: string[];
  trace: TraversalTrace;
}

const SYS =
  'You are a retrieval controller for a roleplay engine. Given the CURRENT SCENE and a numbered list of '
  + 'CANDIDATE chronicle facts, choose ONLY the candidates whose recall would help continue THIS scene '
  + 'truthfully and in continuity. Prefer facts about who is present, unresolved tension, and what just '
  + 'changed; ignore unrelated history. Output STRICT JSON only: {"ids":["<id>",...]} using the exact ids '
  + 'shown. Choose few, not many. Empty list is allowed.';

/** Compact, deterministic scene summary the controller reasons over. */
export function buildScene(state: ChronicleState): string {
  const nameOf = (id: string): string => state.cast[id]?.name ?? id;
  const present = (state.scene.present ?? []).map(nameOf);
  const loc = state.scene.location ? `Location: ${state.scene.location}.` : '';
  const tension = typeof state.scene.tension === 'number' ? ` Tension ${state.scene.tension}/10.` : '';
  const cast = present.length ? `Present: ${present.join(', ')}.` : 'Present: (none marked).';
  const threads = (state.threads ?? [])
    .filter((t) => !/resolv/i.test(t.status))
    .slice(-4)
    .map((t) => t.name);
  const open = threads.length ? ` Open threads: ${threads.join('; ')}.` : '';
  return `Turn ${state.turns || 0}. ${cast} ${loc}${tension}${open}`.trim();
}

/** Build the bounded candidate frontier from the lexical ranking (already scene-relevant). */
export function pickCandidates(index: InvertedIndex, lexIds: string[], max: number): Array<{ id: string; text: string }> {
  const out: Array<{ id: string; text: string }> = [];
  for (const id of lexIds) {
    const it = index.byId.get(id);
    if (!it) continue;
    out.push({ id, text: it.text.slice(0, 240) });
    if (out.length >= max) break;
  }
  return out;
}

/** Lenient JSON parse for the controller reply: {"ids":[...]} or a bare [...] array. */
export function parseSelection(text: string): string[] | null {
  const t = String(text || '').replace(/```[a-z]*\n?|```/gi, '').trim();
  const tryParse = (s: string): unknown => { try { return JSON.parse(s); } catch { return null; } };
  let v = tryParse(t);
  if (v == null) {
    const m = t.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) v = tryParse(m[0]);
  }
  if (Array.isArray(v)) return v.map(String);
  if (v && typeof v === 'object' && Array.isArray((v as { ids?: unknown }).ids)) {
    return ((v as { ids: unknown[] }).ids).map(String);
  }
  return null;
}

/**
 * Keep only ids that are real candidates, in the controller's chosen order,
 * deduped. Returns null when nothing valid survives → caller falls back.
 */
export function validateSelection(candidates: Array<{ id: string }>, chosen: string[] | null): string[] | null {
  if (!chosen) return null;
  const valid = new Set(candidates.map((c) => c.id));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of chosen) {
    if (valid.has(id) && !seen.has(id)) { out.push(id); seen.add(id); }
  }
  return out.length ? out : null;
}

export interface TraverseOpts { maxCandidates?: number }

/**
 * Run one controller selection over the lexical frontier. Returns null on any
 * failure (no candidates, model error, unparseable, empty/invalid selection) so
 * the caller transparently falls back to the deterministic ranking.
 */
export async function traverseRanked(
  index: InvertedIndex,
  state: ChronicleState,
  lexIds: string[],
  callModel: CallModel,
  opts: TraverseOpts = {},
): Promise<TraversalResult | null> {
  const max = opts.maxCandidates ?? 16;
  const candidates = pickCandidates(index, lexIds, max);
  if (!candidates.length) return null;
  const scene = buildScene(state);
  const list = candidates.map((c) => `${c.id}: ${c.text}`).join('\n');
  const res = await callModel({ system: SYS, user: `CURRENT SCENE:\n${scene}\n\nCANDIDATES:\n${list}` });
  if (!res.ok) return null;
  const ids = validateSelection(candidates, parseSelection(res.value));
  if (!ids) return null;
  return { ids, trace: { scene, candidateIds: candidates.map((c) => c.id), selectedIds: ids } };
}

import type { ChronicleState } from './types.js';

/**
 * Layer 3 — semantic thread/arc reconcile (pure mapping). A cheap controller LLM
 * looks at the open tracks and proposes merges of near-duplicates that the
 * deterministic Layer-2 matcher can't catch ("Jaime's Arrival" + "Jaime at
 * Harrenhal" — same ongoing thread, no shared significant token beyond "Jaime").
 *
 * This module is PURE: it builds the prompt and validates the model's JSON into
 * safe merge groups. The host call lives in the backend; tests inject the JSON.
 * GUARDRAILS: only names that actually exist are kept; self-merges and unknown
 * names are dropped; a group must reduce ≥2 distinct tracks to be worth emitting.
 */

export interface MergeGroup { into: string; from: string[] }

export const THREAD_MERGE_SYS =
  'You reconcile a roleplay\u2019s open PLOT THREADS. Given a numbered list of thread titles (with a short status), '
  + 'group ONLY the titles that name the SAME ongoing thread phrased differently (e.g. "Jaime\u2019s Arrival" and '
  + '"Jaime at Harrenhal"). NEVER merge threads that are genuinely distinct even if they share characters or a place. '
  + 'Output STRICT JSON only: {"merge":[{"into":"<the clearest existing title to keep>","from":["<duplicate title>",...]}]}. '
  + 'Use titles EXACTLY as given. `into` must be one of the listed titles. Omit groups with only one title. Empty merge array is fine.';

/** Render the numbered title list the controller reasons over. */
export function buildMergePrompt(titles: Array<{ name: string; status?: string }>): string {
  const list = titles.map((t, i) => `${i + 1}. ${t.name}${t.status && !/^(advance|new)$/i.test(t.status) ? ' \u2014 ' + t.status : ''}`).join('\n');
  return 'OPEN THREADS:\n' + list + '\n\nReturn the merge groups as JSON.';
}

/** Lenient JSON parse for the controller reply: {merge:[...]} or a bare [...]. */
export function parseMergeReply(text: string): MergeGroup[] | null {
  const t = String(text || '').replace(/```[a-z]*\n?|```/gi, '').trim();
  const tryParse = (s: string): unknown => { try { return JSON.parse(s); } catch { return null; } };
  let v = tryParse(t);
  if (v == null) { const m = t.match(/\{[\s\S]*\}|\[[\s\S]*\]/); if (m) v = tryParse(m[0]); }
  const arr = Array.isArray(v) ? v : (v && typeof v === 'object' && Array.isArray((v as { merge?: unknown }).merge) ? (v as { merge: unknown[] }).merge : null);
  if (!arr) return null;
  const out: MergeGroup[] = [];
  for (const g of arr) {
    if (!g || typeof g !== 'object') continue;
    const into = String((g as { into?: unknown }).into ?? '').trim();
    const from = Array.isArray((g as { from?: unknown }).from) ? ((g as { from: unknown[] }).from).map((x) => String(x).trim()).filter(Boolean) : [];
    if (into && from.length) out.push({ into, from });
  }
  return out;
}

/**
 * Validate proposed merges against the ACTUAL track names (case-insensitive):
 * `into` must exist; keep only `from` names that exist and differ from `into`;
 * drop groups that don't reduce ≥2 distinct tracks. Returns canonical-cased
 * groups ready to become thread.merge / arc.merge events.
 */
export function validateMerges(groups: MergeGroup[] | null, existingNames: string[]): MergeGroup[] {
  if (!groups) return [];
  const byLower = new Map(existingNames.map((n) => [n.toLowerCase(), n] as const));
  const out: MergeGroup[] = [];
  const consumed = new Set<string>(); // a track can only be merged once per sweep
  for (const g of groups) {
    const into = byLower.get(g.into.toLowerCase());
    if (!into || consumed.has(into.toLowerCase())) continue;
    const from: string[] = [];
    for (const f of g.from) {
      const real = byLower.get(f.toLowerCase());
      if (real && real.toLowerCase() !== into.toLowerCase() && !consumed.has(real.toLowerCase())) {
        from.push(real); consumed.add(real.toLowerCase());
      }
    }
    if (from.length) { consumed.add(into.toLowerCase()); out.push({ into, from }); }
  }
  return out;
}

/** Open (non-resolved) tracks of a kind, newest first — the merge candidates.
 * Carries `beats` (latest step) and the narrative-day anchor `lastDay` so callers
 * (the off-screen sim payload) can react to a thread's post-skip state, not just
 * its title/status. */
export function openTracks(state: ChronicleState, kind: 'threads' | 'arcs'): Array<{ id: string; name: string; status: string; lastTurn: number; beats: string[]; lastDay?: number }> {
  return state[kind]
    .filter((t) => !/resolv/i.test(t.status || ''))
    .sort((a, b) => (b.lastTurn || 0) - (a.lastTurn || 0))
    .map((t) => ({ id: t.id, name: t.name, status: t.status, lastTurn: t.lastTurn, beats: t.beats, ...(t.lastDay !== undefined ? { lastDay: t.lastDay } : {}) }));
}

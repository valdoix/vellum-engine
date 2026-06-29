import type { ChronicleState } from './types.js';

/**
 * Tidy Knowledge/Secrets — semantic reconcile (pure mapping), the knowledge/
 * secret sibling of thread-merge. A cheap controller LLM looks at one
 * character's facts (or secrets) and groups near-duplicates the deterministic
 * reducer dedup can't catch (different wording, no shared significant token).
 *
 * PURE: builds the prompt + validates the model's JSON into safe merge groups
 * (by ENTRY ID). The host call lives in the backend; tests inject the JSON.
 * Guardrails: only ids that exist are kept; self-merges + unknowns dropped; a
 * group must fold ≥2 distinct entries; an entry is consumed by at most one group.
 */

export interface FactMergeGroup { into: string; from: string[] }

export const FACT_MERGE_SYS =
  'You reconcile a roleplay\u2019s tracked KNOWLEDGE / SECRETS. You are given numbered entries, each "[id] text", '
  + 'all belonging to ONE character. Group ONLY entries that state the SAME fact phrased differently '
  + '(e.g. "in love with Daeron" and "is in love with Daeron and has not said the words yet"). '
  + 'NEVER merge entries that are genuinely different facts even if they share a name or topic. '
  + 'Output STRICT JSON only: {"merge":[{"into":"<id of the fullest/clearest entry to keep>","from":["<duplicate id>",...]}]}. '
  + 'Use ids EXACTLY as given. `into` must be one of the listed ids. Omit groups with only one id. Empty merge array is fine.';

/** Render the numbered "[id] text" list for one character's entries. */
export function buildFactMergePrompt(label: string, entries: Array<{ id: string; text: string }>): string {
  const list = entries.map((e, i) => `${i + 1}. [${e.id}] ${e.text}`).join('\n');
  return `${label}\n${list}\n\nReturn the merge groups as JSON.`;
}

/** Lenient JSON parse for the controller reply: {merge:[...]} or a bare [...]. */
export function parseFactMergeReply(text: string): FactMergeGroup[] | null {
  const t = String(text || '').replace(/```[a-z]*\n?|```/gi, '').trim();
  const tryParse = (s: string): unknown => { try { return JSON.parse(s); } catch { return null; } };
  let v = tryParse(t);
  if (v == null) { const m = t.match(/\{[\s\S]*\}|\[[\s\S]*\]/); if (m) v = tryParse(m[0]); }
  const arr = Array.isArray(v) ? v : (v && typeof v === 'object' && Array.isArray((v as { merge?: unknown }).merge) ? (v as { merge: unknown[] }).merge : null);
  if (!arr) return null;
  const out: FactMergeGroup[] = [];
  for (const g of arr) {
    if (!g || typeof g !== 'object') continue;
    const into = String((g as { into?: unknown }).into ?? '').trim();
    const from = Array.isArray((g as { from?: unknown }).from) ? ((g as { from: unknown[] }).from).map((x) => String(x).trim()).filter(Boolean) : [];
    if (into && from.length) out.push({ into, from });
  }
  return out;
}

/** Validate proposed merges against the ACTUAL entry ids: `into` must exist;
 * keep only `from` ids that exist and differ; each id consumed once. */
export function validateFactMerges(groups: FactMergeGroup[] | null, existingIds: string[]): FactMergeGroup[] {
  if (!groups) return [];
  const known = new Set(existingIds);
  const out: FactMergeGroup[] = [];
  const consumed = new Set<string>();
  for (const g of groups) {
    if (!known.has(g.into) || consumed.has(g.into)) continue;
    const from: string[] = [];
    for (const f of g.from) if (known.has(f) && f !== g.into && !consumed.has(f)) { from.push(f); consumed.add(f); }
    if (from.length) { consumed.add(g.into); out.push({ into: g.into, from }); }
  }
  return out;
}

/** Group a character's knowledge/secrets by holder, returning per-holder entry
 * lists with ≥2 entries (the only ones worth reconciling). */
export function mergeCandidates(state: ChronicleState, kind: 'knowledge' | 'secrets'): Array<{ key: string; label: string; entries: Array<{ id: string; text: string }> }> {
  const byHolder = new Map<string, Array<{ id: string; text: string }>>();
  if (kind === 'knowledge') {
    for (const k of state.knowledge) (byHolder.get(k.who) ?? byHolder.set(k.who, []).get(k.who)!).push({ id: k.id, text: k.fact });
  } else {
    for (const s of state.secrets) if (!s.revealed) (byHolder.get(s.keeper) ?? byHolder.set(s.keeper, []).get(s.keeper)!).push({ id: s.id, text: s.text });
  }
  const out: Array<{ key: string; label: string; entries: Array<{ id: string; text: string }> }> = [];
  for (const [holder, entries] of byHolder) {
    if (entries.length < 2) continue;
    const name = state.cast[holder]?.name ?? holder;
    out.push({ key: holder, label: `${kind === 'knowledge' ? 'KNOWLEDGE held by' : 'SECRETS kept by'} ${name}:`, entries });
  }
  return out;
}

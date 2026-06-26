import type { ChronicleState } from './types.js';
import { catsOf } from './category-util.js';
import { tokenSet } from '../retrieval/tokenize.js';

/**
 * Vault intelligence (Phase 3) — PURE, tested. The backend supplies the current
 * state + the existing Vault entries (their links/keywords/extensions); these
 * functions decide what to suggest, how to wire recursion, and which scheduled
 * entries should be on right now. No host I/O here.
 */

export interface VaultEntryLite {
  id: string; key: string[]; content: string; link: string; category: string; disabled: boolean;
  reveal?: { day?: number; afterThread?: string }; // scheduled Events (from extensions)
}

// --- 1. scene-coverage suggestions --------------------------------------
export interface Suggestion { kind: 'cast' | 'relation'; id: string; label: string; reason: string }

/**
 * "Selene is present but has no Character entry." Suggest promotions for
 * present/active cast and current bonds that aren't yet covered by a linked
 * Vault entry. Capped + dismissible (dismissals handled by the caller).
 */
export function sceneSuggestions(s: ChronicleState, entries: VaultEntryLite[], dismissed: Set<string>): Suggestion[] {
  const linked = new Set(entries.map((e) => e.link).filter(Boolean));
  const out: Suggestion[] = [];
  const present = new Set(s.scene.present);
  // cast on stage or recurring, without a cast: entry
  const cast = Object.values(s.cast)
    .filter((c) => present.has(c.id) || c.status === 'present' || c.status === 'active')
    .sort((a, b) => (b.lastTurn || 0) - (a.lastTurn || 0));
  for (const c of cast) {
    const key = 'cast:' + c.id;
    if (linked.has(key) || dismissed.has(key)) continue;
    out.push({ kind: 'cast', id: c.id, label: c.name, reason: present.has(c.id) ? 'present, no lore entry' : 'recurring, no lore entry' });
  }
  // strong bonds among present cast without a relationship entry
  for (const r of s.relations) {
    if (!(present.has(r.a) || present.has(r.b))) continue;
    const intensity = Math.max(Math.abs(r.affection), Math.abs(r.trust));
    if (intensity < 40) continue; // only notable bonds
    const key = 'rel:' + r.a + '|' + r.b;
    if (linked.has(key) || dismissed.has(key)) continue;
    const an = s.cast[r.a]?.name ?? r.a, bn = s.cast[r.b]?.name ?? r.b;
    out.push({ kind: 'relation', id: r.a + '|' + r.b, label: `${an} \u2194 ${bn}`, reason: catsOf(r).join('+') + ' bond, no entry' });
  }
  return out.slice(0, 8);
}

// --- 2. recursion-seed keyword merge ------------------------------------
/**
 * When two bonded characters both have Vault entries, the host's recursion can
 * pull each in when the other is mentioned — IF each entry's content contains
 * the other's keyword. Compute the keyword additions per entry so the backend
 * can patch content. Returns entryId -> names to weave in (dedup'd vs content).
 */
export function recursionSeeds(s: ChronicleState, entries: VaultEntryLite[]): Map<string, string[]> {
  const byCastLink = new Map<string, VaultEntryLite>();
  for (const e of entries) if (e.link.startsWith('cast:')) byCastLink.set(e.link.slice(5), e);
  const seeds = new Map<string, string[]>();
  for (const r of s.relations) {
    const ea = byCastLink.get(r.a), eb = byCastLink.get(r.b);
    if (!ea || !eb) continue;
    const aName = s.cast[r.a]?.name, bName = s.cast[r.b]?.name;
    if (aName && !ea.content.includes(bName ?? '\0') && bName) push(seeds, ea.id, bName);
    if (bName && !eb.content.includes(aName ?? '\0') && aName) push(seeds, eb.id, aName);
  }
  return seeds;
}
function push(m: Map<string, string[]>, k: string, v: string): void { const a = m.get(k) ?? []; if (!a.includes(v)) a.push(v); m.set(k, a); }

// --- 3. scheduled Events evaluator --------------------------------------
export interface ScheduleChange { entryId: string; enable: boolean }

/**
 * Events-category entries can carry a reveal condition (day reached / thread
 * resolved). Return the host enable/disable flips needed so a scheduled entry
 * turns on exactly when the chronicle reaches its trigger — a time-driven
 * lorebook native WI can't do.
 */
export function evaluateSchedules(s: ChronicleState, entries: VaultEntryLite[]): ScheduleChange[] {
  const resolved = new Set(s.threads.filter((t) => /resolv/i.test(t.status)).map((t) => t.name.toLowerCase()));
  const out: ScheduleChange[] = [];
  for (const e of entries) {
    if (!e.reveal) continue;
    const dayOk = typeof e.reveal.day === 'number' ? (s.day >= e.reveal.day) : true;
    const threadOk = e.reveal.afterThread ? resolved.has(e.reveal.afterThread.toLowerCase()) : true;
    const shouldBeOn = dayOk && threadOk;
    if (shouldBeOn === e.disabled) out.push({ entryId: e.id, enable: shouldBeOn }); // state mismatch → flip
  }
  return out;
}

// --- 4. Tier-C auto-author (salience-gated drafts) ----------------------
export interface DraftProposal { kind: 'cast'; id: string; name: string; category: string; key: string[]; content: string }

/**
 * Propose draft entries for SALIENT cast members not yet covered by the Vault.
 * Salience = present, or active and seen across >= minTurns (a recurring face),
 * so we don't draft one-off mentions. Caller dedupes (dupeGuard) and lands them
 * as `pending` for accept/reject. Pure.
 */
export function autoAuthorDrafts(s: ChronicleState, covered: Set<string>, minTurns = 3): DraftProposal[] {
  const out: DraftProposal[] = [];
  for (const c of Object.values(s.cast)) {
    const link = 'cast:' + c.id;
    if (covered.has(link)) continue;
    const span = (c.lastTurn || 0) - (c.firstTurn || 0);
    const salient = c.status === 'present' || (c.status === 'active' && span >= minTurns);
    if (!salient) continue;
    const bits = [c.role, c.age, c.appearance].filter(Boolean).join('; ');
    const content = `${c.name}${bits ? ' � ' + bits + '.' : '.'}${c.note ? ' ' + c.note : ''}`.trim();
    out.push({ kind: 'cast', id: c.id, name: c.name, category: 'characters', key: [c.name, ...(c.aka ?? [])].filter(Boolean), content });
  }
  return out.slice(0, 6);
}

// --- 5. dupe / contradiction guard --------------------------------------
/**
 * Lexical Jaccard similarity between two texts (0..1). A cheap, embedding-free
 * guard that catches near-duplicate lore before creating a second entry. The
 * backend can swap/augment this with cosine over host embeddings when available;
 * the decision shape stays the same.
 */
export function textSimilarity(a: string, b: string): number {
  const sa = tokenSet(a), sb = tokenSet(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

export interface DupeMatch { entryId: string; score: number }
/** Find an existing entry too similar to `content` (>= threshold). null = unique. */
export function findDupe(content: string, entries: VaultEntryLite[], threshold = 0.55): DupeMatch | null {
  let best: DupeMatch | null = null;
  for (const e of entries) {
    const score = textSimilarity(content, e.content);
    if (score >= threshold && (!best || score > best.score)) best = { entryId: e.id, score };
  }
  return best;
}

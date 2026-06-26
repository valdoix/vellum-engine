import type { ChronicleState } from './types.js';
import { catsOf } from './category-util.js';

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

import type { ChronicleState, TraitEvent } from './types.js';

/**
 * Personality drift — PURE derived views over the trait ledger (self memory).
 * The ledger records emerge/fade/reverse/resurface/harden per character, turn-
 * stamped and cause-linked; these helpers turn it into (a) the current ARC of
 * each active trait, (b) dormant (faded) traits that can resurface, and (c) the
 * capped injection so the model writes characters true to where they've been.
 */

export interface TraitArc {
  trait: string;
  since: number;                 // turn it last emerged/resurfaced
  weight: number;                // turns held (age)
  momentum: 'rising' | 'stable' | 'hardened' | 'fading';
  history: TraitEvent[];         // this trait's events for this character, chronological
}

function forWho(state: ChronicleState, who: string): TraitEvent[] {
  return (state.traitHistory ?? []).filter((e) => e.who === who).sort((a, b) => a.turn - b.turn);
}
const norm = (x: string): string => x.trim().toLowerCase();

/** Traits currently ACTIVE for a character (last event isn't a fade), each with
 * its arc + momentum. */
export function traitArc(state: ChronicleState, who: string, nowTurn?: number): TraitArc[] {
  const evs = forWho(state, who);
  const turn = nowTurn ?? state.turns ?? (evs.length ? evs[evs.length - 1]!.turn : 0);
  const byTrait = new Map<string, TraitEvent[]>();
  for (const e of evs) { const k = norm(e.trait); (byTrait.get(k) ?? byTrait.set(k, []).get(k)!).push(e); }
  const out: TraitArc[] = [];
  for (const hist of byTrait.values()) {
    const last = hist[hist.length - 1]!;
    if (last.op === 'fade') continue; // dormant, not active
    const emergedAt = [...hist].reverse().find((e) => e.op === 'emerge' || e.op === 'resurface')?.turn ?? hist[0]!.turn;
    const weight = Math.max(0, turn - emergedAt);
    const hardened = hist.some((e) => e.op === 'harden');
    const recentlyChanged = turn - last.turn <= 3;
    const momentum: TraitArc['momentum'] = hardened ? 'hardened' : (recentlyChanged && (last.op === 'emerge' || last.op === 'resurface' || last.op === 'reverse')) ? 'rising' : weight > 25 ? 'hardened' : 'stable';
    out.push({ trait: last.trait, since: emergedAt, weight, momentum, history: hist });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

/** Faded traits — kept as dormant traces that can resurface under stress. */
export function dormantTraits(state: ChronicleState, who: string): string[] {
  const evs = forWho(state, who);
  const byTrait = new Map<string, TraitEvent[]>();
  for (const e of evs) { const k = norm(e.trait); (byTrait.get(k) ?? byTrait.set(k, []).get(k)!).push(e); }
  const out: string[] = [];
  for (const hist of byTrait.values()) if (hist[hist.length - 1]!.op === 'fade') out.push(hist[hist.length - 1]!.trait);
  return out;
}

/** One-line arc summary for a character ("was trusting; hardened to guarded (t58)"). */
export function arcLine(state: ChronicleState, who: string, name: string): string {
  const arcs = traitArc(state, who);
  if (!arcs.length && !dormantTraits(state, who).length) return '';
  const active = arcs.map((a) => a.trait + (a.momentum === 'hardened' ? ' (defining)' : a.momentum === 'rising' ? ' (rising)' : '')).join(', ');
  const dormant = dormantTraits(state, who);
  const past = dormant.length ? ` Once ${dormant.join(', ')} \u2014 now dormant, resurfaces only under real pressure.` : '';
  return `${name} \u2014 ${active}.${past}`;
}

/** The capped [PERSONALITY] injection for the PRESENT characters that have real
 * drift. Arc summaries only (not the full ledger) — the beat-spine discipline. */
export function driftInjection(state: ChronicleState, presentIds: readonly string[], cap = 6): string {
  const lines: string[] = [];
  for (const id of presentIds) {
    // only worth injecting once a character has actually drifted (>1 trait event
    // or a dormant trait) — a flat single-emerge adds nothing over the trait tag.
    const evs = forWho(state, id);
    const hasDrift = evs.some((e) => e.op !== 'emerge') || evs.length > 1;
    if (!hasDrift) continue;
    const name = state.cast[id]?.name ?? id;
    const line = arcLine(state, id, name);
    if (line) lines.push('- ' + line);
    if (lines.length >= cap) break;
  }
  if (!lines.length) return '';
  return '[PERSONALITY \u2014 write these characters true to where they have BEEN, not a flat label. Honor earned change; do not silently revert a hardened trait]\n' + lines.join('\n');
}

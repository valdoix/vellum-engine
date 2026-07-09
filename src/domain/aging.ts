import type { ChronicleState } from './types.js';
import { spanLabel } from './date-format.js';

/**
 * Living Clock (opt-in) — when a time-skip is detected, surface ADVISORY
 * injection lines for time-sensitive state so nothing frozen-in-time slips
 * silently across the gap. PURE: no state mutation, no I/O. Mirrors
 * offscreenInjection — it only advises the narrator; canon is never rewritten.
 *
 * Inputs: the derived state, the current day, and the skip span (days elapsed).
 * Output: a single injection block, or '' when nothing is stale enough to note.
 */

/** A skip must clear this many days before the living clock speaks (below it,
 * the ordinary NOW line + off-screen sim already cover the passage of time). */
export const LIVING_SKIP_MIN = 3;

export interface AgingOpts {
  /** max lines emitted (budget cap); default 8 */
  cap?: number;
}

export function agingInjection(state: ChronicleState, nowDay: number, skipDays: number, opts: AgingOpts = {}): string {
  if (!nowDay || nowDay <= 0) return '';
  if (!skipDays || skipDays < LIVING_SKIP_MIN) return '';
  const cap = opts.cap ?? 8;
  const nameOf = (id: string): string => state.cast[id]?.name ?? state.locations.find((l) => l.id === id)?.name ?? id;
  const lines: string[] = [];

  // 1) Conditions: a wound/ailment noted on a present character before the skip
  // should have progressed (healed, scarred, worsened) over the elapsed span.
  for (const d of state.scene.detail ?? []) {
    if (!d.condition) continue;
    const nm = state.cast[d.id]?.name ?? d.id;
    lines.push(`- ${nm}'s condition ("${d.condition}") was noted before ~${spanLabel(skipDays)} passed \u2014 it should have healed, scarred, or worsened by now, not stayed fresh.`);
    if (lines.length >= cap) break;
  }

  // 2) Plants: a seeded detail older than the skip is now well overdue — nudge
  // toward paying off or being deliberately let go, using its day age when known.
  const openPlants = (state.plants ?? []).filter((p) => p.status === 'planted');
  for (const p of openPlants) {
    if (lines.length >= cap) break;
    const agedDays = p.plantedDay !== undefined ? (nowDay - p.plantedDay) : skipDays;
    const span = spanLabel(agedDays);
    if (!span) continue;
    lines.push(`- Seeded ~${span} ago and still unresolved: "${p.what}"${p.subject ? ` (concerns ${nameOf(p.subject)})` : ''} \u2014 consider paying it off or letting it go; it can't stay untouched forever.`);
  }

  // 3) Distant defining memories: a landmark beat from long before now should be
  // recalled as DISTANT ("months ago"), not as if it just happened.
  const beats = (state.memories ?? [])
    .filter((m) => m.tier === 'beat' && typeof m.beatDay === 'number')
    .map((m) => ({ text: m.text, age: nowDay - (m.beatDay as number) }))
    .filter((m) => m.age > 0 && spanLabel(m.age))
    .sort((a, b) => b.age - a.age)
    .slice(0, 3);
  for (const b of beats) {
    if (lines.length >= cap) break;
    lines.push(`- ~${spanLabel(b.age)} ago: ${b.text} \u2014 treat this as distant, not recent.`);
  }

  // 4) Aging: a months/years skip makes numeric-aged characters measurably older
  // (advisory — never auto-edits age; the author confirms). Emitted once as a tail.
  if (lines.length < cap && skipDays >= 60) {
    const span = spanLabel(skipDays);
    const aged = Object.values(state.cast).filter((c) => c.status === 'present' || c.status === 'active').filter((c) => /\d/.test(String(c.age ?? '')));
    if (aged.length) {
      lines.push(`- ${span} have passed: characters are ~${span} older \u2014 reflect the passage of time in appearance and manner where it fits (ages are not auto-updated).`);
    }
  }

  if (!lines.length) return '';
  return '[LIVING CLOCK \u2014 time has passed off-page; reflect its effect on these time-sensitive details. Advisory, never a mandate.]\n' + lines.slice(0, cap).join('\n');
}

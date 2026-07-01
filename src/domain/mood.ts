import type { VellumEvent } from '../core/events.js';

/**
 * Mood recency — PURE. Transient emotional state is WEATHER (vs. drift's climate):
 * a grieving character shouldn't reset to chipper next turn. Derived from the
 * `scene.set` detail history in the event log (mood per present character), so
 * no new schema. Produces a short injection so the model carries a persistent
 * mood forward until something shifts it.
 */

interface MoodRun { who: string; mood: string; turns: number }

/** For each currently-present character, how long their current mood has held
 * (consecutive most-recent scene.set entries with the same mood). */
export function moodRuns(events: readonly VellumEvent[], presentIds: readonly string[]): MoodRun[] {
  const present = new Set(presentIds);
  // gather each character's mood timeline from scene.set details, in order
  const timeline = new Map<string, string[]>();
  for (const e of events) {
    if (e.kind !== 'scene.set') continue;
    const detail = (e as { detail?: Array<{ id: string; mood?: string }> }).detail ?? [];
    for (const d of detail) {
      if (!d.id || !d.mood) continue;
      (timeline.get(d.id) ?? timeline.set(d.id, []).get(d.id)!).push(d.mood.trim().toLowerCase());
    }
  }
  const runs: MoodRun[] = [];
  for (const id of present) {
    const series = timeline.get(id);
    if (!series?.length) continue;
    const cur = series[series.length - 1]!;
    let run = 0;
    for (let i = series.length - 1; i >= 0 && series[i] === cur; i--) run++;
    if (run >= 2) runs.push({ who: id, mood: cur, turns: run }); // only surface a mood that has PERSISTED
  }
  return runs;
}

/** Injection: persistent moods for present characters ("Cersei has been grieving
 * for 3 turns; it hasn't lifted"). Empty when nothing has held. */
export function moodInjection(events: readonly VellumEvent[], presentIds: readonly string[], nameOf: (id: string) => string, cap = 5): string {
  const runs = moodRuns(events, presentIds).sort((a, b) => b.turns - a.turns).slice(0, cap);
  if (!runs.length) return '';
  const lines = runs.map((r) => `- ${nameOf(r.who)} has been ${r.mood} for ${r.turns} turns; carry it forward until something in the scene genuinely shifts it.`);
  return '[MOOD \u2014 transient emotional weather (not a permanent trait). Do not reset these without cause]\n' + lines.join('\n');
}

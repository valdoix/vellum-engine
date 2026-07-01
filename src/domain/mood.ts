import type { VellumEvent } from '../core/events.js';

/**
 * Mood recency — PURE. Transient emotional state is WEATHER (vs. drift's climate):
 * a grieving character shouldn't reset to chipper next turn. Derived from the
 * `scene.set` detail history in the event log (mood per present character), so
 * no new schema. Produces a short injection so the model carries a persistent
 * mood forward until something shifts it.
 */

interface MoodRun { who: string; mood: string; turns: number }

/**
 * INCREMENTAL mood timeline cache. moodRuns() previously re-scanned the ENTIRE
 * event log every turn (O(total events), unbounded) on the synchronous
 * interceptor path. Here we keep each chat's per-character mood series and only
 * fold the NEW scene.set events appended since the last call, keyed on the
 * monotonic log version. Output is byte-identical to a full rescan.
 */
interface MoodTimeline { version: number; consumed: number; series: Map<string, string[]> }
const _timeline = new Map<string, MoodTimeline>();

/** Drop a chat's cached timeline (call when the log is truncated/rebuilt). */
export function invalidateMood(chatId?: string): void {
  if (chatId) _timeline.delete(chatId);
  else _timeline.clear();
}

/** Fold any scene.set events after `consumed` into the per-character series. */
function foldTimeline(series: Map<string, string[]>, events: readonly VellumEvent[], from: number): void {
  for (let i = from; i < events.length; i++) {
    const e = events[i]!;
    if (e.kind !== 'scene.set') continue;
    const detail = (e as { detail?: Array<{ id: string; mood?: string }> }).detail ?? [];
    for (const d of detail) {
      if (!d.id || !d.mood) continue;
      let arr = series.get(d.id);
      if (!arr) { arr = []; series.set(d.id, arr); }
      arr.push(d.mood.trim().toLowerCase());
    }
  }
}

/** Get (build or incrementally extend) the cached mood timeline for a chat. */
function timelineFor(chatId: string, events: readonly VellumEvent[], version: number): Map<string, string[]> {
  const cached = _timeline.get(chatId);
  if (cached && cached.version === version) return cached.series;
  // reuse the existing series and fold only the new tail when the log GREW;
  // otherwise (truncate/rebuild/first-run) rebuild from scratch.
  if (cached && events.length >= cached.consumed) {
    foldTimeline(cached.series, events, cached.consumed);
    cached.consumed = events.length;
    cached.version = version;
    return cached.series;
  }
  const series = new Map<string, string[]>();
  foldTimeline(series, events, 0);
  _timeline.set(chatId, { version, consumed: events.length, series });
  return series;
}

/** Compute current mood runs from a prebuilt per-character series. */
function runsFrom(series: Map<string, string[]>, presentIds: readonly string[]): MoodRun[] {
  const runs: MoodRun[] = [];
  for (const id of new Set(presentIds)) {
    const s = series.get(id);
    if (!s?.length) continue;
    const cur = s[s.length - 1]!;
    let run = 0;
    for (let i = s.length - 1; i >= 0 && s[i] === cur; i--) run++;
    if (run >= 2) runs.push({ who: id, mood: cur, turns: run }); // only surface a mood that has PERSISTED
  }
  return runs;
}

/** For each currently-present character, how long their current mood has held
 * (consecutive most-recent scene.set entries with the same mood). */
export function moodRuns(events: readonly VellumEvent[], presentIds: readonly string[]): MoodRun[] {
  const series = new Map<string, string[]>();
  foldTimeline(series, events, 0);
  return runsFrom(series, presentIds);
}

/** Injection using the INCREMENTAL cache (interceptor hot path). Identical
 * output to moodInjection(), but the timeline is extended, not re-scanned. */
export function moodInjectionCached(chatId: string, events: readonly VellumEvent[], version: number, presentIds: readonly string[], nameOf: (id: string) => string, cap = 5): string {
  const series = timelineFor(chatId, events, version);
  return renderRuns(runsFrom(series, presentIds), nameOf, cap);
}

/** Injection: persistent moods for present characters ("Cersei has been grieving
 * for 3 turns; it hasn't lifted"). Empty when nothing has held. */
export function moodInjection(events: readonly VellumEvent[], presentIds: readonly string[], nameOf: (id: string) => string, cap = 5): string {
  return renderRuns(moodRuns(events, presentIds), nameOf, cap);
}

/** Shared renderer: top-N persistent moods → the injection block. */
function renderRuns(allRuns: MoodRun[], nameOf: (id: string) => string, cap: number): string {
  const runs = allRuns.sort((a, b) => b.turns - a.turns).slice(0, cap);
  if (!runs.length) return '';
  const lines = runs.map((r) => `- ${nameOf(r.who)} has been ${r.mood} for ${r.turns} turns; carry it forward until something in the scene genuinely shifts it.`);
  return '[MOOD \u2014 transient emotional weather (not a permanent trait). Do not reset these without cause]\n' + lines.join('\n');
}

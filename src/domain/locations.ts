import type { ChronicleState, Location } from './types.js';

/**
 * Locations gazetteer — PURE helpers. Locations are auto-collected from visited
 * scenes (`auto:true`) or user-pinned; the injector hands the model the canonical
 * names so it reuses them instead of inventing or renaming places. Capped +
 * recency-ordered so the block stays a light skeleton (the beat-spine lesson).
 */

/** Most-recently-seen first, capped. User-pinned (auto !== true) always kept. */
export function injectableLocations(state: ChronicleState, cap = 12): Location[] {
  const list = (state.locations ?? []).slice();
  if (list.length <= cap) return list.sort((a, b) => b.lastTurn - a.lastTurn);
  const pinned = list.filter((l) => l.auto !== true);
  const auto = list.filter((l) => l.auto === true).sort((a, b) => b.lastTurn - a.lastTurn);
  const room = Math.max(0, cap - pinned.length);
  return [...pinned, ...auto.slice(0, room)].sort((a, b) => b.lastTurn - a.lastTurn);
}

/** The injected block, or '' when there are no locations. */
export function locationList(state: ChronicleState, cap = 12): string {
  const locs = injectableLocations(state, cap);
  if (!locs.length) return '';
  const lines = locs.map((l) => '- ' + l.name + (l.note ? ' \u2014 ' + l.note : ''));
  return '[LOCATIONS \u2014 established places in this story. Use these exact names; do not invent a duplicate or rename one. Introduce a NEW place only when the scene genuinely goes somewhere new]\n' + lines.join('\n');
}

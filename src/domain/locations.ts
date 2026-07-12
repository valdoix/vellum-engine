import type { ChronicleState, Location } from './types.js';

/**
 * Locations gazetteer — PURE helpers. Locations are model-collected from visited
 * scenes (`source:'auto'`) or user-made; each is either PINNED (always injected)
 * or recency-keyed (injected when fresh / when you're in or near it). The injector
 * hands the model the canonical names so it reuses them instead of inventing or
 * renaming places. Capped + recency-ordered so the block stays a light skeleton.
 */

/**
 * Infer a containing location for a freshly-named place from TEXT alone (no LLM):
 * when the new place's name contains an existing location's name as a distinct
 * word ("Harrenhal study", "the Study, Harrenhal"), that existing location is the
 * parent. Returns the parent's id, or '' when nothing matches (→ stays a root).
 *
 * Guardrails against false positives:
 *  - never parent a place to itself (same normalized name)
 *  - the parent name must appear on a word boundary, not as a substring ("Kings
 *    Landing" must not match inside "Kingslanding Bakery" by accident — the
 *    boundary check handles the common cases)
 *  - longest match wins (prefer "Old Harrenhal" over "Harrenhal" when both exist)
 */
export function inferLocationParent(newName: string, existing: readonly Location[]): string {
  const hay = ' ' + newName.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  const self = newName.trim().toLowerCase();
  let best = ''; let bestLen = 0;
  for (const l of existing) {
    const pn = l.name.trim().toLowerCase();
    if (!pn || pn === self) continue; // a place never contains itself
    const needle = ' ' + pn.replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
    if (needle.trim() && hay.includes(needle) && pn.length > bestLen) { best = l.id; bestLen = pn.length; }
  }
  return best;
}

/** Most-recently-seen first, capped. PINNED places are always kept (always
 * injected); the rest are recency-keyed and fill the remaining room. */
export function injectableLocations(state: ChronicleState, cap = 12): Location[] {
  const list = (state.locations ?? []).slice();
  if (list.length <= cap) return list.sort((a, b) => b.lastTurn - a.lastTurn);
  const pinned = list.filter((l) => l.pinned === true);
  const rest = list.filter((l) => l.pinned !== true).sort((a, b) => b.lastTurn - a.lastTurn);
  const room = Math.max(0, cap - pinned.length);
  return [...pinned, ...rest.slice(0, room)].sort((a, b) => b.lastTurn - a.lastTurn);
}

/** The known sub-places contained by the current scene's location, so they
 * RESURFACE on re-entry even if they've gone stale and dropped from the capped
 * list. Matches the scene location by normalized name → its children. PURE. */
export function currentPlaceChildren(state: ChronicleState): Location[] {
  const loc = (state.scene?.location ?? '').trim().toLowerCase();
  if (!loc) return [];
  const here = (state.locations ?? []).find((l) => l.name.trim().toLowerCase() === loc);
  if (!here) return [];
  return (state.locations ?? []).filter((l) => l.parent === here.id).sort((a, b) => b.lastTurn - a.lastTurn);
}

/** The injected block, or '' when there are no locations. */
export function locationList(state: ChronicleState, cap = 12): string {
  const locs = injectableLocations(state, cap);
  if (!locs.length) return '';
  const byId = new Map((state.locations ?? []).map((l) => [l.id, l.name]));
  const lines = locs.map((l) => {
    const parent = l.parent ? (byId.get(l.parent) ?? '') : '';
    return '- ' + l.name + (parent ? ' (in ' + parent + ')' : '') + (l.note ? ' \u2014 ' + l.note : '');
  });
  // Surface the current place's known sub-places (even stale ones the cap
  // dropped), so entering "Harrenhal" reminds the model the "Study" is inside it.
  const shown = new Set(locs.map((l) => l.id));
  const kids = currentPlaceChildren(state).filter((k) => !shown.has(k.id));
  const hereName = (state.scene?.location ?? '').trim();
  const kidLine = kids.length
    ? `\nWithin ${hereName} (established sub-places, reuse these): ` + kids.map((k) => k.name).join(', ') + '.'
    : '';
  return '[LOCATIONS \u2014 established places in this story. Use these exact names; do not invent a duplicate or rename one. Introduce a NEW place only when the scene genuinely goes somewhere new]\n' + lines.join('\n') + kidLine;
}

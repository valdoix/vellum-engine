import type { ChronicleState } from './types.js';
import { canonId } from '../core/ids.js';

/**
 * Cast identity resolution. The model refers to the same character by varying
 * names across turns — "Cersei" one turn, "Cersei Lannister" the next — and
 * naive canonId() turns those into two ids (`cersei` vs `cersei_lannister`),
 * spawning duplicate cast cards and duplicate relation endpoints.
 *
 * resolveCastId maps a raw name onto an EXISTING cast id when it confidently
 * refers to the same person, else returns the fresh canonId. Pure; the fold
 * extractor passes prior state so first-seen id stays canonical.
 *
 * Conservative on purpose — only merges on a token-prefix containment with a
 * UNIQUE match, so two genuinely different characters are never collapsed:
 *   - exact id hit                                  → that id
 *   - the name's id matches a cast member's aka     → that id
 *   - exactly one cast id is a token-prefix of this one (or vice versa),
 *     e.g. `cersei` ⊂ `cersei_lannister`            → that id
 *   - otherwise                                     → the fresh canonId
 */
export function resolveCastId(state: ChronicleState, rawName: string): string {
  const id = canonId(rawName);
  if (!id) return id;
  const cast = state.cast;
  if (cast[id]) return id; // exact, already known

  // alias hit: some existing card lists this name (or its canon) as an aka
  for (const c of Object.values(cast)) {
    if ((c.aka ?? []).some((a) => canonId(a) === id)) return c.id;
  }

  // token-prefix containment, must be UNIQUE to merge
  const matches: string[] = [];
  for (const existingId of Object.keys(cast)) {
    if (tokenPrefix(id, existingId) || tokenPrefix(existingId, id)) matches.push(existingId);
  }
  if (matches.length === 1) return matches[0]!;

  return id;
}

/** True if `short` is a leading whole-token prefix of `full` (underscore-joined
 * tokens): `cersei` ⊂ `cersei_lannister`, but `jon` ⊄ `jonas`. */
function tokenPrefix(short: string, full: string): boolean {
  if (short === full || !short || !full) return false;
  return full.startsWith(short + '_');
}

import type { ChronicleState } from './types.js';

/**
 * Cast hygiene — durability layers that stop junk cast cards from accumulating,
 * WITHOUT enumerating every junk word in a blocklist (that guard lives in
 * identity.ts and is the first line; this is the safety net behind it).
 *
 * A cast card is PROVISIONAL when it was auto-registered from a single passing
 * reference and has never earned its keep:
 *   - source is 'auto' (never a user-made or user-edited card), and
 *   - it was never STAGED by the model (status stayed 'mentioned'/'added' — a
 *     'present'/'active' card was deliberately put on stage), and
 *   - it is not marked deceased (a corpse/flashback name is intentional), and
 *   - it was seen in exactly ONE turn (firstTurn === lastTurn — never recurred), and
 *   - nothing is attached to it (no relation, knowledge, secret, journal, item,
 *     scar, membership, trait history, or off-screen thread).
 *
 * Provisional cards are:
 *   - HIDDEN from the browse surfaces (Layer 1 "deferred promotion": a name that
 *     appeared once and attached nothing shouldn't clutter the cast until it
 *     proves real), and
 *   - REAPED once they age past a short grace window (Layer 3 GC): if a name
 *     never recurred, never got staged, and never attached anything after a few
 *     turns, it was noise — drop it from derived state (the event log is
 *     untouched, so a later reference re-creates and re-evaluates it).
 *
 * Promotion is automatic and needs no event: a second sighting (firstTurn !=
 * lastTurn), an appearance in present[] (status -> present/active), or any
 * attached datum all clear the provisional flag on the next reduce.
 */

/** Turns a provisional card may linger before the GC sweep reaps it. Short, so
 * junk clears fast, but > 0 so a card minted mid-fold can still gain an
 * attachment or a second sighting on the very next turn and promote. */
export const PROVISIONAL_GRACE_TURNS = 3;

/** True when anything in the chronicle points at this cast id. A single hit is
 * enough to prove the card earned its place, so this short-circuits. */
export function hasCastAttachments(state: ChronicleState, id: string): boolean {
  if (!id) return false;
  if (state.relations.some((r) => r.a === id || r.b === id)) return true;
  if (state.knowledge.some((k) => k.who === id || k.about === id)) return true;
  if (state.secrets.some((s) => s.keeper === id || s.from.includes(id))) return true;
  if (state.journal.some((j) => j.who === id || j.about === id)) return true;
  if (state.scars.some((s) => s.who === id || s.about === id)) return true;
  if (state.items.some((it) => it.who === id)) return true;
  if (state.memberships.some((m) => m.char === id)) return true;
  if (state.traitHistory.some((t) => t.who === id)) return true;
  if (state.offscreen.some((o) => o.who === id)) return true;
  if (state.scene.present.includes(id)) return true; // on stage right now
  return false;
}

/** True when a cast card is a low-value, unproven auto-registration (see module
 * doc). Pure; safe to call from display filters and the GC sweep alike. */
export function isProvisionalCast(state: ChronicleState, id: string): boolean {
  const c = state.cast[id];
  if (!c) return false;
  if (c.source === 'user' || c.userEdited) return false;   // never touch user cards
  if (c.status === 'present' || c.status === 'active') return false; // model staged it
  if (c.deceased) return false;                            // a remembered dead name is intentional
  if (c.firstTurn !== c.lastTurn) return false;            // recurred across turns -> real
  return !hasCastAttachments(state, id);
}

/** The cast the user should SEE — everything except provisional (unproven,
 * single-mention, attachment-less) auto cards. Layer 1 quarantine for the browse
 * surfaces; injection/export already exclude 'mentioned', so they need no change. */
export function visibleCast(state: ChronicleState): ChronicleState['cast'][string][] {
  return Object.values(state.cast).filter((c) => !isProvisionalCast(state, c.id));
}

/**
 * Layer 3 GC: drop provisional cards that have aged past the grace window from
 * DERIVED state. Idempotent and event-log-safe — returns the SAME object when
 * nothing is reaped (so it never churns the incremental-reduce cache), and a new
 * shallow copy with the doomed ids removed otherwise. Apply after reduce/merge.
 */
export function sweepProvisionalCast(state: ChronicleState): ChronicleState {
  const now = state.turns ?? 0;
  const doomed: string[] = [];
  for (const id of Object.keys(state.cast)) {
    const c = state.cast[id]!;
    // only reap once it has had a fair chance to recur or attach something
    if (now - c.firstTurn <= PROVISIONAL_GRACE_TURNS) continue;
    if (isProvisionalCast(state, id)) doomed.push(id);
  }
  if (!doomed.length) return state;
  const cast = { ...state.cast };
  for (const id of doomed) delete cast[id];
  return { ...state, cast };
}

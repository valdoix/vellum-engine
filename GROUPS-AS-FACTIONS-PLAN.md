# VELLUM II — groups are FACTIONS, not characters (instruct + feed back)

## Problem
The model emits collective nouns ("Household Staff", "The Court", "the
Lannister guards") as CHARACTERS, minting junk cast cards. Two compounding gaps:
1. **Instruction**: the prose extractor (`extract.ts` EXTRACT_SYS) tells the
   model to attribute to "real character names" and defines FACTIONS, but never
   says *a collective/group noun is a FACTION, not a character* — so groups leak
   into the cast/bond name slots.
2. **Feedback**: the injected recall lists factions (`recall.ts:104` facLines)
   but doesn't tell the model "these already exist — reuse them, don't restate",
   the way OPEN THREADS does ("reuse the EXACT title"). So it coins
   "The Baldness Conspiracy" again as "The Hair Conspiracy".

## Two-layer fix (instruct the model + harden the guard)

### Phase 1 — Instruct: groups are factions (extract.ts EXTRACT_SYS)
- Add an explicit rule to EXTRACT_SYS: "A COLLECTIVE or GROUP — household staff,
  the court, a guard detail, a house, a council, an order — is a FACTION, never
  a character. Never put a group in `who`/`a`/`b`/`keeper`; put it in
  `factions[].name` with its members. Individuals only in character slots."
- Mirror the same one-liner into the inline-block guidance the main model sees
  (wherever the `<vellum>` protocol is taught) so both the structured path and
  the prose-extractor path get it. (If the main protocol lives in a preset doc
  the host injects, add it there; otherwise it rides the recall preamble.)

### Phase 2 — Feed back existing factions (recall.ts)
- Relabel/extend the faction recall block so it reads like the threads block:
  `[FACTIONS — established groups; reuse the EXACT name, don't restate as a new
  group]` listing current faction names (+ kind + standing). This is the
  anti-duplication signal — the model sees "The Baldness Conspiracy" already
  exists and advances it instead of coining a synonym.
- Keep it in the shared structured budget; it already lists up to 8 factions, so
  this is mostly a header/intent change + ensuring names are verbatim.

### Phase 3 — Harden the guard (identity.ts) — belt and suspenders
The model won't comply 100%, so reject obvious group nouns at the cast boundary:
- Extend `notAName` (or add `looksLikeGroup`) with a GROUP-NOUN set: staff,
  court, household, guards, council, kingsguard, watch, order, guild, house,
  faction, conspiracy, family (when bare/with article) — so
  `notAName('Household Staff')` → true, blocking a cast card. These already feel
  at home next to the existing GENERIC set.
- BUT: a group noun should still be usable as a FACTION. So don't globally reject
  it — `resolveFactionId` must still accept it. Scope the new rejection to the
  CHARACTER path only: `notAName` stays the cast/bond guard; faction resolution
  keeps its own (looser) name check. Verify `resolveFactionId` doesn't call the
  stricter guard.
- ponytail: a multi-word proper group ("The Night's Watch") is a real faction
  name; only reject when used as a CHARACTER, never when used as a faction.

### Phase 4 — (optional) reroute, don't just drop
When a bond/knowledge/journal `who` is a detected group noun, instead of silently
dropping it, the extractor mapping could emit a `faction.seen` for it. Higher
effort, defer — v1 = instruct + feed back + reject-from-cast.

## Tests
- `notAName('Household Staff')`, `notAName('The Court')`, `notAName('the guards')`
  → true (blocked from cast); a real name ("Cersei", "The Stranger") still false.
- `resolveFactionId(state, 'Household Staff')` → a `fac:` id (still a valid
  faction), NOT rejected.
- EXTRACT_SYS contains the group→faction rule (string assertion).
- recall structuredBlock emits a FACTIONS reuse block when factions exist.

## Verify
typecheck → test → build → reload. Manual: a scene with "the household staff
served dinner" yields a Household Staff FACTION (or nothing), never a cast card;
an existing faction is reused, not duplicated under a synonym.

## Risk / scope
- Phase 1/2 are text-only (prompt + injection) — zero logic risk, the highest-
  leverage part (most fixes happen by the model just complying).
- Phase 3 is the safety net; the only subtlety is keeping group nouns valid as
  factions while rejecting them as characters (scope the guard to the cast path).
- Out of scope: Phase 4 reroute; reclassifying EXISTING junk cast cards (a
  separate cleanup pass — could add a one-time "move group-noun cards to
  factions" later).

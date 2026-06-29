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
export function resolveCastId(state: ChronicleState, rawName: string, extraIds?: Iterable<string>): string {
  const id = canonId(rawName);
  if (!id) return id;
  const cast = state.cast;
  if (cast[id]) return id; // exact, already known

  // alias hit: some existing card lists this name (or its canon) as an aka — but
  // NEVER merge two names that conflict (same surname, different given name:
  // "Daeron Targaryen" vs "Rhaegar Targaryen"). A corrupted aka or a fuzzy model
  // pass must not be able to collapse two distinct people.
  for (const c of Object.values(cast)) {
    if (c.id !== id && nameConflict(id, c.id)) continue;
    if ((c.aka ?? []).some((a) => canonId(a) === id)) return c.id;
  }

  // candidate id universe = existing cast ∪ ids introduced THIS turn (extraIds).
  // The latter fixes the same-turn split: `present:["Cersei Lannister"]` emits
  // cast.seen for `cersei_lannister`, but that event isn't reduced into `state`
  // yet — so a bond using "cersei" in the same turn would otherwise mint a
  // separate `cersei`. Including the turn's present ids lets it merge.
  const known = new Set<string>(Object.keys(cast));
  if (extraIds) for (const e of extraIds) if (e) known.add(e);
  if (known.has(id)) return id; // exact hit among this-turn ids

  // token-prefix containment, must be UNIQUE to merge
  const matches: string[] = [];
  for (const existingId of known) {
    if (existingId === id) continue;
    if (nameConflict(id, existingId)) continue; // distinct people, same surname
    if (tokenPrefix(id, existingId) || tokenPrefix(existingId, id)) matches.push(existingId);
  }
  if (matches.length === 1) return matches[0]!;

  return id;
}

/**
 * True when two canonical ids name DIFFERENT people who must never be merged:
 * both are multi-token, they share the SAME last token (surname/house) but
 * differ in the FIRST token (given name). "daeron_targaryen" vs
 * "rhaegar_targaryen", "robb_stark" vs "arya_stark". A single-token name
 * ("daeron" vs "daeron_targaryen") is NOT a conflict — that's the legitimate
 * short↔full merge. Pure + symmetric.
 */
export function nameConflict(a: string, b: string): boolean {
  if (a === b) return false;
  const ta = a.split('_'), tb = b.split('_');
  if (ta.length < 2 || tb.length < 2) return false;     // need given + surname on both
  if (ta[0] === tb[0]) return false;                     // same given name → not a conflict
  return ta[ta.length - 1] === tb[tb.length - 1];        // same surname, different given → conflict
}

/** True if `short` is a leading whole-token prefix of `full` (underscore-joined
 * tokens): `cersei` ⊂ `cersei_lannister`, but `jon` ⊄ `jonas`. NEVER across a
 * possessive boundary — `cersei` ⊄ `cersei_s_father` ("Cersei's father" is a
 * DIFFERENT entity, not a fuller spelling of Cersei). This guard prevents the
 * catastrophic merge of a character into a relative of theirs. */
function tokenPrefix(short: string, full: string): boolean {
  if (short === full || !short || !full) return false;
  if (!full.startsWith(short + '_')) return false;
  const rest = full.slice(short.length + 1); // tokens after the prefix
  // possessive 's ("X's Y" → x_s_y) or a kinship/relation word → different person
  if (rest === 's' || rest.startsWith('s_')) return false;
  const firstTok = rest.split('_')[0]!;
  if (RELATION_TOKENS.has(firstTok)) return false;
  return true;
}

// kinship/relational nouns: "Cersei Mother", "Daeron Hand" etc. name a DIFFERENT
// entity than the bare name, so a prefix match across one is not the same person.
const RELATION_TOKENS = new Set([
  'father', 'mother', 'son', 'daughter', 'sister', 'brother', 'wife', 'husband',
  'mom', 'dad', 'aunt', 'uncle', 'cousin', 'grandfather', 'grandmother', 'nephew',
  'niece', 'hand', 'guard', 'maid', 'servant', 'squire', 'steward',
]);

// pronouns / deixis — NEVER a character name, regardless of capitalization
// ("She" at a sentence start is still a pronoun). A bond keyed to one spawns a
// junk node ("she → Daeron"); resolving it to a referent needs coref we lack.
const PRONOUN = new Set([
  'she', 'he', 'her', 'him', 'his', 'hers', 'they', 'them', 'their', 'theirs',
  'it', 'its', 'i', 'me', 'my', 'mine', 'you', 'your', 'yours', 'we', 'us', 'our', 'ours',
  'this', 'that', 'these', 'those', 'someone', 'somebody', 'anyone', 'everyone',
  'no one', 'nobody', 'everybody', 'who', 'whom', 'one', 'self', 'himself', 'herself', 'themselves',
]);
// generic role nouns — junk ONLY when lowercase/uncapitalized. A capitalized
// proper epithet ("The Stranger", "The Hound") is a real name and passes.
const GENERIC = new Set([
  'guard', 'servant', 'soldier', 'stranger', 'man', 'woman', 'figure', 'person',
  'people', 'child', 'boy', 'girl', 'men', 'women', 'others', 'crowd', 'group',
]);
// narration / meta-fiction tokens — the model sometimes emits a ROLE LABEL
// instead of a name ("Narrator POV Character", "the protagonist", "main char").
// These are never a character identity; any name containing one is rejected.
const META = new Set([
  'narrator', 'pov', 'protagonist', 'antagonist', 'character', 'char', 'player',
  'user', 'persona', 'speaker', 'narration', 'viewpoint', 'perspective', 'self',
  'unnamed', 'unknown', 'nobody', 'everyone', 'someone', 'anybody', 'main',
]);

/**
 * True when a raw name is NOT a usable character identity. Rejects: empty,
 * placeholders, pronouns/deixis (any case), and bare LOWERCASE generic nouns.
 * Passes: proper names ("Anne", "Daeron"), capitalized epithets ("The Stranger").
 */
export function notAName(rawName: string): boolean {
  const s = String(rawName ?? '').trim();
  if (!s) return true;
  if (/\{\{/.test(s) || /placeholder/i.test(s)) return true;
  const rest = s.replace(/^(a|an|the)\s+/i, '');
  if (!rest) return true;
  const lower = rest.toLowerCase();
  if (PRONOUN.has(lower)) return true; // pronoun/deixis, any case
  const words = rest.split(/\s+/);
  // a single bare LOWERCASE generic word ("guard", "stranger") — capitalized
  // first letter means a proper epithet, which passes.
  if (words.length === 1 && words[0]![0] === words[0]![0]!.toLowerCase() && GENERIC.has(lower)) return true;
  // a NAME is short. A long phrase ("everyone, including herself until now") or
  // one containing a pronoun token is free text, not a character — reject so it
  // can't mint a junk cast node from a secret's `from`/a bond endpoint.
  if (words.length > 4) return true;
  if (/[,;.]/.test(rest)) return true; // punctuation → a clause, not a name
  if (words.some((w) => PRONOUN.has(w.toLowerCase()))) return true;
  // role/meta labels ("Narrator POV Character", "the protagonist") are not names
  if (words.some((w) => META.has(w.toLowerCase()))) return true;
  return false;
}

/**
 * SELF-HEALING merge pass over a reduced state. resolveCastId only merges at
 * CREATION time; once `cersei` and `cersei_lannister` both exist as separate
 * stored cards (from an older log, or a fold before the resolver landed),
 * nothing collapses them. This pass folds any cast node whose id is a UNIQUE
 * token-prefix of another (`cersei` ⊂ `cersei_lannister`) into the longer, more
 * specific id, then remaps every id-bearing reference across the whole state.
 *
 * PURE: returns a new-ish state (mutates a shallow-built copy of collections).
 * Idempotent and conservative — ambiguous prefixes (two candidates) are left
 * untouched so distinct characters are never collapsed. Apply AFTER reduce().
 */
export function mergeCastDuplicates(s: ChronicleState): ChronicleState {
  const ids = Object.keys(s.cast);
  if (ids.length < 2) return s;

  // build id → canonical-id remap from unique token-prefix containment
  const remap = new Map<string, string>();
  for (const shortId of ids) {
    const supersets = ids.filter((other) => other !== shortId && !nameConflict(shortId, other) && tokenPrefix(shortId, other));
    if (supersets.length === 1) remap.set(shortId, supersets[0]!); // unique → merge into the longer
  }
  if (!remap.size) return s;

  // collapse transitive chains (a→b, b→c ⇒ a→c) so every id lands on its final target
  const resolve = (id: string): string => {
    let cur = id, guard = 0;
    while (remap.has(cur) && guard++ < 16) cur = remap.get(cur)!;
    return cur;
  };
  const map = (id: string): string => resolve(id);

  // 1) cast: merge cards, preferring the kept card's fields; fold the short
  //    name into the kept card's aka so it stays recognizable + searchable.
  const cast: Record<string, typeof s.cast[string]> = {};
  for (const id of ids) {
    const target = map(id);
    const src = s.cast[id]!;
    if (!cast[target]) {
      cast[target] = { ...(s.cast[target] ?? src), id: target };
    }
    const keep = cast[target]!;
    if (id !== target) {
      const akas = new Set([...(keep.aka ?? []), src.name, ...(src.aka ?? [])].filter(Boolean));
      keep.aka = Array.from(akas).filter((a) => canonId(a) !== target);
      keep.firstTurn = Math.min(keep.firstTurn, src.firstTurn);
      keep.lastTurn = Math.max(keep.lastTurn, src.lastTurn);
      keep.userEdited = keep.userEdited || src.userEdited;
    }
  }

  // 2) relations: remap endpoints, then merge edges that collapse to the same pair
  const relByKey = new Map<string, typeof s.relations[number]>();
  for (const r of s.relations) {
    const a = map(r.a), b = map(r.b);
    if (a === b) continue; // self-edge after merge → drop
    const key = a + '|' + b;
    const existing = relByKey.get(key);
    if (!existing) { relByKey.set(key, { ...r, a, b }); continue; }
    // accumulate the weaker edge into the kept one (sum scores, union cats)
    existing.affection = Math.max(-100, Math.min(100, existing.affection + r.affection));
    existing.trust = Math.max(-100, Math.min(100, existing.trust + r.trust));
    existing.categories = Array.from(new Set([...existing.categories, ...r.categories]));
    existing.firstTurn = Math.min(existing.firstTurn, r.firstTurn);
    existing.lastTurn = Math.max(existing.lastTurn, r.lastTurn);
    existing.userEdited = existing.userEdited || r.userEdited;
  }

  // 3) every other id-bearing field
  const knowledge = s.knowledge.map((k) => ({ ...k, who: map(k.who), ...(k.about ? { about: map(k.about) } : {}) }));
  const secrets = s.secrets.map((x) => ({ ...x, keeper: map(x.keeper), from: x.from.map(map), revealedTo: x.revealedTo.map(map) }));
  const journal = s.journal.map((j) => ({ ...j, who: map(j.who), ...(j.about ? { about: map(j.about) } : {}) }));
  const parallel = s.parallel.map((p) => ({ ...p, ...(p.who ? { who: map(p.who) } : {}) }));
  const present = Array.from(new Set(s.scene.present.map(map)));
  const detail = s.scene.detail.map((d) => ({ ...d, id: map(d.id) })).filter((d, i, arr) => arr.findIndex((x) => x.id === d.id) === i);
  // memberships reference cast ids on the `char` side — remap + dedupe
  const memberships = dedupeMemberships(s.memberships.map((m) => ({ ...m, char: map(m.char) })));

  return {
    ...s,
    cast,
    relations: Array.from(relByKey.values()),
    knowledge,
    secrets,
    journal,
    parallel,
    memberships,
    scene: { ...s.scene, present, detail },
  };
}

function dedupeMemberships(list: Array<{ char: string; faction: string; role?: string }>): Array<{ char: string; faction: string; role?: string }> {
  const seen = new Set<string>();
  const out: typeof list = [];
  for (const m of list) {
    if (m.char === m.faction) continue;
    const k = m.char + '|' + m.faction;
    if (seen.has(k)) continue;
    seen.add(k); out.push(m);
  }
  return out;
}

/**
 * Resolve a raw GROUP name onto an existing faction id (namespace `fac:`), or
 * mint a fresh one. Parallel to resolveCastId — exact / aka / unique token-prefix
 * — but entirely within the faction id-space, so it can NEVER collide with cast
 * (the "Daeron Targaryen" vs "The Targaryens" hazard). Returns '' for non-names.
 */
export function resolveFactionId(state: ChronicleState, rawName: string): string {
  if (notAName(rawName)) return '';
  const bare = canonId(rawName);
  if (!bare) return '';
  const id = 'fac:' + bare;
  const facs = state.factions;
  if (facs[id]) return id;
  for (const f of Object.values(facs)) {
    if ((f.aka ?? []).some((a) => 'fac:' + canonId(a) === id)) return f.id;
  }
  const matches: string[] = [];
  for (const existingId of Object.keys(facs)) {
    if (existingId === id) continue;
    const a = existingId.replace(/^fac:/, ''), b = bare;
    if (tokenPrefix(a, b) || tokenPrefix(b, a)) matches.push(existingId);
  }
  if (matches.length === 1) return matches[0]!;
  return id;
}

/** Self-healing merge for split faction nodes (e.g. `fac:targaryens` ⊂
 * `fac:targaryen_house`). Parallel to mergeCastDuplicates; remaps faction ids
 * across factions + memberships only. NEVER touches cast ids. */
export function mergeFactionDuplicates(s: ChronicleState): ChronicleState {
  const ids = Object.keys(s.factions);
  if (ids.length < 2) return s;
  const remap = new Map<string, string>();
  for (const shortId of ids) {
    const a = shortId.replace(/^fac:/, '');
    const supersets = ids.filter((other) => other !== shortId && tokenPrefix(a, other.replace(/^fac:/, '')));
    if (supersets.length === 1) remap.set(shortId, supersets[0]!);
  }
  if (!remap.size) return s;
  const map = (id: string): string => { let cur = id, g = 0; while (remap.has(cur) && g++ < 16) cur = remap.get(cur)!; return cur; };

  const factions: Record<string, typeof s.factions[string]> = {};
  for (const id of ids) {
    const target = map(id);
    const src = s.factions[id]!;
    if (!factions[target]) factions[target] = { ...(s.factions[target] ?? src), id: target };
    const keep = factions[target]!;
    if (id !== target) {
      const akas = new Set([...(keep.aka ?? []), src.name, ...(src.aka ?? [])].filter(Boolean));
      keep.aka = Array.from(akas).filter((a) => 'fac:' + canonId(a) !== target);
      keep.standing = Math.max(-100, Math.min(100, keep.standing + src.standing));
      keep.trust = Math.max(-100, Math.min(100, keep.trust + src.trust));
      keep.firstTurn = Math.min(keep.firstTurn, src.firstTurn);
      keep.lastTurn = Math.max(keep.lastTurn, src.lastTurn);
      keep.userEdited = keep.userEdited || src.userEdited;
    }
  }
  const memberships = dedupeMemberships(s.memberships.map((m) => ({ ...m, faction: map(m.faction) })));
  return { ...s, factions, memberships };
}

/** Run both self-healing merges (cast then factions). The single entry point
 * stores call to keep the two id-spaces reconciled together. */
export function mergeDuplicates(s: ChronicleState): ChronicleState {
  return mergeFactionDuplicates(mergeCastDuplicates(s));
}

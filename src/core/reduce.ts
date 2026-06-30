import type { VellumEvent } from '../core/events.js';
import { type ChronicleState, type Relation, freshState } from '../domain/types.js';
import { freshRelation, applyScore, addCategories, removeCategories, sentimentToScores, deriveSentiment } from '../domain/relations.js';
import { normalizeCategorySet, primaryCategory, isCategory } from '../domain/category.js';

/**
 * reduce(events) → ChronicleState. PURE: no I/O, no randomness, no host calls.
 * The single place state is derived. Tested against fixture event streams.
 *
 * Incremental use: pass a prior (state, consumedCount) to fold only new events
 * onto the last snapshot — O(new events), not O(all history), per turn.
 */
export function reduce(events: readonly VellumEvent[], from?: ChronicleState, startIndex = 0): ChronicleState {
  const s = from ? from : freshState();
  for (let i = startIndex; i < events.length; i++) {
    apply(s, events[i]!);
  }
  return s;
}

function findRel(s: ChronicleState, a: string, b: string): Relation | undefined {
  // directional identity: a→b is distinct from b→a (asymmetric relationships)
  return s.relations.find((r) => r.a === a && r.b === b);
}

/**
 * Auto-register / promote a cast card for ANY character the chronicle refers to
 * — not just those in the scene's `present` list. Knowledge/secrets/journal/
 * bonds attribute to canonical ids; without a card those characters are ghost
 * ids (no name, absent from the cast UI), which made it look like only the
 * {{char}} accrued data.
 *
 *  - missing      → create a 'mentioned' card (readable de-canonicalized name)
 *  - 'added'      → promote to 'mentioned': a user-pre-seeded character the story
 *                   has now actually referenced enters the live lifecycle (a
 *                   later cast.seen lifts them to present/active)
 *  - present/active/mentioned → only bump lastTurn (never downgrade)
 */
function ensureCast(s: ChronicleState, id: string, turn: number, name?: string): void {
  if (!id) return;
  const c = s.cast[id];
  if (!c) {
    s.cast[id] = {
      id,
      name: name || deCanon(id),
      aka: [], status: 'mentioned', source: 'auto',
      firstTurn: turn, lastTurn: turn, userEdited: false,
    };
    return;
  }
  c.lastTurn = Math.max(c.lastTurn, turn);
  if (c.status === 'added') c.status = 'mentioned'; // pre-seed → live once referenced
}

/** Readable name from a canonical id: `cersei_lannister` → `Cersei Lannister`. */
function deCanon(id: string): string {
  return String(id).replace(/^fac:/, '').split('_').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || id;
}

/** Auto-register a faction referenced before it was introduced (mirrors
 * ensureCast). 'added' pre-seed promotes to 'mentioned' on first reference. */
function ensureFaction(s: ChronicleState, id: string, turn: number, name?: string): void {
  if (!id) return;
  const f = s.factions[id];
  if (!f) {
    s.factions[id] = {
      id, name: name || deCanon(id), aka: [], kind: undefined,
      status: 'mentioned', standing: 0, trust: 0, source: 'auto',
      firstTurn: turn, lastTurn: turn, userEdited: false,
    };
    return;
  }
  f.lastTurn = Math.max(f.lastTurn, turn);
  if (f.status === 'added') f.status = 'mentioned';
}

function apply(s: ChronicleState, e: VellumEvent): void {
  switch (e.kind) {
    case 'turn.fold': {
      s.turns = Math.max(s.turns, e.turn);
      s.day = Math.max(s.day, e.day);
      break;
    }
    case 'scene.set': {
      s.scene = {
        location: e.location ?? s.scene.location,
        time: e.time ?? s.scene.time,
        tension: e.tension ?? s.scene.tension,
        weather: e.weather ?? s.scene.weather,
        present: e.present,
        detail: e.detail ? e.detail.map((d) => ({ id: d.id, ...(d.mood ? { mood: d.mood } : {}), ...(d.doing ? { doing: d.doing } : {}), ...(d.condition ? { condition: d.condition } : {}), ...(d.thought ? { thought: d.thought } : {}) })) : (e.present.length ? s.scene.detail.filter((d) => e.present.includes(d.id)) : s.scene.detail),
      };
      // demote cast who LEFT: an authoritative present list means anyone still
      // flagged 'present' but no longer on stage steps back to 'active' (in play,
      // offscreen). Without this, 'present' accrues everyone ever seen. The
      // matching cast.seen events (emitted after) re-promote those who remain.
      if (e.present.length) {
        const here = new Set(e.present);
        for (const c of Object.values(s.cast)) {
          if (c.status === 'present' && !here.has(c.id)) c.status = 'active';
        }
      }
      break;
    }
    case 'parallel.set': {
      s.parallel = e.items.map((it) => ({ ...(it.who ? { who: it.who } : {}), ...(it.where ? { where: it.where } : {}), activity: it.activity, ...(it.note ? { note: it.note } : {}), ...(it.src ? { src: it.src } : {}), turn: e.turn, day: e.day }));
      break;
    }
    case 'cast.seen': {
      const c = s.cast[e.id];
      if (c) {
        c.lastTurn = Math.max(c.lastTurn, e.turn);
        if (e.status === 'present' || e.status === 'active') c.status = e.status;
      } else {
        s.cast[e.id] = {
          id: e.id, name: e.name, aka: [], status: e.status,
          source: e.src === 'user' ? 'user' : 'auto',
          firstTurn: e.turn, lastTurn: e.turn, userEdited: e.src === 'user',
        };
      }
      break;
    }
    case 'cast.edit': {
      const c = s.cast[e.id];
      if (c) {
        // defensively strip protected identity keys even if schema let them through
        const { id: _id, source: _src, firstTurn: _ft, ...safe } = e.patch as Record<string, unknown>;
        void _id; void _src; void _ft;
        Object.assign(c, safe);
        // empty color string = clear → drop the key so it's truly absent (default ink)
        if (safe.color === '') delete c.color;
        if (safe.colorTo === '') delete c.colorTo;
        // empty disposition string = clear; empty traits array = clear
        if (safe.disposition === '') delete c.disposition;
        if (Array.isArray(c.traits)) {
          // trim, drop blanks, dedupe (case-insensitive), cap at 6
          const seen = new Set<string>();
          const clean: string[] = [];
          for (const t of c.traits) {
            const v = String(t).trim();
            const k = v.toLowerCase();
            if (!v || seen.has(k)) continue;
            seen.add(k); clean.push(v);
            if (clean.length >= 6) break;
          }
          if (clean.length) c.traits = clean; else delete c.traits;
        }
        if (e.src === 'user') c.userEdited = true;
      }
      break;
    }
    case 'cast.drop': {
      delete s.cast[e.id];
      s.relations = s.relations.filter((r) => r.a !== e.id && r.b !== e.id);
      s.memberships = s.memberships.filter((m) => m.char !== e.id); // drop their memberships too
      // full cascade: erase everything ABOUT or HELD BY this character so a delete
      // leaves no orphaned data behind. Knowledge they hold or that's about them,
      // secrets they keep or are kept from, and their journal entries (incl. ones
      // about them) all go.
      s.knowledge = s.knowledge.filter((k) => k.who !== e.id && k.about !== e.id);
      s.secrets = s.secrets.filter((x) => x.keeper !== e.id && !(x.from ?? []).includes(e.id));
      s.journal = s.journal.filter((j) => j.who !== e.id && j.about !== e.id);
      s.scars = s.scars.filter((x) => x.who !== e.id && x.about !== e.id);
      break;
    }
    case 'faction.seen': {
      const f = s.factions[e.id];
      if (f) {
        f.lastTurn = Math.max(f.lastTurn, e.turn);
        if (e.status === 'present' || e.status === 'active') f.status = e.status;
      } else {
        s.factions[e.id] = {
          id: e.id, name: e.name, aka: [], status: e.status, standing: 0, trust: 0,
          source: e.src === 'user' ? 'user' : 'auto',
          firstTurn: e.turn, lastTurn: e.turn, userEdited: e.src === 'user',
        };
      }
      break;
    }
    case 'faction.edit': {
      const f = s.factions[e.id];
      if (f) {
        const { id: _id, source: _src, firstTurn: _ft, standing: _st, trust: _tr, ...safe } = e.patch as Record<string, unknown>;
        void _id; void _src; void _ft; void _st; void _tr;
        Object.assign(f, safe);
        if (e.src === 'user') f.userEdited = true;
      }
      break;
    }
    case 'faction.drop': {
      delete s.factions[e.id];
      s.memberships = s.memberships.filter((m) => m.faction !== e.id);
      break;
    }
    case 'faction.member': {
      ensureCast(s, e.char, e.turn);
      ensureFaction(s, e.faction, e.turn);
      const i = s.memberships.findIndex((m) => m.char === e.char && m.faction === e.faction);
      if (e.op === 'remove') { if (i >= 0) s.memberships.splice(i, 1); }
      else if (i >= 0) { if (e.role) s.memberships[i]!.role = e.role; }
      else s.memberships.push({ char: e.char, faction: e.faction, ...(e.role ? { role: e.role } : {}) });
      break;
    }
    case 'faction.standing': {
      ensureFaction(s, e.faction, e.turn);
      const f = s.factions[e.faction]!;
      const clamp = (n: number): number => Math.max(-100, Math.min(100, n));
      if (typeof e.standing === 'number') f.standing = clamp(e.absolute ? e.standing : f.standing + e.standing);
      if (typeof e.trust === 'number') f.trust = clamp(e.absolute ? e.trust : f.trust + e.trust);
      f.lastTurn = Math.max(f.lastTurn, e.turn);
      break;
    }
    case 'bond.delta': {
      ensureCast(s, e.a, e.turn); ensureCast(s, e.b, e.turn); // every bonded character gets a card
      let r = findRel(s, e.a, e.b);
      if (!r) {
        r = freshRelation(e.a, e.b, e.turn, e.day, e.src === 'user' ? 'user' : 'auto');
        s.relations.push(r);
      }
      // A user's manual edit sets the BASELINE; it must not freeze the bond from
      // evolving with the story. So narrative DELTAS (relative aff/trust) always
      // accumulate. The lock only guards a user-edited bond against non-user
      // ABSOLUTE overwrites (which would clobber the chosen value outright).
      const blockAbsolute = r.userEdited && e.src !== 'user';
      if (e.label && (e.src === 'user' || !r.label)) r.label = e.label.slice(0, 120);
      if (e.addCats?.length) addCategories(r, e.addCats, e.turn, e.day, e.why ?? '');
      if (e.removeCats?.length) removeCategories(r, e.removeCats, e.turn, e.day, e.why ?? '', e.src === 'user');
      if (typeof e.aff === 'number' || typeof e.trust === 'number') {
        if (e.absolute && blockAbsolute) { /* protect user's set value from auto overwrite */ }
        else applyScore(r, e.aff ?? 0, e.trust ?? 0, !!e.absolute, e.turn, e.day, e.why);
      }
      if (e.src === 'user') r.userEdited = true;
      r.lastTurn = Math.max(r.lastTurn, e.turn);
      break;
    }
    case 'bond.drop': {
      // directed by default; `both` clears the reciprocal edge too
      if (e.both) s.relations = s.relations.filter((r) => !((r.a === e.a && r.b === e.b) || (r.a === e.b && r.b === e.a)));
      else s.relations = s.relations.filter((r) => !(r.a === e.a && r.b === e.b));
      break;
    }
    case 'knowledge.learn': {
      ensureCast(s, e.who, e.turn); if (e.about) ensureCast(s, e.about, e.turn); // knower + subject become tracked cast
      // dedup: same knower + the SAME fact (exact, or a near-duplicate clause —
      // "in love with Daeron" vs "in love with Daeron and has not said it yet").
      const dup = s.knowledge.find((k) => k.who === e.who && similarFact(k.fact, e.fact));
      if (dup) {
        // re-fold of the same who|fact: keep the richer wording + firm up the
        // epistemic frame in place, rather than duplicating.
        dup.fact = richer(dup.fact, e.fact);
        if (e.reliability) dup.reliability = e.reliability;
        if (e.truth) dup.truth = e.truth;
        if (e.source) dup.source = e.source;
      } else {
        s.knowledge.push({
          id: `k_${s.knowledge.length}_${e.seq}`, who: e.who, fact: e.fact,
          ...(e.about ? { about: e.about } : {}), turn: e.turn,
          reliability: e.reliability ?? 'knows', truth: e.truth ?? 'unknown',
          ...(e.source ? { source: e.source } : {}),
        });
      }
      break;
    }
    case 'knowledge.drop': {
      s.knowledge = s.knowledge.filter((k) => k.id !== e.id);
      break;
    }
    case 'knowledge.merge': {
      const into = s.knowledge.find((k) => k.id === e.into);
      if (into) {
        const drop = new Set(e.from);
        for (const k of s.knowledge) if (drop.has(k.id)) { into.fact = richer(into.fact, k.fact); if (!into.source && k.source) into.source = k.source; }
        s.knowledge = s.knowledge.filter((k) => !drop.has(k.id));
      }
      break;
    }
    case 'secret.form': {
      if (!s.secrets.find((x) => x.id === e.id)) {
        ensureCast(s, e.keeper, e.turn); for (const f of e.from) ensureCast(s, f, e.turn); // keeper + those kept in the dark
        // dedup: the same keeper concealing the SAME secret (near-duplicate text)
        // is one secret — merge the `from` lists (who it's kept from accumulates)
        // and keep the richer wording, rather than spawning parallel rows.
        const dup = s.secrets.find((x) => x.keeper === e.keeper && !x.revealed && similarFact(x.text, e.text));
        if (dup) {
          dup.text = richer(dup.text, e.text);
          dup.from = Array.from(new Set([...dup.from, ...e.from]));
        } else {
          s.secrets.push({ id: e.id, keeper: e.keeper, from: e.from, text: e.text, revealed: false, revealedTo: [], formedTurn: e.turn });
        }
      }
      break;
    }
    case 'secret.reveal': {
      const sec = s.secrets.find((x) => x.id === e.id);
      if (sec) { sec.revealed = true; sec.revealedTo = Array.from(new Set([...sec.revealedTo, ...e.to])); }
      break;
    }
    case 'secret.drop': {
      s.secrets = s.secrets.filter((x) => x.id !== e.id);
      break;
    }
    case 'secret.merge': {
      const into = s.secrets.find((x) => x.id === e.into);
      if (into) {
        const drop = new Set(e.from);
        for (const x of s.secrets) if (drop.has(x.id)) {
          into.text = richer(into.text, x.text);
          into.from = Array.from(new Set([...into.from, ...x.from]));
          into.revealedTo = Array.from(new Set([...into.revealedTo, ...x.revealedTo]));
          if (x.revealed) into.revealed = true;
        }
        s.secrets = s.secrets.filter((x) => !drop.has(x.id));
      }
      break;
    }
    case 'memory.record': {
      if (!s.memories.find((m) => m.id === e.id)) {
        s.memories.push({ id: e.id, tier: e.tier, text: e.text, ...(e.detail ? { detail: e.detail } : {}), keys: e.keys, ...(e.covers ? { covers: e.covers } : {}), ...(e.subsumed ? { subsumed: e.subsumed } : {}), ...(e.beatDay !== undefined ? { beatDay: e.beatDay } : {}), ...(e.beatTime ? { beatTime: e.beatTime } : {}), ...(e.spine ? { spine: e.spine } : {}), ...(e.act ? { act: e.act } : {}), ...(e.ord !== undefined ? { ord: e.ord } : {}), turn: e.turn });
      }
      break;
    }
    case 'memory.link': {
      const m = s.memories.find((x) => x.id === e.id);
      if (m) { m.vaultEntryId = e.vaultEntryId; if (e.keys) m.keys = e.keys; }
      break;
    }
    case 'memory.edit': {
      const m = s.memories.find((x) => x.id === e.id);
      if (m) {
        if (typeof e.text === 'string' && e.text.trim()) m.text = e.text.trim();
        if (typeof e.detail === 'string') m.detail = e.detail.trim() || undefined; // empty clears the detail
      }
      break;
    }
    case 'memory.drop': {
      // memory.drop is used two ways, and they must behave OPPOSITELY:
      //   - FOLD-drop (folded:true): the child was just consumed into a parent
      //     (turns→chapter, chapters→arc). Remove it; do NOT restore — its content
      //     now lives in the parent. (The parent keeps `subsumed` for later undo.)
      //   - USER-drop (no flag): the user deleted/undid a compressed memory, so
      //     RESTORE what it subsumed (a chapter brings back its turns; an arc its
      //     chapters, with detail/covers). Subsumed entries carry their own tier.
      const target = s.memories.find((m) => m.id === e.id);
      s.memories = s.memories.filter((m) => m.id !== e.id);
      if (!e.folded && (target?.tier === 'chapter' || target?.tier === 'arc') && target.subsumed?.length) {
        for (const sm of target.subsumed) {
          if (!s.memories.find((m) => m.id === sm.id)) {
            s.memories.push({ id: sm.id, tier: sm.tier ?? 'turn', text: sm.text, keys: sm.keys ?? [], turn: sm.turn, ...(sm.detail ? { detail: sm.detail } : {}), ...(sm.covers ? { covers: sm.covers } : {}) });
          }
        }
      }
      break;
    }
    case 'thread.op': {
      upsertTrack(s.threads, e.name, e.op === 'resolve' ? 'resolved' : (e.note ?? e.op), e.turn);
      break;
    }
    case 'arc.op': {
      upsertTrack(s.arcs, e.name, e.op === 'resolve' ? 'resolved' : (e.note ?? e.op), e.turn);
      break;
    }
    case 'thread.merge': { mergeTracks(s.threads, e.from, e.into); break; }
    case 'arc.merge': { mergeTracks(s.arcs, e.from, e.into); break; }
    case 'offscreen.op': {
      const list = s.offscreen;
      let ot = list.find((o) => o.id === e.id);
      if (!ot) {
        if (e.op === 'resolve') break; // nothing to resolve
        ot = { id: e.id, name: e.name || e.id, status: 'active', gist: e.gist ?? '', beats: [], firstTurn: e.turn, lastTurn: e.turn, ...(e.who ? { who: e.who } : {}), ...(e.where ? { where: e.where } : {}) };
        list.push(ot);
      }
      if (e.name) ot.name = e.name;
      if (e.who) ot.who = e.who;
      if (e.where) ot.where = e.where;
      if (e.gist) { ot.gist = e.gist; ot.beats = [...ot.beats, e.gist].slice(-6); }
      ot.lastTurn = Math.max(ot.lastTurn, e.turn);
      if (e.op === 'resolve') ot.status = 'resolved';
      break;
    }
    case 'journal.entry': {
      if (!s.journal.find((j) => j.id === e.id)) {
        // dedupe identical memory text for the same holder
        if (!s.journal.find((j) => j.who === e.who && j.memory === e.memory)) {
          ensureCast(s, e.who, e.turn); if (e.about) ensureCast(s, e.about, e.turn); // holder + subject become tracked cast
          s.journal.push({ id: e.id, who: e.who, ...(e.about ? { about: e.about } : {}), memory: e.memory, kind: e.jkind, weight: e.weight, sentiment: e.sentiment, turn: e.turn, day: e.day });
        }
      }
      break;
    }
    case 'journal.drop': {
      s.journal = s.journal.filter((j) => j.id !== e.id);
      break;
    }
    case 'journal.edit': {
      const j = s.journal.find((x) => x.id === e.id);
      if (j) {
        const p = e.patch;
        if (p.memory !== undefined) j.memory = p.memory;
        if (p.about !== undefined) j.about = p.about;
        if (p.jkind !== undefined) j.kind = p.jkind;
        if (p.weight !== undefined) j.weight = p.weight;
        if (p.sentiment !== undefined) j.sentiment = p.sentiment;
      }
      break;
    }
    case 'scar.form': {
      ensureCast(s, e.who, e.turn); if (e.about) ensureCast(s, e.about, e.turn);
      // dedup: same holder + the same (or near-duplicate) superseded belief.
      if (!s.scars.find((x) => x.id === e.id) && !s.scars.find((x) => x.who === e.who && similarFact(x.was, e.was))) {
        s.scars.push({ id: e.id, who: e.who, was: e.was, ...(e.about ? { about: e.about } : {}), ...(e.knowledgeId ? { knowledgeId: e.knowledgeId } : {}), turn: e.turn });
      }
      break;
    }
    case 'scar.drop': {
      s.scars = s.scars.filter((x) => x.id !== e.id);
      break;
    }
    case 'lore.note': {
      // dedup: a near-duplicate canon fact is one note (keep the richer wording).
      const dup = s.lore.find((x) => x.id === e.id) ?? s.lore.find((x) => similarFact(x.fact, e.fact));
      if (dup) { dup.fact = richer(dup.fact, e.fact); if (e.tag && !dup.tag) dup.tag = e.tag; }
      else s.lore.push({ id: e.id, fact: e.fact, ...(e.tag ? { tag: e.tag } : {}), turn: e.turn });
      break;
    }
    case 'lore.drop': {
      s.lore = s.lore.filter((x) => x.id !== e.id);
      break;
    }
    default: {
      // exhaustiveness guard — a new event kind must be handled here
      const _never: never = e;
      void _never;
    }
  }
}

// Track-title normalization for conservative dedup (Layer 2). Lowercase, drop
// punctuation + leading articles + possessive 's, split into significant tokens
// (stopwords removed). "Jaime's Arrival" / "the arrival of Jaime" → {arrival,jaime}.
const TRACK_STOP = new Set(['the', 'a', 'an', 'of', 'and', 'to', 'in', 'on', 'at', 'with', 'for', 'is', 'as', 'by', 's']);
function trackTokens(name: string): Set<string> {
  return new Set(
    String(name || '').toLowerCase()
      .replace(/['\u2019]s\b/g, '') // possessive
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !TRACK_STOP.has(w)),
  );
}
function subset(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
/** Conservative same-thread match: exact, or token-set equality, or whole-title
 * containment where the shorter has >=2 significant tokens. Deliberately does
 * NOT merge on a single shared token ("Jaime" vs "Jaime at Harrenhal") — that
 * semantic case is the LLM reconcile sweep's (Layer 3) job, not a blind merge. */
function sameTrack(existing: string, incoming: string): boolean {
  if (existing.toLowerCase() === incoming.toLowerCase()) return true;
  const a = trackTokens(existing), b = trackTokens(incoming);
  if (!a.size || !b.size) return false;
  if (a.size === b.size && subset(a, b)) return true; // token-set equality
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  if (small.size >= 2 && subset(small, big)) return true; // containment, >=2 tokens
  return false;
}

// Content-fact stopwords (broader than track titles — facts are full clauses).
const FACT_STOP = new Set([
  ...TRACK_STOP, 'has', 'have', 'had', 'not', 'yet', 'said', 'words', 'her', 'his',
  'their', 'them', 'they', 'she', 'he', 'it', 'that', 'this', 'who', 'whom', 'been',
  'will', 'would', 'about', 'into', 'from', 'but', 'or', 'so', 'than', 'then', 'now',
]);
function factTokens(text: string): Set<string> {
  return new Set(
    String(text || '').toLowerCase()
      .replace(/['\u2019]s\b/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !FACT_STOP.has(w))
      .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)), // light stem: loves→love
  );
}
/**
 * Near-duplicate match for KNOWLEDGE facts / SECRET texts (full clauses, not
 * titles). True when, after stripping stopwords, one significant-token set is a
 * subset of the other (e.g. "in love with Daeron" ⊂ "in love with Daeron and has
 * not said the words yet") OR they overlap strongly (Jaccard ≥ .6). Both sides
 * must carry ≥2 significant tokens, so trivially-short facts never blind-merge.
 */
function similarFact(a: string, b: string): boolean {
  if (a.toLowerCase().trim() === b.toLowerCase().trim()) return true;
  const ta = factTokens(a), tb = factTokens(b);
  if (ta.size < 2 || tb.size < 2) return false;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  if (subset(small, big)) return true; // one clause contains the other's content
  let shared = 0; for (const x of ta) if (tb.has(x)) shared++;
  const union = ta.size + tb.size - shared;
  return union > 0 && shared / union >= 0.6;
}
/** Pick the richer (more informative) of two near-duplicate texts — the longer
 * one carries more detail ("…and has not said the words yet"). */
function richer(a: string, b: string): string { return b.length > a.length ? b : a; }

function upsertTrack(list: { name: string; status: string; firstTurn: number; lastTurn: number }[], name: string, status: string, turn: number): void {
  const t = list.find((x) => sameTrack(x.name, name));
  if (t) { t.status = status; t.lastTurn = Math.max(t.lastTurn, turn); } // keep existing (canonical) name
  else list.push({ name, status, firstTurn: turn, lastTurn: turn });
}

/** Layer 3 reduce: fold `from` tracks into `into` (by name), reconciling turns
 * and status to the latest, then drop the merged-away tracks. The `into` track
 * is created if absent. Tolerant of names that don't exist (skip). */
function mergeTracks(list: { name: string; status: string; firstTurn: number; lastTurn: number }[], from: string[], into: string): void {
  const target = list.find((x) => x.name.toLowerCase() === into.toLowerCase());
  const sources = from.filter((f) => f.toLowerCase() !== into.toLowerCase())
    .map((f) => list.find((x) => x.name.toLowerCase() === f.toLowerCase()))
    .filter((x): x is NonNullable<typeof x> => !!x);
  if (!sources.length && target) return;
  const keep = target ?? { name: into, status: 'advance', firstTurn: Infinity, lastTurn: 0 };
  for (const src of sources) {
    keep.firstTurn = Math.min(keep.firstTurn, src.firstTurn);
    if (src.lastTurn >= keep.lastTurn) { keep.lastTurn = src.lastTurn; keep.status = src.status; }
  }
  if (!isFinite(keep.firstTurn)) keep.firstTurn = keep.lastTurn;
  const dropNames = new Set(sources.map((s) => s.name.toLowerCase()));
  // rebuild: remove sources (and the old target slot), then push the merged keep
  for (let i = list.length - 1; i >= 0; i--) {
    if (dropNames.has(list[i]!.name.toLowerCase()) || list[i] === target) list.splice(i, 1);
  }
  list.push(keep);
}

// re-exports used by callers building events from parsed state
export { normalizeCategorySet, primaryCategory, isCategory, sentimentToScores, deriveSentiment };

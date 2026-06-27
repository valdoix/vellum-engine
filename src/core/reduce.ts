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
      s.parallel = e.items.map((it) => ({ ...(it.who ? { who: it.who } : {}), ...(it.where ? { where: it.where } : {}), activity: it.activity, ...(it.note ? { note: it.note } : {}), turn: e.turn, day: e.day }));
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
        if (e.src === 'user') c.userEdited = true;
      }
      break;
    }
    case 'cast.drop': {
      delete s.cast[e.id];
      s.relations = s.relations.filter((r) => r.a !== e.id && r.b !== e.id);
      break;
    }
    case 'bond.delta': {
      let r = findRel(s, e.a, e.b);
      if (!r) {
        r = freshRelation(e.a, e.b, e.turn, e.day, e.src === 'user' ? 'user' : 'auto');
        s.relations.push(r);
      }
      const userLocked = r.userEdited && e.src !== 'user';
      if (e.label && (e.src === 'user' || !r.label)) r.label = e.label.slice(0, 120);
      if (!userLocked) {
        if (e.addCats?.length) addCategories(r, e.addCats, e.turn, e.day, e.why ?? '');
        if (e.removeCats?.length) removeCategories(r, e.removeCats, e.turn, e.day, e.why ?? '', e.src === 'user');
        if (typeof e.aff === 'number' || typeof e.trust === 'number') {
          applyScore(r, e.aff ?? 0, e.trust ?? 0, !!e.absolute, e.turn, e.day, e.why);
        }
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
      const dup = s.knowledge.find((k) => k.who === e.who && k.fact === e.fact);
      if (!dup) s.knowledge.push({ id: `k_${s.knowledge.length}_${e.seq}`, who: e.who, fact: e.fact, ...(e.about ? { about: e.about } : {}), turn: e.turn });
      break;
    }
    case 'knowledge.drop': {
      s.knowledge = s.knowledge.filter((k) => k.id !== e.id);
      break;
    }
    case 'secret.form': {
      if (!s.secrets.find((x) => x.id === e.id)) {
        s.secrets.push({ id: e.id, keeper: e.keeper, from: e.from, text: e.text, revealed: false, revealedTo: [], formedTurn: e.turn });
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
    case 'memory.record': {
      if (!s.memories.find((m) => m.id === e.id)) {
        s.memories.push({ id: e.id, tier: e.tier, text: e.text, keys: e.keys, ...(e.covers ? { covers: e.covers } : {}), ...(e.subsumed ? { subsumed: e.subsumed } : {}), turn: e.turn });
      }
      break;
    }
    case 'memory.drop': {
      // deleting a CHAPTER restores the turn-memories it subsumed (so a user can
      // undo a compression and get the per-turn detail back); other drops just remove.
      const target = s.memories.find((m) => m.id === e.id);
      s.memories = s.memories.filter((m) => m.id !== e.id);
      if (target?.tier === 'chapter' && target.subsumed?.length) {
        for (const sm of target.subsumed) {
          if (!s.memories.find((m) => m.id === sm.id)) s.memories.push({ id: sm.id, tier: 'turn', text: sm.text, keys: sm.keys ?? [], turn: sm.turn });
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
    case 'journal.entry': {
      if (!s.journal.find((j) => j.id === e.id)) {
        // dedupe identical memory text for the same holder
        if (!s.journal.find((j) => j.who === e.who && j.memory === e.memory)) {
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
    default: {
      // exhaustiveness guard — a new event kind must be handled here
      const _never: never = e;
      void _never;
    }
  }
}

function upsertTrack(list: { name: string; status: string; firstTurn: number; lastTurn: number }[], name: string, status: string, turn: number): void {
  const t = list.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (t) { t.status = status; t.lastTurn = turn; }
  else list.push({ name, status, firstTurn: turn, lastTurn: turn });
}

// re-exports used by callers building events from parsed state
export { normalizeCategorySet, primaryCategory, isCategory, sentimentToScores, deriveSentiment };

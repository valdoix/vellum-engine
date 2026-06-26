import type { VellumEvent } from '../core/events.js';
import { pairKey } from '../core/ids.js';
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
  const key = pairKey(a, b);
  return s.relations.find((r) => pairKey(r.a, r.b) === key);
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
        Object.assign(c, e.patch);
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
      const key = pairKey(e.a, e.b);
      s.relations = s.relations.filter((r) => pairKey(r.a, r.b) !== key);
      break;
    }
    case 'knowledge.learn': {
      const dup = s.knowledge.find((k) => k.who === e.who && k.fact === e.fact);
      if (!dup) s.knowledge.push({ id: `k_${s.knowledge.length}_${e.seq}`, who: e.who, fact: e.fact, ...(e.about ? { about: e.about } : {}), turn: e.turn });
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
    case 'memory.record': {
      if (!s.memories.find((m) => m.id === e.id)) {
        s.memories.push({ id: e.id, tier: e.tier, text: e.text, keys: e.keys, ...(e.covers ? { covers: e.covers } : {}), turn: e.turn });
      }
      break;
    }
    case 'memory.drop': {
      s.memories = s.memories.filter((m) => m.id !== e.id);
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

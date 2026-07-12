import type { VellumEvent } from '../core/events.js';
import { canonId } from '../core/ids.js';
import { type ChronicleState, type Relation, type Track, freshState } from '../domain/types.js';
import { freshRelation, applyScore, addCategories, removeCategories, sentimentToScores, deriveSentiment } from '../domain/relations.js';
import { normalizeCategorySet, primaryCategory, isCategory } from '../domain/category.js';
import { parseClock } from '../domain/clock.js';
import { isCatchupMarker } from '../domain/thread-catchup.js';

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
    case 'config.set': {
      if (e.dateFormat) s.dateFormat = e.dateFormat;
      if (e.dateEpoch !== undefined) {
        const d = e.dateEpoch ? new Date(e.dateEpoch) : undefined;
        s.dateEpoch = d && !isNaN(d.getTime()) ? d : undefined;
      }
      // fantasy calendar naming: an empty array clears back to defaults
      if (e.monthNames !== undefined) s.monthNames = e.monthNames.length ? e.monthNames : undefined;
      if (e.monthNamesShort !== undefined) s.monthNamesShort = e.monthNamesShort.length ? e.monthNamesShort : undefined;
      if (e.yearPrefix !== undefined) s.yearPrefix = e.yearPrefix || undefined;
      if (e.yearSuffix !== undefined) s.yearSuffix = e.yearSuffix || undefined;
      break;
    }
    case 'tone.set': {
      // last-write-wins per dial: an event may carry only the dial(s) that
      // changed, so absent fields leave the current value intact. Invalid values
      // can't reach here (zod-validated at load), so no re-parse is needed.
      if (e.romance !== undefined) s.tone.romance = e.romance;
      if (e.disposition !== undefined) s.tone.disposition = e.disposition;
      if (e.social !== undefined) s.tone.social = e.social;
      if (e.politics !== undefined) s.tone.politics = e.politics;
      break;
    }
    case 'scene.set': {
      // MERGE MODE (prose extractor recovery): never rewrite the scene wholesale
      // or demote anyone — only ADD missing present ids and FILL empty detail
      // fields (esp. inner thoughts) so a dropped/truncated <vellum> block doesn't
      // lose interiority. An authored value from the block always wins.
      if (e.mergeDetail) {
        const present = s.scene.present.slice();
        for (const id of e.present) if (id && !present.includes(id)) present.push(id);
        const detail = s.scene.detail.map((d) => ({ ...d }));
        const byId = new Map(detail.map((d) => [d.id, d] as const));
        for (const d of e.detail ?? []) {
          const cur = byId.get(d.id);
          if (cur) {
            // only fill fields the block left EMPTY — never overwrite authored detail
            if (!cur.mood && d.mood) cur.mood = d.mood;
            if (!cur.doing && d.doing) cur.doing = d.doing;
            if (!cur.condition && d.condition) cur.condition = d.condition;
            if (!cur.thought && d.thought) cur.thought = d.thought;
          } else {
            const nd = { id: d.id, ...(d.mood ? { mood: d.mood } : {}), ...(d.doing ? { doing: d.doing } : {}), ...(d.condition ? { condition: d.condition } : {}), ...(d.thought ? { thought: d.thought } : {}) };
            detail.push(nd); byId.set(d.id, nd);
          }
        }
        // fill an absent clock from an incoming one, or derive from a new time
        // string — but never overwrite an existing authored clock (merge = fill).
        const mClock = s.scene.clock ?? e.clock ?? (e.time ? parseClock(e.time) : undefined);
        s.scene = { ...s.scene, present, detail, ...(mClock !== undefined ? { clock: mClock } : {}) };
        break;
      }
      // ordered clock: prefer the event's explicit clock, else derive from the
      // (new or carried) time string. Undefined when nothing is parseable.
      const nextTime = e.time ?? s.scene.time;
      // explicit clock wins; else derive from a NEW time string; else keep the
      // established clock (an unparseable/absent time never erases the order).
      const clock = e.clock ?? (e.time ? parseClock(e.time) : undefined) ?? s.scene.clock;
      s.scene = {
        location: e.location ?? s.scene.location,
        time: nextTime,
        ...(clock !== undefined ? { clock } : {}),
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
      // scene-day anchors for the NOW "since last scene" span: when this scene
      // sits on a LATER narrative day than the one we last recorded, the prior
      // day slides back to prevSceneDay. Same-day re-sets don't shift the anchor.
      if (e.day > 0) {
        if (s.sceneDay === undefined) s.sceneDay = e.day;
        else if (e.day > s.sceneDay) { s.prevSceneDay = s.sceneDay; s.sceneDay = e.day; }
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
        if (safe.dialogueColor === '') delete c.dialogueColor;
        if (safe.imageUrl === '') delete c.imageUrl;
        // deceased false = alive again → drop the flag so it's truly absent
        if (safe.deceased === false) delete c.deceased;
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
      s.items = s.items.filter((x) => x.who !== e.id);
      s.traitHistory = s.traitHistory.filter((x) => x.who !== e.id);
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
      s.factionRelations = s.factionRelations.filter((r) => r.a !== e.id && r.b !== e.id);
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
    case 'factionrel.op': {
      if (!e.a || !e.b || e.a === e.b) break;
      ensureFaction(s, e.a, e.turn); ensureFaction(s, e.b, e.turn);
      const clamp = (n: number): number => Math.max(-100, Math.min(100, n));
      let fr = s.factionRelations.find((r) => r.a === e.a && r.b === e.b);
      if (!fr) {
        fr = { a: e.a, b: e.b, kind: e.relkind ?? 'rivalry', standing: 0, firstTurn: e.turn, lastTurn: e.turn };
        s.factionRelations.push(fr);
      }
      if (e.relkind) fr.kind = e.relkind;
      if (typeof e.standing === 'number') fr.standing = clamp(e.absolute ? e.standing : fr.standing + e.standing);
      if (e.note !== undefined) { if (e.note) fr.note = e.note; else delete fr.note; }
      fr.lastTurn = Math.max(fr.lastTurn, e.turn);
      break;
    }
    case 'factionrel.drop': {
      if (e.both) s.factionRelations = s.factionRelations.filter((r) => !((r.a === e.a && r.b === e.b) || (r.a === e.b && r.b === e.a)));
      else s.factionRelations = s.factionRelations.filter((r) => !(r.a === e.a && r.b === e.b));
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
      upsertTrack(s.threads, e.name, e.op === 'resolve' ? 'resolved' : (e.note ?? e.op), e.turn, e.note, e.op, e.day);
      break;
    }
    case 'arc.op': {
      upsertTrack(s.arcs, e.name, e.op === 'resolve' ? 'resolved' : (e.note ?? e.op), e.turn, e.note, e.op, e.day);
      break;
    }
    case 'thread.merge': {
      const remap = mergeTracks(s.threads, e.from, e.into);
      // keep explicit off-screen links valid: repoint any ref at a folded-away
      // thread id to the survivor (the stale-ref hole the id refactor closes).
      if (remap) for (const o of s.offscreen) if (o.thread && remap.dropped.has(o.thread)) o.thread = remap.keep;
      break;
    }
    case 'arc.merge': {
      const remap = mergeTracks(s.arcs, e.from, e.into);
      // keep thread->arc links valid: repoint any thread whose folded-away arc id
      // now points at the survivor (mirrors the offscreen repoint above).
      if (remap) for (const t of s.threads) if (t.arc && remap.dropped.has(t.arc)) t.arc = remap.keep;
      break;
    }
    case 'thread.set': {
      // user CRUD: edit by id, else upsert by name. `note` accrues as a beat.
      const list = e.kindArc ? s.arcs : s.threads;
      const cur = e.id ? list.find((t) => t.id === e.id) : list.find((t) => sameTrack(t.name, e.name));
      // optional parent-arc link edit (threads only): set/clear `thread.arc` to the
      // chosen arc's stable id. Honored on BOTH the existing-thread path and the
      // mint path, so a single event can create-and-link a thread in one step.
      // Empty/missing `arc` leaves the link untouched. Runs whether or not
      // name/status/note also changed, so a single event can relabel and re-parent.
      const wantArc = !e.kindArc && e.arc !== undefined;
      const arcId = wantArc ? String(e.arc || '').trim() : '';
      if (cur) {
        cur.name = e.name;
        if (e.status !== undefined) cur.status = e.status;
        cur.lastTurn = Math.max(cur.lastTurn, e.turn);
        stampTrackDay(cur, e.day);
        if (wantArc) { if (arcId) cur.arc = arcId; else delete cur.arc; }
        // `fill`: an authored Time Sync beat REPLACES a trailing "caught up: …"
        // placeholder marker in place, so generating real content swaps out the
        // bare marker rather than leaving both. Falls back to a normal push when
        // there's no marker to replace.
        if (e.note && e.fill && isCatchupMarker(cur.beats[cur.beats.length - 1])) {
          cur.beats = [...cur.beats.slice(0, -1), e.note.trim()].slice(-6);
        } else if (e.note) pushTrackBeat(cur, e.note);
      } else {
        upsertTrack(list, e.name, e.status ?? 'advance', e.turn, e.note, 'new', e.day);
        if (wantArc && arcId) {
          const minted = list.find((t) => sameTrack(t.name, e.name));
          if (minted) minted.arc = arcId;
        }
      }
      break;
    }
    case 'thread.drop': { s.threads = s.threads.filter((t) => t.id !== e.id); break; }
    case 'arc.drop': {
      // dropping an arc unparents any threads that belonged to it — they revert to
      // free threads rather than danging at a deleted arc (mirrors the convention
      // that explicit links point at real rows).
      for (const t of s.threads) if (t.arc === e.id) delete t.arc;
      s.arcs = s.arcs.filter((t) => t.id !== e.id);
      break;
    }
    case 'offscreen.op': {
      const list = s.offscreen;
      let ot = list.find((o) => o.id === e.id);
      if (!ot) {
        if (e.op === 'resolve') break; // nothing to resolve
        ot = { id: e.id, name: e.name || e.id, status: 'active', gist: e.gist ?? '', beats: [], firstTurn: e.turn, lastTurn: e.turn, ...(e.who ? { who: e.who } : {}), ...(e.where ? { where: e.where } : {}), ...(e.thread ? { thread: e.thread } : {}) };
        list.push(ot);
      }
      if (e.name) ot.name = e.name;
      if (e.who) ot.who = e.who;
      if (e.where) ot.where = e.where;
      if (e.thread !== undefined) { if (e.thread) ot.thread = e.thread; else delete ot.thread; }
      // `fill`: an authored Time Sync beat REPLACES a trailing "caught up: …"
      // placeholder gist in place. The gist is also the newest beat (beats mirrors
      // gist accumulation), so pop both when replacing. Falls back to normal append.
      if (e.gist && e.fill && isCatchupMarker(ot.beats[ot.beats.length - 1])) {
        ot.gist = e.gist;
        ot.beats = [...ot.beats.slice(0, -1), e.gist].slice(-6);
      } else if (e.gist) { ot.gist = e.gist; ot.beats = [...ot.beats, e.gist].slice(-6); }
      ot.lastTurn = Math.max(ot.lastTurn, e.turn);
      if (ot.firstDay === undefined) ot.firstDay = e.day;
      ot.lastDay = ot.lastDay === undefined ? e.day : Math.max(ot.lastDay, e.day);
      if (e.op === 'resolve') ot.status = 'resolved';
      break;
    }
    case 'offscreen.link': {
      const ot = s.offscreen.find((o) => o.id === e.id);
      if (ot) { if (e.thread) ot.thread = e.thread; else delete ot.thread; } // '' clears
      break;
    }
    case 'offscreen.drop': {
      s.offscreen = s.offscreen.filter((o) => o.id !== e.id);
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
    case 'item.change': {
      const norm = (x: string): string => x.trim().toLowerCase();
      const findItem = (who: string, item: string) => s.items.find((x) => x.who === who && norm(x.item) === norm(item));
      if (e.op === 'gain' || e.op === 'scene') {
        if (e.who !== 'world') ensureCast(s, e.who, e.turn);
        const dup = findItem(e.who, e.item);
        if (dup) { if (e.note) dup.note = e.note; }
        else s.items.push({ id: e.id, who: e.who, item: e.item, ...(e.note ? { note: e.note } : {}), ...(e.op === 'scene' || e.who === 'world' ? { scene: true } : {}), turn: e.turn });
      } else if (e.op === 'lose' || e.op === 'give') {
        const cur = findItem(e.who, e.item);
        if (cur) s.items = s.items.filter((x) => x !== cur);
        if (e.op === 'give' && e.to && e.to !== 'world') {
          ensureCast(s, e.to, e.turn);
          if (!findItem(e.to, e.item)) s.items.push({ id: e.id, who: e.to, item: e.item, ...(e.note ? { note: e.note } : {}), turn: e.turn });
        } else if (e.op === 'give' && e.to === 'world') {
          if (!findItem('world', e.item)) s.items.push({ id: e.id, who: 'world', item: e.item, scene: true, ...(e.note ? { note: e.note } : {}), turn: e.turn });
        }
      } else if (e.op === 'note') {
        const cur = findItem(e.who, e.item);
        if (cur) { if (e.note) cur.note = e.note; }
        else { if (e.who !== 'world') ensureCast(s, e.who, e.turn); s.items.push({ id: e.id, who: e.who, item: e.item, ...(e.note ? { note: e.note } : {}), ...(e.who === 'world' ? { scene: true } : {}), turn: e.turn }); }
      }
      break;
    }
    case 'item.drop': {
      s.items = s.items.filter((x) => x.id !== e.id);
      break;
    }
    case 'location.set': {
      const norm = (x: string): string => x.trim().toLowerCase();
      const cur = s.locations.find((l) => l.id === e.id) ?? s.locations.find((l) => norm(l.name) === norm(e.name));
      // Resolve the event's intent into the split model (source = provenance,
      // pinned = injection). New events carry source/pinned directly; LEGACY
      // events only carry `auto` (auto:true → model/keyed, auto:false → the old
      // "pinned & sticky" semantics = user-owned + always-injected).
      const evSource: 'auto' | 'user' | undefined =
        e.source ?? (e.auto === true ? 'auto' : e.auto === false ? 'user' : undefined);
      const evPinned: boolean | undefined =
        e.pinned ?? (e.auto === false ? true : e.auto === true ? false : undefined);
      if (cur) {
        const isUser = e.src === 'user';
        const isContentEdit = isUser && (e.note !== undefined || e.parent !== undefined || (e.pinned === undefined && e.auto === undefined));
        cur.name = e.name;
        if (e.note !== undefined) cur.note = e.note;
        if (e.parent !== undefined) { if (e.parent) cur.parent = e.parent; else delete cur.parent; } // '' clears
        // pin/unpin: apply the resolved pinned flag. A user action always wins; a
        // non-user (auto refresh) event must never turn OFF an existing user pin
        // — mirror the old "auto never downgrades a pin" guard.
        const wantPinned = e.pinned !== undefined ? e.pinned : evPinned;
        if (wantPinned !== undefined && (isUser || !(wantPinned === false && cur.pinned === true))) cur.pinned = wantPinned;
        // provenance: a user CONTENT edit flips a model place to user-owned (drops
        // the auto icon, per the design). An explicit source applies, but a non-user
        // (auto refresh) event must never overwrite a user-owned source.
        if (isContentEdit) cur.source = 'user';
        else if (e.source !== undefined) { if (isUser || cur.source !== 'user') cur.source = e.source; }
        else if (evSource === 'user' && cur.source !== 'auto') cur.source = 'user';
        cur.lastTurn = e.turn;
      } else {
        s.locations.push({
          id: e.id, name: e.name,
          ...(e.note ? { note: e.note } : {}),
          ...(evSource !== undefined ? { source: evSource } : {}),
          ...(evPinned !== undefined ? { pinned: evPinned } : {}),
          ...(e.parent ? { parent: e.parent } : {}),
          firstTurn: e.turn, lastTurn: e.turn,
        });
      }
      break;
    }
    case 'location.drop': {
      s.locations = s.locations.filter((l) => l.id !== e.id);
      break;
    }
    case 'continuity.flag': {
      // Dedupe by (code+detail): a standing advisory (thread/clock desync) re-fires
      // the same text each fold, so without this an already-flooded log would keep
      // 50 identical desync rows and bury genuine one-shot time flags. Drop any
      // prior identical entry and re-push at the tail (newest turn wins) so each
      // distinct finding appears exactly once, most-recent-first when displayed.
      const dupKey = e.code + '\u0000' + e.detail;
      const at = s.continuityFlags.findIndex((f) => f.code + '\u0000' + f.detail === dupKey);
      if (at !== -1) s.continuityFlags.splice(at, 1);
      s.continuityFlags.push({ turn: e.turn, code: e.code, detail: e.detail });
      if (s.continuityFlags.length > 50) s.continuityFlags = s.continuityFlags.slice(-50); // ring buffer
      break;
    }
    case 'day.set': {
      // the SINGLE sanctioned override of the monotonic day rule: absolute SETS
      // (can lower a spurious high day), otherwise it advances like a report.
      s.day = e.absolute ? e.day : Math.max(s.day, e.day);
      break;
    }
    case 'trait.drift': {
      s.traitHistory.push({ who: e.who, trait: e.trait, op: e.op, ...(e.from ? { from: e.from } : {}), ...(e.cause ? { cause: e.cause } : {}), ...(e.causeId ? { causeId: e.causeId } : {}), turn: e.turn });
      if (s.traitHistory.length > 400) s.traitHistory = s.traitHistory.slice(-400); // ring buffer
      break;
    }
    case 'plant.set': {
      const norm = (x: string): string => x.trim().toLowerCase();
      if (!s.plants.find((p) => p.id === e.id) && !s.plants.find((p) => norm(p.what) === norm(e.what) && p.status === 'planted')) {
        s.plants.push({ id: e.id, what: e.what, status: 'planted', ...(e.subject ? { subject: e.subject } : {}), plantedTurn: e.turn, ...(e.day > 0 ? { plantedDay: e.day } : {}) });
      }
      break;
    }
    case 'plant.pay': {
      const p = s.plants.find((x) => x.id === e.id) ?? s.plants.find((x) => x.status === 'planted' && x.what.trim().toLowerCase() === (e as { what?: string }).what?.trim().toLowerCase());
      if (p) { p.status = 'paid'; p.paidTurn = e.turn; if (e.note) p.payNote = e.note; }
      break;
    }
    case 'plant.abandon': {
      const p = s.plants.find((x) => x.id === e.id);
      if (p) { p.status = 'abandoned'; if (e.note) p.payNote = e.note; }
      break;
    }
    case 'plant.drop': {
      s.plants = s.plants.filter((x) => x.id !== e.id);
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

/** Push a beat onto a track's running history (newest last), capped, deduping an
 * immediate repeat. Mirrors the OffscreenThread beats discipline. */
function pushTrackBeat(t: Track, beat: string): void {
  const b = beat.trim();
  if (!b || t.beats[t.beats.length - 1] === b) return;
  t.beats = [...t.beats, b].slice(-6);
}

/** Stamp a track's narrative-day anchors. firstDay is set once (earliest seen);
 * lastDay only advances (monotonic, mirrors s.day) so a thread's day never runs
 * backward. A `day` of 0/undefined (pre-day-stamp fold) leaves anchors untouched
 * so legacy logs and callers that don't carry a day stay valid. */
function stampTrackDay(t: Track, day?: number): void {
  if (!day || day <= 0) return;
  if (t.firstDay === undefined) t.firstDay = day;
  t.lastDay = t.lastDay === undefined ? day : Math.max(t.lastDay, day);
}

/** Upsert a track by fuzzy title match (sameTrack). The id is engine-assigned on
 * FIRST sight (slug of the first title) and never changes as the model's title
 * drifts — the model speaks in titles, the engine owns the id. A `note` (or the
 * op, for a genuine step) accrues onto beats[]. */
function upsertTrack(list: Track[], name: string, status: string, turn: number, note?: string, op?: string, day?: number): void {
  const t = list.find((x) => sameTrack(x.name, name));
  if (t) {
    t.status = status; t.lastTurn = Math.max(t.lastTurn, turn); // keep existing (canonical) id + name
  } else {
    // mint a collision-free id from the first title
    let id = 'thr_' + canonId(name); let n = 2;
    while (list.some((x) => x.id === id)) id = 'thr_' + canonId(name) + '_' + n++;
    list.push({ id, name, status, beats: [], firstTurn: turn, lastTurn: turn });
  }
  const cur = list.find((x) => sameTrack(x.name, name));
  if (cur) stampTrackDay(cur, day);
  // record a beat only for a real story step (a note, or a new/advance/resolve),
  // never for a bare status echo that carries no information.
  if (cur && note) pushTrackBeat(cur, note);
  else if (cur && (op === 'new' || op === 'resolve')) pushTrackBeat(cur, op === 'resolve' ? 'resolved' : name);
}

/** Layer 3 reduce: fold `from` tracks into `into` (by name), reconciling turns,
 * status, and beats to the survivor, then drop the merged-away tracks. The `into`
 * track is created if absent. Tolerant of names that don't exist (skip). The
 * surviving id is the target's (or a source's, or freshly minted). */
function mergeTracks(list: Track[], from: string[], into: string): { keep: string; dropped: Set<string> } | null {
  const target = list.find((x) => x.name.toLowerCase() === into.toLowerCase());
  const sources = from.filter((f) => f.toLowerCase() !== into.toLowerCase())
    .map((f) => list.find((x) => x.name.toLowerCase() === f.toLowerCase()))
    .filter((x): x is NonNullable<typeof x> => !!x);
  if (!sources.length && target) return null;
  const keep: Track = target ?? { id: sources[0]?.id ?? ('thr_' + canonId(into)), name: into, status: 'advance', beats: [], firstTurn: Infinity, lastTurn: 0 };
  // union beats in turn order (target first, then sources), deduped + capped
  const merged = [...keep.beats];
  for (const src of sources) {
    keep.firstTurn = Math.min(keep.firstTurn, src.firstTurn);
    if (src.lastTurn >= keep.lastTurn) { keep.lastTurn = src.lastTurn; keep.status = src.status; }
    // reconcile narrative-day anchors: firstDay = earliest, lastDay = latest,
    // treating undefined as "no anchor" so pre-day-stamp tracks don't zero it.
    if (src.firstDay !== undefined) keep.firstDay = keep.firstDay === undefined ? src.firstDay : Math.min(keep.firstDay, src.firstDay);
    if (src.lastDay !== undefined) keep.lastDay = keep.lastDay === undefined ? src.lastDay : Math.max(keep.lastDay, src.lastDay);
    for (const b of src.beats) if (b && merged[merged.length - 1] !== b && !merged.includes(b)) merged.push(b);
  }
  keep.beats = merged.slice(-6);
  // preserve the parent-arc link across the fold: the survivor inherits the
  // target's arc if set, else any merged source's arc (so merging two threads of
  // the same arc does not orphan the survivor from its arc).
  if (target && (target as Track).arc) keep.arc = (target as Track).arc;
  else for (const src of sources) if ((src as Track).arc) { keep.arc = (src as Track).arc; break; }
  if (!isFinite(keep.firstTurn)) keep.firstTurn = keep.lastTurn;
  // every source id is folded away; `keep` (fresh object or the target) is pushed
  // separately. When no target existed, keep borrows sources[0]'s id — that source
  // object is still spliced out here, so the re-pushed keep leaves exactly one row.
  const dropped = new Set(sources.map((s) => s.id));
  for (let i = list.length - 1; i >= 0; i--) {
    if (dropped.has(list[i]!.id) || list[i] === target) list.splice(i, 1);
  }
  list.push(keep);
  // the off-screen rewrite compares against dropped ids EXCLUDING the survivor's,
  // so a link already on the survivor is left untouched.
  dropped.delete(keep.id);
  return { keep: keep.id, dropped };
}

// re-exports used by callers building events from parsed state
export { normalizeCategorySet, primaryCategory, isCategory, sentimentToScores, deriveSentiment };

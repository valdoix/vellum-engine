import type { ChronicleState } from '../domain/types.js';
import { collectItems, buildIndex, type InvertedIndex, type RetrievableItem } from './invindex.js';
import { lexicalSearch } from './lexical.js';
import { allocate, fitLines } from './budget.js';
import { rrf } from './fuse.js';
import { vectorSearch } from './embed.js';
import { hashStr } from '../core/ids.js';
import { traverseRanked, type CallModel, type TraversalTrace } from './traverse.js';
import { traverseTree, type TreeTraversalTrace } from './traverse-tree.js';
import { linkedOffscreen, linkedThreads } from '../domain/offscreen.js';
import { spanLabel, formatDate } from '../domain/date-format.js';
import { clockLabel } from '../domain/clock.js';
import { tokenize } from './tokenize.js';

/**
 * Recall assembler. Produces the text VELLUM injects into the prompt, in two
 * distinct kinds of block:
 *
 *  1. STRUCTURED (authoritative) — cast + active relations, injected VERBATIM.
 *     Never scored, never similarity-retrieved. This is the continuity
 *     guardrail: facts the engine owns deterministically are stated as fact.
 *
 *  2. RECALL (retrieved) — prose context (knowledge/secrets/memories) selected
 *     by lexical relevance to the current scene, recency-weighted. Advisory.
 *
 * Phase 3 will fuse host embeddings into (2) via RRF; (1) never changes.
 */

export interface InjectionResult {
  text: string;
  recallIds: string[];
  source: 'lexical' | 'hybrid' | 'traversal' | 'traversal-tree';
  trace?: TraversalTrace;
  treeTrace?: TreeTraversalTrace;
}

// knowledge items flow through collectItems→ranked recall (kind:'knowledge'); the
// old separate `knowledge:900` cap was never rendered and only forced TOTAL down-
// scaling. structured 1800 + recall 2600 = 4400 ≤ 4400 → no spurious scaling.
// (Raised from 1400/1800/3600: structured grows for cast personality traits, and
// recall grows so compressed long-term summaries/facts aren't clipped.)
const CAPS = { structured: 1800, recall: 2600 };
const TOTAL = 4400;

// cache the index per chat so we don't rebuild every interceptor call
interface IndexCache { sig: string; version?: number; index: InvertedIndex }
const _idx = new Map<string, IndexCache>();

/**
 * Index cache key. A count-based sig misses in-place CONTENT edits (Fix 20):
 * editing a knowledge fact without adding/removing rows kept the stale index.
 * When the caller knows the log length it passes `version` (monotonic, bumps on
 * any append/edit); otherwise we fall back to a cheap content signature over the
 * items' ids + text lengths.
 *
 * Two-level gate (perf): the monotonic `version` is checked FIRST as an O(1)
 * short-circuit — most turns hit it and skip collectItems entirely. When the
 * version advanced we recompute the item-content signature (id + full text) and
 * only rebuild the (tokenized) index if that ACTUALLY changed. Many appends are
 * non-retrievable events (turn.fold / scene.set / bond.delta / continuity.flag)
 * that bump the version without touching any retrievable item, so this avoids a
 * needless re-tokenize while staying correctness-safe: the signature still moves
 * on any knowledge/secret/memory/journal add, drop, OR in-place text edit.
 */
function indexFor(chatId: string, state: ChronicleState, version?: number): InvertedIndex {
  const cached = _idx.get(chatId);
  if (version !== undefined) {
    // hot path: version unchanged since the last build → reuse, no work at all.
    if (cached && cached.version === version) return cached.index;
    // version advanced: does the retrievable-item content actually differ?
    const items = collectItems(state);
    const sig = itemsSig(items);
    if (cached && cached.sig === sig) { cached.version = version; return cached.index; }
    const index = buildIndex(items);
    _idx.set(chatId, { sig, version, index });
    return index;
  }
  // fallback (no version, e.g. tests): cheap content signature over id+length.
  const items = collectItems(state);
  const sig = itemsSig(items);
  if (cached && cached.sig === sig) return cached.index;
  const index = buildIndex(items);
  _idx.set(chatId, { sig, index });
  return index;
}

/** Content signature over retrievable items: id + FULL text. Moves on any
 * add/drop/reorder AND on any in-place text edit — including one that keeps the
 * same length — so it's exactly as safe as the previous "rebuild on every
 * version bump" behavior (never a stale index), while still letting us skip the
 * postings rebuild when nothing retrievable actually changed. */
function itemsSig(items: RetrievableItem[]): string {
  let acc = '';
  for (const i of items) acc += [i.id, i.text, i.status ?? '', i.audience ?? '', i.authority ?? '', (i.entityIds ?? []).join(','), (i.knownBy ?? []).join(','), (i.hiddenFrom ?? []).join(',')].join('\u0000') + '\u0001';
  return hashStr(acc);
}

export function invalidateIndex(chatId?: string): void {
  if (chatId) _idx.delete(chatId);
  else _idx.clear();
}

/**
 * Shared inverted index for a chat — the SAME cache the interceptor's recall
 * uses. Exposed so background jobs (e.g. tree precompute) reuse the built,
 * tokenized postings instead of constructing a parallel index per call. Honors
 * the two-level version/content gate, so a warm cache is returned with no work.
 */
export function sharedIndex(chatId: string, state: ChronicleState, version?: number): InvertedIndex {
  return indexFor(chatId, state, version);
}

/** Authoritative structured block: present/active cast + their bonds, verbatim. */
function structuredBlock(state: ChronicleState, budget: number, query = ''): string {
  const present = new Set(state.scene.present);
  const cast = Object.values(state.cast)
    .filter((c) => present.has(c.id) || c.status === 'present' || c.status === 'active')
    .sort((a, b) => (b.lastTurn || 0) - (a.lastTurn || 0));
  const castLines = cast.map((c) => {
    // deceased is authoritative + orthogonal to presence: the model may remember or
    // mention them, but they cannot act, speak, or appear except in flashback/vision.
    if (c.deceased) return '- ' + c.name + ' (DECEASED \u2014 may be remembered or mentioned; cannot act, speak, or appear except in flashback/vision)';
    const bits = [c.role, c.age, c.appearance].filter(Boolean).join('; ');
    // append a capped personality clause (top 3 traits) so the model holds voice
    // consistent; fitLines clips the whole line if the shared budget is tight.
    const traits = (c.traits ?? []).slice(0, 3).join(', ');
    const tail = [bits, traits].filter(Boolean).join('; ');
    return '- ' + c.name + (tail ? ' (' + tail + ')' : '');
  });
  const nameOf = (id: string): string => state.cast[id]?.name ?? id;
  const relLines = state.relations
    .filter((r) => present.has(r.a) || present.has(r.b))
    .slice(0, 12)
    .map((r) => {
      const cats = (r.categories.length ? r.categories : [r.category]).join('+');
      return '- ' + nameOf(r.a) + ' \u2192 ' + nameOf(r.b) + ': ' + cats + ' (' + r.sentiment + ', aff ' + r.affection + '/trust ' + r.trust + ')';
    });
  // OPEN THREADS / ARCS (Layer 1): surface the model's own unresolved threads so
  // it ADVANCES them under their existing title instead of coining a new label
  // each turn ("Jaime's Arrival" → "Jaime at Harrenhal"). Non-resolved, newest
  // first, capped. This is the highest-leverage anti-fragmentation fix.
  const isOpen = (t: { status: string }): boolean => !/resolv/i.test(t.status || '');
  // reflect the bridge back: if the off-screen sim advanced a subplot that ties
  // into this thread, annotate the thread with its latest off-screen beat so the
  // narrator picks up where the sim left off ("The Letter … off-screen: B opened it").
  const offBeat = (t: { id?: string; name: string }): string => {
    const links = linkedOffscreen(state, t);
    if (!links.length) return '';
    const beat = links[0]!.gist || links[0]!.beats[links[0]!.beats.length - 1] || '';
    return beat ? ' \u2014 off-screen: ' + beat : '';
  };
  // ARC side of the arc<->thread bridge: an arc may own several threads, each with
  // their own momentum. Roll the arc's own latest beat up with the latest beat of
  // every thread linked to it, so the narrator reads the arc's true state rather
  // than the single arc-line summary ("The Heist … A got the plans; B picked the
  // lock"). Capped so a wide arc never blows the structured budget.
  const arcBeat = (t: { id?: string; name: string }): string => {
    const linked = linkedThreads(state, t);
    if (!linked.length && !t.name) return '';
    const clauses: string[] = [];
    const seen = new Set<string>();
    // strict label+beat budget: a long label is shortened, but the beat is NEVER
    // dropped per truncation — the line is what carries the momentum detail. The
    // budget bar (label ≤18 chars + beat ≤80) keeps a wide arc inside the shared
    // structured block budget.
    const note = (label: string, beats: string[]) => {
      const b = beats[beats.length - 1];
      if (b && !seen.has(b)) { seen.add(b); const lab = label.length > 18 ? label.slice(0, 18) + '…' : label; clauses.push(lab + ' — ' + b.slice(0, 80)); }
    };
    // enumerate the arc's owned threads (capped to keep the line compact), deduped
    // by text so a shared milestone isn't repeated across sibling threads.
    for (const th of linked.slice(0, 5)) {
      note(th.name, th.beats);
    }
    if (!clauses.length) return '';
    return ' \u2014 threads ' + linked.length + (linked.length > clauses.length ? ', ' + (linked.length - clauses.length) + ' quiet' : '') + ': ' + clauses.join('; ');
  };
  // SKIP-LAG note: a thread last touched on a narrative day well before the
  // current day was left behind by a time-skip — the on-screen scene jumped ahead
  // while this thread's state is still pre-skip. Flag the elapsed span so the
  // narrator advances it to "now" instead of resuming it as if no time passed.
  const nowDay = state.day || 0;
  const skipLag = (t: { lastDay?: number }): string => {
    if (t.lastDay === undefined || nowDay <= 0) return '';
    const span = spanLabel(nowDay - t.lastDay);
    return span ? ' \u2014 last advanced ~' + span + ' ago; catch it up to now' : '';
  };
  const trackLine = (t: { id?: string; name: string; status: string; lastDay?: number }, withOff: boolean, withArc = false): string =>
    '- ' + t.name + (t.status && !/^(advance|new)$/i.test(t.status) ? ': ' + t.status : '') + (withOff ? offBeat(t) : '') + (withArc ? arcBeat(t) : '') + skipLag(t);
  // day-aware sort: order by narrative recency (lastDay) first, falling back to
  // turn order when days are absent/equal — so under a skip the freshest-day
  // threads lead and the lagging ones are visibly last (and carry the note above).
  const byRecency = (a: { lastDay?: number; lastTurn?: number }, b: { lastDay?: number; lastTurn?: number }): number =>
    ((b.lastDay ?? -1) - (a.lastDay ?? -1)) || ((b.lastTurn || 0) - (a.lastTurn || 0));
  const openThreads = state.threads.filter(isOpen).sort(byRecency).slice(0, 6).map((t) => trackLine(t, true));
  const openArcs = state.arcs.filter(isOpen).sort(byRecency).slice(0, 2).map((t) => trackLine(t, false, true));

  // present/active factions + their standing toward the player (authoritative,
  // like cast). Reuses the shared structured budget.
  const facLines = Object.values(state.factions)
    .filter((f) => f.status === 'present' || f.status === 'active')
    .sort((a, b) => (b.lastTurn || 0) - (a.lastTurn || 0))
    .slice(0, 8)
    .map((f) => {
      const facName = (id: string): string => state.factions[id]?.name ?? id.replace(/^fac:/, '');
      const rels = (state.factionRelations ?? []).filter((r) => r.a === f.id).map((r) => r.kind + ' with ' + facName(r.b));
      return '- ' + f.name + (f.kind ? ' (' + f.kind + ')' : '') + ': ' + standingWord(f.standing) + ' toward you (standing ' + f.standing + (f.trust ? '/trust ' + f.trust : '') + ')' + (rels.length ? '; ' + rels.join(', ') : '');
    });

  // Codex facts are always-on structured context, but provenance remains
  // explicit: user-confirmed and legacy facts are authoritative; model-minted
  // notes stay visibly provisional so they cannot silently outrank source canon.
  const loreLines = (state.lore ?? [])
    .filter(l => l.status !== 'rejected')
    .sort((a, b) => Number(b.status === 'confirmed' || !b.status) - Number(a.status === 'confirmed' || !a.status) || b.turn - a.turn)
    .slice(0, 8)
    .map((l) => '- ' + (l.status === 'provisional' ? 'PROVISIONAL: ' : 'CONFIRMED: ') + (l.tag ? `(${l.tag}) ` : '') + l.fact);

  // The information state is authoritative, not a similarity guess. Surface
  // recent facts and secret audiences involving the present/query cast so the
  // narrator cannot accidentally give a character knowledge they never gained.
  const focus = new Set(state.scene.present ?? []);
  const q = query.toLocaleLowerCase();
  for (const c of Object.values(state.cast)) {
    if (q.includes(c.name.toLocaleLowerCase()) || (c.aka ?? []).some((a) => q.includes(a.toLocaleLowerCase()))) focus.add(c.id);
  }
  const epistemicSecrets = state.secrets
    .filter((s) => focus.has(s.keeper) || s.from.some((id) => focus.has(id)) || s.revealedTo.some((id) => focus.has(id)))
    .sort((a, b) => (b.lastTurn ?? b.formedTurn) - (a.lastTurn ?? a.formedTurn))
    .slice(0, 8)
    .map((s) => {
      const known = [...new Set([s.keeper, ...s.revealedTo])].map(nameOf);
      const hidden = s.from.filter((id) => !s.revealedTo.includes(id)).map(nameOf);
      return `- SECRET ${s.id}: ${s.text} | known by ${known.join(', ') || 'none'} | hidden from ${hidden.join(', ') || (s.revealed ? 'no one (public)' : 'unspecified')}`;
    });
  const epistemicKnowledge = state.knowledge
    .filter((k) => focus.has(k.who) || (!!k.about && focus.has(k.about)))
    .sort((a, b) => b.turn - a.turn)
    .slice(0, 10)
    .map((k) => `- ${nameOf(k.who)} ${k.reliability}: ${k.fact} | actual truth ${k.truth}${k.source ? ` | source ${k.source}` : ''}`);
  const epistemicLines = [...epistemicSecrets, ...epistemicKnowledge];

  // share ONE budget: reserve up to 40% for open threads/arcs, give the rest to
  // cast/bonds/factions — so the structured block never overshoots its allocation.
  const trackBudget = (openThreads.length || openArcs.length) ? Math.floor(budget * 0.4) : 0;
  const trackLines = fitLines([...openThreads, ...openArcs], trackBudget);
  const usedByTracks = trackLines.reduce((n, l) => n + l.length + 1, 0);
  const loreBudget = loreLines.length ? Math.floor(budget * 0.15) : 0;
  const fittedLore = fitLines(loreLines, loreBudget);
  const usedByLore = fittedLore.reduce((n, l) => n + l.length + 1, 0);
  const epistemicBudget = epistemicLines.length ? Math.floor(budget * 0.3) : 0;
  const fittedEpistemic = fitLines(epistemicLines, epistemicBudget);
  const usedByEpistemic = fittedEpistemic.reduce((n, l) => n + l.length + 1, 0);
  const castRel = fitLines([...castLines, ...relLines], Math.max(0, budget - usedByTracks - usedByLore - usedByEpistemic));
  const blocks: string[] = [];
  if (castRel.length) blocks.push('[CAST & BONDS \u2014 established, authoritative. Keep consistent; do not contradict.]\n' + castRel.join('\n'));
  if (trackLines.length) blocks.push('[OPEN THREADS & ARCS \u2014 advance or resolve these; reuse the EXACT title, do not restate as a new thread.]\n' + trackLines.join('\n'));
  // factions feed-back: list established GROUPS so the model reuses them by name
  // (and treats them as factions, not characters) instead of coining synonyms.
  if (facLines.length) blocks.push('[FACTIONS \u2014 established GROUPS (not characters). Reuse the EXACT name; don\u2019t restate a group as a new one or as a character.]\n' + facLines.join('\n'));
  if (fittedLore.length) blocks.push('[CODEX \u2014 CONFIRMED facts are authoritative. PROVISIONAL facts are model-minted working lore: preserve them when consistent, but never let them override user, scenario, worldbook, or confirmed canon.]\n' + fittedLore.join('\n'));
  if (fittedEpistemic.length) blocks.push('[INFORMATION STATE \u2014 authoritative per-character knowledge. Never let a character act on a secret or fact unless listed as known by them.]\n' + fittedEpistemic.join('\n'));
  // off-screen subplots — living "meanwhile" threads the sim advances, fed back so
  // the on-screen model can acknowledge/react to them. Open ones, latest beat.
  const meanwhile = (state.offscreen ?? []).filter((o) => o.status === 'active').slice(0, 5)
    .map((o) => '- ' + o.name + (o.who ? ' (' + (state.cast[o.who]?.name ?? o.who) + ')' : '') + ': ' + (o.gist || o.beats[o.beats.length - 1] || ''));
  if (meanwhile.length) blocks.push('[MEANWHILE, OFF-SCREEN \u2014 subplots in motion elsewhere; acknowledge or advance if relevant, don\u2019t force.]\n' + meanwhile.join('\n'));
  return blocks.join('\n\n');
}

/**
 * Authoritative NOW line — the current clock stated as a hard fact, on the same
 * verbatim footing as cast/bonds (never similarity-retrieved). Composes the
 * calendar day, the time-of-day (clock slot or the raw scene.time string), and a
 * "~N since the previous scene" tail from the scene-day anchors. Returns '' when
 * there is no scene/day yet (nothing authoritative to assert). PURE.
 */
export function nowInjection(state: ChronicleState): string {
  const day = state.day || 0;
  if (day <= 0 && !state.scene.location && !state.scene.time) return '';
  const dateStr = formatDate(day, state.dateFormat, state);
  // time-of-day: prefer the human string the author wrote; else label the clock.
  const timeStr = state.scene.time?.trim() || (state.scene.clock !== undefined ? clockLabel(state.scene.clock) : '');
  // elapsed since the previous distinct scene-day (only when we have both anchors)
  const prev = state.prevSceneDay;
  const cur = state.sceneDay ?? day;
  const span = (prev !== undefined && cur > prev) ? spanLabel(cur - prev) : '';
  const head = [dateStr, timeStr].filter(Boolean).join(', ');
  const tail = span ? ` ~${span} elapsed since the previous scene.` : '';
  if (!head && !tail) return '';
  // Anchor the clock WITHOUT implying it must advance: the day only moves when
  // the story's action actually spans a day/night, not once per turn. "Keep this
  // date unless the scene itself moves time" replaces the old "do not reset",
  // which read as a one-way ratchet and made the model bump the day each turn.
  return `[NOW \u2014 current in-story date. Keep it unless the scene's own action moves time forward; most turns stay the same day.] ${head}.${tail}`.replace(/\.\./g, '.');
}

/** Short word for a faction standing value (for the injected structured line). */
function standingWord(n: number): string {
  if (n >= 40) return 'devoted'; if (n >= 15) return 'friendly';
  if (n > -15) return 'neutral'; if (n > -40) return 'wary'; return 'hostile';
}

/** Render the final injection text from a ranked, deduped recall id list. */
function assemble(
  state: ChronicleState,
  index: InvertedIndex,
  rankedIds: string[],
  budgets: Record<string, number>,
  source: 'lexical' | 'hybrid' | 'traversal' | 'traversal-tree',
  trace?: TraversalTrace,
  detailIds?: Set<string>,
  recallBudgetOverride?: number,
  query = '',
): InjectionResult {
  const structured = structuredBlock(state, budgets.structured ?? 1200, query);
  // A selected book/arc/chapter node injects its DETAILED summary (the continuity
  // payload), not the lean gist; everything else uses the indexed text.
  const detailById = detailIds && detailIds.size
    ? new Map(state.memories.filter((m) => detailIds.has(m.id)).map((m) => [m.id, m.detail || m.text]))
    : null;
  const candidates: Array<{ id: string; line: string }> = [];
  for (const id of rankedIds) {
    const item = index.byId.get(id);
    if (item?.status === 'stale' || item?.status === 'degraded') continue;
    const detail = detailById?.get(id);
    if (detail) { candidates.push({ id, line: '- ' + detail }); continue; }
    if (item) candidates.push({ id, line: '- ' + item.text });
  }
  // tree selections can pull long detailed summaries → give recall more room
  const recallCap = recallBudgetOverride ?? budgets.recall ?? 1200;
  const recallLines: string[] = [];
  const recallIds: string[] = [];
  let used = 0;
  for (const candidate of candidates) {
    const remaining = recallCap - used - 1;
    if (remaining < 40) break;
    const line = clipRecallLine(candidate.line, remaining);
    if (!line) continue;
    recallLines.push(line); recallIds.push(candidate.id); used += line.length + 1;
  }
  const recall = recallLines.length
    ? '[CHRONICLE RECALL \u2014 relevant established history. Honor it; do not recite.]\n' + recallLines.join('\n')
    : '';
  // NOW line leads: the authoritative clock at highest salience, ahead of the
  // structured cast/bonds. Cheap (one line), always-on when a scene exists.
  const now = nowInjection(state);
  const text = [now, structured, recall].filter(Boolean).join('\n\n');
  return { text, recallIds, source, ...(trace ? { trace } : {}) };
}

/** Lexical-only ranking with a gentle recency lift + an archive-tier boost so the
 * compressed long-term summaries (the memory backbone) reliably surface and
 * aren't crowded out by raw turn-memories or facts at equal lexical score. */
function labelsFor(state: ChronicleState, id: string): string[] {
  const cast = state.cast[id]; if (cast) return [cast.name, ...(cast.aka ?? [])];
  const faction = state.factions[id]; if (faction) return [faction.name, ...(faction.aka ?? [])];
  const location = state.locations.find((x) => x.id === id); if (location) return [location.name];
  const item = state.items.find((x) => x.id === id); if (item) return [item.item];
  return [id];
}

/** Add deterministic scene and alias vocabulary to the user's latest prose.
 * This closes the common recall gap where a record was filed under a canonical
 * name while the scene uses an alias, containing location, faction, or item. */
export function buildRecallQuery(state: ChronicleState, query: string): string {
  const parts: string[] = []; const seen = new Set<string>();
  const add = (value?: string): void => { const v = String(value ?? '').trim(); const k = v.normalize('NFKC').toLocaleLowerCase(); if (v && !seen.has(k)) { seen.add(k); parts.push(v); } };
  add(query);
  const low = query.normalize('NFKC').toLocaleLowerCase();
  for (const id of state.scene.present) for (const label of labelsFor(state, id)) add(label);
  add(state.scene.location);
  let loc = state.locations.find((x) => x.id === state.scene.location || x.name.toLocaleLowerCase() === state.scene.location.toLocaleLowerCase());
  for (let depth = 0; loc && depth < 6; depth++) { add(loc.name); loc = loc.parent ? state.locations.find((x) => x.id === loc!.parent) : undefined; }
  const entities: Array<{ id: string; labels: string[] }> = [
    ...Object.values(state.cast).map((x) => ({ id: x.id, labels: [x.name, ...(x.aka ?? [])] })),
    ...Object.values(state.factions).map((x) => ({ id: x.id, labels: [x.name, ...(x.aka ?? [])] })),
    ...state.locations.map((x) => ({ id: x.id, labels: [x.name] })),
    ...state.items.map((x) => ({ id: x.id, labels: [x.item] })),
  ];
  for (const entity of entities) if (entity.labels.some((x) => x.length >= 3 && low.includes(x.toLocaleLowerCase()))) {
    add(entity.id); for (const label of entity.labels) add(label);
  }
  for (const track of [...state.threads, ...state.arcs]) if (low.includes(track.name.toLocaleLowerCase())) {
    add(track.name); add(track.id); add(track.beats[track.beats.length - 1]);
  }
  return parts.join(' ').slice(0, 2400);
}

function lexicalRanked(index: InvertedIndex, state: ChronicleState, query: string): string[] {
  const expanded = buildRecallQuery(state, query);
  const hits = lexicalSearch(index, expanded, 64);
  const maxTurn = state.turns || 1;
  const rawLow = query.normalize('NFKC').toLocaleLowerCase();
  const ranked = hits
    .map((h) => {
      const it = index.byId.get(h.id)!;
      if (it.status === 'stale' || it.status === 'degraded') return { id: h.id, score: 0 };
      const recency = 1 + 0.4 * (it.turn / maxTurn);
      const tierBoost = it.tier === 'beat' ? 1.6 : it.tier === 'book' ? 1.65 : it.tier === 'arc' ? 1.5 : it.tier === 'chapter' ? 1.3 : 1;
      const sceneEntity = it.entityIds?.some((id) => state.scene.present.includes(id)) ? 1.35 : 1;
      const continuityBoost = it.kind === 'secret' || it.kind === 'scar' || it.kind === 'item' || it.kind === 'timeline' ? 1.12 : 1;
      const exactEntity = it.entityIds?.some((id) => labelsFor(state, id).some((label) => label.length >= 3 && rawLow.includes(label.toLocaleLowerCase()))) ? 1.45 : 1;
      const authority = it.authority === 'provisional' ? 0.75 : it.authority === 'confirmed' || it.authority === 'canonical' ? 1.08 : 1;
      return { id: h.id, score: h.score * recency * tierBoost * sceneEntity * continuityBoost * exactEntity * authority };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  // A hit and its archived ancestor carry overlapping prose. Keep the stronger
  // one, then spread the remaining budget across record families so items,
  // scars, secrets, Codex facts, and timeline beats cannot all be crowded out by
  // a pile of near-identical turn memories.
  const selected: string[] = []; const selectedItems: RetrievableItem[] = []; const counts = new Map<string, number>();
  for (const hit of ranked) {
    const item = index.byId.get(hit.id)!;
    if ((counts.get(item.kind) ?? 0) >= 8) continue;
    const overlaps = selectedItems.some((other) => (item.parentIds ?? []).includes(other.id) || (other.parentIds ?? []).includes(item.id));
    if (overlaps) continue;
    selected.push(item.id); selectedItems.push(item); counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
    if (selected.length >= 36) break;
  }
  return selected;
}

/** Synchronous, lexical-only injection. Used in tests and as the always-on base. */
export function buildInjection(chatId: string, state: ChronicleState, query: string, phaseMult = 1, version?: number): InjectionResult {
  const budgets = allocate({ total: TOTAL, caps: CAPS, phaseMult });
  const index = indexFor(chatId, state, version);
  return assemble(state, index, lexicalRanked(index, state, query), budgets, 'lexical', undefined, undefined, undefined, query);
}

/**
 * Hybrid injection: fuse lexical + host-embedding rankings via RRF. Falls back
 * to pure lexical when vectorization is unavailable (vectorSearch → null), so
 * continuity precision is never lost and the path is fully model-agnostic.
 */
export async function buildInjectionHybrid(
  chatId: string,
  state: ChronicleState,
  query: string,
  userId: string | null,
  phaseMult = 1,
  version?: number,
  controller?: CallModel,
  traversalMode: 'flat' | 'tree' = 'flat',
  precomputed?: { ids: string[]; summaryIds: string[]; trace: TreeTraversalTrace } | null,
  traversalAxis: 'temporal' | 'character' | 'hybrid' = 'temporal',
): Promise<InjectionResult> {
  const budgets = allocate({ total: TOTAL, caps: CAPS, phaseMult });
  const index = indexFor(chatId, state, version);
  const lexIds = lexicalRanked(index, state, query);

  // PR2: a precomputed tree ranking (built on GENERATION_ENDED, cached by
  // logVersion) skips the live drill entirely — zero prompt-path latency.
  if (precomputed && precomputed.ids.length) {
    const detailIds = new Set(precomputed.summaryIds);
    const r = assemble(state, index, precomputed.ids, budgets, 'traversal-tree', undefined, detailIds, Math.floor((budgets.recall ?? 1200) * 1.8), query);
    return { ...r, treeTrace: precomputed.trace };
  }

  // Controller-guided traversal, opt-in. Any failure (error/timeout/empty/
  // invalid) → null → fall through to the deterministic path. The structured
  // authoritative block is never traversed (guardrail preserved).
  if (controller) {
    if (traversalMode === 'tree') {
      // Tiered drill (book→arc→chapter→leaf); selected summary nodes inject their
      // DETAILED summary, so give recall extra budget for those long payloads.
      const tt = await traverseTree(index, state, controller, { query, axis: traversalAxis });
      if (tt) {
        const detailIds = new Set(tt.summaryIds);
        const r = assemble(state, index, tt.ids, budgets, 'traversal-tree', undefined, detailIds, Math.floor((budgets.recall ?? 1200) * 1.8), query);
        return { ...r, treeTrace: tt.trace };
      }
    } else {
      const t = await traverseRanked(index, state, lexIds, controller, { query });
      if (t) return assemble(state, index, t.ids, budgets, 'traversal', t.trace, undefined, undefined, query);
    }
  }

  // Map a host-embedding hit's text back to our item id. Preserves the ORIGINAL
  // first-match semantics exactly (equality on the trimmed lowercase text, OR a
  // prefix-substring on the full lowercase text; first item in index order wins)
  // but normalizes each item's text ONCE (lazily, on the first hit) rather than
  // re-lowercasing every item for each of the ~20 vector hits (the old
  // O(hits × items × strlen) cost). Lazy so the common embeddings-OFF path — where
  // vectorSearch never calls this — pays nothing.
  let normItems: Array<{ id: string; eq: string; low: string; tokens: Set<string> }> | null = null;
  const contentToId = (text: string): string | null => {
    if (!normItems) {
      normItems = [];
      for (const it of index.byId.values()) { const low = it.text.normalize('NFKC').toLocaleLowerCase(); normItems.push({ id: it.id, eq: low.trim(), low, tokens: new Set(it.tokens) }); }
    }
    const t = text.normalize('NFKC').trim().toLocaleLowerCase();
    const exact = normItems.filter((it) => it.eq === t);
    if (exact.length === 1) return exact[0]!.id;
    if (exact.length > 1) return null;
    const prefix = t.slice(0, 40);
    const qTokens = new Set(tokenize(t));
    const scored = normItems
      .filter((it) => prefix.length >= 16 && (it.low.includes(prefix) || t.includes(it.eq.slice(0, 40))))
      .map((it) => ({ id: it.id, score: [...qTokens].filter((tok) => it.tokens.has(tok)).length / Math.max(1, new Set([...qTokens, ...it.tokens]).size) }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    if (!scored.length || scored[0]!.score <= 0 || (scored[1] && scored[1]!.score === scored[0]!.score)) return null;
    return scored[0]!.id;
  };
  const vec = await vectorSearch(chatId, buildRecallQuery(state, query), userId, contentToId, 20);
  if (!vec || !vec.length) {
    return assemble(state, index, lexIds, budgets, 'lexical', undefined, undefined, undefined, query);
  }
  // fuse: lexical weighted slightly higher to keep exact-name precision dominant
  const fused = rrf([
    { ids: lexIds, weight: 1.1 },
    { ids: vec.map((v) => v.id), weight: 1.0 },
  ]).map((r) => r.id);
  return assemble(state, index, fused, budgets, 'hybrid', undefined, undefined, undefined, query);
}

/** Keep at least one relevant record even when a generated archive detail is
 * longer than the recall slice. Prefer a full sentence, then a whole word. */
function clipRecallLine(line: string, max: number): string {
  if (line.length <= max) return line;
  const cut = line.slice(0, Math.max(0, max - 1));
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (sentence > Math.min(80, max * 0.45)) return cut.slice(0, sentence + 1).trim();
  return cut.replace(/\s+\S*$/, '').replace(/[\s,;:.\u2014-]+$/, '').trim() + '\u2026';
}

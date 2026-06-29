import { restoreUser, rememberUser, currentUser } from './host/user.js';
import { invalidatePermissions, invalidateChatCaps, has } from './host/capability.js';
import { activeChatId, latestAssistantContent, latestAssistantContentRetry, allAssistantContents, allTurnContents, chatNames, getChatVar, setChatVar } from './host/chats.js';
import { loadState, append, invalidate, clearLog, exportLog, importLog, logVersion, truncateAfterTurn, turnSigs, recoverFromBackup } from './store/chronicle.js';
import { foldTurn } from './bus/lifecycle.js';
import { registerFeature } from './bus/registry.js';
import { coreFeature } from './domain/core-feature.js';
import { buildInjectionHybrid, invalidateIndex } from './retrieval/recall.js';
import { importLegacy } from './store/import-legacy.js';
import { cmdEvents, CMD_TYPES } from './domain/commands.js';
import { summarizeOnce, summarizeAll } from './bus/summarize.js';
import { extractFromProse } from './bus/extract.js';
import { controllerGenerate } from './host/generation.js';
import type { CallModel } from './retrieval/traverse.js';
import { traverseTree, type TreeTraversalResult } from './retrieval/traverse-tree.js';

/** Validate the persisted traversal axis to the three known values. */
type TraversalAxis = 'temporal' | 'character' | 'hybrid';
function readAxis(v: unknown): TraversalAxis { return v === 'character' || v === 'hybrid' ? v : 'temporal'; }

import { EventLog as EventLogSchema, type VellumEvent } from './core/events.js';
import { nextSeq as nextSeqLocal, hashStr, canonId } from './core/ids.js';
import { syncHideOnFile } from './host/hide.js';
import type { ChronicleState } from './domain/types.js';
import { vaultSnapshot, setBookAttached, createBook, updateBook, createEntry, updateEntry, deleteEntry, syncEntry, hasVault } from './host/worldbooks.js';
import { loadCategories, upsertCategory, deleteCategory } from './store/vault-categories.js';
import { resolveCategory, settingsToEntryFields, customCategory, type EntrySettings, type VaultCategory } from './domain/vault.js';
import { reconcileChapterEntries, planChapterEntry, type ChapterVaultMode } from './domain/chapter-vault.js';
import { reconcileFactionEntries } from './domain/faction-vault.js';
import { buildPromotion, reconcileCategory, type PromoteKind } from './domain/promote.js';
import { parseTone, type Tone } from './domain/tone.js';
import { sanitizeLocks, lockKey, type RelationLock } from './domain/relation-lock.js';
import { sanitizeDirectives, directiveInjection, reconcileDirectives, armScheduled, type Directive } from './domain/directive.js';
import { checkContinuity } from './domain/continuity.js';
import { offscreenCast, buildSimPrompt, parseSim, simEvents, SIM_SYS } from './domain/offscreen.js';
import { THREAD_MERGE_SYS, buildMergePrompt, parseMergeReply, validateMerges, openTracks } from './domain/thread-merge.js';
import { FACT_MERGE_SYS, buildFactMergePrompt, parseFactMergeReply, validateFactMerges, mergeCandidates } from './domain/fact-merge.js';
import { sceneSuggestions, recursionSeeds, evaluateSchedules, autoAuthorDrafts, findDupe, type VaultEntryLite } from './domain/vault-intel.js';

/** Highest turn already captured by a chapter/arc memory (the hide-on-file mark). */
function coveredTurn(state: ChronicleState): number {
  let c = 0;
  for (const m of state.memories) if ((m.tier === 'chapter' || m.tier === 'arc') && m.covers) c = Math.max(c, m.covers[1]);
  return c;
}

/** Parse a comma/array keyword list into a clean string[]. */
function splitList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  return String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

// dismissed scene-suggestions, per chat (in-memory; cheap + resets on reload)
const _dismissed = new Map<string, Set<string>>();
function dismissedFor(chatId: string): Set<string> { let s = _dismissed.get(chatId); if (!s) { s = new Set(); _dismissed.set(chatId, s); } return s; }

/** Snapshot + scene-coverage suggestions ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ broadcast the full vault view. */
async function vaultBroadcast(chatId: string, uid: string | null): Promise<void> {
  const categories = await loadCategories();
  const snap = await vaultSnapshot(chatId, uid);
  let suggestions: unknown[] = [];
  try {
    if (chatId && snap.ok) {
      const state = await loadState(chatId);
      const lites: VaultEntryLite[] = snap.books.flatMap((b) => b.entries).map((e) => ({ id: e.id, key: e.key, content: e.content, link: e.link, category: e.category, disabled: e.disabled, ...(e.reveal ? { reveal: e.reveal } : {}) }));
      suggestions = sceneSuggestions(state, lites, dismissedFor(chatId));
    }
  } catch { /* suggestions best-effort */ }
  spindle.sendToFrontend?.({ type: 'vellum_vault', categories, ...snap, suggestions }, uid ?? currentUser());
}

declare const spindle: any;

/**
 * Backend entrypoint. Registers features, folds each turn into the event log,
 * and serves the frontend via a dispatch table. Everything is guarded ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â the
 * worker must never crash the host. New features call registerFeature() and
 * (if they need UI) add a message handler in the dispatch table below.
 */

registerFeature(coreFeature);

const lastSigByChat = new Map<string, string>();
interface InjRecord { turn: number; at: number; chars: number; recallIds: string[]; text: string; source?: string; trace?: unknown }
const injectionLog = new Map<string, InjRecord[]>(); // per-chat ring of recent injections
function recordInjection(chatId: string, turn: number, text: string, recallIds: string[], meta?: { source?: string; trace?: unknown }): InjRecord {
  const ring = injectionLog.get(chatId) ?? [];
  const rec: InjRecord = { turn, at: Date.now(), chars: text.length, recallIds, text: text.slice(0, 4000), ...(meta?.source ? { source: meta.source } : {}), ...(meta?.trace ? { trace: meta.trace } : {}) };
  ring.push(rec);
  while (ring.length > 20) ring.shift(); // keep last 20 turns of injection history
  injectionLog.set(chatId, ring);
  return rec;
}

async function broadcastState(chatId: string, userId: string | null): Promise<void> {
  const state = await loadState(chatId);
  const tone = await readTone(chatId, userId);
  let tidy = false;
  try { tidy = !!(await getChatVar(chatId, 'vellum_tidy_threads')); } catch { /* best effort */ }
  let offscreen = false;
  try { offscreen = !!(await getChatVar(chatId, 'vellum_offscreen')); } catch { /* best effort */ }
  const chapterVault = await readChapterVaultMode(chatId);
  let traversalMode = 'off';
  try { if (await getChatVar(chatId, 'vellum_traversal')) traversalMode = (await getChatVar(chatId, 'vellum_traversal_mode')) === 'tree' ? 'tree' : 'flat'; } catch { /* best effort */ }
  const traversalAxis = readAxis(await getChatVar(chatId, 'vellum_traversal_axis'));
  const relationLocks = await readLocks(chatId);
  const directives = await readDirectives(chatId);
  spindle.sendToFrontend?.({ type: 'vellum_state', chatId, state, tone, tidy, offscreen, chapterVault, traversalMode, traversalAxis, relationLocks, directives }, userId ?? currentUser());
}

/** FOLD: read the raw turn, parse ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ events ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ append ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ broadcast. */
const _foldChain = new Map<string, Promise<void>>();
function foldChat(chatId: string, userId: string | null, hint?: string): Promise<void> {
  // serialize folds per chat: concurrent triggers (GENERATION_ENDED +
  // get_state retries) would each read the same prior.turns and re-fold the
  // SAME turn, accumulating duplicate deltas (aff -30/-60/-90). Chaining makes
  // the 2nd call wait, then see turns already advanced -> nothing new to fold.
  const prev = _foldChain.get(chatId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => foldChatInner(chatId, userId, hint));
  _foldChain.set(chatId, next.catch(() => {}));
  return next;
}

/** Content signature for a turn Ã¢â‚¬â€ MUST match foldTurn's sig (hashStr of the
 * first 4000 chars of the trimmed content) so stored and current sigs compare. */
function sigOf(content: string): string { return hashStr(content.slice(0, 4000)); }

/** Per-turn memory text fed to the summarizer: strip the vellum/reverie blocks,
 * collapse whitespace, then keep a GENEROUS window cut at a sentence boundary
 * (not a hard mid-word slice). Accuracy of chapter summaries depends on this Ã¢â‚¬â€
 * the old 600-char hard cut dropped most of each turn, so summaries were built
 * on fragments. ~1600 chars holds the full beat of a typical turn. */
function turnGist(content: string, names?: { user: string; char: string }): string {
  let s = content
    .replace(/(?:\u2039vellum\u203a|<vellum>)[\s\S]*?(?:\u2039\/vellum\u203a|<\/vellum>)/gi, '')
    .replace(/<reverie>[\s\S]*?<\/reverie>/gi, '')
    .replace(/\s+/g, ' ').trim();
  // resolve persona tokens to real names so the stored memory reads cleanly
  // ("{{user}}: ..." from allTurnContents becomes "Cersei: ...").
  if (names?.user) s = s.replace(/\{\{\s*user\s*\}\}/gi, names.user);
  if (names?.char) s = s.replace(/\{\{\s*char\s*\}\}/gi, names.char);
  const MAX = 1600;
  if (s.length <= MAX) return s;
  const cut = s.slice(0, MAX);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return stop > MAX * 0.5 ? cut.slice(0, stop + 1).trim() : cut.replace(/\s+\S*$/, '').trim();
}

/**
 * Find the lowest already-folded turn whose content changed (regenerate/edit),
 * or the new turn count if messages were deleted Ã¢â‚¬â€ i.e. the turn to roll BACK
 * to (return = keep turns Ã¢â€°Â¤ N). Returns null when nothing earlier diverged.
 */
async function divergedTurn(chatId: string, msgs: string[], foldedTurns: number, asstMsgs?: string[]): Promise<number | null> {
  if (foldedTurns <= 0) return null;
  // messages deleted: fewer assistant turns than we folded → roll back to the new count
  if (msgs.length < foldedTurns) return msgs.length;
  const sigs = await turnSigs(chatId);
  for (let turnNo = 1; turnNo <= foldedTurns; turnNo++) {
    const stored = sigs.get(turnNo);
    if (stored === undefined) continue; // turn had no fold marker — skip
    // legacy constant sigs (pre-reconcile builds) can't be compared — skip them
    // so we never roll back a chronicle folded by an older version.
    if (stored === 'auto' || stored === 'rebuild') continue;
    const cur = sigOf((msgs[turnNo - 1] ?? '').trim());
    if (cur === stored) continue;
    // BASIS-SHIFT SAFETY: chronicles folded before user-messages were included
    // stored an ASSISTANT-ONLY signature. Don't treat that basis change as an
    // edit (which would roll back and wipe chapters) — also accept a match on the
    // assistant-only signature for this turn.
    if (asstMsgs && sigOf((asstMsgs[turnNo - 1] ?? '').trim()) === stored) continue;
    return turnNo - 1; // keep up to the turn before the change
  }
  return null;
}

/** Read the per-chat tone dials (romance pace + world disposition) the user set
 * via the Tone control. Defaults to neutral (medium/fair) Ã¢â€ â€™ today's behavior. */
async function readTone(chatId: string, userId: string | null): Promise<Tone> {
  void userId;
  const r = await getChatVar(chatId, 'vellum_romance');
  const d = await getChatVar(chatId, 'vellum_disposition');
  return parseTone(r, d);
}

/** Read + sanitize the per-chat relation locks (Plot Director). */
async function readLocks(chatId: string): Promise<RelationLock[]> {
  try { const raw = await getChatVar(chatId, 'vellum_relation_locks'); return raw ? sanitizeLocks(JSON.parse(raw)) : []; } catch { return []; }
}

/** Read + sanitize the per-chat Plot Director directives. */
async function readDirectives(chatId: string): Promise<Directive[]> {
  try { const raw = await getChatVar(chatId, 'vellum_directives'); return raw ? sanitizeDirectives(JSON.parse(raw)) : []; } catch { return []; }
}
async function writeDirectives(chatId: string, d: Directive[]): Promise<void> {
  try { await setChatVar(chatId, 'vellum_directives', JSON.stringify(d)); } catch { /* best effort */ }
}

async function foldChatInner(chatId: string, userId: string | null, hint?: string): Promise<void> {
  let msgs = await allTurnContents(chatId);
  if (!msgs.length || !(msgs[msgs.length - 1] ?? '').trim()) { await new Promise((r) => setTimeout(r, 220)); msgs = await allTurnContents(chatId); }
  if (hint && hint.trim() && (!msgs.length || msgs[msgs.length - 1] !== hint)) msgs.push(hint);
  if (!msgs.length) return;
  let prior = await loadState(chatId);
  // tone dials + canonical {{user}} id, resolved once per fold pass
  const tone = await readTone(chatId, userId);
  const names = await chatNames(chatId, userId);
  const userCanon = names.user ? canonId(names.user) : '';
  const locks = await readLocks(chatId);
  // REGENERATION / EDIT RECONCILE: a regenerated or edited turn keeps the same
  // message count, so the forward-only fold below would never revisit it and the
  // chronicle would keep the STALE turn's deltas. Compare each already-folded
  // turn's stored content signature to the message's current signature; at the
  // first divergence (or if messages were deleted), roll the log back to just
  // before it so the loop re-folds the new content. (Swipes are out of scope.)
  const rollbackTo = await divergedTurn(chatId, msgs, prior.turns ?? 0, await allAssistantContents(chatId));
  if (rollbackTo !== null && rollbackTo < (prior.turns ?? 0)) {
    prior = await truncateAfterTurn(chatId, rollbackTo);
    invalidateIndex(chatId);
    spindle.log?.info?.(`[vellum_engine] reconcile: turn ${rollbackTo + 1} changed (regenerate/edit) \u2014 rolled back to turn ${rollbackTo}, re-folding.`);
  }
  let added = 0;
  const foldedEvents: VellumEvent[] = []; // accumulate for Plot Director self-clear
  // snapshot the PRE-fold state for the continuity check: loadState/append return
  // the same cached object mutated in place, so a live reference would already show
  // this turn's reveals/learns. Clone the few slices the checker reads.
  const preFold = { cast: prior.cast, secrets: prior.secrets.map((x) => ({ ...x })), knowledge: prior.knowledge.map((x) => ({ ...x })) } as ChronicleState;
  for (let turnNo = (prior.turns ?? 0) + 1; turnNo <= msgs.length; turnNo++) {
    const content = (msgs[turnNo - 1] ?? '').trim();
    if (!content) continue;
    const { events, source } = foldTurn(content, prior, turnNo, { tone, userCanon, locks });
    const evs: VellumEvent[] = [...events];
    if (!evs.some((e) => e.kind === 'turn.fold')) evs.unshift({ seq: nextSeqLocal(), turn: turnNo, day: prior.day || 0, src: 'system', kind: 'turn.fold', sig: sigOf(content) } as VellumEvent);
    const gist = turnGist(content, names);
    if (gist) evs.push({ seq: nextSeqLocal(), turn: turnNo, day: prior.day || 0, src: 'system', kind: 'memory.record', id: 'turn_' + chatId.slice(0, 6) + '_' + turnNo, tier: 'turn', text: gist, keys: [] } as VellumEvent);
    foldedEvents.push(...evs);
    prior = await append(chatId, evs);
    added += evs.length;
    // prose-driven extraction: knowledge / secrets / journal / bonds (incl. the
    // player) the model didn't hand-write in a <vellum> block. When the turn had
    // NO parseable block (source 'none'/'regex'), this is the SAFETY NET Ã¢â‚¬â€ the
    // schema-guaranteed extractor mines the structure from prose so a forgotten
    // block never means lost continuity. Best-effort; never throws into the fold.
    const hadBlock = source === 'json';
    if (gist) {
      try {
        const xevs = await extractFromProse(gist, turnNo, prior.day || 0, names, userId, prior, tone);
        if (xevs.length) { prior = await append(chatId, xevs); added += xevs.length; spindle.log?.info?.(`[vellum_engine] extracted +${xevs.length} (knowledge/secret/journal/bond)${hadBlock ? '' : ' [FALLBACK: no <vellum> block]'} from turn ${turnNo}`); }
        else if (!hadBlock) spindle.log?.warn?.(`[vellum_engine] turn ${turnNo} had no <vellum> block and prose extraction yielded nothing`);
      } catch (e) { spindle.log?.warn?.('[vellum_engine] extract: ' + ((e as Error)?.message ?? e)); }
    }
    spindle.log?.info?.(`[vellum_engine] folded turn ${turnNo} via ${source}: +${evs.length} events`);
    if (source === 'none' && /\u2039\/?vellum\u203a|<\/?vellum>/i.test(content)) {
      const m = content.match(/(?:\u2039vellum\u203a|<vellum>)([\s\S]*?)(?:\u2039\/vellum\u203a|<\/vellum>)/i);
      spindle.log?.warn?.('[vellum_engine] <vellum> present but UNPARSED. Inner head: ' + ((m?.[1] ?? '').trim().slice(0, 200)));
    }
  }
  if (!added) return;
  // Plot Director: self-clear armed directives whose target transition fired this
  // fold, and expire any past TTL. Persist only on change.
  try {
    const dirs = await readDirectives(chatId);
    if (dirs.length) {
      // first arm any scheduled directives the story has now reached, then self-clear/expire
      const armedRes = armScheduled(dirs, prior.turns ?? 0, prior.day ?? 0);
      const { directives: next, changed } = reconcileDirectives(armedRes.directives, foldedEvents, prior.turns ?? 0);
      if (armedRes.changed || changed) await writeDirectives(chatId, next);
    }
  } catch { /* best effort */ }
  // Plot Director continuity alarm: passive, non-blocking warnings comparing the
  // fold's events to the PRE-fold state (snapshot, so reveals/learns aren't yet
  // applied). Advisory only Ã¢â‚¬â€ surfaced as a toast + in the Director panel.
  try {
    const warnings = checkContinuity(foldedEvents, preFold);
    if (warnings.length) spindle.sendToFrontend?.({ type: 'vellum_continuity', chatId, warnings }, userId ?? currentUser());
  } catch { /* best effort */ }
  invalidateIndex(chatId);
  await broadcastState(chatId, userId);
  void maybeAutoSummarize(chatId, userId);
  void maybeVaultSync(chatId, userId);
  void maybeTidyThreads(chatId, userId);
  void maybeSimulate(chatId, userId);
  void maybeChapterVault(chatId, userId);
  void precomputeTree(chatId, userId); // PR2: warm the tree ranking for next turn
}

const _tidying = new Set<string>();
const TIDY_THRESHOLD = 8; // auto-tidy only once open-thread count exceeds this

/**
 * Layer 3 Ã¢â‚¬â€ reconcile near-duplicate threads/arcs via a cheap controller LLM.
 * Returns the number of tracks merged away. Honors the generation permission;
 * any failure (no perm, timeout, unparseable, nothing valid) Ã¢â€ â€™ 0, no events.
 * Serialized per chat. Both threads and arcs are swept.
 */
async function tidyThreads(chatId: string, userId: string | null): Promise<number> {
  if (_tidying.has(chatId)) return 0;
  if (!(await has('generation'))) return 0;
  _tidying.add(chatId);
  try {
    const state = await loadState(chatId);
    const evs: VellumEvent[] = [];
    for (const kind of ['threads', 'arcs'] as const) {
      const open = openTracks(state, kind);
      if (open.length < 2) continue;
      const res = await controllerGenerate(
        [{ role: 'system', content: THREAD_MERGE_SYS }, { role: 'user', content: buildMergePrompt(open) }],
        userId, 2500,
      );
      if (!res.ok) continue;
      const groups = validateMerges(parseMergeReply(res.value), open.map((t) => t.name));
      const evKind = kind === 'threads' ? 'thread.merge' : 'arc.merge';
      for (const g of groups) evs.push({ seq: nextSeqLocal(), turn: state.turns || 0, day: state.day || 0, src: 'system', kind: evKind, from: g.from, into: g.into } as VellumEvent);
    }
    if (!evs.length) return 0;
    const merged = evs.reduce((n, e) => n + ((e as { from: string[] }).from.length), 0);
    await append(chatId, evs);
    invalidateIndex(chatId);
    await broadcastState(chatId, userId);
    spindle.log?.info?.(`[vellum_engine] tidy-threads: merged ${merged} duplicate track(s) across ${evs.length} group(s)`);
    return merged;
  } catch (e) { spindle.log?.warn?.('[vellum_engine] tidyThreads: ' + ((e as Error)?.message ?? e)); return 0; }
  finally { _tidying.delete(chatId); }
}

const _tidyingFacts = new Set<string>();
/**
 * Tidy Knowledge/Secrets Ã¢â‚¬â€ the knowledge/secret sibling of tidyThreads. For each
 * holder with Ã¢â€°Â¥2 entries, a cheap controller LLM groups near-duplicate facts the
 * reducer dedup can't catch (different wording, no shared token); emits
 * knowledge.merge / secret.merge to fold them. Generation-gated, serialized per
 * chat. Returns the count of folded entries.
 */
async function tidyFacts(chatId: string, userId: string | null): Promise<number> {
  if (_tidyingFacts.has(chatId)) return 0;
  if (!(await has('generation'))) return 0;
  _tidyingFacts.add(chatId);
  try {
    const state = await loadState(chatId);
    const evs: VellumEvent[] = [];
    for (const kind of ['knowledge', 'secrets'] as const) {
      const evKind = kind === 'knowledge' ? 'knowledge.merge' : 'secret.merge';
      for (const cand of mergeCandidates(state, kind)) {
        const res = await controllerGenerate(
          [{ role: 'system', content: FACT_MERGE_SYS }, { role: 'user', content: buildFactMergePrompt(cand.label, cand.entries) }],
          userId, 2500,
        );
        if (!res.ok) continue;
        const groups = validateFactMerges(parseFactMergeReply(res.value), cand.entries.map((e) => e.id));
        for (const g of groups) evs.push({ seq: nextSeqLocal(), turn: state.turns || 0, day: state.day || 0, src: 'system', kind: evKind, into: g.into, from: g.from } as VellumEvent);
      }
    }
    if (!evs.length) return 0;
    const merged = evs.reduce((n, e) => n + ((e as { from: string[] }).from.length), 0);
    await append(chatId, evs);
    invalidateIndex(chatId);
    await broadcastState(chatId, userId);
    spindle.log?.info?.(`[vellum_engine] tidy-facts: folded ${merged} duplicate(s) across ${evs.length} group(s)`);
    return merged;
  } catch (e) { spindle.log?.warn?.('[vellum_engine] tidyFacts: ' + ((e as Error)?.message ?? e)); return 0; }
  finally { _tidyingFacts.delete(chatId); }
}

/** Auto-tidy: opt-in chat var, only when open threads exceed the threshold, and
 * throttled to roughly every 4th turn so it isn't a per-turn controller cost. */
async function maybeTidyThreads(chatId: string, userId: string | null): Promise<void> {
  let on = false;
  try { on = !!(await getChatVar(chatId, 'vellum_tidy_threads')); } catch { /* best effort */ }
  if (!on) return;
  const state = await loadState(chatId);
  const open = state.threads.filter((t) => !/resolv/i.test(t.status || '')).length;
  if (open <= TIDY_THRESHOLD) return;
  if ((state.turns || 0) % 4 !== 0) return; // cadence guard
  await tidyThreads(chatId, userId);
}

const _simulating = new Set<string>();
const SIM_CADENCE = 3; // tick the off-screen world every Nth turn (cost control)

/**
 * Off-screen simulation tick Ã¢â‚¬â€ advance characters who aren't in the scene. Opt-in
 * (chat var) + generation-permission-gated + cadence-throttled + serialized per
 * chat, exactly like tidyThreads. One bounded controller call; respects locks,
 * armed directives, and tone. Fail/timeout/empty Ã¢â€ â€™ no-op. Beats are tagged
 * src:'sim' so the UI distinguishes them; the append-only log makes them undoable.
 */
async function simulateOffscreen(chatId: string, userId: string | null): Promise<void> {
  if (_simulating.has(chatId)) return;
  if (!(await has('generation'))) return;
  _simulating.add(chatId);
  try {
    const state = await loadState(chatId);
    const cast = offscreenCast(state);
    if (cast.length < 1) return; // nobody plausibly off-screen
    const tone = await readTone(chatId, userId);
    const locks = await readLocks(chatId);
    const directives = await readDirectives(chatId);
    const prompt = buildSimPrompt(state, cast, { locks, directives, tone: { disposition: tone.disposition } });
    const res = await controllerGenerate([{ role: 'system', content: SIM_SYS }, { role: 'user', content: prompt }], userId, 3000);
    if (!res.ok) return;
    const parsed = parseSim(res.value);
    if (!parsed) return;
    const evs = simEvents(parsed, state, state.turns || 0, state.day || 0, () => nextSeqLocal());
    if (!evs.length) return;
    await append(chatId, evs);
    invalidateIndex(chatId);
    await broadcastState(chatId, userId);
    spindle.log?.info?.(`[vellum_engine] off-screen sim: ${parsed.offscreen.length} subplot beat(s)`);
  } catch (e) { spindle.log?.warn?.('[vellum_engine] simulateOffscreen: ' + ((e as Error)?.message ?? e)); }
  finally { _simulating.delete(chatId); }
}

/** Auto off-screen sim: opt-in chat var, throttled to every SIM_CADENCE-th turn. */
async function maybeSimulate(chatId: string, userId: string | null): Promise<void> {
  let on = false;
  try { on = !!(await getChatVar(chatId, 'vellum_offscreen')); } catch { /* best effort */ }
  if (!on) return;
  const state = await loadState(chatId);
  if ((state.turns || 0) % SIM_CADENCE !== 0) return; // cadence guard
  await simulateOffscreen(chatId, userId);
}

const _vaultSyncing = new Set<string>();
/** Tier-B sync: for each category set to 'sync', refresh linked entries whose source changed. */
async function maybeVaultSync(chatId: string, userId: string | null): Promise<void> {
  if (_vaultSyncing.has(chatId)) return;
  if (!(await hasVault())) return;
  const cats = (await loadCategories()).filter((c) => c.sync === 'sync' && c.source);
  _vaultSyncing.add(chatId);
  try {
    const state = await loadState(chatId);
    const snap = await vaultSnapshot(chatId, userId);
    const owned = snap.books.flatMap((b) => b.entries).filter((e) => e.vellum && e.link);
    let changed = 0;
    for (const cat of cats) {
      const managed = owned.filter((e) => e.category === cat.id).map((e) => ({ id: e.id, link: e.link, hash: e.hash }));
      if (!managed.length) continue;
      const plan = reconcileCategory(state, cat.source!, managed);
      for (const u of plan.update) { await syncEntry(u.entryId, u.promotion.content, u.promotion.key, u.promotion.hash, u.promotion.link, cat.id, userId); changed++; }
    }
    // scheduled Events: enable/disable entries whose reveal condition flipped
    const lites = snap.books.flatMap((b) => b.entries).filter((e) => e.vellum && e.reveal).map((e) => ({ id: e.id, key: e.key, content: e.content, link: e.link, category: e.category, disabled: e.disabled, reveal: e.reveal! }));
    if (lites.length) { for (const ch of evaluateSchedules(state, lites)) { await updateEntry(ch.entryId, { disabled: !ch.enable }, userId); changed++; } }
    // recursion seeds: weave each bonded partner's name into the other's keysecondary
    // so the host recursion can pull bonded characters in. Dedupe vs existing.
    const castEntries = owned.filter((e) => e.link.startsWith('cast:'));
    if (castEntries.length) {
      const ksById = new Map(castEntries.map((e) => [e.id, e.keysecondary ?? []] as const));
      const castLites: VaultEntryLite[] = castEntries.map((e) => ({ id: e.id, key: e.key, content: e.content, link: e.link, category: e.category, disabled: e.disabled }));
      for (const [entryId, names] of recursionSeeds(state, castLites)) {
        const existing = ksById.get(entryId) ?? [];
        const merged = existing.slice();
        for (const n of names) if (!merged.some((x) => x.toLowerCase() === n.toLowerCase())) merged.push(n);
        if (merged.length > existing.length) { await updateEntry(entryId, { keysecondary: merged }, userId); changed++; }
      }
    }
    // Tier-C auto-author: draft pending entries for salient uncovered cast when
    // a category is set to 'auto'. Dedupe against existing entries first.
    const autoOn = (await loadCategories()).some((c) => c.sync === 'auto');
    if (autoOn) {
      const allEntries = snap.books.flatMap((b) => b.entries);
      const covered = new Set(allEntries.filter((e) => e.vellum && e.link).map((e) => e.link));
      const bookId = snap.books.find((b) => b.vellum)?.id;
      if (bookId) {
        const cats = await loadCategories();
        const charCat = cats.find((c) => c.id === 'characters');
        for (const d of autoAuthorDrafts(state, covered)) {
          if (findDupe(d.content, allEntries)) continue; // skip near-duplicates
          await createEntry({ bookId, key: d.key, content: d.content, comment: d.name, settings: charCat?.defaults ?? cats[0]!.defaults, category: d.category, source: 'auto', link: 'cast:' + d.id, pending: true }, userId);
          changed++;
        }
      }
    }
    if (changed) { await vaultBroadcast(chatId, userId); spindle.log?.info?.('[vellum_engine] vault sync: ' + changed + ' change(s)'); }
  } catch (e) { spindle.log?.warn?.('[vellum_engine] vault sync: ' + ((e as Error)?.message ?? e)); }
  finally { _vaultSyncing.delete(chatId); }
}

const _chapterVaulting = new Set<string>();

/** Read the per-chat chapter-vault mode (off | keyed | constant). Default keyed
 * when world_books is granted; off otherwise. */
async function readChapterVaultMode(chatId: string): Promise<ChapterVaultMode> {
  const v = await getChatVar(chatId, 'vellum_chapter_vault');
  if (v === 'off' || v === 'keyed' || v === 'constant') return v;
  return 'keyed'; // default ON (keyed) per design
}

/**
 * Hybrid chapter memory Ã¢â‚¬â€ VAULT projection (the I/O half). Mirrors each chapter/
 * arc memory's DETAIL into a world-book entry so the host injects it on keyword
 * relevance, outside VELLUM's recall budget. Reconciles create/update/delete and
 * round-trips user-edited keys back into the chronicle (memory.link). Pure diff
 * lives in domain/chapter-vault.ts. Best-effort, serialized per chat.
 */
async function resolveVellumBook(snap: { books: Array<{ id: string; name: string; vellum: boolean }> }, chatId: string, userId: string | null, name: string, desc: string): Promise<string> {
  const byName = snap.books.find((b) => b.name === name);
  if (byName) return byName.id;
  const r = await createBook(name, desc, userId);
  if (!r.ok) return '';
  if (chatId) { try { await setBookAttached(chatId, r.value, true, userId); } catch { /* best effort */ } }
  snap.books.push({ id: r.value, name, vellum: true } as any); // reuse within this pass
  return r.value;
}

async function maybeChapterVault(chatId: string, userId: string | null): Promise<{ ok: boolean; reason?: string; created: number; updated: number; removed: number }> {
  if (_chapterVaulting.has(chatId)) return { ok: false, reason: 'busy', created: 0, updated: 0, removed: 0 };
  if (!(await hasVault())) return { ok: false, reason: 'no_world_books', created: 0, updated: 0, removed: 0 };
  const mode = await readChapterVaultMode(chatId);
  _chapterVaulting.add(chatId);
  try {
    const state = await loadState(chatId);
    const snap = await vaultSnapshot(chatId, userId);
    const entries = snap.books.flatMap((b) => b.entries);
    const plan = reconcileChapterEntries(state, entries, mode);
    if (mode === 'off') {
      // tear down our chapter/arc entries when disabled
      let removed = 0;
      for (const e of entries.filter((x) => x.vellum && /^(chapter|arc|faction):/.test(x.link))) { await deleteEntry(e.id, userId); removed++; }
      return { ok: true, reason: 'mode_off', created: 0, updated: 0, removed };
    }
    const names = await chatNames(chatId, userId);
    const card = (names.char || 'Chronicle').slice(0, 40);
    // two named books: summaries (chapters/arcs) and lore (factions + promotions)
    const summaryBook = await resolveVellumBook(snap, chatId, userId, `VELLUM Vault (${card}) - Summaries`, 'Auto-authored chapter & arc summaries.');
    const loreBook = await resolveVellumBook(snap, chatId, userId, `VELLUM Vault (${card}) - Lore`, 'Auto-authored factions, characters, and lore.');
    const bookId = summaryBook;
    if (!bookId) return { ok: false, reason: 'no_book', created: 0, updated: 0, removed: 0 };
    const linkEvents: VellumEvent[] = [];
    for (const c of plan.create) {
      const r = await createEntry({ bookId, key: c.input.key, content: c.input.content, comment: c.input.comment, settings: c.input.settings, category: c.input.category, source: 'chapter', link: c.input.link }, userId);
      if (r.ok && r.value) linkEvents.push({ seq: nextSeqLocal(), turn: state.turns || 0, day: state.day || 0, src: 'system', kind: 'memory.link', id: c.memId, vaultEntryId: r.value, keys: c.input.key } as VellumEvent);
    }
    for (const u of plan.update) {
      // content/constant only Ã¢â‚¬â€ keys are owned by the entry post-creation and
      // round-trip via keySync, so we never clobber a user's edited keywords.
      await updateEntry(u.entryId, { content: u.input.content, constant: u.input.settings.constant ?? false, extensions: { vellum: true, vellumCategory: u.input.category, vellumSource: 'chapter', vellumLink: u.input.link } }, userId);
    }
    for (const k of plan.keySync) {
      // user edited the entry's keys Ã¢â€ â€™ pull them back to the chronicle memory
      linkEvents.push({ seq: nextSeqLocal(), turn: state.turns || 0, day: state.day || 0, src: 'system', kind: 'memory.link', id: k.memId, vaultEntryId: k.entryId, keys: k.keys } as VellumEvent);
    }
    for (const entryId of plan.remove) await deleteEntry(entryId, userId);
    if (linkEvents.length) { await append(chatId, linkEvents.filter((e) => (e as any).vaultEntryId)); invalidateIndex(chatId); }
    // factions: project group lore-sheets to the vault (keyed entries, same mode)
    const fplan = reconcileFactionEntries(state, entries, mode);
    if (loreBook) {
      for (const c of fplan.create) await createEntry({ bookId: loreBook, key: c.input.key, content: c.input.content, comment: c.input.comment, settings: c.input.settings, category: c.input.category, source: 'faction', link: c.input.link }, userId);
      for (const u of fplan.update) await updateEntry(u.entryId, { content: u.input.content, constant: u.input.settings.constant ?? false, extensions: { vellum: true, vellumCategory: 'factions', vellumSource: 'faction', vellumLink: u.input.link } }, userId);
      for (const entryId of fplan.remove) await deleteEntry(entryId, userId);
    }
    if (plan.create.length || plan.update.length || plan.remove.length) spindle.log?.info?.(`[vellum_engine] chapter-vault: +${plan.create.length} ~${plan.update.length} -${plan.remove.length} (mode ${mode})`);
    return { ok: true, created: plan.create.length, updated: plan.update.length, removed: plan.remove.length };
  } catch (e) { spindle.log?.warn?.('[vellum_engine] chapter-vault: ' + ((e as Error)?.message ?? e)); return { ok: false, reason: 'error', created: 0, updated: 0, removed: 0 }; }
  finally { _chapterVaulting.delete(chatId); }
}

let _summarizing = new Set<string>();
async function maybeAutoSummarize(chatId: string, userId: string | null): Promise<void> {
  if (_summarizing.has(chatId)) return;
  const state = await loadState(chatId);
  const turnMems = state.memories.filter((m) => m.tier === 'turn').length;
  if (turnMems < AUTO_SUMMARY_AT) return; // threshold; keeps recent turns verbatim
  _summarizing.add(chatId);
  try {
    const evs = await summarizeOnce(state, userId, 8, await chatNames(chatId, userId));
    if (evs.length) {
      await append(chatId, evs); invalidateIndex(chatId); await broadcastState(chatId, userId);
      spindle.log?.info?.('[vellum_engine] auto-summarized a chapter');
      void maybeChapterVault(chatId, userId); // project the new chapter's detail to the vault
      // if the user enabled hide-summarized, fold the freshly-covered turns away
      try {
        const enabled = !!(await getChatVar(chatId, 'vellum_hide_summarized'));
        if (enabled) { const ns = await loadState(chatId); await syncHideOnFile(chatId, true, coveredTurn(ns)); }
      } catch { /* best effort */ }
    }
  } catch (e) { spindle.log?.warn?.('[vellum_engine] auto-summary: ' + ((e as Error)?.message ?? e)); }
  finally { _summarizing.delete(chatId); }
}
const AUTO_SUMMARY_AT = 16; // compress the oldest 8 once 16 turn-memories accrue

async function boot(): Promise<void> {
  await restoreUser();
  await wireCapabilities(); // attach interceptor + generation fold if already granted
  spindle.log?.info?.('[vellum_engine] booted ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â event-log core online');
}
void boot();

/**
 * Build a scene query from the tail of the prompt the interceptor is assembling.
 * We pull the last few message contents so recall keys off what's happening NOW.
 */
function sceneQuery(messages: any[]): string {
  try {
    if (Array.isArray(messages) && messages.length) {
      return messages.slice(-4).map((m: any) => (typeof m?.content === 'string' ? m.content : '')).join(' ').slice(0, 2000);
    }
  } catch { /* ignore */ }
  return '';
}

/**
 * Build the controller CallModel for traversal IF the user enabled it for this
 * chat (chat var `vellum_traversal`). Returns undefined when off or when the
 * generation permission is missing, so recall stays on the deterministic path.
 * The model call is cheap (reasoning off) and hard-timeout bounded.
 */
async function traversalController(chatId: string, uid: string | null, perCallMs = 1500): Promise<CallModel | undefined> {
  let enabled = false;
  try { enabled = !!(await getChatVar(chatId, 'vellum_traversal')); } catch { /* best effort */ }
  if (!enabled || !(await has('generation'))) return undefined;
  return async (prompt) => controllerGenerate(
    [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
    uid,
    perCallMs,
  );
}

// PR2 Ã¢â‚¬â€ precomputed tree traversal. After a turn ends we walk the memory/character
// tree in the BACKGROUND (nobody waiting) and cache the ranking keyed on
// logVersion. The interceptor reads the cache instead of drilling live, so tree
// mode costs ~0 on the prompt path. Stale/missing Ã¢â€ â€™ live drill (or fallback).
interface PrecomputedTree { version: number; result: TreeTraversalResult }
const _treeCache = new Map<string, PrecomputedTree>();
const _precomputing = new Set<string>();

/** Read a fresh (current-logVersion) precomputed tree ranking, else null. */
function getPrecomputedTree(chatId: string): TreeTraversalResult | null {
  const c = _treeCache.get(chatId);
  return c && c.version === logVersion(chatId) ? c.result : null;
}

/** Walk the tree after a turn and cache it. Gated on tree mode + generation. */
async function precomputeTree(chatId: string, userId: string | null): Promise<void> {
  if (_precomputing.has(chatId)) return;
  if ((await getChatVar(chatId, 'vellum_traversal_mode')) !== 'tree') return;
  if (!(await getChatVar(chatId, 'vellum_traversal'))) return;
  const controller = await traversalController(chatId, userId, 1200);
  if (!controller) return;
  _precomputing.add(chatId);
  try {
    const version = logVersion(chatId);
    const state = await loadState(chatId);
    const { buildIndex, collectItems } = await import('./retrieval/invindex.js');
    const index = buildIndex(collectItems(state));
    const axis = readAxis(await getChatVar(chatId, 'vellum_traversal_axis'));
    const result = await traverseTree(index, state, controller, { axis });
    if (result) _treeCache.set(chatId, { version, result });
  } catch (e) { spindle.log?.warn?.('[vellum_engine] precomputeTree: ' + ((e as Error)?.message ?? e)); }
  finally { _precomputing.delete(chatId); }
}

// --- permission-gated wiring --------------------------------------------
// The host rejects interceptor/generation registration when the permission
// isn't granted, and won't re-wire on its own when the user grants it later.
// So we attach each piece behind a capability check, idempotently, and re-run
// the whole attach pass whenever permissions change ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â no reload required.
let _interceptorWired = false;
let _genWired = false;

async function wireCapabilities(): Promise<void> {
  // INTERCEPT: inject authoritative cast/bonds + scene-relevant recall.
  if (!_interceptorWired && (await has('interceptor')) && spindle.registerInterceptor) {
    try {
      // The host calls (messages, context) and expects the messages array back
      // (or { messages, breakdown }). We PREPEND our injection as a system
      // message rather than returning a custom shape ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â returning anything
      // without `.messages` breaks the host's `normalized.messages`.
      spindle.registerInterceptor(async (messages: any[], context: any) => {
        const out = Array.isArray(messages) ? messages : [];
        try {
          const uid = context?.userId || currentUser();
          rememberUser(uid);
          const chatId = context?.chatId || context?.chat_id || (await activeChatId(uid));
          if (!chatId) return out;
          const state = await loadState(chatId);
          if (!state.turns && !Object.keys(state.cast).length) return out;
          // Controller-guided traversal (variant A), opt-in per chat. Builds a
          // CallModel backed by a cheap, timeout-bounded controller generation;
          // buildInjectionHybrid falls back to the deterministic path on any miss.
          const tmode = (await getChatVar(chatId, 'vellum_traversal_mode')) === 'tree' ? 'tree' : 'flat';
          // PR2: prefer a fresh precomputed tree ranking (warmed after the last
          // turn) Ã¢â‚¬â€ zero prompt-path latency. Else drill live, tightening each of
          // the up-to-4 calls so the inline budget stays bounded (~3.2s).
          const pre = tmode === 'tree' ? getPrecomputedTree(chatId) : null;
          const controller = pre ? undefined : await traversalController(chatId, uid, tmode === 'tree' ? 800 : 1500);
          const inj = await buildInjectionHybrid(chatId, state, sceneQuery(out), uid, 1, logVersion(chatId), controller, tmode, pre);
          // Plot Director: append armed directives as gentle guidance (suggestive,
          // not a hard block Ã¢â‚¬â€ they self-clear at the fold when fulfilled).
          const dirText = directiveInjection(await readDirectives(chatId));
          const injText = dirText ? (inj.text ? inj.text + '\n\n' + dirText : dirText) : inj.text;
          if (!injText) return out;
          const rec = recordInjection(chatId, state.turns || 0, injText, inj.recallIds, { source: inj.source, trace: inj.trace ?? inj.treeTrace });
          // Fix 11 Ã¢â‚¬â€ live retrieval feed: push the record so the Injection tab
          // streams in real time instead of only on manual Refresh.
          try { spindle.sendToFrontend?.({ type: 'vellum_injection_push', chatId, record: rec }, uid); } catch { /* best effort */ }
          const head = { role: 'system', content: injText };
          return { messages: [head, ...out], breakdown: [{ messageIndex: 0, name: 'VELLUM Recall' }] };
        } catch (e) {
          spindle.log?.warn?.('[vellum_engine] interceptor: ' + ((e as Error)?.message ?? e));
          return out;
        }
      }, 120);
      _interceptorWired = true;
      spindle.log?.info?.('[vellum_engine] interceptor wired');
    } catch (e) { spindle.log?.warn?.('[vellum_engine] interceptor wiring deferred: ' + ((e as Error)?.message ?? e)); }
  }

  // FOLD on generation end (requires the generation permission to subscribe).
  if (!_genWired && (await has('generation'))) {
    try {
      spindle.on?.('GENERATION_ENDED', async (p: any) => {
        rememberUser(p?.userId);
        const chatId = p?.chatId || p?.chat_id || (await activeChatId(p?.userId ?? currentUser()));
        if (!chatId) return;
        // some hosts include the finished text on the event; use it if present
        const hint = typeof p?.message === 'string' ? p.message : (typeof p?.content === 'string' ? p.content : (typeof p?.text === 'string' ? p.text : ''));
        await foldChat(chatId, p?.userId ?? currentUser(), hint);
      });
      _genWired = true;
      spindle.log?.info?.('[vellum_engine] generation fold wired');
    } catch (e) { spindle.log?.warn?.('[vellum_engine] generation wiring deferred: ' + ((e as Error)?.message ?? e)); }
  }
}

// Always-safe events (no special permission to subscribe).
try {
  spindle.on?.('PERMISSION_CHANGED', () => { invalidatePermissions(); void wireCapabilities(); });
  spindle.on?.('CHAT_SWITCHED', (p: any) => { rememberUser(p?.userId); invalidateChatCaps(); if (p?.chatId) invalidate(); });
} catch { /* events optional */ }

// --- frontend dispatch table ---------------------------------------------
// Each entry is isolated; a throw in one handler can't affect the others.
type Handler = (payload: any, userId: string | null) => Promise<void> | void;
const dispatch: Record<string, Handler> = {
  vellum_ping: (_p, uid) => { spindle.sendToFrontend?.({ type: 'vellum_pong', v: '2.0.0-alpha.0' }, uid); },
  vellum_get_state: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) { spindle.sendToFrontend?.({ type: 'vellum_state', chatId: null, state: null }, uid); return; }
    // self-heal: catch up any turns that weren't folded, then broadcast
    try { await foldChat(chatId, uid); } catch { /* best effort */ }
    await broadcastState(chatId, uid);
  },
  vellum_recover: async (p, uid) => {
    // Restore from the .bak if it holds more events than the current log (undo a
    // shrink/wipe). Reports how many events were recovered.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) { spindle.sendToFrontend?.({ type: 'vellum_recover_done', ok: false, reason: 'no_active_chat' }, uid); return; }
    invalidate(chatId);
    const recovered = await recoverFromBackup(chatId);
    await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_recover_done', ok: !!recovered, events: recovered ? (await loadState(chatId)) && logVersion(chatId) : 0 }, uid);
  },
  vellum_refold: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (chatId) { lastSigByChat.delete(chatId); await foldChat(chatId, uid); }
  },
  vellum_rebuild: async (p, uid) => {
    // RECOVER: rebuild the whole chronicle from the chat transcript (the true
    // source). Clears the derived log, then re-folds every assistant turn Ã¢â‚¬â€ so a
    // wiped/corrupt chronicle can be reconstructed (cast/relations/knowledge/
    // journal) from the messages, which were never lost.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) { spindle.sendToFrontend?.({ type: 'vellum_rebuild_done', ok: false, reason: 'no_active_chat' }, uid); return; }
    try {
      const msgs = await allTurnContents(chatId);
      await clearLog(chatId);
      lastSigByChat.delete(chatId);
      let prior = await loadState(chatId);
      const tone = await readTone(chatId, uid);
      const names = await chatNames(chatId, uid);
      const userCanon = names.user ? canonId(names.user) : '';
      const locks = await readLocks(chatId);
      let turns = 0;
      for (let turnNo = 1; turnNo <= msgs.length; turnNo++) {
        const content = (msgs[turnNo - 1] ?? '').trim();
        if (!content) continue;
        const { events } = foldTurn(content, prior, turnNo, { tone, userCanon, locks });
        const evs: VellumEvent[] = [...events];
        if (!evs.some((e) => e.kind === 'turn.fold')) evs.unshift({ seq: nextSeqLocal(), turn: turnNo, day: prior.day || 0, src: 'system', kind: 'turn.fold', sig: sigOf(content) } as VellumEvent);
        const gist = turnGist(content, names);
        if (gist) evs.push({ seq: nextSeqLocal(), turn: turnNo, day: prior.day || 0, src: 'system', kind: 'memory.record', id: 'turn_' + chatId.slice(0, 6) + '_' + turnNo, tier: 'turn', text: gist, keys: [] } as VellumEvent);
        prior = await append(chatId, evs);
        turns++;
        // optional deep extraction per turn (knowledge/secrets/journal) when asked
        if (p?.deep && gist) { try { const xe = await extractFromProse(gist, turnNo, prior.day || 0, names, uid, prior, tone); if (xe.length) prior = await append(chatId, xe); } catch { /* best effort */ } }
      }
      invalidateIndex(chatId);
      await broadcastState(chatId, uid);
      void maybeChapterVault(chatId, uid); // reconcile vault chapter entries after a full rebuild
      spindle.sendToFrontend?.({ type: 'vellum_rebuild_done', ok: true, turns }, uid);
      spindle.log?.info?.('[vellum_engine] rebuilt chronicle from transcript: ' + turns + ' turns');
    } catch (e) {
      spindle.sendToFrontend?.({ type: 'vellum_rebuild_done', ok: false, reason: (e as Error)?.message ?? 'error' }, uid);
    }
  },
  vellum_import_legacy: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) { spindle.sendToFrontend?.({ type: 'vellum_import_done', ok: false, reason: 'no_active_chat' }, uid); return; }
    try {
      const events = importLegacy(p?.chronicle);
      await append(chatId, events);
      invalidateIndex(chatId);
      await broadcastState(chatId, uid);
      spindle.sendToFrontend?.({ type: 'vellum_import_done', ok: true, events: events.length }, uid);
    } catch (e) {
      spindle.sendToFrontend?.({ type: 'vellum_import_done', ok: false, reason: (e as Error)?.message ?? 'error' }, uid);
    }
  },
  vellum_cmd: async (p, uid) => {
    // CRUD: add/edit/delete any entity. payload.cmd = e.g. 'cast_upsert'.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId || !p?.cmd || !CMD_TYPES.has(p.cmd)) return;
    const state = await loadState(chatId);
    const evs = cmdEvents(p.cmd, p, state, { turn: state.turns || 0, day: state.day || 0 });
    if (!evs.length) return;
    await append(chatId, evs);
    invalidateIndex(chatId);
    await broadcastState(chatId, uid);
    // deleting OR editing a chapter/arc memory must reconcile its mirrored Vault
    // entry (drop orphans; re-project edited detail/keys).
    if (p.cmd === 'memory_delete' || p.cmd === 'memory_edit') void maybeChapterVault(chatId, uid);
  },
  vellum_summarize: async (p, uid) => {
    // manual "summarize past turns" Ã¢â‚¬â€ compress as many full windows as exist.
    // Broadcast state + a progress count after EACH window so summaries appear
    // one-by-one in the chronicle/vault instead of all at once on reload.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const state = await loadState(chatId);
    const rounds = await summarizeAll(state, uid, (evs) => append(chatId, evs), 4, await chatNames(chatId, uid), async (done, total) => {
      invalidateIndex(chatId);
      await broadcastState(chatId, uid);
      await maybeChapterVault(chatId, uid); // project each new chapter to the vault as it lands
      spindle.sendToFrontend?.({ type: 'vellum_summarize_progress', done, total }, uid);
    });
    invalidateIndex(chatId);
    await broadcastState(chatId, uid);
    const vault = await maybeChapterVault(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_summarize_done', ok: true, rounds, vault }, uid);
  },
  vellum_resummarize: async (p, uid) => {
    // Rebuild ALL chapter summaries with the current pipeline. Drop every chapter
    // memory (the reducer restores each chapter's subsumed turn-memories), then
    // re-run summarizeAll over the restored turns. Fixes old/low-quality gists.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) { spindle.sendToFrontend?.({ type: 'vellum_resummarize_done', ok: false, reason: 'no_active_chat' }, uid); return; }
    if (!(await has('generation'))) { spindle.sendToFrontend?.({ type: 'vellum_resummarize_done', ok: false, reason: 'no_generation' }, uid); return; }
    try {
      let state = await loadState(chatId);
      const chapters = state.memories.filter((m) => m.tier === 'chapter');
      if (chapters.length) {
        const drops = chapters.map((m) => ({ seq: nextSeqLocal(), turn: state.turns || 0, day: state.day || 0, src: 'user', kind: 'memory.drop', id: m.id } as VellumEvent));
        state = await append(chatId, drops); // reducer restores the subsumed turns
        invalidateIndex(chatId);
        await broadcastState(chatId, uid);
      }
      const rounds = await summarizeAll(state, uid, (evs) => append(chatId, evs), 4, await chatNames(chatId, uid), async (done, total) => {
        invalidateIndex(chatId);
        await broadcastState(chatId, uid);
        await maybeChapterVault(chatId, uid);
        spindle.sendToFrontend?.({ type: 'vellum_summarize_progress', done, total }, uid);
      });
      invalidateIndex(chatId);
      await broadcastState(chatId, uid);
      const vault = await maybeChapterVault(chatId, uid);
      spindle.sendToFrontend?.({ type: 'vellum_resummarize_done', ok: true, rounds, vault }, uid);
    } catch (e) {
      spindle.log?.warn?.('[vellum_engine] resummarize: ' + ((e as Error)?.message ?? e));
      spindle.sendToFrontend?.({ type: 'vellum_resummarize_done', ok: false, reason: 'error' }, uid);
    }
  },
  vellum_clear: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    await clearLog(chatId);
    invalidateIndex(chatId);
    await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_cleared', ok: true }, uid);
  },
  vellum_export: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const log = await exportLog(chatId);
    spindle.sendToFrontend?.({ type: 'vellum_export', chatId, log }, uid);
  },
  vellum_get_injection: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    spindle.sendToFrontend?.({ type: 'vellum_injection', chatId, log: (injectionLog.get(chatId) ?? []).slice().reverse() }, uid);
  },
  vellum_get_vault: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    const categories = await loadCategories();
    if (!(await hasVault())) { spindle.sendToFrontend?.({ type: 'vellum_vault', ok: false, reason: 'no_permission', categories, books: [], attached: [], activated: [], suggestions: [] }, uid); return; }
    await vaultBroadcast(chatId ?? '', uid);
  },
  vellum_vault_category: async (p, uid) => {
    // upsert/delete a category. payload.op = 'upsert'|'delete'
    if (p?.op === 'delete' && p?.id) await deleteCategory(String(p.id));
    else if (p?.cat) {
      const c = p.cat as Partial<VaultCategory>;
      const id = c.id || ('custom_' + Date.now().toString(36));
      const base = c.builtin ? null : customCategory(id, String(c.label || 'Custom'), String(c.glyph || '\u2727'), String(c.color || '#cdbfa0'));
      await upsertCategory({ ...(base ?? {}), ...(c as VaultCategory), id });
    }
    const categories = await loadCategories();
    spindle.sendToFrontend?.({ type: 'vellum_vault_categories', categories }, uid);
  },
  vellum_vault_op: async (p, uid) => {
    // book + entry CRUD. payload.op decides.
    const chatId = p?.chatId || (await activeChatId(uid));
    const done = (ok: boolean, extra?: Record<string, unknown>) => spindle.sendToFrontend?.({ type: 'vellum_vault_done', op: p?.op, ok, ...(extra || {}) }, uid);
    if (!(await hasVault())) { done(false, { reason: 'no_permission' }); return; }
    try {
      const cats = await loadCategories();
      if (p.op === 'book_create') { const r = await createBook(String(p.name || 'New Lorebook'), String(p.description || ''), uid); if (r.ok && p.attach && chatId) await setBookAttached(chatId, r.value, true, uid); done(r.ok, r.ok ? { bookId: r.value } : { reason: r.error }); }
      else if (p.op === 'book_update') { const r = await updateBook(String(p.bookId), String(p.name || ''), p.description, uid); done(r.ok, r.ok ? {} : { reason: r.error }); }
      else if (p.op === 'book_attach') { if (!chatId) { done(false, { reason: 'no_active_chat' }); return; } const ok = await setBookAttached(chatId, String(p.bookId), !!p.attach, uid); done(ok); }
      else if (p.op === 'entry_create') {
        const cat = resolveCategory(cats, p.category);
        const settings: EntrySettings = p.settings ?? cat.defaults;
        // auto-resolve a target book: explicit Ã¢â€ â€™ a VELLUM book Ã¢â€ â€™ create+attach one
        let bookId = String(p.bookId || '');
        if (!bookId) {
          const snap = await vaultSnapshot(chatId ?? '', uid);
          bookId = snap.books.find((b) => b.vellum)?.id || snap.books[0]?.id || '';
          if (!bookId) { const cr = await createBook('VELLUM Vault', 'Lore authored in the Vault', uid); if (!cr.ok) { done(false, { reason: cr.error }); return; } bookId = cr.value; if (chatId) await setBookAttached(chatId, bookId, true, uid); }
        }
        const r = await createEntry({ bookId, key: splitList(p.key), keysecondary: splitList(p.keysecondary), content: String(p.content || ''), comment: String(p.comment || ''), settings, category: cat.id, source: 'manual' }, uid);
        done(r.ok, r.ok ? { entryId: r.value } : { reason: r.error });
      } else if (p.op === 'entry_update') {
        const patch: Record<string, unknown> = {};
        if (p.key !== undefined) patch.key = splitList(p.key);
        if (p.keysecondary !== undefined) patch.keysecondary = splitList(p.keysecondary);
        if (p.content !== undefined) patch.content = String(p.content);
        if (p.comment !== undefined) patch.comment = String(p.comment);
        if (p.settings) Object.assign(patch, settingsToEntryFields(p.settings));
        if (p.category) patch.extensions = { vellum: true, vellumCategory: String(p.category) };
        if (typeof p.disabled === 'boolean') patch.disabled = p.disabled;
        const r = await updateEntry(String(p.entryId), patch, uid); done(r.ok, r.ok ? {} : { reason: r.error });
      } else if (p.op === 'entry_delete') { const r = await deleteEntry(String(p.entryId), uid); done(r.ok, r.ok ? {} : { reason: r.error }); }
      else if (p.op === 'entry_unlink') {
        // convert an auto-managed entry to hand-owned: keep vellum tag + category,
        // drop the source link so Tier-B sync never touches it again
        const r = await updateEntry(String(p.entryId), { extensions: { vellum: true, vellumCategory: String(p.category || ''), vellumSource: 'manual' } }, uid);
        done(r.ok, r.ok ? {} : { reason: r.error });
      }
      else done(false, { reason: 'unknown_op' });
    } catch (e) { done(false, { reason: (e as Error)?.message ?? 'error' }); }
    // refresh the snapshot after any mutation
    await vaultBroadcast(chatId ?? '', uid);
  },
  vellum_vault_promote: async (p, uid) => {
    // Tier A: promote a chronicle record into a Vault entry (or refresh if it exists).
    const chatId = p?.chatId || (await activeChatId(uid));
    const done = (ok: boolean, extra?: Record<string, unknown>) => spindle.sendToFrontend?.({ type: 'vellum_vault_done', op: 'promote', ok, ...(extra || {}) }, uid);
    if (!chatId || !(await hasVault())) { done(false, { reason: 'no_permission' }); return; }
    try {
      const state = await loadState(chatId);
      const promo = buildPromotion(state, p.kind as PromoteKind, String(p.id));
      if (!promo) { done(false, { reason: 'not_found' }); return; }
      const cats = await loadCategories();
      const cat = resolveCategory(cats, promo.category);
      const snap = await vaultSnapshot(chatId, uid);
      // target a VELLUM-owned book (create one if none), reuse if entry already linked
      let bookId = p.bookId || snap.books.find((b) => b.vellum)?.id;
      if (!bookId) { const r = await createBook('VELLUM Vault', 'Lore promoted from the chronicle', uid); if (!r.ok) { done(false, { reason: r.error }); return; } bookId = r.value; await setBookAttached(chatId, bookId, true, uid); }
      const existing = snap.books.flatMap((b) => b.entries).find((e) => e.vellum && e.link === promo.link);
      if (existing) { await syncEntry(existing.id, promo.content, promo.key, promo.hash, promo.link, cat.id, uid); done(true, { updated: true }); }
      else { const r = await createEntry({ bookId, key: promo.key, keysecondary: promo.keysecondary, content: promo.content, comment: promo.comment, settings: cat.defaults, category: cat.id, source: 'promote', link: promo.link, hash: promo.hash }, uid); done(r.ok, r.ok ? { entryId: r.value } : { reason: r.error }); }
    } catch (e) { done(false, { reason: (e as Error)?.message ?? 'error' }); }
    await vaultBroadcast(chatId, uid);
  },
  vellum_vault_suggest: async (p, uid) => {
    // accept (promote) or dismiss a scene-coverage suggestion
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    if (p?.action === 'dismiss') { dismissedFor(chatId).add(String(p.kind === 'relation' ? 'rel:' + p.id : 'cast:' + p.id)); await vaultBroadcast(chatId, uid); return; }
    if (p?.action === 'accept') { await (dispatch.vellum_vault_promote as Handler)({ chatId, kind: p.kind, id: p.id }, uid); return; }
  },
  vellum_vault_pending: async (p, uid) => {
    // resolve a Tier-C draft: accept (clear pending flag) or reject (delete)
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!(await hasVault())) return;
    try {
      if (p?.action === 'accept') await updateEntry(String(p.entryId), { extensions: { vellum: true, vellumCategory: String(p.category || 'characters'), vellumSource: 'auto', vellumLink: String(p.link || ''), vellumPending: false } }, uid);
      else if (p?.action === 'reject') await deleteEntry(String(p.entryId), uid);
    } catch (e) { spindle.log?.warn?.('[vellum_engine] pending resolve: ' + ((e as Error)?.message ?? e)); }
    await vaultBroadcast(chatId ?? '', uid);
  },
  vellum_rescan: async (p, uid) => {
    // re-fold the latest turn from raw stored text (recover from a missed fold)
    const chatId = p?.chatId || (await activeChatId(uid));
    if (chatId) { lastSigByChat.delete(chatId); await foldChat(chatId, uid); spindle.sendToFrontend?.({ type: 'vellum_rescan_done', ok: true }, uid); }
  },
  vellum_refresh: async (p, uid) => {
    // REFRESH TRACKER: re-fold the LATEST turn even if it was already folded
    // (wrongly). rescan only folds turns AFTER the last one, so a turn that
    // mis-folded Ã¢â‚¬â€ e.g. fell to the regex parser before a parser fix Ã¢â‚¬â€ can't be
    // corrected by it. Here we drop the latest turn's events and re-fold it from
    // the raw message with current parser logic, preserving all earlier history.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) { spindle.sendToFrontend?.({ type: 'vellum_refresh_done', ok: false, reason: 'no_active_chat' }, uid); return; }
    const state = await loadState(chatId);
    const maxTurn = state.turns || 0;
    if (maxTurn <= 0) { lastSigByChat.delete(chatId); await foldChat(chatId, uid); spindle.sendToFrontend?.({ type: 'vellum_refresh_done', ok: true, refolded: 0 }, uid); return; }
    try {
      await truncateAfterTurn(chatId, maxTurn - 1); // drop the latest turn's events
      lastSigByChat.delete(chatId);                  // clear the dedupe sig so it re-folds
      await foldChat(chatId, uid);                   // re-fold the latest turn cleanly
      spindle.sendToFrontend?.({ type: 'vellum_refresh_done', ok: true, refolded: maxTurn }, uid);
    } catch (e) {
      spindle.log?.warn?.('[vellum_engine] refresh: ' + ((e as Error)?.message ?? e));
      spindle.sendToFrontend?.({ type: 'vellum_refresh_done', ok: false, reason: 'error' }, uid);
    }
  },
  vellum_set_hide: async (p, uid) => {
    // toggle hide-summarized-turns; persist the preference in a chat var
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const enabled = !!p?.enabled;
    try { await setChatVar(chatId, 'vellum_hide_summarized', enabled ? '1' : ''); } catch { /* best effort */ }
    const state = await loadState(chatId);
    const covered = coveredTurn(state);
    const res = await syncHideOnFile(chatId, enabled, covered);
    spindle.sendToFrontend?.({ type: 'vellum_hide_done', ok: true, enabled, ...res }, uid);
  },
  vellum_set_traversal: async (p, uid) => {
    // controller-guided retrieval mode: off | flat (one-shot) | tree (tiered
    // arcÃ¢â€ â€™chapterÃ¢â€ â€™leaf drill). Persisted in chat vars; needs generation to engage.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const mode = (p?.mode === 'flat' || p?.mode === 'tree') ? p.mode : (p?.enabled ? 'flat' : 'off');
    const enabled = mode !== 'off';
    try { await setChatVar(chatId, 'vellum_traversal', enabled ? '1' : ''); } catch { /* best effort */ }
    try { await setChatVar(chatId, 'vellum_traversal_mode', mode === 'tree' ? 'tree' : 'flat'); } catch { /* best effort */ }
    if (p?.axis === 'character' || p?.axis === 'temporal' || p?.axis === 'hybrid') { try { await setChatVar(chatId, 'vellum_traversal_axis', p.axis); } catch { /* best effort */ } }
    _treeCache.delete(chatId); // settings changed Ã¢â€ â€™ drop any stale precompute
    const available = await has('generation');
    const axis = readAxis(await getChatVar(chatId, 'vellum_traversal_axis'));
    spindle.sendToFrontend?.({ type: 'vellum_traversal_done', ok: true, enabled, mode, axis, available }, uid);
  },
  vellum_set_tone: async (p, uid) => {
    // persist romance pace + world disposition; they steer the fold (bond seed/
    // clamp/strip) and the preset prose. Validated via parseTone (neutral default).
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const tone = parseTone(p?.romance, p?.disposition);
    try { await setChatVar(chatId, 'vellum_romance', tone.romance); } catch { /* best effort */ }
    try { await setChatVar(chatId, 'vellum_disposition', tone.disposition); } catch { /* best effort */ }
    spindle.sendToFrontend?.({ type: 'vellum_tone_done', ok: true, romance: tone.romance, disposition: tone.disposition }, uid);
  },
  vellum_set_locks: async (p, uid) => {
    // Plot Director relation locks: persist the per-pair forbid/pin list. On
    // create, also drop any category already on the graph that the lock now
    // forbids (a one-time cleanup Ã¢â‚¬â€ future deltas are stripped at the fold).
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const locks = sanitizeLocks(p?.locks);
    try { await setChatVar(chatId, 'vellum_relation_locks', JSON.stringify(locks)); } catch { /* best effort */ }
    const state = await loadState(chatId);
    const evs: VellumEvent[] = [];
    for (const lock of locks) {
      if (!lock.forbid.length) continue;
      // match the existing relation in either direction; strip forbidden cats now
      const r = state.relations.find((x) => lockKey(x.a, x.b) === lock.key);
      if (!r) continue;
      const offending = (r.categories ?? []).filter((c) => lock.forbid.includes(c));
      if (offending.length) evs.push({ seq: nextSeqLocal(), turn: state.turns || 0, day: state.day || 0, src: 'user', kind: 'bond.delta', a: r.a, b: r.b, removeCats: offending } as VellumEvent);
    }
    if (evs.length) { await append(chatId, evs); invalidateIndex(chatId); }
    await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_locks_done', ok: true, locks }, uid);
  },
  vellum_set_directives: async (p, uid) => {
    // Plot Director: replace the directive list (UI sends the full set). Suggestive
    // nudges Ã¢â‚¬â€ injected while armed, self-cleared at the fold, TTL-expired.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const directives = sanitizeDirectives(p?.directives);
    await writeDirectives(chatId, directives);
    await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_directives_done', ok: true, directives }, uid);
  },
  vellum_set_tidy: async (p, uid) => {
    // toggle auto thread/arc reconcile (Layer 3); persist in a chat var
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const enabled = !!p?.enabled;
    try { await setChatVar(chatId, 'vellum_tidy_threads', enabled ? '1' : ''); } catch { /* best effort */ }
    spindle.sendToFrontend?.({ type: 'vellum_tidy_set_done', ok: true, enabled, available: await has('generation') }, uid);
  },
  vellum_set_offscreen: async (p, uid) => {
    // toggle off-screen simulation; persist in a chat var. Costs a generation per
    // tick (cadence-throttled), so it's opt-in and gated on the generation perm.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const enabled = !!p?.enabled;
    try { await setChatVar(chatId, 'vellum_offscreen', enabled ? '1' : ''); } catch { /* best effort */ }
    spindle.sendToFrontend?.({ type: 'vellum_offscreen_set_done', ok: true, enabled, available: await has('generation') }, uid);
    // run once immediately on enable so the user sees subplots without waiting
    // for the cadence gate (every Nth turn). Off the response path.
    if (enabled) void simulateOffscreen(chatId, uid);
  },
  vellum_set_chaptervault: async (p, uid) => {
    // chapter-vault mode: off | keyed (default) | constant. Detailed chapter
    // summaries mirror to the vault; chronicle keeps the lean gist.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const mode: ChapterVaultMode = (p?.mode === 'off' || p?.mode === 'constant') ? p.mode : 'keyed';
    try { await setChatVar(chatId, 'vellum_chapter_vault', mode); } catch { /* best effort */ }
    void maybeChapterVault(chatId, uid); // apply immediately (project / re-key / tear down)
    spindle.sendToFrontend?.({ type: 'vellum_chaptervault_done', ok: true, mode, available: await hasVault() }, uid);
  },
  vellum_tidy_now: async (p, uid) => {
    // manual "Tidy threads" Ã¢â‚¬â€ merge near-duplicate threads/arcs right now
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) { spindle.sendToFrontend?.({ type: 'vellum_tidy_done', ok: false, reason: 'no_active_chat' }, uid); return; }
    if (!(await has('generation'))) { spindle.sendToFrontend?.({ type: 'vellum_tidy_done', ok: false, reason: 'no_generation' }, uid); return; }
    const merged = await tidyThreads(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_tidy_done', ok: true, merged }, uid);
  },
  vellum_tidy_facts_now: async (p, uid) => {
    // manual "Tidy Knowledge/Secrets" Ã¢â‚¬â€ fold near-duplicate facts right now
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) { spindle.sendToFrontend?.({ type: 'vellum_tidy_facts_done', ok: false, reason: 'no_active_chat' }, uid); return; }
    if (!(await has('generation'))) { spindle.sendToFrontend?.({ type: 'vellum_tidy_facts_done', ok: false, reason: 'no_generation' }, uid); return; }
    const merged = await tidyFacts(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_tidy_facts_done', ok: true, merged }, uid);
  },
  vellum_import: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId || !p?.log) { spindle.sendToFrontend?.({ type: 'vellum_import_done', ok: false, reason: 'no_data' }, uid); return; }
    const v = EventLogSchema.safeParse(p.log);
    if (!v.success) { spindle.sendToFrontend?.({ type: 'vellum_import_done', ok: false, reason: 'invalid' }, uid); return; }
    await importLog(chatId, v.data);
    invalidateIndex(chatId);
    await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_import_done', ok: true, events: v.data.events.length }, uid);
  },
  vellum_undo: async (p, uid) => {
    // Fix 10 Ã¢â‚¬â€ UNDO LAST TURN: drop every event at the max turn in the log, then
    // re-reduce. Honors the read-only durability guard (truncate bails on it).
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) { spindle.sendToFrontend?.({ type: 'vellum_undo_done', ok: false, reason: 'no_active_chat' }, uid); return; }
    const state = await loadState(chatId);
    const maxTurn = state.turns || 0;
    if (maxTurn <= 0) { spindle.sendToFrontend?.({ type: 'vellum_undo_done', ok: false, reason: 'nothing_to_undo' }, uid); return; }
    await truncateAfterTurn(chatId, maxTurn - 1);
    invalidateIndex(chatId);
    await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_undo_done', ok: true, undoneTurn: maxTurn }, uid);
  },
};

try {
  spindle.onFrontendMessage?.(async (payload: any, userId: string) => {
    const uid = userId || payload?.userId || currentUser();
    rememberUser(uid);
    const h = payload?.type && dispatch[payload.type];
    if (!h) return;
    try { await h(payload, uid); }
    catch (e) { spindle.log?.warn?.('[vellum_engine] dispatch ' + payload.type + ': ' + ((e as Error)?.message ?? e)); }
  });
} catch { /* messaging optional */ }

try { spindle.log?.info?.('[vellum_engine] backend loaded'); } catch { /* ignore */ }

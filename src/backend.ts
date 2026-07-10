import { VELLUM_VERSION } from './version.js';
import { restoreUser, rememberUser, currentUser } from './host/user.js';
import { invalidatePermissions, invalidateChatCaps, has } from './host/capability.js';
import { activeChatId, latestAssistantContent, latestAssistantContentRetry, allAssistantContents, allTurnContents, chatNames, getChatVar, setChatVar, invalidateChatVars } from './host/chats.js';
import { loadState, append, appendDeferred, flush, invalidate, clearLog, exportLog, importLog, logVersion, logHasKind, truncateAfterTurn, turnSigs, turnDays, recoverFromBackup, loadLog } from './store/chronicle.js';
import { foldTurn } from './bus/lifecycle.js';
import { registerFeature } from './bus/registry.js';
import { coreFeature } from './domain/core-feature.js';
import { buildInjectionHybrid, invalidateIndex, sharedIndex } from './retrieval/recall.js';
import { importLegacy } from './store/import-legacy.js';
import { cmdEvents, CMD_TYPES } from './domain/commands.js';
import { summarizeOnce, summarizeAll, summarizeFromPlan } from './bus/summarize.js';
import { planChapterFrom, planArc, planArcFrom } from './domain/memory.js';
import { beatSpine, beatEvent, beatEditEvents, beatReorderEvents, suggestBeats } from './domain/beats.js';
import { locationList } from './domain/locations.js';
import { driftInjection } from './domain/drift.js';
import { formatDate } from './domain/date-format.js';
import { turnLog } from './domain/turnlog.js';
import { toMarkdown } from './domain/markdown.js';
import { moodInjectionCached, invalidateMood } from './domain/mood.js';
import { plantsInjection } from './domain/plants.js';
import { agingInjection } from './domain/aging.js';
import { sanitizeBudget, resolveBudget, DEFAULT_BUDGET, type ContextBudget, type ResolvedCaps } from './domain/context-budget.js';
import { sanitizeSummarizerCfg, DEFAULT_CFG, DEFAULT_CHAPTER_PROMPT, DEFAULT_ARC_PROMPT, DEFAULT_GIST_PROMPT, type SummarizerCfg } from './domain/summarizer-config.js';
import { extractFromProse } from './bus/extract.js';
import { controllerGenerate, invalidateConnCache, withTimeout } from './host/generation.js';
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
import { hasRegex, upsertScript, setScriptDisabled, deleteScriptByScriptId, scriptMeta } from './host/regex.js';
import { colorScripts, castColorHash } from './domain/dialogue-color.js';
import { loadCategories, upsertCategory, deleteCategory } from './store/vault-categories.js';
import { resolveCategory, settingsToEntryFields, customCategory, type EntrySettings, type VaultCategory } from './domain/vault.js';
import { reconcileChapterEntries, planChapterEntry, type ChapterVaultMode } from './domain/chapter-vault.js';
import { reconcileFactionEntries } from './domain/faction-vault.js';
import { buildPromotion, reconcileCategory, type PromoteKind } from './domain/promote.js';
import { parseTone, isDefaultTone, DEFAULT_TONE, type Tone } from './domain/tone.js';
import { sanitizeLocks, lockKey, lockInjection, type RelationLock } from './domain/relation-lock.js';
import { sanitizeDirectives, directiveInjection, reconcileDirectives, armScheduled, type Directive } from './domain/directive.js';
import { checkContinuity, checkThreadOffscreenSync } from './domain/continuity.js';
import { offscreenCast, buildSimPrompt, parseSim, simEvents, simSys, offscreenInjection, readyToIntersect } from './domain/offscreen.js';
import { THREAD_MERGE_SYS, buildMergePrompt, parseMergeReply, validateMerges, openTracks } from './domain/thread-merge.js';
import { THREAD_CATCHUP_SYS, buildCatchupPrompt, OFFSCREEN_CATCHUP_SYS, buildOffscreenCatchupPrompt, parseCatchupReply, validateCatchupBeats, catchupTargets, offscreenCatchupTargets, threadsAwaitingCatchup, offscreensAwaitingCatchup } from './domain/thread-catchup.js';
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

/** Snapshot + scene-coverage suggestions — broadcast the full vault view. */
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
 * and serves the frontend via a dispatch table. Everything is guarded — the
 * worker must never crash the host. New features call registerFeature() and
 * (if they need UI) add a message handler in the dispatch table below.
 */

registerFeature(coreFeature);

const lastSigByChat = new Map<string, string>();
// Consecutive deep-extractor failures; emit one diagnostic toast at the threshold
// then reset so a persistently broken generation connection is visible, not silent.
let _extractFails = 0;
const EXTRACT_FAIL_TOAST_AT = 3;
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
  // independent reads run in parallel (chat vars are cached, but this also cuts
  // first-read host round-trips and any awaited derivations). EVERY persisted
  // per-chat toggle/setting the UI shows must be included here — the frontend
  // hydrates its toggle display from this broadcast, so anything omitted silently
  // reverts to its default after a reload/chat-switch (the hide-toggle bug).
  const [tone, tidyRaw, offscreenRaw, hideRaw, chapterVault, travOn, travModeRaw, traversalAxis, relationLocks, directives, nextScene, hardLimits, calendar, themeRaw, prefsRaw, coloredDialogueRaw] = await Promise.all([
    readTone(chatId, userId),
    getChatVar(chatId, 'vellum_tidy_threads').catch(() => ''),
    getChatVar(chatId, 'vellum_offscreen').catch(() => ''),
    getChatVar(chatId, 'vellum_hide_summarized').catch(() => ''),
    readChapterVaultMode(chatId),
    getChatVar(chatId, 'vellum_traversal').catch(() => ''),
    getChatVar(chatId, 'vellum_traversal_mode').catch(() => ''),
    getChatVar(chatId, 'vellum_traversal_axis').then(readAxis).catch(() => 'temporal' as const),
    readLocks(chatId),
    readDirectives(chatId),
    readNextScene(chatId),
    readHardLimits(chatId),
    readCalendar(chatId),
    readTheme(),
    readPrefs(),
    getChatVar(chatId, 'vellum_colored_dialogue').catch(() => ''),
  ]);
  const tidy = !!tidyRaw;
  const offscreen = !!offscreenRaw;
  const hide = !!hideRaw;
  const coloredDialogue = !!coloredDialogueRaw;
  const traversalMode = travOn ? (travModeRaw === 'tree' ? 'tree' : 'flat') : 'off';
  const theme = themeRaw ?? null;
  const prefs = prefsRaw ?? null;
  spindle.sendToFrontend?.({ type: 'vellum_state', chatId, state, tone, tidy, offscreen, hide, coloredDialogue, chapterVault, traversalMode, traversalAxis, relationLocks, directives, nextScene, hardLimits, calendar, theme, prefs }, userId ?? currentUser());
}

/** FOLD: read the raw turn, parse — events — append — broadcast. */
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

/** Content signature for a turn — MUST match foldTurn's sig (hashStr of the
 * first 4000 chars of the trimmed content) so stored and current sigs compare. */
function sigOf(content: string): string { return hashStr(content.slice(0, 4000)); }

/** Per-turn memory text: strip the vellum/reverie blocks, collapse whitespace,
 * resolve persona tokens to real names, and keep the FULL beat (both the player
 * message and the scene response). We store it whole so chapter summaries are
 * built on complete turns, not fragments; the chronicle UI shows only a one-line
 * preview (first sentence + ellipsis). A large safety guard prevents a
 * pathological mega-message from bloating the log. */
function turnGist(content: string, names?: { user: string; char: string }): string {
  let s = content
    .replace(/(?:\u2039vellum\u203a|<vellum>)[\s\S]*?(?:\u2039\/vellum\u203a|<\/vellum>)/gi, '')
    .replace(/<reverie>[\s\S]*?<\/reverie>/gi, '')
    .replace(/\s+/g, ' ').trim();
  if (names?.user) s = s.replace(/\{\{\s*user\s*\}\}/gi, names.user);
  if (names?.char) s = s.replace(/\{\{\s*char\s*\}\}/gi, names.char);
  const MAX = 24000; // ~6k tokens: effectively the whole turn, with a sane ceiling
  if (s.length <= MAX) return s;
  const cut = s.slice(0, MAX);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return stop > MAX * 0.5 ? cut.slice(0, stop + 1).trim() : cut.replace(/\s+\S*$/, '').trim();
}

/**
 * Find the lowest already-folded turn whose content changed (regenerate/edit),
 * or the new turn count if messages were deleted — i.e. the turn to roll BACK
 * to (return = keep turns — N). Returns null when nothing earlier diverged.
 */
async function divergedTurn(chatId: string, msgs: string[], foldedTurns: number, asstMsgs?: () => Promise<string[]>): Promise<number | null> {
  if (foldedTurns <= 0) return null;
  // messages deleted: fewer assistant turns than we folded → roll back to the new count
  if (msgs.length < foldedTurns) return msgs.length;
  const sigs = await turnSigs(chatId);
  let asst: string[] | null = null; // fetched LAZILY, only if a sig mismatches
  for (let turnNo = 1; turnNo <= foldedTurns; turnNo++) {
    const stored = sigs.get(turnNo);
    if (stored === undefined) continue; // turn had no fold marker — skip
    // legacy constant sigs (pre-reconcile builds) can't be compared — skip them
    // so we never roll back a chronicle folded by an older version. 'legacy-import'
    // is the synthetic fold marker written by import-legacy for the imported
    // baseline turn; comparing it to the live transcript would spuriously roll
    // back (and wipe) the imported history on the first real fold after import.
    if (stored === 'auto' || stored === 'rebuild' || stored === 'legacy-import') continue;
    const cur = sigOf((msgs[turnNo - 1] ?? '').trim());
    if (cur === stored) continue;
    // BASIS-SHIFT SAFETY: chronicles folded before user-messages were included
    // stored an ASSISTANT-ONLY signature. Don't treat that basis change as an
    // edit (which would roll back and wipe chapters) — also accept a match on the
    // assistant-only signature for this turn. The assistant-only transcript is an
    // extra host fetch, so pull it only NOW (first mismatch), not every fold.
    if (asstMsgs) {
      if (asst === null) { try { asst = await asstMsgs(); } catch { asst = []; } }
      if (sigOf((asst[turnNo - 1] ?? '').trim()) === stored) continue;
    }
    return turnNo - 1; // keep up to the turn before the change
  }
  return null;
}

// Chats whose legacy chat-var tone has already been considered for migration
// this session, so the one-time seed runs at most once per chat (readTone is
// called from several paths, sometimes in parallel via Promise.all).
const _toneMigrated = new Set<string>();

/**
 * One-time migration: earlier builds stored the tone dials in host chat vars
 * (vellum_romance/disposition/social/politics), which reverted to default on
 * regen/chat-switch/reload. Tone now lives in the durable event log (tone.set).
 * On first read of a chat whose log has NO tone.set yet, seed one from any
 * non-default legacy chat var so an existing user's dials are preserved. A log
 * that already carries a tone.set (or only default legacy vars) is left alone.
 * turn:0 so a later regenerate/edit rollback (truncateAfterTurn) never drops it.
 */
async function migrateLegacyTone(chatId: string): Promise<void> {
  if (_toneMigrated.has(chatId)) return;
  _toneMigrated.add(chatId);
  try {
    await loadLog(chatId); // ensure the log is in cache so logHasKind is accurate
    if (logHasKind(chatId, 'tone.set')) return; // already migrated / natively set
    const r = await getChatVar(chatId, 'vellum_romance');
    const d = await getChatVar(chatId, 'vellum_disposition');
    const s = await getChatVar(chatId, 'vellum_social');
    const p = await getChatVar(chatId, 'vellum_politics');
    const legacy = parseTone(r, d, s, p);
    // retire the legacy keys either way so they can never re-seed tone on a later
    // session (e.g. after an explicit clear) now that the log is authoritative.
    const retireLegacy = async (): Promise<void> => {
      for (const k of ['vellum_romance', 'vellum_disposition', 'vellum_social', 'vellum_politics']) {
        try { await setChatVar(chatId, k, ''); } catch { /* best effort */ }
      }
    };
    if (isDefaultTone(legacy)) { await retireLegacy(); return; } // nothing worth preserving
    await append(chatId, [{ seq: nextSeqLocal(), turn: 0, day: 0, src: 'user', kind: 'tone.set', romance: legacy.romance, disposition: legacy.disposition, social: legacy.social, politics: legacy.politics } as VellumEvent]);
    invalidateIndex(chatId);
    await retireLegacy();
    spindle.log?.info?.('[vellum_engine] migrated legacy chat-var tone into the log for ' + chatId);
  } catch { /* best effort — a failed migration just falls back to DEFAULT_TONE */ }
}

/** Read the per-chat tone dials (romance / disposition / social / politics) the
 * user set via the Tone control. Now sourced from the durable event log
 * (state.tone, derived from tone.set events) so it survives regen/chat-switch/
 * reload; defaults to DEFAULT_TONE when the user never changed it. */
async function readTone(chatId: string, userId: string | null): Promise<Tone> {
  void userId;
  await migrateLegacyTone(chatId);
  const state = await loadState(chatId);
  return state.tone ?? DEFAULT_TONE;
}

/** Read + sanitize the per-chat relation locks (Plot Director). */
async function readLocks(chatId: string): Promise<RelationLock[]> {
  try { const raw = await getChatVar(chatId, 'vellum_relation_locks'); return raw ? sanitizeLocks(JSON.parse(raw)) : []; }
  catch (e) { spindle.log?.warn?.('[vellum_engine] relation_locks parse failed, using default: ' + ((e as Error)?.message ?? e)); return []; }
}

/** Read + sanitize the per-chat Plot Director directives. */
async function readDirectives(chatId: string): Promise<Directive[]> {
  try { const raw = await getChatVar(chatId, 'vellum_directives'); return raw ? sanitizeDirectives(JSON.parse(raw)) : []; }
  catch (e) { spindle.log?.warn?.('[vellum_engine] directives parse failed, using default: ' + ((e as Error)?.message ?? e)); return []; }
}
async function writeDirectives(chatId: string, d: Directive[]): Promise<void> {
  try { await setChatVar(chatId, 'vellum_directives', JSON.stringify(d)); } catch { /* best effort */ }
}

// --- Context budget: how much VELLUM injects per turn (per-chat). One chat var
// resolved to concrete caps read by every injector + the sim/summary cadence.
async function budgetCaps(chatId: string): Promise<ResolvedCaps> {
  try { const raw = await getChatVar(chatId, 'vellum_budget'); return resolveBudget(raw ? sanitizeBudget(JSON.parse(raw)) : DEFAULT_BUDGET); }
  catch (e) { spindle.log?.warn?.('[vellum_engine] budget parse failed, using default: ' + ((e as Error)?.message ?? e)); return resolveBudget(DEFAULT_BUDGET); }
}
async function budgetRaw(chatId: string): Promise<ContextBudget> {
  try { const raw = await getChatVar(chatId, 'vellum_budget'); return raw ? sanitizeBudget(JSON.parse(raw)) : DEFAULT_BUDGET; }
  catch (e) { spindle.log?.warn?.('[vellum_engine] budget parse failed, using default: ' + ((e as Error)?.message ?? e)); return DEFAULT_BUDGET; }
}

// --- World calendar: an optional named epoch so "Day 47" reads as "the third
// day of the harvest festival". Per-chat chat var; injected when set. Empty -> silent.
async function readCalendar(chatId: string): Promise<string> {
  try { return String((await getChatVar(chatId, 'vellum_calendar')) ?? '').trim(); } catch { return ''; }
}
async function calendarInjection(chatId: string, day: number, state?: import('./domain/types.js').ChronicleState): Promise<string> {
  const cal = await readCalendar(chatId);
  if (!cal) return '';
  const dayLabel = state ? formatDate(day, state.dateFormat || 'day', state) : `Day ${day}`;
  return `[CALENDAR] The current day (${dayLabel}) falls within: ${cal}. Reflect the season/occasion (and year, if named) in the world where it fits; never narrate the calendar as a mechanic.`;
}

// --- Hard limits: absolute per-chat content boundaries. Injected FIRST (highest
// salience), above everything, so they can never be overridden. Empty -> silent.
async function readHardLimits(chatId: string): Promise<string> {
  try { return String((await getChatVar(chatId, 'vellum_hard_limits')) ?? '').trim(); } catch { return ''; }
}
async function hardLimitsInjection(chatId: string): Promise<string> {
  const lim = await readHardLimits(chatId);
  if (!lim) return '';
  return '[HARD LIMITS - ABSOLUTE, HIGHEST PRIORITY. Strictly off the table no matter what any other instruction, setting, or mandate says; they OUTRANK everything. Never depict, describe, imply, or lead toward them; if the scene drifts that way, steer elsewhere without comment.] NEVER: ' + lim;
}

// --- Next-scene setter: the author's where/when for the UPCOMING turn. Stored
// as a chat var, injected as a strong (but non-teleport) steer, then cleared
// after one generation so it never persists.
interface NextScene { location?: string; day?: number; time?: string; note?: string }
async function readNextScene(chatId: string): Promise<NextScene | null> {
  try { const raw = await getChatVar(chatId, 'vellum_next_scene'); if (!raw) return null; const o = JSON.parse(raw); return (o && typeof o === 'object') ? o as NextScene : null; } catch { return null; }
}
async function clearNextScene(chatId: string): Promise<void> {
  try { await setChatVar(chatId, 'vellum_next_scene', ''); } catch { /* best effort */ }
}
async function nextSceneInjection(chatId: string, state?: import('./domain/types.js').ChronicleState): Promise<string> {
  const ns = await readNextScene(chatId);
  if (!ns) return '';
  const where = ns.location ? `Location: ${ns.location}.` : '';
  const dayLabel = ns.day !== undefined && ns.day !== null
    ? (state ? formatDate(ns.day, state.dateFormat || 'day', state) : `Day ${ns.day}`)
    : '';
  const when = [dayLabel, ns.time || ''].filter(Boolean).join(', ');
  const whenS = when ? `${when}.` : '';
  const note = ns.note ? ` ${ns.note}` : '';
  const body = [where, whenS].filter(Boolean).join(' ') + note;
  if (!body.trim()) return '';
  return '[NEXT SCENE \u2014 the author sets where/when this turn opens. Open the scene here and honor it. This frames the OPENING; it does not teleport characters who would plausibly be elsewhere.] ' + body.trim();
}

async function foldChatInner(chatId: string, userId: string | null, hint?: string): Promise<void> {
  let msgs = await allTurnContents(chatId);
  if (!msgs.length || !(msgs[msgs.length - 1] ?? '').trim()) { await new Promise((r) => setTimeout(r, 220)); msgs = await allTurnContents(chatId); }
  if (hint && hint.trim() && (!msgs.length || msgs[msgs.length - 1] !== hint)) msgs.push(hint);
  if (!msgs.length) return;
  let prior = await loadState(chatId);
  // tone dials + canonical {{user}} id + locks, resolved once per fold pass (in
  // parallel; chat vars are cached but this also overlaps the name derivation).
  const [tone, names, locks] = await Promise.all([
    readTone(chatId, userId),
    chatNames(chatId, userId),
    readLocks(chatId),
  ]);
  const userCanon = names.user ? canonId(names.user) : '';
  // REGENERATION / EDIT RECONCILE: a regenerated or edited turn keeps the same
  // message count, so the forward-only fold below would never revisit it and the
  // chronicle would keep the STALE turn's deltas. Compare each already-folded
  // turn's stored content signature to the message's current signature; at the
  // first divergence (or if messages were deleted), roll the log back to just
  // before it so the loop re-folds the new content. (Swipes are out of scope.)
  // The assistant-only transcript (basis-shift safety) is fetched LAZILY — only
  // if a signature actually mismatches — so the common no-edit fold skips it.
  const rollbackTo = await divergedTurn(chatId, msgs, prior.turns ?? 0, () => allAssistantContents(chatId));
  // regenerate day-stability: remember the days the re-folded turns previously
  // held, so the re-fold can't ratchet the calendar forward past them (the NOW
  // line feeds the model the old day as authoritative; it tends to step past it).
  let priorTurnDays: Map<number, number> | null = null;
  if (rollbackTo !== null && rollbackTo < (prior.turns ?? 0)) {
    priorTurnDays = await turnDays(chatId);
    prior = await truncateAfterTurn(chatId, rollbackTo);
    invalidateIndex(chatId);
    invalidateMood(chatId);
    spindle.log?.info?.(`[vellum_engine] reconcile: turn ${rollbackTo + 1} changed (regenerate/edit) \u2014 rolled back to turn ${rollbackTo}, re-folding.`);
  }
  let added = 0;
  const foldedEvents: VellumEvent[] = []; // accumulate for Plot Director self-clear
  // PASS 1 (fast, no LLM) queues each folded turn's prose for the deep extractor,
  // which runs in PASS 2 AFTER an early broadcast — so the scene/cast/relations/
  // mood the <vellum> block already established reach the "Now" window immediately
  // instead of waiting on the extractor's model round-trip.
  const extractQueue: Array<{ turnNo: number; gist: string; day: number; hadBlock: boolean }> = [];
  // snapshot the PRE-fold state for the continuity check: loadState/append return
  // the same cached object mutated in place, so a live reference would already show
  // this turn's reveals/learns. Clone the few slices the checker reads.
  const preFold = { cast: prior.cast, secrets: prior.secrets.map((x) => ({ ...x })), knowledge: prior.knowledge.map((x) => ({ ...x })), scene: { ...prior.scene }, day: prior.day } as ChronicleState;
  for (let turnNo = (prior.turns ?? 0) + 1; turnNo <= msgs.length; turnNo++) {
    const content = (msgs[turnNo - 1] ?? '').trim();
    if (!content) continue;
    const dayCap = priorTurnDays?.get(turnNo);
    const { events, source, sig } = foldTurn(content, prior, turnNo, { tone, userCanon, locks, ...(dayCap !== undefined ? { dayCap } : {}) });
    const evs: VellumEvent[] = [...events];
    // reuse foldTurn's already-computed content signature (same hashStr of the
    // first 4000 chars) instead of recomputing sigOf(content) here.
    if (!evs.some((e) => e.kind === 'turn.fold')) evs.unshift({ seq: nextSeqLocal(), turn: turnNo, day: prior.day || 0, src: 'system', kind: 'turn.fold', sig } as VellumEvent);
    const gist = turnGist(content, names);
    if (gist) evs.push({ seq: nextSeqLocal(), turn: turnNo, day: prior.day || 0, src: 'system', kind: 'memory.record', id: 'turn_' + chatId.slice(0, 6) + '_' + turnNo, tier: 'turn', text: gist, keys: [] } as VellumEvent);
    foldedEvents.push(...evs);
    prior = await appendDeferred(chatId, evs);
    added += evs.length;
    // defer prose-driven extraction to PASS 2 (below the early broadcast).
    if (gist) extractQueue.push({ turnNo, gist, day: prior.day || 0, hadBlock: source === 'json' });
    spindle.log?.info?.(`[vellum_engine] folded turn ${turnNo} via ${source}: +${evs.length} events`);
    if (source === 'none' && /\u2039\/?vellum\u203a|<\/?vellum>/i.test(content)) {
      const m = content.match(/(?:\u2039vellum\u203a|<vellum>)([\s\S]*?)(?:\u2039\/vellum\u203a|<\/vellum>)/i);
      spindle.log?.warn?.('[vellum_engine] <vellum> present but UNPARSED. Inner head: ' + ((m?.[1] ?? '').trim().slice(0, 200)));
    }
  }
  if (!added) return;
  // A deep (LLM) extraction pass follows only if we queued gists AND the
  // generation permission is granted; otherwise phase 1 is the whole update.
  const willExtract = extractQueue.length > 0 && (await has('generation'));
  const foldTotal = willExtract ? 2 : 1;
  // EARLY BROADCAST: the block-folded state (scene, present, mood, cast,
  // relations) is complete now — push it to the UI BEFORE the deep prose
  // extractor runs, so the "Now" window and drawer refresh immediately instead
  // of waiting on the extractor's per-turn model round-trip. The deferred appends
  // are flushed here so a crash mid-extraction can't lose the block fold.
  await flush(chatId);
  invalidateIndex(chatId);
  await broadcastState(chatId, userId);
  // progress toast, phase 1 of N: the live scene is in. When a deep pass follows,
  // this reads "… (1/2)"; when it doesn't, the frontend shows a single done toast.
  spindle.sendToFrontend?.({ type: 'vellum_fold_progress', chatId, phase: 1, total: foldTotal }, userId ?? currentUser());
  // PASS 2 (slow, LLM): prose-driven extraction — knowledge / secrets / journal /
  // bonds (incl. the player) the model didn't hand-write in a <vellum> block. When
  // a turn had NO parseable block, this is the SAFETY NET: the schema-guaranteed
  // extractor mines the structure from prose so a forgotten block never means lost
  // continuity. Best-effort; never throws into the fold.
  let extracted = 0;
  for (const q of extractQueue) {
    try {
      const xevs = await extractFromProse(q.gist, q.turnNo, q.day, names, userId, prior, tone);
      if (xevs.length) { prior = await appendDeferred(chatId, xevs); extracted += xevs.length; spindle.log?.info?.(`[vellum_engine] extracted +${xevs.length} (knowledge/secret/journal/bond)${q.hadBlock ? '' : ' [FALLBACK: no <vellum> block]'} from turn ${q.turnNo}`); }
      else if (!q.hadBlock) spindle.log?.warn?.(`[vellum_engine] turn ${q.turnNo} had no <vellum> block and prose extraction yielded nothing`);
      _extractFails = 0; // a completed pass (even empty) clears the streak
    } catch (e) {
      spindle.log?.warn?.('[vellum_engine] extract: ' + ((e as Error)?.message ?? e));
      // Surface a single toast once the deep pass has failed repeatedly, so a
      // persistently broken generation connection is diagnosable instead of only
      // living in the log. Reset after notifying so it re-arms.
      if (++_extractFails >= EXTRACT_FAIL_TOAST_AT) {
        _extractFails = 0;
        try { spindle.sendToFrontend?.({ type: 'vellum_toast', level: 'warning', msg: 'VELLUM\u2019s deep memory pass keeps failing \u2014 check the generation permission and your connection.' }, userId ?? currentUser()); } catch { /* best effort */ }
      }
    }
  }
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
  // applied). Advisory only — surfaced as a toast + in the Director panel.
  let flagged = 0;
  try {
    // event-vs-prior checks (secrets/knowledge/traits/deceased) + the state-level
    // thread<->off-screen skip-desync guard, which reads the POST-fold derived
    // state (day anchors as they stand now) rather than a single fold's events.
    const postFold = await loadState(chatId);
    const warnings = [...checkContinuity(foldedEvents, preFold), ...checkThreadOffscreenSync(postFold)];
    if (warnings.length) {
      // Always TOAST every warning (the live nudge), but only PERSIST ones we
      // haven't already logged. The desync guards (thread_offscreen_conflict /
      // thread_thread_desync / clock_backward) re-fire the SAME text every fold
      // while the gap stands; appending each time floods the 50-entry ring buffer
      // in reduce() and evicts genuine one-shot time flags (day_creep/day_jump/
      // day_backward) so they "show up then disappear". Dedupe on (code+detail)
      // against the flags already on record so a standing advisory is logged once.
      spindle.sendToFrontend?.({ type: 'vellum_continuity', chatId, warnings }, userId ?? currentUser());
      const flagTurn = postFold.turns || 0;
      const flagDay = postFold.day || 0;
      const seen = new Set((postFold.continuityFlags ?? []).map((f) => f.code + '\u0000' + f.detail));
      const fresh = warnings.filter((w) => !seen.has(w.kind + '\u0000' + w.text));
      if (fresh.length) {
        await appendDeferred(chatId, fresh.map((w) => ({ seq: nextSeqLocal(), turn: flagTurn, day: flagDay, src: 'system', kind: 'continuity.flag', code: w.kind, detail: w.text } as VellumEvent)));
        flagged = fresh.length;
      }
    }
  } catch { /* best effort */ }
  // Second durable write + broadcast, but ONLY if PASS 2 (prose extraction or
  // continuity flags) actually added events. On the common clean-JSON turn both
  // are empty, so the early broadcast above already reflected everything and this
  // is skipped — no redundant full-log stringify+write or full-state re-post.
  if (extracted || flagged) {
    await flush(chatId);
    invalidateIndex(chatId);
    await broadcastState(chatId, userId);
  }
  // progress toast, phase 2 of 2: the deep pass finished (whether or not it found
  // anything new). Only emitted when a deep pass was actually expected, so a
  // permission-less / block-only turn shows just the single phase-1 completion.
  if (willExtract) spindle.sendToFrontend?.({ type: 'vellum_fold_progress', chatId, phase: 2, total: 2, added: extracted }, userId ?? currentUser());
  void maybeAutoSummarize(chatId, userId);
  void maybeVaultSync(chatId, userId);
  void maybeTidyThreads(chatId, userId);
  // AWAIT the off-screen sim: on a time-skip its catch-up beats must be in the log
  // before the next prompt is assembled, so the on-screen scene doesn't reference
  // an off-screen world still a skip behind. maybeSimulate only blocks for a skip
  // (it detaches an ordinary cadence tick internally), so the common turn returns
  // immediately. simulateOffscreen already broadcasts on success; on a skip we
  // re-broadcast defensively so the drawer reflects the caught-up subplots.
  try { if (await maybeSimulate(chatId, userId)) await broadcastState(chatId, userId); }
  catch (e) { spindle.log?.warn?.('[vellum_engine] maybeSimulate: ' + ((e as Error)?.message ?? e)); }
  void maybeChapterVault(chatId, userId);
  void maybeColorSync(chatId, userId); // regenerate colored-dialogue scripts if cast/colors changed
  void precomputeTree(chatId, userId); // PR2: warm the tree ranking for next turn
}

const _tidying = new Set<string>();
const TIDY_THRESHOLD = 8; // auto-tidy only once open-thread count exceeds this

/**
 * Layer 3 — reconcile near-duplicate threads/arcs via a cheap controller LLM.
 * Returns the number of tracks merged away. Honors the generation permission;
 * any failure (no perm, timeout, unparseable, nothing valid) → 0, no events.
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
 * Tidy Knowledge/Secrets — the knowledge/secret sibling of tidyThreads. For each
 * holder with —2 entries, a cheap controller LLM groups near-duplicate facts the
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
 * Off-screen simulation tick — advance characters who aren't in the scene. Opt-in
 * (chat var) + generation-permission-gated + cadence-throttled + serialized per
 * chat, exactly like tidyThreads. One bounded controller call; respects locks,
 * armed directives, and tone. Fail/timeout/empty → no-op. Beats are tagged
 * src:'sim' so the UI distinguishes them; the append-only log makes them undoable.
 */
/** Outcome of one sim tick, so callers (the manual button) can report WHY a tick
 * produced nothing instead of silently claiming success. */
type SimResult = { beats: number; reason?: 'no_generation' | 'no_cast' | 'empty_reply' };

async function simulateOffscreen(chatId: string, userId: string | null, focusId?: string, skipDays?: number): Promise<SimResult> {
  if (_simulating.has(chatId)) return { beats: 0, reason: 'empty_reply' };
  if (!(await has('generation'))) return { beats: 0, reason: 'no_generation' };
  _simulating.add(chatId);
  try {
    const state = await loadState(chatId);
    const cast = offscreenCast(state);
    // per-thread advance can run even with nobody plausibly off-screen (the
    // subplot itself carries the context); the world-wide tick needs a cast.
    if (!focusId && cast.length < 1) return { beats: 0, reason: 'no_cast' };
    const tone = await readTone(chatId, userId);
    const locks = await readLocks(chatId);
    const directives = await readDirectives(chatId);
    // open plot threads feed the sim so off-screen life can build TOWARD the main
    // plot (the thread<->offscreen bridge), newest first, capped.
    const threads = openTracks(state, 'threads').slice(0, 6).map((t) => ({ id: t.id, name: t.name, status: t.status, ...(t.beats?.length ? { note: t.beats[t.beats.length - 1] } : {}), ...(t.lastDay !== undefined ? { lastDay: t.lastDay } : {}) }));
    const prompt = buildSimPrompt(state, cast, { locks, directives, tone: { disposition: tone.disposition, social: tone.social }, ...(focusId ? { focusId } : {}), ...(skipDays ? { skipDays } : {}), ...(threads.length ? { threads } : {}) });
    // 600-token budget: the reply is a JSON array of up to 4 subplot objects; 200
    // truncated it (unparseable JSON → silent no-op) on reasoning models.
    // 30s timeout: this runs detached (background tick or manual button), NOT on
    // the prompt-assembly path — a reasoning model needs far more than the old 3s
    // to think + emit JSON, which was aborting every tick ("Generation aborted").
    const res = await controllerGenerate([{ role: 'system', content: simSys(tone.social, tone.politics) }, { role: 'user', content: prompt }], userId, 30000, 600);
    if (!res.ok) {
      spindle.log?.warn?.(`[vellum_engine] off-screen sim: generation failed (${res.error})`);
      return { beats: 0, reason: 'empty_reply' };
    }
    const parsed = parseSim(res.value);
    if (!parsed) {
      spindle.log?.warn?.('[vellum_engine] off-screen sim: reply did not parse. Raw reply: ' + JSON.stringify((res.value || '').slice(0, 400)));
      return { beats: 0, reason: 'empty_reply' };
    }
    // when focused, keep only the beat for that subplot (guard against drift).
    // the model may echo a fresh slug for the focused subplot instead of reusing
    // its id, which used to filter to nothing → false "no beat". Fall back to the
    // first parsed beat when the id doesn't match so a focused advance still lands.
    let useParsed = parsed;
    if (focusId) {
      const exact = parsed.offscreen.filter((p) => p.id === focusId);
      // reuse the exact-id beat when present; else take the first beat but force
      // its id back to focusId so it ADVANCES the focused thread (not spawn a new
      // one) even when the model echoed a fresh slug.
      const one = (exact.length ? exact : parsed.offscreen).slice(0, 1).map((p) => ({ ...p, id: focusId }));
      useParsed = { offscreen: one };
    }
    if (!useParsed.offscreen.length) {
      spindle.log?.warn?.('[vellum_engine] off-screen sim: parsed reply had zero usable beats. Raw reply: ' + JSON.stringify((res.value || '').slice(0, 400)));
      return { beats: 0, reason: 'empty_reply' };
    }
    const simNames = await chatNames(chatId, userId);
    const simUserCanon = simNames.user ? canonId(simNames.user) : '';
    const evs = simEvents(useParsed, state, state.turns || 0, state.day || 0, () => nextSeqLocal(), { locks, social: tone.social, politics: tone.politics, userId: simUserCanon });
    if (!evs.length) return { beats: 0, reason: 'empty_reply' };
    await append(chatId, evs);
    invalidateIndex(chatId);
    // remember the narrative day this tick covered so the NEXT fold can measure a
    // time-skip (a big day-jump) and force a proportional catch-up tick.
    try { await setChatVar(chatId, 'vellum_sim_day', String(state.day || 0)); } catch { /* best effort */ }
    await broadcastState(chatId, userId);
    spindle.log?.info?.(`[vellum_engine] off-screen sim${focusId ? ` (focus ${focusId})` : ''}${skipDays && skipDays >= 2 ? ` [time-skip ~${Math.floor(skipDays)}d]` : ''}: ${useParsed.offscreen.length} subplot beat(s)`);
    return { beats: evs.length };
  } catch (e) { spindle.log?.warn?.('[vellum_engine] simulateOffscreen: ' + ((e as Error)?.message ?? e)); return { beats: 0, reason: 'empty_reply' }; }
  finally { _simulating.delete(chatId); }
}

/**
 * Auto off-screen sim: opt-in chat var, throttled to every SIM_CADENCE-th turn.
 *
 * A TIME-SKIP catch-up (skipDays >= 2) is AWAITED here so its beats are appended
 * to the log before this fold returns — and therefore before the next turn's
 * prompt is assembled. This is safe to block on: the fold runs post-generation,
 * OFF the prompt path (which has its own hard 5s deadline the 30s sim could never
 * fit inside). Previously the whole tick was fire-and-forget (`void maybeSimulate`
 * at fold end), so on a skip the catch-up beats raced the next generation and
 * usually landed a turn LATE — the on-screen scene jumped days ahead while the
 * off-screen world it referenced was still pre-skip. An ordinary cadence tick has
 * no such ordering constraint, so it stays detached to keep the fold tail quick.
 *
 * Returns true when a skip catch-up was run (so the caller can await it).
 */
async function maybeSimulate(chatId: string, userId: string | null): Promise<boolean> {
  let on = false;
  try { on = !!(await getChatVar(chatId, 'vellum_offscreen')); } catch { /* best effort */ }
  if (!on) return false;
  const state = await loadState(chatId);
  // narrative days elapsed since the last sim tick (or since the chat's first day
  // if the sim has never run). A jump of >=2 days is a TIME-SKIP: the off-screen
  // world should move with it, so force a catch-up tick NOW and tell the sim how
  // much time to cover — regardless of the turn cadence below.
  let lastSimDay: number | null = null;
  try { const raw = await getChatVar(chatId, 'vellum_sim_day'); if (raw !== '' && raw != null) { const n = Number(raw); if (Number.isFinite(n)) lastSimDay = n; } } catch { /* best effort */ }
  const skipDays = lastSimDay === null ? 0 : Math.max(0, (state.day || 0) - lastSimDay);
  const interval = (await budgetCaps(chatId)).simInterval || SIM_CADENCE; // 0 → treat as default
  const cadenceHit = interval > 0 && (state.turns || 0) % interval === 0;
  const isSkip = skipDays >= 2;
  if (!cadenceHit && !isSkip) return false; // no cadence tick and no time-skip → nothing to do
  // stamp the OBSERVED-day baseline up front (monotonic; see note below) so a
  // failed/empty catch-up can't leave the marker behind and inflate the NEXT
  // fold's skipDays. Written before the tick precisely because the tick may fail.
  const stamp = async (): Promise<void> => {
    try {
      const cur = lastSimDay ?? 0;
      const next = Math.max(cur, state.day || 0);
      if (next !== cur || lastSimDay === null) await setChatVar(chatId, 'vellum_sim_day', String(next));
    } catch { /* best effort */ }
  };
  if (isSkip) {
    // AWAITED catch-up: beats must land before the next prompt build.
    await stamp();
    await simulateOffscreen(chatId, userId, undefined, skipDays);
    return true;
  }
  // ordinary cadence tick: no ordering constraint, keep the fold tail quick.
  await stamp();
  void simulateOffscreen(chatId, userId, undefined, undefined);
  return false;
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

const _colorSyncing = new Set<string>();
/**
 * Sync colored-dialogue regex scripts: regenerate display + strip scripts when
 * the cast or colors change. Idempotent (checks castHash). Gated on hasRegex().
 * When the feature is disabled, tears down our scripts and restores the preset's.
 */
async function maybeColorSync(chatId: string, userId: string | null): Promise<void> {
  if (_colorSyncing.has(chatId)) return;
  if (!(await hasRegex())) { spindle.log?.info?.('[vellum_engine] colored-dialogue: regex_scripts permission not granted — skipping'); return; }
  const on = !!(await getChatVar(chatId, 'vellum_colored_dialogue'));
  _colorSyncing.add(chatId);
  try {
    const scope = { scope: 'chat', scopeId: chatId };
    if (!on) {
      // Feature off: remove our scripts if present, restore preset's vellum2-spk-display
      await deleteScriptByScriptId(`vellum-engine-spk-display-${chatId}`, userId, scope);
      await deleteScriptByScriptId(`vellum-engine-spk-strip-${chatId}`, userId, scope);
      await setScriptDisabled('vellum2-spk-display', false, userId); // preset's is global, no scope
      spindle.log?.info?.(`[vellum_engine] colored-dialogue: OFF for ${chatId} — scripts removed`);
      return;
    }
    // Feature on: check if regeneration needed (castHash changed)
    const state = await loadState(chatId);
    const hash = castColorHash(state);
    const currentMeta = await scriptMeta(`vellum-engine-spk-display-${chatId}`, userId, scope);
    if (currentMeta && currentMeta.castHash === hash) {
      spindle.log?.info?.(`[vellum_engine] colored-dialogue: unchanged for ${chatId} (hash ${hash.slice(0, 8)}) — skipping`);
      return; // unchanged, skip
    }
    
    // Generate and upsert both scripts
    const scripts = colorScripts(chatId, state);
    let ok = 0, failed = 0;
    for (const script of scripts) {
      const r = await upsertScript(script, userId, chatId); // pass chatId for scope filtering
      if (r.ok) ok++; else { failed++; spindle.log?.warn?.(`[vellum_engine] colored-dialogue: upsert ${script.script_id} failed: ${r.error}`); }
    }
    
    // Disable the preset's competing display script to avoid double-wrap
    await setScriptDisabled('vellum2-spk-display', true, userId);
    
    spindle.log?.info?.(`[vellum_engine] colored-dialogue: regenerated ${ok}/${scripts.length} scripts for ${chatId} (hash ${hash.slice(0, 8)}, ${state.cast ? Object.keys(state.cast).length : 0} cast, ${failed} failed)`);
  } catch (e) { spindle.log?.warn?.('[vellum_engine] maybeColorSync: ' + ((e as Error)?.message ?? e)); }
  finally { _colorSyncing.delete(chatId); }
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
 * Hybrid chapter memory — VAULT projection (the I/O half). Mirrors each chapter/
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
      // content/constant only — keys are owned by the entry post-creation and
      // round-trip via keySync, so we never clobber a user's edited keywords.
      await updateEntry(u.entryId, { content: u.input.content, constant: u.input.settings.constant ?? false, extensions: { vellum: true, vellumCategory: u.input.category, vellumSource: 'chapter', vellumLink: u.input.link } }, userId);
    }
    for (const k of plan.keySync) {
      // user edited the entry's keys → pull them back to the chronicle memory
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
    const changed = plan.create.length || plan.update.length || plan.remove.length || fplan.create.length || fplan.update.length || fplan.remove.length;
    if (changed) spindle.log?.info?.(`[vellum_engine] chapter-vault: +${plan.create.length} ~${plan.update.length} -${plan.remove.length} (mode ${mode})`);
    // push a fresh vault snapshot so an open Vault tab reflects the reconciled
    // summary/faction entries immediately (summarize/arc/re-summarize edit these
    // behind the user's back; without this the tab shows stale content).
    if (changed) { try { await vaultBroadcast(chatId, userId); } catch { /* best effort */ } }
    return { ok: true, created: plan.create.length, updated: plan.update.length, removed: plan.remove.length };
  } catch (e) { spindle.log?.warn?.('[vellum_engine] chapter-vault: ' + ((e as Error)?.message ?? e)); return { ok: false, reason: 'error', created: 0, updated: 0, removed: 0 }; }
  finally { _chapterVaulting.delete(chatId); }
}

let _summarizing = new Set<string>();

/** Read the per-chat summarizer config (caps, window, automation, prompts).
 * Falls back to the generous defaults when unset or unparseable. */
async function summarizerCfg(chatId: string): Promise<SummarizerCfg> {
  try { const raw = await getChatVar(chatId, 'vellum_summarizer'); return raw ? sanitizeSummarizerCfg(JSON.parse(raw)) : DEFAULT_CFG; }
  catch (e) { spindle.log?.warn?.('[vellum_engine] summarizer cfg parse failed, using default: ' + ((e as Error)?.message ?? e)); return DEFAULT_CFG; }
}

async function maybeAutoSummarize(chatId: string, userId: string | null): Promise<void> {
  if (_summarizing.has(chatId)) return;
  const cfg = await summarizerCfg(chatId);
  if (!cfg.auto) return; // user disabled automatic summarization
  const state = await loadState(chatId);
  const turnMems = state.memories.filter((m) => m.tier === 'turn').length;
  const threshold = (await budgetCaps(chatId)).autoSummaryAt || AUTO_SUMMARY_AT;
  if (turnMems < threshold) return; // threshold (user-tunable); keeps recent turns verbatim
  _summarizing.add(chatId);
  try {
    // tell the UI a pass actually STARTED (auto runs off the response path, so the
    // user otherwise has no signal it's happening). The manual button already
    // toasts on click; this covers the automatic cadence.
    spindle.sendToFrontend?.({ type: 'vellum_summarize_start', chatId, auto: true }, userId ?? currentUser());
    const evs = await summarizeOnce(state, userId, cfg.autoWindow, await chatNames(chatId, userId), cfg);
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
  spindle.log?.info?.('[vellum_engine] booted — event-log core online');
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

// PR2 — precomputed tree traversal. After a turn ends we walk the memory/character
// tree in the BACKGROUND (nobody waiting) and cache the ranking keyed on
// logVersion. The interceptor reads the cache instead of drilling live, so tree
// mode costs ~0 on the prompt path. Stale/missing → live drill (or fallback).
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
    // reuse the interceptor's shared (tokenized) index instead of building a
    // parallel one — same postings, honoring the version/content cache gate.
    const index = sharedIndex(chatId, state, version);
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
// the whole attach pass whenever permissions change — no reload required.
let _interceptorWired = false;
let _genWired = false;

// Hard self-imposed deadline for the whole injection build on the prompt path.
// buildInjectionHybrid can call spindle.memories.chatMemory.warm (no timeout) and
// up to 4 sequential controller LLM calls; a slow host must never consume the
// full 15s interceptorTimeoutMs or hang the chat. On expiry we return the
// untouched messages. Kept well under the host budget.
const INTERCEPTOR_DEADLINE_MS = 5000;

async function wireCapabilities(): Promise<void> {
  // INTERCEPT: inject authoritative cast/bonds + scene-relevant recall.
  if (!_interceptorWired && (await has('interceptor')) && spindle.registerInterceptor) {
    try {
      // The host calls (messages, context) and expects the messages array back
      // (or { messages, breakdown }). We PREPEND our injection as a system
      // message rather than returning a custom shape — returning anything
      // without `.messages` breaks the host's `normalized.messages`.
      spindle.registerInterceptor(async (messages: any[], context: any) => {
        const out = Array.isArray(messages) ? messages : [];
        // Race the entire injection build against a hard deadline. If the build
        // (host warm + up to 4 controller calls) stalls, we return the untouched
        // messages so a slow host API can never hang the chat or eat the budget.
        const build = (async () => {
          // Live permission gate: the host won't un-register us when the user
          // revokes `interceptor` mid-session, so honor revocation here by
          // returning the untouched messages (pass-through).
          if (!(await has('interceptor'))) return out;
          const uid = context?.userId || currentUser();
          rememberUser(uid);
          const chatId = context?.chatId || context?.chat_id || (await activeChatId(uid));
          if (!chatId) return out;
          const state = await loadState(chatId);
          if (!state.turns && !Object.keys(state.cast).length) return out;
          const present = state.scene.present ?? [];
          const nameOf = (id: string): string => state.cast[id]?.name ?? id;
          const version = logVersion(chatId);
          // Fetch every INDEPENDENT per-chat input in parallel (chat vars are
          // cached, but this also removes serialized await-chains on the hot
          // pre-response path). The traversal-mode read gates the controller/
          // precompute choice, so it's awaited first; everything else overlaps.
          const [tmodeRaw, caps, directives, locks, calText, nextSceneText, limitsText, logEvents, livingRaw, lastSimRaw] = await Promise.all([
            getChatVar(chatId, 'vellum_traversal_mode').catch(() => ''),
            budgetCaps(chatId),
            readDirectives(chatId),
            readLocks(chatId),
            calendarInjection(chatId, state.day || 0, state),
            nextSceneInjection(chatId, state),
            hardLimitsInjection(chatId),
            loadLog(chatId).then((l) => l.events).catch(() => [] as VellumEvent[]),
            getChatVar(chatId, 'vellum_living_clock').catch(() => ''),
            getChatVar(chatId, 'vellum_sim_day').catch(() => ''),
          ]);
          const tmode = tmodeRaw === 'tree' ? 'tree' : 'flat';
          // Controller-guided traversal (variant A), opt-in per chat. Builds a
          // CallModel backed by a cheap, timeout-bounded controller generation;
          // buildInjectionHybrid falls back to the deterministic path on any miss.
          // PR2: prefer a fresh precomputed tree ranking (warmed after the last
          // turn) — zero prompt-path latency. Else drill live, tightening each of
          // the up-to-4 calls so the inline budget stays bounded (~3.2s).
          const pre = tmode === 'tree' ? getPrecomputedTree(chatId) : null;
          const controller = pre ? undefined : await traversalController(chatId, uid, tmode === 'tree' ? 800 : 1500);
          const inj = await buildInjectionHybrid(chatId, state, sceneQuery(out), uid, 1, version, controller, tmode, pre);
          // Plot Director: append armed directives as gentle guidance (suggestive,
          // not a hard block — they self-clear at the fold when fulfilled).
          const dirText = directiveInjection(directives);
          // Story Beats: the author-curated chronological spine — always-on, cheap.
          const spineText = beatSpine(state, caps.spine);
          // Locations gazetteer — canonical place names so the model doesn't hallucinate.
          const locText = caps.locations ? locationList(state, caps.locations) : '';
          // Personality drift — arc summaries for present characters (write them in motion).
          const driftText = caps.drift ? driftInjection(state, present, caps.drift) : '';
          // Mood recency — persistent emotional weather for present characters.
          const moodText = caps.mood ? moodInjectionCached(chatId, logEvents, version, present, nameOf, caps.mood) : '';
          // Foreshadow plants — unresolved seeded details that still hang.
          const plantText = caps.plants ? plantsInjection(state, state.turns || 0, caps.plants) : '';
          // Off-screen convergence — threads ripe to walk back into the scene.
          const offText = caps.offscreen ? offscreenInjection(state, caps.offscreen) : '';
          // Living Clock (opt-in) — on a detected time-skip, surface advisory decay
          // for time-sensitive state (wounds, plants, distant beats, aging). Off by
          // default; the skip span comes from the same lastSimDay anchor the sim uses.
          let livingText = '';
          if (livingRaw === '1' || livingRaw === 'true' || livingRaw === 'on') {
            const lastSim = Number(lastSimRaw);
            const skip = Number.isFinite(lastSim) ? Math.max(0, (state.day || 0) - lastSim) : 0;
            livingText = agingInjection(state, state.day || 0, skip);
          }
          // Relationship guardrails — locks for pairs PRESENT this turn, phrased
          // positively (prevention half; the fold strip is the hard guarantee).
          const lockText = lockInjection(locks, present, nameOf, caps.locks);
          const injText = [limitsText, inj.text, locText, driftText, moodText, offText, livingText, lockText, plantText, calText, spineText, nextSceneText, dirText].filter(Boolean).join('\n\n');
          if (!injText) return out;
          const rec = recordInjection(chatId, state.turns || 0, injText, inj.recallIds, { source: inj.source, trace: inj.trace ?? inj.treeTrace });
          // Fix 11 — live retrieval feed: push the record so the Injection tab
          // streams in real time instead of only on manual Refresh.
          try { spindle.sendToFrontend?.({ type: 'vellum_injection_push', chatId, record: rec }, uid); } catch { /* best effort */ }
          const head = { role: 'system', content: injText };
          return { messages: [head, ...out], breakdown: [{ messageIndex: 0, name: 'VELLUM Recall' }] };
        })();
        try {
          return await withTimeout(build, INTERCEPTOR_DEADLINE_MS, 'interceptor');
        } catch (e) {
          // Timeout OR any build error — never block the chat; ship messages as-is.
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
        void clearNextScene(chatId); // the next-scene steer is for one turn only
      });
      _genWired = true;
      spindle.log?.info?.('[vellum_engine] generation fold wired');
    } catch (e) { spindle.log?.warn?.('[vellum_engine] generation wiring deferred: ' + ((e as Error)?.message ?? e)); }
  }
}

// Drop every per-chat, in-memory cache/guard keyed by a chat id. These are all
// recomputable session caches (rankings, dedup signatures, dismissed hints,
// in-flight guards); without this they accumulate for the whole session as the
// user visits chats — a slow memory leak. Called when leaving a chat.
function pruneChatState(chatId: string): void {
  if (!chatId) return;
  _dismissed.delete(chatId);
  lastSigByChat.delete(chatId);
  injectionLog.delete(chatId);
  _foldChain.delete(chatId);
  _toneMigrated.delete(chatId);
  _tidying.delete(chatId);
  _tidyingFacts.delete(chatId);
  _simulating.delete(chatId);
  _vaultSyncing.delete(chatId);
  _chapterVaulting.delete(chatId);
  _summarizing.delete(chatId);
  _treeCache.delete(chatId);
  _precomputing.delete(chatId);
}

// The chat we last saw active, so a CHAT_SWITCHED (which only carries the new
// chat id) can prune the one we just left.
let _prevActiveChat: string | null = null;

// Always-safe events (no special permission to subscribe).
try {
  spindle.on?.('PERMISSION_CHANGED', () => { invalidatePermissions(); invalidateConnCache(); void wireCapabilities(); });
  spindle.on?.('CHAT_SWITCHED', (p: any) => {
    rememberUser(p?.userId); invalidateChatCaps(); invalidateChatVars(); invalidateConnCache();
    const next = p?.chatId || p?.chat_id || null;
    if (_prevActiveChat && _prevActiveChat !== next) pruneChatState(_prevActiveChat);
    _prevActiveChat = next;
    if (p?.chatId) invalidate();
  });
} catch { /* events optional */ }

// --- theme persistence ----------------------------------------------------
const THEME_PATH = 'vellum/theme.json';
async function readTheme(): Promise<string | null> {
  try { if (spindle.storage?.exists && (await spindle.storage.exists(THEME_PATH))) return await spindle.storage.read(THEME_PATH); } catch { /* ignore */ }
  return null;
}
async function writeTheme(json: string): Promise<void> {
  try { await spindle.storage?.write?.(THEME_PATH, json); } catch { /* ignore */ }
}

// --- window-prefs persistence ---------------------------------------------
// The float window's structural prefs (layout / density / custom arrangement /
// float tab & geometry / auto-name / fold-toast) live in host storage too, so
// they survive an extension reload that clears the webview's localStorage — the
// same durability the theme already had. One JSON blob, global (not per-chat),
// mirroring THEME_PATH exactly.
const PREFS_PATH = 'vellum/prefs.json';
async function readPrefs(): Promise<string | null> {
  try { if (spindle.storage?.exists && (await spindle.storage.exists(PREFS_PATH))) return await spindle.storage.read(PREFS_PATH); } catch { /* ignore */ }
  return null;
}
async function writePrefs(json: string): Promise<void> {
  try { await spindle.storage?.write?.(PREFS_PATH, json); } catch { /* ignore */ }
}

// --- frontend dispatch table ---------------------------------------------
// Each entry is isolated; a throw in one handler can't affect the others.
type Handler = (payload: any, userId: string | null) => Promise<void> | void;
const dispatch: Record<string, Handler> = {
  vellum_ping: (_p, uid) => { spindle.sendToFrontend?.({ type: 'vellum_pong', v: VELLUM_VERSION }, uid); },
  vellum_get_state: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) { spindle.sendToFrontend?.({ type: 'vellum_state', chatId: null, state: null }, uid); return; }
    // self-heal: catch up any turns that weren't folded, then broadcast. We ALWAYS
    // broadcast here (not gated on log version): this is the frontend's hydrate
    // path on open / chat-switch / refresh, and it carries the per-chat SETTINGS
    // (tone, hide, traversal, …) which are chat vars — orthogonal to the event log.
    // Gating on logVersion would skip re-sending settings when the log hadn't
    // changed, so the UI's toggles would revert to their module defaults.
    try { await foldChat(chatId, uid); } catch { /* best effort */ }
    await broadcastState(chatId, uid);
  },
  vellum_recover: async (p, uid) => {
    // Restore from the .bak if it holds more events than the current log (undo a
    // shrink/wipe). Reports how many events were recovered.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) { spindle.sendToFrontend?.({ type: 'vellum_recover_done', ok: false, reason: 'no_active_chat' }, uid); return; }
    invalidate(chatId);
    invalidateIndex(chatId);
    invalidateMood(chatId);
    const recovered = await recoverFromBackup(chatId);
    await broadcastState(chatId, uid);
    // Report the restored event count explicitly. loadState primes the cache so
    // logVersion (which reads the cached log's event length) is accurate; without
    // a recovery we report 0 rather than a stale/misleading number.
    let events = 0;
    if (recovered) { await loadState(chatId); events = logVersion(chatId); }
    spindle.sendToFrontend?.({ type: 'vellum_recover_done', ok: !!recovered, events }, uid);
  },
  vellum_refold: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (chatId) { lastSigByChat.delete(chatId); await foldChat(chatId, uid); }
  },
  vellum_rebuild: async (p, uid) => {
    // Two distinct operations share this handler:
    //   full (default)  — RECONSTRUCT from the transcript: clear the derived log,
    //                      then re-fold every turn (cast/relations/knowledge/
    //                      journal + per-turn memories). Use to recover after loss.
    //   messagesOnly    — ADDITIVE backfill: do NOT clear anything. Just capture
    //                      the per-turn message memories for any turn missing one,
    //                      leaving all existing cast/relations/knowledge/secrets/
    //                      journal untouched. (memory.record dedups by id.)
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) { spindle.sendToFrontend?.({ type: 'vellum_rebuild_done', ok: false, reason: 'no_active_chat' }, uid); return; }
    const messagesOnly = !!p?.messagesOnly;
    try {
      const msgs = await allTurnContents(chatId);
      // full rebuild wipes the log; capture the durable tone first so a recovery
      // reconstruction re-seeds the user's dials (legacy chat vars are no longer
      // written, so there's nothing else to recover them from).
      const preTone = messagesOnly ? null : await readTone(chatId, uid);
      if (!messagesOnly) { await clearLog(chatId); lastSigByChat.delete(chatId); invalidateMood(chatId); _toneMigrated.delete(chatId); }
      if (preTone && !isDefaultTone(preTone)) {
        await append(chatId, [{ seq: nextSeqLocal(), turn: 0, day: 0, src: 'user', kind: 'tone.set', romance: preTone.romance, disposition: preTone.disposition, social: preTone.social, politics: preTone.politics } as VellumEvent]);
        _toneMigrated.add(chatId); // the log now carries tone.set — skip re-migration
      }
      let prior = await loadState(chatId);
      const tone = await readTone(chatId, uid);
      const names = await chatNames(chatId, uid);
      const userCanon = names.user ? canonId(names.user) : '';
      const locks = await readLocks(chatId);
      // ids of turn-memories that already exist (messagesOnly: only backfill gaps)
      const haveTurnMem = new Set(prior.memories.filter((m) => m.tier === 'turn').map((m) => m.id));
      let turns = 0;
      let added = 0;
      for (let turnNo = 1; turnNo <= msgs.length; turnNo++) {
        const content = (msgs[turnNo - 1] ?? '').trim();
        if (!content) continue;
        const sig = sigOf(content);
        const memId = 'turn_' + chatId.slice(0, 6) + '_' + turnNo;
        const evs: VellumEvent[] = [];
        if (messagesOnly) {
          // additive: only record the full-turn memory when it's missing; never
          // emit turn.fold (that would re-arm the fold sig / disturb counts) and
          // never touch knowledge/cast/etc.
          if (haveTurnMem.has(memId)) continue;
          const gist = turnGist(content, names);
          if (!gist) continue;
          evs.push({ seq: nextSeqLocal(), turn: turnNo, day: prior.day || 0, src: 'system', kind: 'memory.record', id: memId, tier: 'turn', text: gist, keys: [] } as VellumEvent);
        } else {
          const { events } = foldTurn(content, prior, turnNo, { tone, userCanon, locks });
          evs.push(...events);
          if (!evs.some((e) => e.kind === 'turn.fold')) evs.unshift({ seq: nextSeqLocal(), turn: turnNo, day: prior.day || 0, src: 'system', kind: 'turn.fold', sig } as VellumEvent);
          const gist = turnGist(content, names);
          if (gist) evs.push({ seq: nextSeqLocal(), turn: turnNo, day: prior.day || 0, src: 'system', kind: 'memory.record', id: memId, tier: 'turn', text: gist, keys: [] } as VellumEvent);
        }
        if (!evs.length) continue;
        prior = await append(chatId, evs);
        turns++; added++;
        // optional deep extraction per turn — full mode only
        if (!messagesOnly && p?.deep) { const g = turnGist(content, names); if (g) { try { const xe = await extractFromProse(g, turnNo, prior.day || 0, names, uid, prior, tone); if (xe.length) prior = await append(chatId, xe); } catch { /* best effort */ } } }
      }
      invalidateIndex(chatId);
      await broadcastState(chatId, uid);
      void maybeChapterVault(chatId, uid); // reconcile vault chapter entries
      spindle.sendToFrontend?.({ type: 'vellum_rebuild_done', ok: true, turns: messagesOnly ? added : turns, messagesOnly }, uid);
      spindle.log?.info?.('[vellum_engine] ' + (messagesOnly ? 'captured ' + added + ' message memories (additive)' : 'rebuilt chronicle from transcript: ' + turns + ' turns'));
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
    // editing cast triggers colored-dialogue script regeneration (if enabled)
    if (p.cmd === 'cast_upsert' || p.cmd === 'cast_edit' || p.cmd === 'cast_delete') void maybeColorSync(chatId, uid);
  },
  vellum_summarize: async (p, uid) => {
    // manual "summarize past turns" — compress as many full windows as exist.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const cfg = await summarizerCfg(chatId);
    const state = await loadState(chatId);
    const win = Math.max(cfg.minWindow, Math.min(4, cfg.autoWindow)); // manual uses a smaller window so short chats still fold
    const { rounds, tokens } = await summarizeAll(state, uid, (evs) => append(chatId, evs), win, await chatNames(chatId, uid), async (done, total, tokensSoFar) => {
      invalidateIndex(chatId);
      await broadcastState(chatId, uid);
      await maybeChapterVault(chatId, uid); // project each new chapter to the vault as it lands
      spindle.sendToFrontend?.({ type: 'vellum_summarize_progress', done, total, tokens: tokensSoFar }, uid);
    }, cfg);
    invalidateIndex(chatId);
    await broadcastState(chatId, uid);
    const vault = await maybeChapterVault(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_summarize_done', ok: true, rounds, tokens, vault }, uid);
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
      const cfg = await summarizerCfg(chatId);
      const win = Math.max(cfg.minWindow, Math.min(4, cfg.autoWindow));
      const { rounds, tokens } = await summarizeAll(state, uid, (evs) => append(chatId, evs), win, await chatNames(chatId, uid), async (done, total, tokensSoFar) => {
        invalidateIndex(chatId);
        await broadcastState(chatId, uid);
        await maybeChapterVault(chatId, uid);
        spindle.sendToFrontend?.({ type: 'vellum_summarize_progress', done, total, tokens: tokensSoFar }, uid);
      }, cfg);
      invalidateIndex(chatId);
      await broadcastState(chatId, uid);
      const vault = await maybeChapterVault(chatId, uid);
      spindle.sendToFrontend?.({ type: 'vellum_resummarize_done', ok: true, rounds, tokens, vault }, uid);
    } catch (e) {
      spindle.log?.warn?.('[vellum_engine] resummarize: ' + ((e as Error)?.message ?? e));
      spindle.sendToFrontend?.({ type: 'vellum_resummarize_done', ok: false, reason: 'error' }, uid);
    }
  },
  vellum_get_summarizer: async (p, uid) => {
    // hand the UI the current config + the built-in default prompts (so the
    // editor can show them and offer a one-click reset).
    const chatId = p?.chatId || (await activeChatId(uid));
    const cfg = chatId ? await summarizerCfg(chatId) : DEFAULT_CFG;
    spindle.sendToFrontend?.({ type: 'vellum_summarizer_state', cfg, defaults: { chapter: DEFAULT_CHAPTER_PROMPT, arc: DEFAULT_ARC_PROMPT, gist: DEFAULT_GIST_PROMPT } }, uid);
  },
  vellum_set_summarizer: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) { spindle.sendToFrontend?.({ type: 'vellum_summarizer_done', ok: false, reason: 'no_active_chat' }, uid); return; }
    const cfg = sanitizeSummarizerCfg(p?.cfg);
    try { await setChatVar(chatId, 'vellum_summarizer', JSON.stringify(cfg)); } catch { /* best effort */ }
    spindle.sendToFrontend?.({ type: 'vellum_summarizer_done', ok: true, cfg }, uid);
  },
  vellum_summarize_pick: async (p, uid) => {
    // manual turn-pick — fold an EXPLICIT set of turn-memory ids into one chapter.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) { spindle.sendToFrontend?.({ type: 'vellum_summarize_done', ok: false, reason: 'no_active_chat' }, uid); return; }
    if (!(await has('generation'))) { spindle.sendToFrontend?.({ type: 'vellum_summarize_done', ok: false, reason: 'no_generation' }, uid); return; }
    const ids: string[] = Array.isArray(p?.ids) ? p.ids.map(String) : [];
    const cfg = await summarizerCfg(chatId);
    const state = await loadState(chatId);
    const plan = planChapterFrom(state, ids, cfg.minWindow);
    if (!plan) { spindle.sendToFrontend?.({ type: 'vellum_summarize_done', ok: false, reason: 'too_few', need: cfg.minWindow }, uid); return; }
    const { events, tokens } = await summarizeFromPlan(state, uid, plan, await chatNames(chatId, uid), cfg, 'chapter');
    if (events.length) await append(chatId, events);
    invalidateIndex(chatId);
    await broadcastState(chatId, uid);
    const vault = await maybeChapterVault(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_summarize_done', ok: true, rounds: events.length ? 1 : 0, tokens, picked: plan.sourceIds.length, vault }, uid);
  },
  vellum_arc: async (p, uid) => {
    // Fold CHAPTERS into an ARC. Manual pick (p.ids = chapter ids) or auto (the
    // oldest run of chapters, keeping recent ones un-bound). Reuses the same
    // record/drop machinery, so deleting the arc restores its chapters.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) { spindle.sendToFrontend?.({ type: 'vellum_arc_done', ok: false, reason: 'no_active_chat' }, uid); return; }
    if (!(await has('generation'))) { spindle.sendToFrontend?.({ type: 'vellum_arc_done', ok: false, reason: 'no_generation' }, uid); return; }
    const cfg = await summarizerCfg(chatId);
    const state = await loadState(chatId);
    const ids: string[] = Array.isArray(p?.ids) ? p.ids.map(String) : [];
    const plan = ids.length
      ? planArcFrom(state, ids, 2)
      : planArc(state, Math.max(2, cfg.minWindow), 4);
    if (!plan) { spindle.sendToFrontend?.({ type: 'vellum_arc_done', ok: false, reason: 'too_few' }, uid); return; }
    const { events, tokens } = await summarizeFromPlan(state, uid, plan, await chatNames(chatId, uid), cfg, 'arc');
    if (events.length) await append(chatId, events);
    invalidateIndex(chatId);
    await broadcastState(chatId, uid);
    const vault = await maybeChapterVault(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_arc_done', ok: true, rounds: events.length ? 1 : 0, tokens, bound: plan.sourceIds.length, vault }, uid);
  },
  vellum_item_add: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const item = String(p?.item ?? '').trim();
    if (!item) return;
    const sceneItem = !!p?.scene || !String(p?.who ?? '').trim();
    const who = sceneItem ? 'world' : canonId(String(p.who));
    if (!who) return;
    const state = await loadState(chatId);
    await append(chatId, [{ seq: nextSeqLocal(), turn: state.turns || 0, day: state.day || 0, src: 'user', kind: 'item.change', id: 'item_u' + nextSeqLocal(), who, item, op: sceneItem ? 'scene' : 'gain', ...(p?.note ? { note: String(p.note).slice(0, 200) } : {}) } as VellumEvent]);
    invalidateIndex(chatId);
    await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_item_done', ok: true }, uid);
  },
  vellum_item_edit: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId || !p?.id) return;
    const state = await loadState(chatId);
    const cur = state.items.find((x) => x.id === String(p.id));
    if (!cur) return;
    const item = String(p?.item ?? cur.item).trim();
    if (!item) return;
    const who = p?.who !== undefined ? (String(p.who).trim() ? canonId(String(p.who)) : 'world') : cur.who;
    // edit = drop old + re-add (item.change dedups by who+item, so drop first)
    await append(chatId, [
      { seq: nextSeqLocal(), turn: cur.turn, day: 0, src: 'user', kind: 'item.drop', id: cur.id } as VellumEvent,
      { seq: nextSeqLocal(), turn: cur.turn, day: state.day || 0, src: 'user', kind: 'item.change', id: cur.id, who: who || 'world', item, op: (who === 'world' || !who) ? 'scene' : 'gain', ...(p?.note !== undefined ? { note: String(p.note).slice(0, 200) } : (cur.note ? { note: cur.note } : {})) } as VellumEvent,
    ]);
    invalidateIndex(chatId);
    await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_item_done', ok: true }, uid);
  },
  vellum_item_delete: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId || !p?.id) return;
    await append(chatId, [{ seq: nextSeqLocal(), turn: 0, day: 0, src: 'user', kind: 'item.drop', id: String(p.id) } as VellumEvent]);
    invalidateIndex(chatId);
    await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_item_done', ok: true }, uid);
  },
  vellum_location_set: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const name = String(p?.name ?? '').trim();
    if (!name) return;
    const state = await loadState(chatId);
    const id = p?.id ? String(p.id) : 'loc_' + canonId(name);
    // user create/edit: auto:false so it sticks and never gets downgraded by auto-collect
    await append(chatId, [{ seq: nextSeqLocal(), turn: state.turns || 0, day: 0, src: 'user', kind: 'location.set', id, name, ...(p?.note !== undefined ? { note: String(p.note).slice(0, 200) } : {}), ...(p?.parent !== undefined ? { parent: String(p.parent) } : {}), auto: false } as VellumEvent]);
    invalidateIndex(chatId);
    await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_location_done', ok: true }, uid);
  },
  vellum_location_drop: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId || !p?.id) return;
    await append(chatId, [{ seq: nextSeqLocal(), turn: 0, day: 0, src: 'user', kind: 'location.drop', id: String(p.id) } as VellumEvent]);
    invalidateIndex(chatId);
    await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_location_done', ok: true }, uid);
  },
  vellum_location_pin: async (p, uid) => {
    // pin (auto:false, sticks + always injected) or unpin (auto:true, back to a
    // recency-capped auto entry). A user-sourced auto flag wins in the reducer.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId || !p?.id) return;
    const id = String(p.id);
    const state = await loadState(chatId);
    const cur = (state.locations ?? []).find((l) => l.id === id);
    if (!cur) return;
    const pinned = p?.pinned === undefined ? cur.auto === true : !!p.pinned; // toggle when unspecified
    await append(chatId, [{ seq: nextSeqLocal(), turn: state.turns || 0, day: 0, src: 'user', kind: 'location.set', id, name: cur.name, auto: !pinned } as VellumEvent]);
    invalidateIndex(chatId);
    await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_location_done', ok: true, pinned }, uid);
  },
  vellum_thread_set: async (p, uid) => {
    // user CRUD on a plot thread/arc: create by name or edit by id (rename /
    // status / append a manual beat). Mirrors vellum_location_set.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const name = String(p?.name ?? '').trim();
    if (!name && !p?.id) return;
    const state = await loadState(chatId);
    const kindArc = !!p?.kindArc;
    const cur = p?.id ? (kindArc ? state.arcs : state.threads).find((t) => t.id === String(p.id)) : undefined;
    // arc<->thread bridge: an optional `arc` field sets/clears the thread's
    // parent-arc link ('' clears). Honored for threads only (kindArc stays false).
    const arcField = p?.arc !== undefined && !kindArc ? { arc: String(p.arc || '') } : {};
    await append(chatId, [{ seq: nextSeqLocal(), turn: state.turns || 0, day: 0, src: 'user', kind: 'thread.set',
      ...(p?.id ? { id: String(p.id) } : {}), name: name || cur?.name || '',
      ...(p?.status !== undefined ? { status: String(p.status) } : {}),
      ...(p?.note ? { note: String(p.note).slice(0, 200) } : {}),
      ...(kindArc ? { kindArc: true } : {}), ...arcField } as VellumEvent]);
    invalidateIndex(chatId);
    await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_thread_done', ok: true }, uid);
  },
  vellum_thread_drop: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId || !p?.id) return;
    const kind = p?.kindArc ? 'arc.drop' : 'thread.drop';
    await append(chatId, [{ seq: nextSeqLocal(), turn: 0, day: 0, src: 'user', kind, id: String(p.id) } as VellumEvent]);
    invalidateIndex(chatId);
    await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_thread_done', ok: true }, uid);
  },
  vellum_thread_catchup: async (p, uid) => {
    // Bring lagging plot threads up to the current narrative day AND author the real
    // beat that closes each day-gap — so a catch-up carries STORY, not just a new
    // day number. Two phases, so the button works with or without generation:
    //   1) STAMP: emit a thread.set that advances each lagging thread's lastDay to
    //      `day`, logging a "caught up: Day X → Day Y" MARKER beat. This alone moves
    //      the clock even when generation is off.
    //   2) AUTHOR: with generation, ask the controller to write one grounded beat
    //      per thread for its gap, then emit fill thread.sets that REPLACE the marker
    //      in place. The prompt is CANON-LOCKED (this story's roster/facts/prior
    //      beats only, source material forbidden) so an AU stays an AU — a childless
    //      Cersei is never given children.
    // The action also targets threads that ALREADY carry an unfilled marker (a prior
    // stamp-only catch-up), so "generate missed beats" stays reachable and fills them.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const state = await loadState(chatId);
    const targetDay = Number.isFinite(p?.day) && (p as { day: number }).day > 0
      ? Math.floor((p as { day: number }).day)
      : state.day || 0;
    // resolve the working set: explicit ids, or (for "catch-up all") every thread
    // that lags or awaits a fill.
    const ids = Array.isArray(p?.ids) ? p.ids.map(String)
      : (p?.id ? [String(p.id)] : threadsAwaitingCatchup(state, targetDay).map((t) => t.id));
    if (!ids.length) { spindle.sendToFrontend?.({ type: 'vellum_thread_catchup_done', ok: false, reason: 'in_sync', jumped: 0, authored: 0 }, uid); return; }

    // Phase 1 — stamp any thread still behind the target day with a marker beat.
    const stampEvs: VellumEvent[] = [];
    for (const id of ids) {
      const t = state.threads.find((x) => x.id === id);
      if (!t || (t.lastDay !== undefined && t.lastDay >= targetDay)) continue; // already current
      const from = t.lastDay ?? 0;
      stampEvs.push({ seq: nextSeqLocal(), turn: state.turns || 0, day: targetDay, src: 'user', kind: 'thread.set',
        id, name: t.name, status: t.status, note: from > 0 ? `caught up: Day ${from} → Day ${targetDay}` : `caught up to Day ${targetDay}` } as VellumEvent);
    }
    if (stampEvs.length) { await append(chatId, stampEvs); invalidateIndex(chatId); }

    // Phase 2 — author real beats for every target (fresh state so marker spans are
    // read post-stamp) and fill the markers in place. Needs generation; without it
    // we keep the markers so the day at least moved.
    let authored = 0;
    let reason: string | undefined;
    const canGen = await has('generation');
    if (!canGen) {
      reason = 'no_generation';
    } else {
      try {
        const post = await loadState(chatId);
        const targets = catchupTargets(post, ids, targetDay);
        if (!targets.length) { reason = 'in_sync'; }
        else {
          const res = await controllerGenerate(
            [{ role: 'system', content: THREAD_CATCHUP_SYS }, { role: 'user', content: buildCatchupPrompt(post, targets) }],
            uid, 30000, 700);
          if (!res.ok) { reason = 'empty_reply'; spindle.log?.warn?.(`[vellum_engine] thread catch-up: generation failed (${res.error})`); }
          else {
            const beats = validateCatchupBeats(parseCatchupReply(res.value), targets);
            if (!beats.length) { reason = 'empty_reply'; spindle.log?.warn?.('[vellum_engine] thread catch-up: reply had no usable beats. Raw: ' + JSON.stringify((res.value || '').slice(0, 400))); }
            else {
              const fillEvs: VellumEvent[] = beats.map((b) => {
                const t = post.threads.find((x) => x.id === b.id)!;
                return { seq: nextSeqLocal(), turn: post.turns || 0, day: targetDay, src: 'system', kind: 'thread.set',
                  id: b.id, name: t.name, status: t.status, note: b.beat, fill: true } as VellumEvent;
              });
              await append(chatId, fillEvs);
              invalidateIndex(chatId);
              authored = fillEvs.length;
            }
          }
        }
      } catch (e) { reason = 'empty_reply'; spindle.log?.warn?.('[vellum_engine] thread catch-up: ' + ((e as Error)?.message ?? e)); }
    }

    if (!stampEvs.length && !authored && reason === 'in_sync') {
      spindle.sendToFrontend?.({ type: 'vellum_thread_catchup_done', ok: false, reason: 'in_sync', jumped: 0, authored: 0 }, uid);
      return;
    }
    await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_thread_catchup_done', ok: true, jumped: stampEvs.length, authored, ...(reason && !authored ? { reason } : {}) }, uid);
  },
  vellum_set_next_scene: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const clear = !!p?.clear;
    if (clear) { await clearNextScene(chatId); }
    else {
      const ns: Record<string, unknown> = {};
      if (p?.location !== undefined && String(p.location).trim()) ns.location = String(p.location).trim().slice(0, 120);
      if (Number.isFinite(p?.day)) ns.day = Number(p.day);
      if (p?.time !== undefined && String(p.time).trim()) ns.time = String(p.time).trim().slice(0, 60);
      if (p?.note !== undefined && String(p.note).trim()) ns.note = String(p.note).trim().slice(0, 200);
      try { await setChatVar(chatId, 'vellum_next_scene', Object.keys(ns).length ? JSON.stringify(ns) : ''); } catch { /* best effort */ }
    }
    spindle.sendToFrontend?.({ type: 'vellum_next_scene_done', ok: true, next: clear ? null : await readNextScene(chatId) }, uid);
  },
  vellum_get_next_scene: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    spindle.sendToFrontend?.({ type: 'vellum_next_scene_state', next: chatId ? await readNextScene(chatId) : null }, uid);
  },
  vellum_offthread_set: async (p, uid) => {
    // add or edit an off-screen subplot (manual)
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const name = String(p?.name ?? '').trim();
    if (!name && !p?.id) return;
    const state = await loadState(chatId);
    const id = p?.id ? String(p.id) : 'off_u' + nextSeqLocal();
    await append(chatId, [{ seq: nextSeqLocal(), turn: state.turns || 0, day: state.day || 0, src: 'user', kind: 'offscreen.op', op: p?.id ? 'advance' : 'new', id, ...(name ? { name } : {}), ...(p?.who ? { who: canonId(String(p.who)) } : {}), ...(p?.where ? { where: String(p.where) } : {}), ...(p?.gist ? { gist: String(p.gist).slice(0, 200) } : {}) } as VellumEvent]);
    invalidateIndex(chatId); await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_offthread_done', ok: true }, uid);
  },
  vellum_offthread_resolve: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId || !p?.id) return;
    const state = await loadState(chatId);
    await append(chatId, [{ seq: nextSeqLocal(), turn: state.turns || 0, day: 0, src: 'user', kind: 'offscreen.op', op: 'resolve', id: String(p.id) } as VellumEvent]);
    invalidateIndex(chatId); await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_offthread_done', ok: true }, uid);
  },
  vellum_offthread_drop: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId || !p?.id) return;
    await append(chatId, [{ seq: nextSeqLocal(), turn: 0, day: 0, src: 'user', kind: 'offscreen.drop', id: String(p.id) } as VellumEvent]);
    invalidateIndex(chatId); await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_offthread_done', ok: true }, uid);
  },
  vellum_offthread_link: async (p, uid) => {
    // explicit link/unlink of an off-screen subplot to a plot Track id. Empty
    // thread ('') clears the link (back to the soft text-match bridge).
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId || !p?.id) return;
    await append(chatId, [{ seq: nextSeqLocal(), turn: 0, day: 0, src: 'user', kind: 'offscreen.link', id: String(p.id), thread: String(p?.thread ?? '') } as VellumEvent]);
    invalidateIndex(chatId); await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_offthread_done', ok: true }, uid);
  },
  vellum_offthread_advance: async (p, uid) => {
    // run one off-screen sim tick NOW (needs generation permission). With an id,
    // advance ONLY that subplot (per-thread); without, the whole off-screen world.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    if (!(await has('generation'))) { spindle.sendToFrontend?.({ type: 'vellum_offthread_done', ok: false, reason: 'no_generation' }, uid); return; }
    const r = await simulateOffscreen(chatId, uid, p?.id ? String(p.id) : undefined);
    await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_offthread_done', ok: r.beats > 0, ...(r.reason ? { reason: r.reason } : {}), advanced: r.beats > 0 }, uid);
  },
  vellum_offscreen_catchup: async (p, uid) => {
    // Bring lagging off-screen subplots up to the current narrative day AND author
    // real beats for their day-gaps — the same Time Sync catch-up flow as threads,
    // but for off-screen life. Two phases: stamp lagging subplots with markers, then
    // (with generation) author one grounded beat per gap and fill the markers in
    // place. The prompt is CANON-LOCKED (this story's roster/facts/prior beats only,
    // source material forbidden) so an AU stays an AU.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const state = await loadState(chatId);
    const targetDay = Number.isFinite(p?.day) && (p as { day: number }).day > 0
      ? Math.floor((p as { day: number }).day)
      : state.day || 0;
    // resolve the working set: explicit ids, or (for "catch-up all") every subplot
    // that lags or awaits a fill.
    const ids = Array.isArray(p?.ids) ? p.ids.map(String)
      : (p?.id ? [String(p.id)] : offscreensAwaitingCatchup(state, targetDay).map((o) => o.id));
    if (!ids.length) { spindle.sendToFrontend?.({ type: 'vellum_offscreen_catchup_done', ok: false, reason: 'in_sync', jumped: 0, authored: 0 }, uid); return; }

    // Phase 1 — stamp any subplot still behind the target day with a marker gist.
    const stampEvs: VellumEvent[] = [];
    for (const id of ids) {
      const o = (state.offscreen ?? []).find((x) => x.id === id);
      if (!o || (o.lastDay !== undefined && o.lastDay >= targetDay)) continue; // already current
      const from = o.lastDay ?? 0;
      stampEvs.push({ seq: nextSeqLocal(), turn: state.turns || 0, day: targetDay, src: 'user', kind: 'offscreen.op', op: 'advance',
        id, name: o.name, ...(o.who ? { who: o.who } : {}), ...(o.where ? { where: o.where } : {}),
        gist: from > 0 ? `caught up: Day ${from} → Day ${targetDay}` : `caught up to Day ${targetDay}` } as VellumEvent);
    }
    if (stampEvs.length) { await append(chatId, stampEvs); invalidateIndex(chatId); }

    // Phase 2 — author real beats for every target (fresh state so marker spans are
    // read post-stamp) and fill the markers in place. Needs generation; without it
    // we keep the markers so the day at least moved.
    let authored = 0;
    let reason: string | undefined;
    const canGen = await has('generation');
    if (!canGen) {
      reason = 'no_generation';
    } else {
      try {
        const post = await loadState(chatId);
        const targets = offscreenCatchupTargets(post, ids, targetDay);
        if (!targets.length) { reason = 'in_sync'; }
        else {
          const res = await controllerGenerate(
            [{ role: 'system', content: OFFSCREEN_CATCHUP_SYS }, { role: 'user', content: buildOffscreenCatchupPrompt(post, targets) }],
            uid, 30000, 700);
          if (!res.ok) { reason = 'empty_reply'; spindle.log?.warn?.(`[vellum_engine] offscreen catch-up: generation failed (${res.error})`); }
          else {
            const beats = validateCatchupBeats(parseCatchupReply(res.value), targets);
            if (!beats.length) { reason = 'empty_reply'; spindle.log?.warn?.('[vellum_engine] offscreen catch-up: reply had no usable beats. Raw: ' + JSON.stringify((res.value || '').slice(0, 400))); }
            else {
              const fillEvs: VellumEvent[] = beats.map((b) => {
                const o = post.offscreen.find((x) => x.id === b.id)!;
                return { seq: nextSeqLocal(), turn: post.turns || 0, day: targetDay, src: 'system', kind: 'offscreen.op', op: 'advance',
                  id: b.id, name: o.name, ...(o.who ? { who: o.who } : {}), ...(o.where ? { where: o.where } : {}),
                  gist: b.beat, fill: true } as VellumEvent;
              });
              await append(chatId, fillEvs);
              invalidateIndex(chatId);
              authored = fillEvs.length;
            }
          }
        }
      } catch (e) { reason = 'empty_reply'; spindle.log?.warn?.('[vellum_engine] offscreen catch-up: ' + ((e as Error)?.message ?? e)); }
    }

    if (!stampEvs.length && !authored && reason === 'in_sync') {
      spindle.sendToFrontend?.({ type: 'vellum_offscreen_catchup_done', ok: false, reason: 'in_sync', jumped: 0, authored: 0 }, uid);
      return;
    }
    await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_offscreen_catchup_done', ok: true, jumped: stampEvs.length, authored, ...(reason && !authored ? { reason } : {}) }, uid);
  },
  vellum_plant_add: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const what = String(p?.what ?? '').trim();
    if (!what) return;
    const state = await loadState(chatId);
    await append(chatId, [{ seq: nextSeqLocal(), turn: state.turns || 0, day: state.day || 0, src: 'user', kind: 'plant.set', id: 'plant_u' + nextSeqLocal(), what, ...(p?.subject ? { subject: String(p.subject) } : {}) } as VellumEvent]);
    invalidateIndex(chatId); await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_plant_done', ok: true }, uid);
  },
  vellum_plant_pay: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId || !p?.id) return;
    const state = await loadState(chatId);
    await append(chatId, [{ seq: nextSeqLocal(), turn: state.turns || 0, day: 0, src: 'user', kind: 'plant.pay', id: String(p.id) } as VellumEvent]);
    invalidateIndex(chatId); await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_plant_done', ok: true }, uid);
  },
  vellum_plant_abandon: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId || !p?.id) return;
    const state = await loadState(chatId);
    await append(chatId, [{ seq: nextSeqLocal(), turn: state.turns || 0, day: 0, src: 'user', kind: 'plant.abandon', id: String(p.id) } as VellumEvent]);
    invalidateIndex(chatId); await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_plant_done', ok: true }, uid);
  },
  vellum_plant_drop: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId || !p?.id) return;
    await append(chatId, [{ seq: nextSeqLocal(), turn: 0, day: 0, src: 'user', kind: 'plant.drop', id: String(p.id) } as VellumEvent]);
    invalidateIndex(chatId); await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_plant_done', ok: true }, uid);
  },
  vellum_set_limits: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const text = String(p?.limits ?? '').trim().slice(0, 2000);
    try { await setChatVar(chatId, 'vellum_hard_limits', text); } catch { /* best effort */ }
    spindle.sendToFrontend?.({ type: 'vellum_limits_done', ok: true, limits: text }, uid);
  },
  vellum_get_limits: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    spindle.sendToFrontend?.({ type: 'vellum_limits_state', limits: chatId ? await readHardLimits(chatId) : '' }, uid);
  },
  vellum_set_calendar: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const text = String(p?.calendar ?? '').trim().slice(0, 400);
    try { await setChatVar(chatId, 'vellum_calendar', text); } catch { /* best effort */ }
    spindle.sendToFrontend?.({ type: 'vellum_calendar_done', ok: true, calendar: text }, uid);
  },
  vellum_set_budget: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const cfg = sanitizeBudget(p?.budget);
    try { await setChatVar(chatId, 'vellum_budget', JSON.stringify(cfg)); } catch { /* best effort */ }
    spindle.sendToFrontend?.({ type: 'vellum_budget_done', ok: true, budget: cfg }, uid);
  },
  vellum_get_budget: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    const cfg = chatId ? await budgetRaw(chatId) : DEFAULT_BUDGET;
    spindle.sendToFrontend?.({ type: 'vellum_budget_state', budget: cfg }, uid);
  },
  vellum_beat_add: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const state = await loadState(chatId);
    const ev = beatEvent({
      text: String(p?.text ?? ''),
      ...(Number.isFinite(p?.day) ? { day: Number(p.day) } : (state.day ? { day: state.day } : {})),
      ...(p?.time ? { time: String(p.time) } : (state.scene?.time ? { time: String(state.scene.time) } : {})),
      ...(p?.spine === false ? { spine: false } : {}),
      ...(p?.act ? { act: String(p.act) } : {}),
    }, state.turns || 0, nextSeqLocal);
    if (!ev) return;
    await append(chatId, [ev]);
    invalidateIndex(chatId);
    await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_beat_done', ok: true }, uid);
  },
  vellum_beat_edit: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId || !p?.id) return;
    const state = await loadState(chatId);
    const evs = beatEditEvents(state, String(p.id), {
      text: String(p?.text ?? ''),
      ...(Number.isFinite(p?.day) ? { day: Number(p.day) } : {}),
      time: p?.time !== undefined ? String(p.time) : undefined,
      ...(p?.spine === false ? { spine: false } : {}),
    }, nextSeqLocal);
    if (!evs.length) return;
    await append(chatId, evs);
    invalidateIndex(chatId);
    await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_beat_done', ok: true }, uid);
  },
  vellum_beat_reorder: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId || !p?.id) return;
    const state = await loadState(chatId);
    const dir = p?.dir === 'up' ? -1 : 1;
    const evs = beatReorderEvents(state, String(p.id), dir, nextSeqLocal);
    if (!evs.length) return;
    await append(chatId, evs);
    invalidateIndex(chatId);
    await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_beat_done', ok: true }, uid);
  },
  vellum_beat_delete: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId || !p?.id) return;
    await append(chatId, [{ seq: nextSeqLocal(), turn: 0, day: 0, src: 'user', kind: 'memory.drop', id: String(p.id) } as VellumEvent]);
    invalidateIndex(chatId);
    await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_beat_done', ok: true }, uid);
  },
  vellum_beat_suggest: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const state = await loadState(chatId);
    spindle.sendToFrontend?.({ type: 'vellum_beat_suggestions', items: suggestBeats(state) }, uid);
  },
  vellum_clear: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    await clearLog(chatId);
    invalidateIndex(chatId);
    invalidateMood(chatId);
    // Clean up colored-dialogue scripts
    const scope = { scope: 'chat', scopeId: chatId };
    try {
      await deleteScriptByScriptId(`vellum-engine-spk-display-${chatId}`, uid, scope);
      await deleteScriptByScriptId(`vellum-engine-spk-strip-${chatId}`, uid, scope);
      await setScriptDisabled('vellum2-spk-display', false, uid); // restore preset script
    } catch { /* best effort */ }
    await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_cleared', ok: true }, uid);
  },
  vellum_export: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const log = await exportLog(chatId);
    spindle.sendToFrontend?.({ type: 'vellum_export', chatId, log }, uid);
  },
  vellum_export_markdown: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const state = await loadState(chatId);
    const md = toMarkdown(state, 'VELLUM Chronicle');
    spindle.sendToFrontend?.({ type: 'vellum_export_markdown', chatId, markdown: md }, uid);
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
        // auto-resolve a target book: explicit → a VELLUM book → create+attach one
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
    // mis-folded — e.g. fell to the regex parser before a parser fix — can't be
    // corrected by it. Here we drop the latest turn's events and re-fold it from
    // the raw message with current parser logic, preserving all earlier history.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) { spindle.sendToFrontend?.({ type: 'vellum_refresh_done', ok: false, reason: 'no_active_chat' }, uid); return; }
    const state = await loadState(chatId);
    const maxTurn = state.turns || 0;
    if (maxTurn <= 0) { lastSigByChat.delete(chatId); await foldChat(chatId, uid); spindle.sendToFrontend?.({ type: 'vellum_refresh_done', ok: true, refolded: 0 }, uid); return; }
    try {
      await truncateAfterTurn(chatId, maxTurn - 1); // drop the latest turn's events
      invalidateMood(chatId);                        // count may regrow to the same → force a mood rebuild
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
  vellum_set_colored_dialogue: async (p, uid) => {
    // toggle colored character dialogue; persist in a chat var. Needs the
    // regex_scripts permission + the preset's [spk=] tags to actually render.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const enabled = !!p?.enabled;
    
    // If turning ON and scripts are orphaned (exist but unfindable), force-delete by brute-force ID scan
    if (enabled && (await hasRegex())) {
      try {
        const api = spindle.regex_scripts;
        if (api?.list && api?.delete) {
          const all = await api.list({ limit: 500, ...(uid ? { userId: uid } : {}) });
          const arr: any[] = Array.isArray(all) ? all : (all?.data ?? all?.items ?? []);
          spindle.log?.info?.(`[vellum_engine] colored-dialogue: force-delete scan found ${arr.length} total scripts`);
          
          // Debug: log the first 10 script_ids to see what's actually in the list
          const sampleIds = arr.slice(0, 10).map((s) => s?.script_id).filter(Boolean);
          if (sampleIds.length) spindle.log?.info?.(`[vellum_engine] colored-dialogue: sample script_ids from list: ${sampleIds.join(', ')}`);
          
          let deleted = 0;
          for (const s of arr) {
            if (s?.script_id === `vellum-engine-spk-display-${chatId}` || s?.script_id === `vellum-engine-spk-strip-${chatId}`) {
              spindle.log?.info?.(`[vellum_engine] colored-dialogue: force-deleting orphaned script ${s.script_id} (id=${s.id})`);
              await api.delete(String(s.id), uid).catch(() => {});
              deleted++;
            }
          }
          if (deleted === 0) {
            spindle.log?.info?.(`[vellum_engine] colored-dialogue: no orphaned scripts found in list (searched for vellum-engine-spk-*-${chatId})`);
            // Last resort: try to get by script_id directly if the API supports it
            if (api.get) {
              for (const scriptId of [`vellum-engine-spk-display-${chatId}`, `vellum-engine-spk-strip-${chatId}`]) {
                try {
                  const direct = await api.get(scriptId, uid);
                  if (direct?.id) {
                    spindle.log?.info?.(`[vellum_engine] colored-dialogue: found orphaned script via direct get: ${scriptId} (id=${direct.id})`);
                    await api.delete(String(direct.id), uid).catch(() => {});
                    deleted++;
                  }
                } catch { /* doesn't exist or get() not supported */ }
              }
            }
          }
          if (deleted > 0) spindle.log?.info?.(`[vellum_engine] colored-dialogue: deleted ${deleted} orphaned scripts`);
        }
      } catch (e) { spindle.log?.warn?.('[vellum_engine] force-delete orphaned scripts failed: ' + ((e as Error)?.message ?? e)); }
    }
    
    try { await setChatVar(chatId, 'vellum_colored_dialogue', enabled ? '1' : ''); } catch { /* best effort */ }
    await maybeColorSync(chatId, uid); // immediate apply/teardown
    spindle.sendToFrontend?.({ type: 'vellum_colored_dialogue_set_done', ok: true, enabled, available: await hasRegex() }, uid);
    await broadcastState(chatId, uid);
  },
  vellum_set_traversal: async (p, uid) => {
    // controller-guided retrieval mode: off | flat (one-shot) | tree (tiered
    // arc→chapter→leaf drill). Persisted in chat vars; needs generation to engage.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const mode = (p?.mode === 'flat' || p?.mode === 'tree') ? p.mode : (p?.enabled ? 'flat' : 'off');
    const enabled = mode !== 'off';
    try { await setChatVar(chatId, 'vellum_traversal', enabled ? '1' : ''); } catch { /* best effort */ }
    try { await setChatVar(chatId, 'vellum_traversal_mode', mode === 'tree' ? 'tree' : 'flat'); } catch { /* best effort */ }
    if (p?.axis === 'character' || p?.axis === 'temporal' || p?.axis === 'hybrid') { try { await setChatVar(chatId, 'vellum_traversal_axis', p.axis); } catch { /* best effort */ } }
    _treeCache.delete(chatId); // settings changed → drop any stale precompute
    const available = await has('generation');
    const axis = readAxis(await getChatVar(chatId, 'vellum_traversal_axis'));
    spindle.sendToFrontend?.({ type: 'vellum_traversal_done', ok: true, enabled, mode, axis, available }, uid);
  },
  vellum_set_tone: async (p, uid) => {
    // persist romance pace + world disposition; they steer the fold (bond seed/
    // clamp/strip) and the preset prose. Validated via parseTone (neutral default).
    // Stored as a DURABLE tone.set event in the log (not a host chat var) so the
    // dials survive regen/chat-switch/reload instead of reverting to default.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const tone = parseTone(p?.romance, p?.disposition, p?.social, p?.politics);
    // ensure the log is loaded (so logHasKind sees it) and the legacy seed ran,
    // so this explicit set is the authoritative last tone.set either way.
    await migrateLegacyTone(chatId);
    const state = await loadState(chatId);
    // turn:0 so a regenerate/edit rollback (truncateAfterTurn) never drops the
    // user's chosen tone; last-write-wins in reduce keeps the newest value.
    await append(chatId, [{ seq: nextSeqLocal(), turn: 0, day: state.day || 0, src: 'user', kind: 'tone.set', romance: tone.romance, disposition: tone.disposition, social: tone.social, politics: tone.politics } as VellumEvent]);
    invalidateIndex(chatId);
    spindle.sendToFrontend?.({ type: 'vellum_tone_done', ok: true, romance: tone.romance, disposition: tone.disposition, social: tone.social, politics: tone.politics }, uid);
  },
  vellum_set_locks: async (p, uid) => {
    // Plot Director relation locks: persist the per-pair forbid/pin list. On
    // create, also drop any category already on the graph that the lock now
    // forbids (a one-time cleanup — future deltas are stripped at the fold).
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
    // nudges — injected while armed, self-cleared at the fold, TTL-expired.
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
  vellum_set_living_clock: async (p, uid) => {
    // toggle the Living Clock: on a detected time-skip, inject advisory decay for
    // time-sensitive state (wounds, plants, distant beats, aging). Off by default;
    // pure injection (no generation), so it's not gated on any permission.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const enabled = !!p?.enabled;
    try { await setChatVar(chatId, 'vellum_living_clock', enabled ? '1' : ''); } catch { /* best effort */ }
    spindle.sendToFrontend?.({ type: 'vellum_living_clock_set_done', ok: true, enabled }, uid);
  },
  vellum_set_day: async (p, uid) => {
    // manual day correction: the one sanctioned override of the monotonic day
    // counter (walk back a spurious high day). Emits a day.set event (absolute).
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) { spindle.sendToFrontend?.({ type: 'vellum_day_set_done', ok: false, reason: 'no_active_chat' }, uid); return; }
    const day = Math.floor(Number(p?.day));
    if (!Number.isFinite(day) || day < 0) { spindle.sendToFrontend?.({ type: 'vellum_day_set_done', ok: false, reason: 'bad_day' }, uid); return; }
    const state = await loadState(chatId);
    const evs = cmdEvents('day_set', { day, absolute: true }, state, { turn: state.turns || 0, day: state.day || 0 });
    if (evs.length) { await append(chatId, evs); invalidateIndex(chatId); await broadcastState(chatId, uid); }
    spindle.sendToFrontend?.({ type: 'vellum_day_set_done', ok: true, day }, uid);
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
    // manual "Tidy threads" — merge near-duplicate threads/arcs right now
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) { spindle.sendToFrontend?.({ type: 'vellum_tidy_done', ok: false, reason: 'no_active_chat' }, uid); return; }
    if (!(await has('generation'))) { spindle.sendToFrontend?.({ type: 'vellum_tidy_done', ok: false, reason: 'no_generation' }, uid); return; }
    const merged = await tidyThreads(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_tidy_done', ok: true, merged }, uid);
  },
  vellum_tidy_facts_now: async (p, uid) => {
    // manual "Tidy Knowledge/Secrets" — fold near-duplicate facts right now
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
    invalidateMood(chatId);
    await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_import_done', ok: true, events: v.data.events.length }, uid);
  },
  vellum_undo: async (p, uid) => {
    // Fix 10 — UNDO LAST TURN: drop every event at the max turn in the log, then
    // re-reduce. Honors the read-only durability guard (truncate bails on it).
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) { spindle.sendToFrontend?.({ type: 'vellum_undo_done', ok: false, reason: 'no_active_chat' }, uid); return; }
    const state = await loadState(chatId);
    const maxTurn = state.turns || 0;
    if (maxTurn <= 0) { spindle.sendToFrontend?.({ type: 'vellum_undo_done', ok: false, reason: 'nothing_to_undo' }, uid); return; }
    await truncateAfterTurn(chatId, maxTurn - 1);
    invalidateIndex(chatId);
    invalidateMood(chatId);
    await broadcastState(chatId, uid);
    spindle.sendToFrontend?.({ type: 'vellum_undo_done', ok: true, undoneTurn: maxTurn }, uid);
  },
  vellum_get_turnlog: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) { spindle.sendToFrontend?.({ type: 'vellum_turnlog', turns: [], maxTurn: 0 }, uid); return; }
    const state = await loadState(chatId);
    const log = await loadLog(chatId);
    const nameOf = (id: string): string => state.cast[id]?.name ?? id;
    spindle.sendToFrontend?.({ type: 'vellum_turnlog', turns: turnLog(log.events, nameOf), maxTurn: state.turns || 0 }, uid);
  },
  vellum_set_theme: async (p) => { if (typeof p?.theme === 'string') await writeTheme(p.theme); },
  vellum_get_theme: async (_p, uid) => { const t = await readTheme(); spindle.sendToFrontend?.({ type: 'vellum_theme', theme: t }, uid ?? currentUser()); },
  vellum_set_prefs: async (p) => { if (typeof p?.prefs === 'string') await writePrefs(p.prefs); },
  vellum_get_prefs: async (_p, uid) => { const t = await readPrefs(); spindle.sendToFrontend?.({ type: 'vellum_prefs', prefs: t }, uid ?? currentUser()); },
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

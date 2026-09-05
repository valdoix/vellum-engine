import { VELLUM_VERSION } from './version.js';
import type { ChatForkedPayloadDTO, ChatSwitchedPayloadDTO, GenerationEndedPayloadDTO, InterceptorContextDTO } from 'lumiverse-spindle-types';
import { restoreUser, rememberUser, currentUser, requireUser } from './host/user.js';
import { invalidatePermissions, invalidateChatCaps, has } from './host/capability.js';
import { activeChatId, latestAssistantContent, latestAssistantContentRetry, allAssistantContents, allTurnContents, chatNames, looksLikeTimestamp, getChatVar, setChatVar, invalidateChatVars, getRawMessages, activeContent } from './host/chats.js';
import { loadState, append, appendDeferred, flush, invalidate, clearLog, exportLog, importLog, logVersion, logRevision, logHasKind, truncateAfterTurn, turnSigs, turnDays, recoverFromBackup, loadLog } from './store/chronicle.js';
import { foldTurn } from './bus/lifecycle.js';
import { registerFeature } from './bus/registry.js';
import { coreFeature } from './domain/core-feature.js';
import { buildInjectionHybrid, invalidateIndex } from './retrieval/recall.js';
import { importLegacy } from './store/import-legacy.js';
import { cmdEvents, CMD_TYPES } from './domain/commands.js';
import { summarizeWindow, summarizeAll, summarizeFromPlan, reportArchiveSaved, type SummaryProgress, type SummaryRunOptions } from './bus/summarize.js';
import { planChapterFrom, planArc, planArcFrom, planBook, planBookFrom, archivedTurnNumbers } from './domain/memory.js';
import { beatSpine, beatEvent, beatEditEvents, beatReorderEvents, suggestBeats } from './domain/beats.js';
import { locationList } from './domain/locations.js';
import { driftInjection } from './domain/drift.js';
import { formatDate } from './domain/date-format.js';
import { turnLog } from './domain/turnlog.js';
import { internalGenerate } from './host/generation.js';
import { toMarkdown } from './domain/markdown.js';
import { moodInjectionCached, invalidateMood } from './domain/mood.js';
import { plantsInjection } from './domain/plants.js';
import { agingInjection } from './domain/aging.js';
import { sanitizeBudget, resolveBudget, DEFAULT_BUDGET, type ContextBudget, type ResolvedCaps } from './domain/context-budget.js';
import { sanitizeSummarizerCfg, DEFAULT_CFG, DEFAULT_CHAPTER_PROMPT, DEFAULT_ARC_PROMPT, DEFAULT_BOOK_PROMPT, DEFAULT_GIST_PROMPT, type SummarizerCfg } from './domain/summarizer-config.js';
import { extractFromProse } from './bus/extract.js';
import { repairStateBlock, buildRepairContext } from './bus/block-repair.js';
import { stripScaffold, parseState, extractVellumBlock } from './parse/state-block.js';
import { validateTurnStructure, missingBlockMessage, looksLikeVellumTurn } from './host/validation.js';
import { controllerGenerate, invalidateConnCache, withTimeout, defaultConnectionId } from './host/generation.js';
import { stampPresetMetadata, updatePresetMetadataKey } from './host/presets.js';
import type { CallModel } from './retrieval/traverse.js';

/** Validate the persisted traversal axis to the three known values. */
type TraversalAxis = 'temporal' | 'character' | 'hybrid';
function readAxis(v: unknown): TraversalAxis { return v === 'character' || v === 'hybrid' ? v : 'temporal'; }

import { EventLog as EventLogSchema, type VellumEvent } from './core/events.js';
import { nextSeq as nextSeqLocal, hashStr, canonId } from './core/ids.js';
import { syncHideOnFile } from './host/hide.js';
import type { ChronicleState } from './domain/types.js';
import { VAULT_SCHEMA_VERSION, vaultSnapshot, setBookAttached, createBook, updateBook, createEntry, updateEntry, deleteEntry, syncEntry, adoptBookForChat, hasVault, ownedBooks, ownedEntries, extensionsFromEntry, type VaultSnapshot, type VaultRole } from './host/worldbooks.js';
import { loadCategories, upsertCategory, deleteCategory } from './store/vault-categories.js';
import { resolveCategory, settingsToEntryFields, customCategory, isSyncSource, type EntrySettings, type VaultCategory } from './domain/vault.js';
import { reconcileChapterEntries, planChapterEntry, type ChapterVaultMode } from './domain/chapter-vault.js';
import { buildPromotion, reconcileCategory, promotionsForSource, type PromoteKind } from './domain/promote.js';
import { auditVault } from './domain/vault-health.js';
import { parseTone, isDefaultTone, DEFAULT_TONE, type Tone } from './domain/tone.js';
import { sanitizeLocks, lockKey, lockInjection, type RelationLock } from './domain/relation-lock.js';
import { sanitizeDirectives, directiveInjection, reconcileDirectives, armScheduled, type Directive } from './domain/directive.js';
import { checkContinuity, checkThreadOffscreenSync } from './domain/continuity.js';
import { offscreenCast, buildSimPrompt, parseSim, simEvents, simSys, offscreenInjection, readyToIntersect } from './domain/offscreen.js';
import { THREAD_MERGE_SYS, buildMergePrompt, parseMergeReply, validateMerges, openTracks } from './domain/thread-merge.js';
import { THREAD_CATCHUP_SYS, buildCatchupPrompt, OFFSCREEN_CATCHUP_SYS, buildOffscreenCatchupPrompt, parseCatchupReply, validateCatchupBeats, catchupTargets, offscreenCatchupTargets, threadsAwaitingCatchup, offscreensAwaitingCatchup } from './domain/thread-catchup.js';
import { FACT_MERGE_SYS, buildFactMergePrompt, parseFactMergeReply, validateFactMerges, mergeCandidates } from './domain/fact-merge.js';
import { sceneSuggestions, recursionSeeds, evaluateSchedules, findDupe, type VaultEntryLite } from './domain/vault-intel.js';
import { proseRefreshInjection, scrubProseRefreshCommands, stripProseRefreshCommand } from './domain/prose-refresh.js';
import { resolveTurnContract, type TurnContract } from './domain/preset-runtime.js';
import { compileState } from './bus/state-compiler.js';
import { stateRevision } from './domain/state-compiler.js';
import { previewStateAtTurn, replaceTailDeferred } from './store/chronicle.js';
import { compileArgentPolicy, applyArgentPolicy } from './domain/argent-policy.js';
import { reduce } from './core/reduce.js';

/**
 * Canonical VELLUM state-block instruction — inserted into presets that are
 * missing it via the preset editor tab health-check fix. Mirrors the core
 * content of the v2-state block in presets/vellum-ii.json.
 */
const VELLUM_STATE_BLOCK_CONTENT =
  '[VELLUM STATE] After the prose, on a new line, append ONE raw-JSON <vellum>...</vellum> block (the display layer hides it). '
  + 'Valid JSON, current scene plus deltas — omit unchanged optional fields. Fields:\n'
  + '{ turn:int, day:int, scene:{loc,time:"HH:MM",clock:int 0-1439,tension:0-10,weather}, '
  + 'present:[{id or name,mood,condition,doing,thought,traits}], '
  + 'delta:{ bonds:[{a,b,aff,trust,addCats:[],removeCats:[],why}], threads:[{op:new|advance|stall|resolve,name,note}], '
  + 'arcs:[{op:new|advance|stall|resolve,name,note}], journal:[{who,about,memory,kind,weight,sentiment}], '
  + 'knowledge:[{who,fact,about,reliability:knows|believes|suspects|wrong|unaware,truth:true|false|unknown,source}], '
  + 'secrets:[{keeper,secret,from}], secretReveals:[{id:"exact prior secret id",to:[names]}], factionRelations:[{from,to,trust,respect,fear,hostility,why}], parallel:[{who,where,activity}] }, '
  + 'ext:{ scars:[{who,was,about}], codex:[{id:"existing id when refreshing",op:add|refresh,fact,tag}], inventory:[{who,item,op:gain|lose|give|scene|note,to,note}], timeline:[{event,day,time:"HH:MM",location,participants:[names],importance:minor|major|critical}] } }\n'
  + 'When a scene is active, scene.time and scene.clock MUST describe the same exact instant. present[] MUST include {{user}} whenever on-screen; leave mood/condition/doing/thought empty and traits [] for {{user}}. '
  + 'Include every named on-stage NPC with a concise first-person private thought limited to that NPC\'s knowledge. '
  + 'Use secretReveals with the existing id when prose discloses a tracked secret, and add recipient knowledge with its source; never recreate that secret as new. Refresh changed Codex facts by existing id. '
  + 'Always close the </vellum> tag.';

/** Reconcile host visibility against exact, integrity-checked archive ancestry. */
async function syncArchiveHide(chatId: string, state?: ChronicleState): Promise<{ hid: number; shown: number }> {
  const enabled = !!(await getChatVar(chatId, 'vellum_hide_summarized'));
  return syncHideOnFile(chatId, enabled, archivedTurnNumbers(state ?? await loadState(chatId)));
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
  const categories = await loadCategories(uid);
  const snap = await vaultSnapshot(chatId, uid);
  let suggestions: unknown[] = [];
  let health: ReturnType<typeof auditVault> | undefined;
  try {
    if (chatId && snap.ok) {
      const state = await loadState(chatId);
      const lites: VaultEntryLite[] = ownedEntries(snap, chatId).map((e) => ({ id: e.id, key: e.key, content: e.content, link: e.link, category: e.category, disabled: e.disabled, ...(e.reveal ? { reveal: e.reveal } : {}) }));
      suggestions = sceneSuggestions(state, lites, dismissedFor(chatId));
      health = auditVault(snap, chatId, state);
    }
  } catch { /* suggestions best-effort */ }
  spindle.sendToFrontend?.({ type: 'vellum_vault', chatId, categories, ...snap, suggestions, health }, uid ?? currentUser() ?? undefined);
}

declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

/**
 * Backend entrypoint. Registers features, folds each turn into the event log,
 * and serves the frontend via a dispatch table. Everything is guarded — the
 * worker must never crash the host. New features call registerFeature() and
 * (if they need UI) add a message handler in the dispatch table below.
 */

registerFeature(coreFeature);

const lastSigByChat = new Map<string, string>();
// Per-chat guard so the "only one block" warning toasts at most once per turn
// number (a regenerate of the same turn can re-warn; steady folding does not spam).
const _blockWarnByChat = new Map<string, number>();
// Block-repair guard: keyed by `chatId\0messageId`, capped at one repair attempt
// per unique message so the chained re-fold can never re-enter repair.
const _blockRepairAttempts = new Set<string>();
// Consecutive deep-extractor failures; emit one diagnostic toast at the threshold
// then reset so a persistently broken generation connection is visible, not silent.
let _extractFails = 0;
const EXTRACT_FAIL_TOAST_AT = 3;
interface InjRecord { turn: number; at: number; chars: number; recallIds: string[]; text: string; source?: string; trace?: unknown }
const injectionLog = new Map<string, InjRecord[]>(); // per-chat ring of recent injections
function recordInjection(chatId: string, turn: number, text: string, recallIds: string[], meta?: { source?: string; trace?: unknown }): InjRecord {
  const ring = injectionLog.get(chatId) ?? [];
  // Store the FULL injected text so the Context tab and preset-tab preview show
  // everything VELLUM fed the model, not a truncated head. The injection is already
  // bounded by the context budget; the 64k cap is only a memory-safety backstop for
  // the 20-record-per-chat ring, well above any realistic injection size.
  const rec: InjRecord = { turn, at: Date.now(), chars: text.length, recallIds, text: text.slice(0, 64000), ...(meta?.source ? { source: meta.source } : {}), ...(meta?.trace ? { trace: meta.trace } : {}) };
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
  const [tone, tidyRaw, offscreenRaw, hideRaw, chapterVault, travOn, travModeRaw, traversalAxis, relationLocks, directives, nextScene, hardLimits, calendar, themeRaw, prefsRaw, autoRetryRaw, blockExampleRaw2] = await Promise.all([
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
    readTheme(userId),
    readPrefs(userId),
    getChatVar(chatId, 'vellum_autoretry_block').catch(() => ''),
    getChatVar(chatId, 'vellum_block_example').catch(() => ''),
  ]);
  const tidy = !!tidyRaw;
  const offscreen = !!offscreenRaw;
  const hide = !!hideRaw;
  const traversalMode = travOn ? (travModeRaw === 'tree' ? 'tree' : 'flat') : 'off';
  const theme = themeRaw ?? null;
  const prefs = prefsRaw ?? null;
  const autoRetryBlock = !!autoRetryRaw;
  const blockExample = !!blockExampleRaw2;
  spindle.sendToFrontend?.({ type: 'vellum_state', chatId, state, tone, tidy, offscreen, hide, chapterVault, traversalMode, traversalAxis, relationLocks, directives, nextScene, hardLimits, calendar, theme, prefs, autoRetryBlock, blockExample }, userId ?? currentUser() ?? undefined);
}

/** FOLD: read the raw turn, parse — events — append — broadcast. */
const _foldChain = new Map<string, Promise<void>>();
function foldChat(chatId: string, userId: string | null, hint?: string, forceRollbackTo?: number): Promise<void> {
  // serialize folds per chat: concurrent triggers (GENERATION_ENDED +
  // get_state retries) would each read the same prior.turns and re-fold the
  // SAME turn, accumulating duplicate deltas (aff -30/-60/-90). Chaining makes
  // the 2nd call wait, then see turns already advanced -> nothing new to fold.
  const prev = _foldChain.get(chatId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => foldChatInner(chatId, userId, hint, forceRollbackTo));
  _foldChain.set(chatId, next.catch(() => {}));
  return next;
}

/** Complete-content signature for a turn. MUST match foldTurn's signature so a
 * changed trailing state block on a long reply is detected during reconcile. */
function sigOf(content: string): string { return hashStr(content); }

/** Per-turn memory text: strip the vellum/reverie blocks, collapse whitespace,
 * resolve persona tokens to real names, and keep the FULL beat (both the player
 * message and the scene response). We store it whole so chapter summaries are
 * built on complete turns, not fragments; the chronicle UI shows only a one-line
 * preview (first sentence + ellipsis). A large safety guard prevents a
 * pathological mega-message from bloating the log. */
function turnGist(content: string, names?: { user: string; char: string }): string {
  // stripScaffold removes the reverie (prefix) and vellum (suffix) scaffold
  // position-aware and fence-tolerant — as robust as the parser, so mangled/
  // truncated/tag-drifted blocks no longer leak into turn memory (and thus not
  // into chapter summaries or PASS-2 prose extraction, both built on this gist).
  let s = stripProseRefreshCommand(stripScaffold(content))
    .replace(/\[Player action\]\s*(?=\[Scene\])/gi, '')
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

async function foldChatInner(chatId: string, userId: string | null, hint?: string, forceRollbackTo?: number): Promise<void> {
  let msgs = await allTurnContents(chatId);
  if (!msgs.length || !(msgs[msgs.length - 1] ?? '').trim()) { await new Promise((r) => setTimeout(r, 220)); msgs = await allTurnContents(chatId); }
  if (hint && hint.trim() && (!msgs.length || msgs[msgs.length - 1] !== hint)) msgs.push(hint);
  if (!msgs.length) return;
  // Resolve the exact active preset's output controls once for this fold. This
  // turns state/reverie validation into a real contract instead of guessing from
  // whichever tags happened to survive in the response.
  const turnContract = await activeTurnContract(chatId, userId);
  const structuredStateEnabled = turnContract?.state !== false;
  const engineCompiler = structuredStateEnabled && turnContract?.stateCompiler === 'engine';
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
  let rollbackTo = await divergedTurn(chatId, msgs, prior.turns ?? 0, () => allAssistantContents(chatId));
  if (forceRollbackTo !== undefined && forceRollbackTo < (prior.turns ?? 0)) {
    rollbackTo = rollbackTo === null ? forceRollbackTo : Math.min(rollbackTo, forceRollbackTo);
  }
  // regenerate day-stability: remember the days the re-folded turns previously
  // held, so the re-fold can't ratchet the calendar forward past them (the NOW
  // line feeds the model the old day as authoritative; it tends to step past it).
  let priorTurnDays: Map<number, number> | null = null;
  let pendingRollback: number | null = null;
  let stagedTail: VellumEvent[] = [];
  let stagedExpectedRevision: number | undefined;
  if (rollbackTo !== null && rollbackTo < (prior.turns ?? 0)) {
    priorTurnDays = await turnDays(chatId);
    if (engineCompiler && rollbackTo < msgs.length) {
      prior = await previewStateAtTurn(chatId, rollbackTo);
      pendingRollback = rollbackTo;
    } else prior = await truncateAfterTurn(chatId, rollbackTo);
    invalidateIndex(chatId);
    invalidateMood(chatId);
    spindle.log?.info?.(`[vellum_engine] reconcile: turn ${rollbackTo + 1} changed (regenerate/edit) \u2014 rolled back to turn ${rollbackTo}, re-folding.`);
  }
  let added = 0;
  const foldedEvents: VellumEvent[] = []; // accumulate for Plot Director self-clear
  // Track the latest turn's raw content + parse source for post-loop block validation.
  let _latestContent = '';
  let _latestSource: 'json' | 'json-partial' | 'regex' | 'none' = 'none';
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
    let compiled: Awaited<ReturnType<typeof compileState>> | null = null;
    let expectedRevision: number | undefined;
    let foldContent = content;
    if (engineCompiler) {
      expectedRevision = stagedExpectedRevision ?? logRevision(chatId);
      if (pendingRollback !== null && stagedExpectedRevision === undefined) stagedExpectedRevision = expectedRevision;
      const baseline = structuredClone(prior);
      const liveRevision = stateRevision(await loadState(chatId));
      const prose = stripScaffold(content);
      const raw = await getRawMessages(chatId);
      const latestUser = [...raw].reverse().find((m: any) => m.role === 'user');
      const explicitGenesis = /(?:\(\(worldgen\)\)|OOC:\s*worldgen)/i.test(latestUser ? activeContent(latestUser) : '');
      const compilerConnection = await getChatVar(chatId, 'vellum_compiler_connection');
      compiled = await compileState({ prior: baseline, turn: turnNo, prose, userName: names.user ?? '', genesisAllowed: !!turnContract?.worldgen && (!baseline.genesisTurn || explicitGenesis), verbosity: turnContract?.stateVerbosity, codexAllowed: turnContract?.codex, inventoryAllowed: turnContract?.inventory }, userId, compilerConnection ? String(compilerConnection) : undefined);
      const current = await allTurnContents(chatId);
      const unchanged = current.length === msgs.length && sigOf((current[turnNo - 1] ?? '').trim()) === sigOf(content);
      if (!compiled.ok || !unchanged || stateRevision(await loadState(chatId)) !== liveRevision) {
        const errors = !compiled.ok ? compiled.errors : ['The transcript or Chronicle changed during compilation; retry the fold.'];
        await setChatVar(chatId, 'vellum_compiler_diagnostic', JSON.stringify({ turn: turnNo, inputSig: sigOf(content), errors }));
        spindle.sendToFrontend?.({ type: 'vellum_toast', level: 'warning', msg: `State compilation held turn ${turnNo}: ${errors.slice(0, 2).join('; ')}. Rescan to retry.` }, userId ?? undefined);
        await flush(chatId);
        await broadcastState(chatId, userId);
        return;
      }
      foldContent = prose + '\n' + compiled.block;
    }
    const folded = structuredStateEnabled
      ? foldTurn(foldContent, prior, turnNo, { tone, userCanon, locks, ...(dayCap !== undefined ? { dayCap } : {}) })
      : { events: [] as VellumEvent[], source: 'none' as const, sig: sigOf(content), dropped: undefined };
    const { events, source, dropped } = folded;
    if (compiled?.ok && source !== 'json') {
      await setChatVar(chatId, 'vellum_compiler_diagnostic', JSON.stringify({ turn: turnNo, inputSig: sigOf(content), errors: ['A validated compiler candidate did not round-trip through the canonical parser.'] }));
      spindle.sendToFrontend?.({ type: 'vellum_toast', level: 'warning', msg: `State compilation held turn ${turnNo}: canonical parser rejected the candidate.` }, userId ?? undefined);
      return;
    }
    const sig = sigOf(content);
    for (const event of events) if (event.kind === 'turn.fold') event.sig = sig;
    if (compiled?.ok) events.push({ seq: nextSeqLocal(), turn: turnNo, day: compiled.candidate.state.day, src: 'system', kind: 'state.compiled', inputSig: sig, baseHash: compiled.baseHash, block: compiled.block, genesis: compiled.candidate.genesis });
    // remember the newest turn's raw content + parse verdict for the block-
    // structure check below (the "only one block" warning).
    if (turnNo === msgs.length) { _latestContent = foldContent; _latestSource = source; }
    const evs: VellumEvent[] = [...events];
    // Reuse foldTurn's already-computed complete-content signature instead of
    // recomputing sigOf(content) here.
    if (!evs.some((e) => e.kind === 'turn.fold')) evs.unshift({ seq: nextSeqLocal(), turn: turnNo, day: prior.day || 0, src: 'system', kind: 'turn.fold', sig } as VellumEvent);
    const gist = turnGist(content, names);
    if (gist) evs.push({ seq: nextSeqLocal(), turn: turnNo, day: prior.day || 0, src: 'system', kind: 'memory.record', id: 'turn_' + chatId.slice(0, 6) + '_' + turnNo, tier: 'turn', text: gist, keys: [] } as VellumEvent);
    foldedEvents.push(...evs);
    if (pendingRollback !== null && expectedRevision !== undefined) {
      stagedTail.push(...evs);
      prior = reduce(evs, prior);
      if (turnNo === msgs.length) {
        prior = await replaceTailDeferred(chatId, pendingRollback, stagedTail, expectedRevision);
        pendingRollback = null; stagedTail = []; stagedExpectedRevision = undefined;
      }
    } else prior = await appendDeferred(chatId, evs, expectedRevision);
    if (compiled?.ok) await setChatVar(chatId, 'vellum_compiler_diagnostic', '');
    added += evs.length;
    // defer prose-driven extraction to PASS 2 (below the early broadcast).
    // `json-partial` means element salvage recovered the block by dropping corrupt
    // member(s) — the block WAS parsed, so treat it as a real block (the safety-net
    // prose extractor still runs, but the PASS-2 log isn't mislabeled "no block").
    if (gist && structuredStateEnabled && !engineCompiler) extractQueue.push({ turnNo, gist, day: prior.day || 0, hadBlock: source === 'json' || source === 'json-partial' });
    spindle.log?.info?.(`[vellum_engine] folded turn ${turnNo} via ${source}: +${evs.length} events`);
    // salvage discards data — surface WHAT was dropped so recurring model
    // malformations are visible and quantifiable, not silent.
    if (source === 'json-partial' && dropped) {
      const summary = Object.entries(dropped).map(([k, n]) => `${n} ${k}`).join(', ');
      spindle.log?.warn?.(`[vellum_engine] turn ${turnNo} salvaged with element loss${summary ? ' (dropped ' + summary + ')' : ''} — a corrupt block member was skipped`);
    }
    if (source === 'none' && /\u2039\/?vellum\u203a|<\/?vellum>/i.test(content)) {
      const m = content.match(/(?:\u2039vellum\u203a|<vellum>)([\s\S]*?)(?:\u2039\/vellum\u203a|<\/vellum>)/i);
      spindle.log?.warn?.('[vellum_engine] <vellum> present but UNPARSED. Inner head: ' + ((m?.[1] ?? '').trim().slice(0, 200)));
    }
  }
  if (!added) return;
  // GREETING SEED — a first-message greeting almost never carries a <vellum>
  // block, so the character the card is about never enters the cast until the
  // model happens to re-emit them. When we've only folded the opening turn(s)
  // and the cast is still empty, seed a single `cast.seen` for the card's
  // character so the tracker isn't blank on turn 1. Guarded against junk names:
  // chatNames already rejects timestamp titles, but re-check here so a bad
  // author string can never become a cast card (the "Jul 19, 2026, ..." bug).
  if (structuredStateEnabled && names.char && !looksLikeTimestamp(names.char) && (prior.turns ?? 0) <= 1 && Object.keys(prior.cast).length === 0) {
    const seedId = canonId(names.char);
    if (seedId) {
      const seedEv = { seq: nextSeqLocal(), turn: prior.turns || 1, day: prior.day || 0, src: 'system', kind: 'cast.seen', id: seedId, name: names.char, status: 'present' } as VellumEvent;
      prior = await appendDeferred(chatId, [seedEv]);
      added += 1;
      spindle.log?.info?.(`[vellum_engine] greeting seed: seeded '${names.char}' into cast from card (no <vellum> block on greeting turn)`);
    }
  }
  // BLOCK REPAIR (Option C) — auto-recovery of a dropped <vellum> block for
  // ARGENT, or opt-in recovery for other VELLUM presets.
  // When the NEWEST turn folded with source 'none' (the parser recovered no state
  // at all) and the reply still looks like a VELLUM turn, transcribe its prose
  // into a valid block with ONE bounded LLM call, append it to the stored message,
  // and re-fold via the reconcile path so the block lands the canonical way.
  // Runs BEFORE the early broadcast / PASS-2 so we don't broadcast the block-less
  // state and run PASS-2 only to immediately discard it on the re-fold. Gated,
  // newest-turn-only, capped at ONE attempt per message; a failure falls through
  // to the existing PASS-2 safety net unchanged.
  if (_latestSource === 'none' && _latestContent && turnContract?.state !== false && (turnContract?.active || looksLikeVellumTurn(_latestContent))) {
    let autoretry = false;
    try { autoretry = !!(await getChatVar(chatId, 'vellum_autoretry_block')); } catch { /* best effort */ }
    if ((autoretry || turnContract?.argent) && (await has('generation'))) {
      try {
        // newest assistant message: the one to append the recovered block to.
        const raw = await getRawMessages(chatId);
        let asst: any = null;
        for (let i = raw.length - 1; i >= 0; i--) { if (raw[i]?.role === 'assistant') { asst = raw[i]; break; } }
        const msgId = asst?.id ? String(asst.id) : '';
        const guardKey = chatId + '\u0000' + msgId;
        if (msgId && !_blockRepairAttempts.has(guardKey)) {
          _blockRepairAttempts.add(guardKey); // cap at ONE attempt per message (success or fail)
          const asstContent = activeContent(asst);
          // Tell the user WHY the tracker paused: the block is missing and we're
          // actively recovering it. This replaces the generic "missing block"
          // validation warning below (suppressed while repair is on) so the user
          // sees a single, honest, in-progress message instead of a scary error.
          try { spindle.sendToFrontend?.({ type: 'vellum_toast', level: 'info', msg: 'VELLUM: the state block is missing from this reply \u2014 recovering it from the prose\u2026' }, userId ?? currentUser() ?? undefined); } catch { /* best effort */ }
          // feed the extractor the PROSE only (strip any reverie prefix / partial
          // block), so it transcribes the narrative rather than echoing scaffold.
          const prose = stripScaffold(asstContent);
          const ctxHeader = buildRepairContext(prior, msgs.length);
          const repaired = await repairStateBlock(prose, ctxHeader, userId);
          if (repaired && spindle.chat?.updateMessage) {
            // content-only patch: mirrors into the active swipe, emits MESSAGE_EDITED
            // only (NOT a fold trigger), so this cannot auto-loop.
            await spindle.chat.updateMessage(chatId, msgId, { content: asstContent + '\n\n' + repaired.block });
            spindle.log?.info?.(`[vellum_engine] block-repair: recovered a <vellum> block for turn ${msgs.length} (${repaired.source}); re-folding.`);
            try { spindle.sendToFrontend?.({ type: 'vellum_toast', level: 'success', msg: 'VELLUM: recovered the missing state block and updated the chronicle.' }, userId ?? currentUser() ?? undefined); } catch { /* best effort */ }
            // re-fold: divergedTurn sees the changed signature, rolls back the
            // block-less turn, and re-folds it with the block present (source json).
            void foldChat(chatId, userId);
            return;
          }
          // Repair attempted but produced no usable block — tell the user it
          // fell back, then let PASS-2 prose extraction (below) do its best.
          spindle.log?.info?.(`[vellum_engine] block-repair: no valid block recovered for turn ${msgs.length}; falling back to prose extraction.`);
          try { spindle.sendToFrontend?.({ type: 'vellum_toast', level: 'warning', msg: 'VELLUM: could not rebuild the missing state block \u2014 recovering what it can from the prose. Consider regenerating.' }, userId ?? currentUser() ?? undefined); } catch { /* best effort */ }
          // suppress the generic validation warning below (we already spoke).
          _blockWarnByChat.set(chatId, msgs.length);
        }
      } catch (e) { spindle.log?.warn?.('[vellum_engine] block-repair: ' + ((e as Error)?.message ?? e)); }
    }
  }
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
  spindle.sendToFrontend?.({ type: 'vellum_fold_progress', chatId, phase: 1, total: foldTotal }, userId ?? currentUser() ?? undefined);
  // BLOCK-STRUCTURE VALIDATION: warn when the latest turn looks like a VELLUM
  // reply but is missing one of the two scaffold blocks. Self-gates on tag
  // presence so plain (non-VELLUM) chats never false-positive. Throttled to one
  // warning per unique turn (the _blockWarnByChat map stores the last warned
  // msgs.length); a regenerate of the same turn re-warns, steady folding doesn't
  // spam. Only the state-missing case is 'error' (chronicle didn't advance); the
  // reverie-missing case is 'warning' (harmless on reasoning models).
  try {
    if (_latestContent && (turnContract?.active || looksLikeVellumTurn(_latestContent))) {
      const lastWarnAt = _blockWarnByChat.get(chatId) ?? -1;
      if (lastWarnAt !== msgs.length) {
        const vr = validateTurnStructure(
          _latestContent,
          turnContract
            ? { reverie: turnContract.reverie, state: turnContract.state }
            : { reverie: false, state: true },
          _latestSource,
        );
        const msg = missingBlockMessage(vr);
        if (msg) {
          _blockWarnByChat.set(chatId, msgs.length);
          const level = vr.missing.includes('state') ? 'warning' : 'info';
          spindle.sendToFrontend?.({ type: 'vellum_toast', level, msg }, userId ?? currentUser() ?? undefined);
          spindle.log?.warn?.('[vellum_engine] block validation: ' + msg);
        }
      }
    }
  } catch { /* validation is best-effort — never throw into the fold */ }
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
        try { spindle.sendToFrontend?.({ type: 'vellum_toast', level: 'warning', msg: 'VELLUM\u2019s deep memory pass keeps failing \u2014 check the generation permission and your connection.' }, userId ?? currentUser() ?? undefined); } catch { /* best effort */ }
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
      spindle.sendToFrontend?.({ type: 'vellum_continuity', chatId, warnings }, userId ?? currentUser() ?? undefined);
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
  if (willExtract) spindle.sendToFrontend?.({ type: 'vellum_fold_progress', chatId, phase: 2, total: 2, added: extracted }, userId ?? currentUser() ?? undefined);
  void maybeAutoSummarize(chatId, userId);
  void maybeVaultSync(chatId, userId);
  void maybeTidyThreads(chatId, userId);
  // COMPANION PRESET METADATA STAMPING: detect and stamp the active preset with
  // VELLUM metadata so the two halves recognize each other without prose sniffing.
  // Runs async after fold completion; never blocks the fold.
  void stampCompanionPreset(chatId, userId);
  // AWAIT the off-screen sim: on a time-skip its catch-up beats must be in the log
  // before the next prompt is assembled, so the on-screen scene doesn't reference
  // an off-screen world still a skip behind. maybeSimulate only blocks for a skip
  // (it detaches an ordinary cadence tick internally), so the common turn returns
  // immediately. simulateOffscreen already broadcasts on success; on a skip we
  // re-broadcast defensively so the drawer reflects the caught-up subplots.
  try { if (await maybeSimulate(chatId, userId)) await broadcastState(chatId, userId); }
  catch (e) { spindle.log?.warn?.('[vellum_engine] maybeSimulate: ' + ((e as Error)?.message ?? e)); }
  void maybeChapterVault(chatId, userId);
}

const _tidying = new Set<string>();
const TIDY_THRESHOLD = 8; // auto-tidy only once open-thread count exceeds this

/**
 * Detect and stamp the companion preset with VELLUM metadata so the extension
 * and preset recognize each other without prose sniffing. Runs async after fold,
 * never blocks. Idempotent: only writes when the version has changed or metadata
 * is absent. Requires presets permission; no-op otherwise.
 */
const _presetStamped = new Map<string, number>(); // chatId -> lastStampedAt (epoch ms)
const _presetByUserChat = new Map<string, string>();
const _turnContractByUserChat = new Map<string, TurnContract>();
const TURN_CONTRACT_CHAT_VAR = 'vellum_active_turn_contract_v1';
const PRESET_STAMP_THROTTLE = 5 * 60 * 1000; // stamp at most once per 5 minutes per chat
function userChatKey(userId: string, chatId: string): string { return userId + '\u0000' + chatId; }
function storedTurnContract(raw: unknown, expectedPresetId?: string): TurnContract | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const snapshot = JSON.parse(raw) as { presetId?: unknown; contract?: Partial<TurnContract> };
    if (expectedPresetId && snapshot.presetId !== expectedPresetId) return null;
    const c = snapshot.contract;
    if (!c || c.active !== true
      || typeof c.argent !== 'boolean'
      || typeof c.state !== 'boolean'
      || typeof c.reverie !== 'boolean'
      || typeof c.dialogueColor !== 'boolean'
      || typeof c.reasoningRoute !== 'string'
      || (c.stateCompiler !== 'engine' && c.stateCompiler !== 'inline')
      || (c.stateVerbosity !== 'lean' && c.stateVerbosity !== 'full')
      || typeof c.codex !== 'boolean'
      || typeof c.inventory !== 'boolean'
      || typeof c.worldgen !== 'boolean') return null;
    return c as TurnContract;
  } catch { return null; }
}
async function activeTurnContract(chatId: string, userId: string | null): Promise<TurnContract | null> {
  try {
    const u = requireUser(userId);
    if (!u.ok) return null;
    const key = userChatKey(u.value, chatId);
    const cached = _turnContractByUserChat.get(key);
    if (cached) return cached;
    const presetId = _presetByUserChat.get(key);
    if (presetId && (await has('presets')) && spindle.presets?.get) {
      const resolved = resolveTurnContract(await spindle.presets.get(presetId, u.value));
      if (resolved) {
        _turnContractByUserChat.set(key, resolved);
        return resolved;
      }
    }
    // The generation-end event may run after another interceptor pass omitted
    // presetId or after the worker was reloaded. Persist the exact resolved
    // contract used to assemble the narrative so Engine Second Pass cannot fall
    // back to inline merely because that transient lookup was lost.
    const stored = storedTurnContract(await getChatVar(chatId, TURN_CONTRACT_CHAT_VAR), presetId);
    if (stored) _turnContractByUserChat.set(key, stored);
    return stored;
  } catch (e) {
    spindle.log?.warn?.('[vellum_engine] active preset contract: ' + ((e as Error)?.message ?? e));
    return null;
  }
}
async function stampCompanionPreset(chatId: string, userId: string | null): Promise<void> {
  try {
    // Throttle: only stamp once per interval per chat to avoid hammering the preset API
    const last = _presetStamped.get(chatId) ?? 0;
    if (Date.now() - last < PRESET_STAMP_THROTTLE) return;
    // Operator-scoped hosts REQUIRE an authenticated uid on preset calls. Bail
    // WITHOUT marking the throttle if an older single-user host supplied none.
    const u = requireUser(userId);
    if (!u.ok) return;
    const uid = u.value;
    if (!(await has('presets'))) return; // permission not granted
    if (!spindle.presets?.list) return; // API not available
    // The current interceptor context identifies the exact active preset. Prefer
    // it so we never stamp an unrelated first/default preset after a turn.
    const activePresetId = _presetByUserChat.get(userChatKey(uid, chatId));
    let preset = activePresetId && spindle.presets.get
      ? await spindle.presets.get(activePresetId, uid)
      : null;
    if (!preset) {
      // Compatibility fallback for folds produced outside an interceptor (for
      // example a manual rebuild on an older host): prefer an already-linked
      // companion, then the first available preset.
      const { data } = await spindle.presets.list({ limit: 50, userId: uid });
      if (!Array.isArray(data) || !data.length) return;
      preset = data.find((p: any) => p?.metadata?.vellum_engine) ?? data[0] ?? null;
    }
    if (!preset?.id) return;
    // Check if metadata already matches current version — skip write if so
    const existing = preset.metadata?.vellum_engine as { version?: string; identifier?: string } | undefined;
    if (existing && existing.version === VELLUM_VERSION && existing.identifier === 'vellum_engine') {
      _presetStamped.set(chatId, Date.now());
      return; // already stamped and up-to-date
    }
    // Stamp the preset with version, identifier, and last-linked timestamp
    const meta = { version: VELLUM_VERSION, identifier: 'vellum_engine', linkedAt: Date.now() };
    const result = await stampPresetMetadata(preset.id, meta, uid);
    if (result.ok) {
      _presetStamped.set(chatId, Date.now());
      spindle.log?.info?.(`[vellum_engine] stamped preset ${preset.id} with metadata`);
    } else {
      spindle.log?.warn?.(`[vellum_engine] preset stamp failed: ${result.error}`);
    }
  } catch (e) {
    spindle.log?.warn?.('[vellum_engine] stampCompanionPreset: ' + ((e as Error)?.message ?? e));
  }
}

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

interface VaultSyncJob { running: boolean; rerun: boolean; promise: Promise<void> | null }
const _vaultSyncJobs = new Map<string, VaultSyncJob>();

/** One complete, chat-scoped reconcile pass. A partial host snapshot is useful
 * for display but never safe for deletes, disables, or overwrites. */
async function vaultSyncPass(chatId: string, userId: string | null): Promise<void> {
  await setChatVar(chatId, 'vellum_vault_dirty', '1');
  const cats = await loadCategories(userId);
  const state = await loadState(chatId);
  const snap = await vaultSnapshot(chatId, userId);
  if (!snap.complete) {
    spindle.log?.warn?.(`[vellum_engine] vault sync paused: incomplete snapshot (${snap.errors.join(', ') || 'unknown'})`);
    await vaultBroadcast(chatId, userId);
    return;
  }
  const owned = ownedEntries(snap, chatId).filter((e) => e.link);
  const byId = new Map(owned.map((e) => [e.id, e] as const));
  let changed = 0; let failed = 0; let conflicts = 0;
  // Enforce audience boundaries independently of category settings. Host world
  // books cannot target one character's private context, so restricted records
  // are disabled even if they were created by an older VELLUM build.
  const privateKind = (link: string): PromoteKind | null => link.startsWith('secret:') ? 'secret'
    : link.startsWith('knowledge:') ? 'knowledge' : link.startsWith('journal:') ? 'journal'
      : link.startsWith('scar:') ? 'scar' : link.startsWith('rel:') ? 'relation' : null;
  for (const entry of owned) {
    const kind = privateKind(entry.link); if (!kind || entry.disabled) continue;
    const canonicalId = entry.link.slice(entry.link.indexOf(':') + 1);
    const promo = buildPromotion(state, kind, canonicalId);
    if (!promo || promo.audience === 'restricted') {
      const r = await updateEntry(entry.id, { disabled: true, extensions: extensionsFromEntry(entry) }, userId);
      if (r.ok) { entry.disabled = true; changed++; } else failed++;
    }
  }
  const syncCats = cats.filter((c) => (c.sync === 'sync' || c.sync === 'auto') && isSyncSource(c.source));
  for (const cat of syncCats) {
    const managed = owned.filter((e) => e.category === cat.id).map((e) => ({
      id: e.id, link: e.link, hash: e.hash, content: e.content, disabled: e.disabled,
      bodyState: e.bodyState, overrideFields: e.overrideFields,
    }));
    const plan = reconcileCategory(state, cat.source!, managed);
    conflicts += plan.conflicts.length;
    for (const u of plan.update) {
      const entry = byId.get(u.entryId); if (!entry) continue;
      const r = await syncEntry(entry, u.promotion.content, u.promotion.key, u.promotion.hash, u.promotion.link, cat.id, userId, u.enable, u.promotion.comment, u.promotion.keysecondary);
      r.ok ? changed++ : failed++;
    }
    for (const entryId of plan.disable) {
      const entry = byId.get(entryId); if (!entry) continue;
      const r = await updateEntry(entryId, { disabled: true, extensions: extensionsFromEntry(entry) }, userId);
      r.ok ? changed++ : failed++;
    }
  }

  // Scheduled entries and relationship recursion are evaluated only inside this
  // chat's ownership boundary.
  const lites = owned.filter((e) => e.reveal).map((e) => ({ id: e.id, key: e.key, content: e.content, link: e.link, category: e.category, disabled: e.disabled, reveal: e.reveal! }));
  for (const ch of evaluateSchedules(state, lites)) {
    const entry = byId.get(ch.entryId); if (!entry) continue;
    const r = await updateEntry(ch.entryId, { disabled: !ch.enable, extensions: extensionsFromEntry(entry) }, userId);
    r.ok ? changed++ : failed++;
  }
  const castEntries = owned.filter((e) => e.link.startsWith('cast:'));
  const castLites: VaultEntryLite[] = castEntries.map((e) => ({ id: e.id, key: e.key, content: e.content, link: e.link, category: e.category, disabled: e.disabled }));
  const desiredSeeds = recursionSeeds(state, castLites);
  for (const entry of castEntries) {
    const previous = new Set((entry.recursionKeys ?? []).map((x) => x.toLocaleLowerCase()));
    const desired = desiredSeeds.get(entry.id) ?? [];
    const merged = entry.keysecondary.filter((x) => !previous.has(x.toLocaleLowerCase()));
    for (const n of desired) if (!merged.some((x) => x.toLocaleLowerCase() === n.toLocaleLowerCase())) merged.push(n);
    const sameKeys = merged.length === entry.keysecondary.length && merged.every((x, i) => x === entry.keysecondary[i]);
    const oldDesired = entry.recursionKeys ?? [];
    const sameDesired = oldDesired.length === desired.length && oldDesired.every((x, i) => x.toLocaleLowerCase() === desired[i]?.toLocaleLowerCase());
    if (!sameKeys || !sameDesired) {
      const r = await updateEntry(entry.id, { keysecondary: merged, extensions: extensionsFromEntry(entry, { recursionKeys: desired }) }, userId);
      r.ok ? changed++ : failed++;
    }
  }

  // Auto categories create reviewable drafts for every public typed adapter.
  // Private knowledge, secrets, journals, and scars never enter host lorebooks.
  const autoCats = cats.filter((c) => c.sync === 'auto' && isSyncSource(c.source));
  if (autoCats.length) {
    let manualBook = ownedBooks(snap, chatId).find((b) => b.role === 'manual');
    if (!manualBook) {
      const names = await chatNames(chatId, userId); const card = (names.char || 'Chronicle').slice(0, 40);
      const id = await resolveVellumBook(snap, chatId, userId, `VELLUM Vault (${card})`, 'Reviewable lore projected from this chat.', 'manual');
      manualBook = ownedBooks(snap, chatId).find((b) => b.id === id);
    }
    const allEntries = owned;
    const covered = new Set(owned.filter((e) => e.link).map((e) => e.link));
    if (manualBook) for (const cat of autoCats) for (const promo of promotionsForSource(state, cat.source!)) {
      if (covered.has(promo.link) || findDupe(promo.content, allEntries)) continue;
      const r = await createEntry({ bookId: manualBook.id, key: promo.key, keysecondary: promo.keysecondary, content: promo.content, comment: promo.comment, settings: cat.defaults, category: cat.id, source: cat.source, link: promo.link, pending: true, hash: promo.hash, ownerChatId: chatId, vaultRole: 'manual' }, userId);
      if (r.ok) { covered.add(promo.link); changed++; } else failed++;
    }
  }
  await setChatVar(chatId, 'vellum_vault_dirty', failed ? '1' : '0');
  if (changed || conflicts || failed) await vaultBroadcast(chatId, userId);
  if (changed || conflicts || failed) spindle.log?.info?.(`[vellum_engine] vault sync: ${changed} change(s), ${conflicts} conflict(s), ${failed} failure(s)`);
}

/** Coalesce folds that arrive during a running sync into one guaranteed rerun. */
async function maybeVaultSync(chatId: string, userId: string | null): Promise<void> {
  if (!(await hasVault())) return;
  const active = _vaultSyncJobs.get(chatId);
  if (active?.running) { active.rerun = true; return active.promise ?? Promise.resolve(); }
  const job: VaultSyncJob = { running: true, rerun: false, promise: null };
  _vaultSyncJobs.set(chatId, job);
  job.promise = (async () => {
    do {
      job.rerun = false;
      try { await vaultSyncPass(chatId, userId); }
      catch (e) { spindle.log?.warn?.('[vellum_engine] vault sync: ' + ((e as Error)?.message ?? e)); }
    } while (job.rerun);
  })().finally(() => { job.running = false; _vaultSyncJobs.delete(chatId); });
  return job.promise;
}

const _chapterVaulting = new Set<string>();
const _chapterVaultAgain = new Set<string>();

/** Read the per-chat chapter-vault mode (off | keyed | constant). Default keyed
 * when world_books is granted; off otherwise. */
async function readChapterVaultMode(chatId: string): Promise<ChapterVaultMode> {
  const v = await getChatVar(chatId, 'vellum_chapter_vault');
  if (v === 'off' || v === 'keyed' || v === 'constant') return v;
  return 'keyed'; // default ON (keyed) per design
}

/**
 * Hybrid chapter memory — VAULT projection (the I/O half). Mirrors each chapter/
 * arc/book memory's DETAIL into a world-book entry so the host injects it on keyword
 * relevance, outside VELLUM's recall budget. Reconciles create/update/delete and
 * round-trips user-edited keys back into the chronicle (memory.link). Pure diff
 * lives in domain/chapter-vault.ts. Best-effort, serialized per chat.
 */
async function resolveVellumBook(snap: VaultSnapshot, chatId: string, userId: string | null, name: string, desc: string, role: VaultRole): Promise<string> {
  const owned = snap.books.find((b) => b.vellum && b.ownerChatId === chatId && b.role === role);
  if (owned) return owned.id;
  const r = await createBook(name, desc, userId, chatId, role);
  if (!r.ok) return '';
  if (chatId && !(await setBookAttached(chatId, r.value, true, userId))) return '';
  snap.books.push({ id: r.value, name, description: desc, vellum: true, ownerChatId: chatId, role, attachedToChat: true, global: false, entries: [] });
  return r.value;
}

async function maybeChapterVault(chatId: string, userId: string | null): Promise<{ ok: boolean; reason?: string; created: number; updated: number; removed: number; conflicts?: number }> {
  if (_chapterVaulting.has(chatId)) { _chapterVaultAgain.add(chatId); return { ok: false, reason: 'queued', created: 0, updated: 0, removed: 0 }; }
  if (!(await hasVault())) return { ok: false, reason: 'no_world_books', created: 0, updated: 0, removed: 0 };
  const mode = await readChapterVaultMode(chatId);
  _chapterVaulting.add(chatId);
  try {
    const state = await loadState(chatId);
    const snap = await vaultSnapshot(chatId, userId);
    if (!snap.complete) {
      spindle.log?.warn?.(`[vellum_engine] chapter-vault paused: incomplete snapshot (${snap.errors.join(', ') || 'unknown'})`);
      return { ok: false, reason: 'incomplete_snapshot', created: 0, updated: 0, removed: 0 };
    }
    const entries = ownedEntries(snap, chatId);
    const plan = reconcileChapterEntries(state, entries, mode);
    if (mode === 'off') {
      // tear down our chapter/arc/book entries when disabled
      let removed = 0;
      for (const e of entries.filter((x) => /^(chapter|arc|book):/.test(x.link) && x.bodyState === 'clean' && !(x.overrideFields ?? []).length)) { const r = await deleteEntry(e.id, userId); if (r.ok) removed++; }
      return { ok: true, reason: 'mode_off', created: 0, updated: 0, removed };
    }
    const names = await chatNames(chatId, userId);
    const card = (names.char || 'Chronicle').slice(0, 40);
    const summaryBook = await resolveVellumBook(snap, chatId, userId, `VELLUM Vault (${card}) - Summaries`, 'Auto-authored chapter, arc, and book summaries.', 'summary');
    const bookId = summaryBook;
    if (!bookId) return { ok: false, reason: 'no_book', created: 0, updated: 0, removed: 0 };
    const linkEvents: VellumEvent[] = [];
    const entryById = new Map(entries.map((e) => [e.id, e] as const));
    let created = 0; let updated = 0; let removed = 0;
    for (const c of plan.create) {
      const r = await createEntry({ bookId, key: c.input.key, content: c.input.content, comment: c.input.comment, settings: c.input.settings, category: c.input.category, source: 'memories', link: c.input.link, hash: c.input.hash, ownerChatId: chatId, vaultRole: 'summary' }, userId);
      if (r.ok && r.value) { created++; linkEvents.push({ seq: nextSeqLocal(), turn: state.turns || 0, day: state.day || 0, src: 'system', kind: 'memory.link', id: c.memId, vaultEntryId: r.value, keys: c.input.key } as VellumEvent); }
    }
    for (const u of plan.update) {
      const entry = entryById.get(u.entryId); if (!entry) continue;
      const r = await updateEntry(u.entryId, {
        content: u.input.content, key: u.input.key, comment: u.input.comment, ...settingsToEntryFields(u.input.settings),
        extensions: extensionsFromEntry(entry, { content: u.input.content, key: u.input.key, hash: u.input.hash, category: u.input.category, source: 'memories', link: u.input.link, ownerChatId: chatId, vaultRole: 'summary' }),
      }, userId);
      if (r.ok) updated++;
    }
    for (const k of plan.keySync) {
      // user edited the entry's keys → pull them back to the chronicle memory
      linkEvents.push({ seq: nextSeqLocal(), turn: state.turns || 0, day: state.day || 0, src: 'system', kind: 'memory.link', id: k.memId, vaultEntryId: k.entryId, keys: k.keys } as VellumEvent);
    }
    for (const entryId of plan.remove) { const r = await deleteEntry(entryId, userId); if (r.ok) removed++; }
    if (linkEvents.length) { await append(chatId, linkEvents.filter((e) => (e as any).vaultEntryId)); invalidateIndex(chatId); }
    const changed = created || updated || removed;
    if (changed || plan.conflicts.length) spindle.log?.info?.(`[vellum_engine] chapter-vault: +${created} ~${updated} -${removed}, ${plan.conflicts.length} conflict(s) (mode ${mode})`);
    // push a fresh vault snapshot so an open Vault tab reflects the reconciled
    // summary/faction entries immediately (summarize/arc/re-summarize edit these
    // behind the user's back; without this the tab shows stale content).
    if (changed) { try { await vaultBroadcast(chatId, userId); } catch { /* best effort */ } }
    return { ok: true, created, updated, removed, conflicts: plan.conflicts.length };
  } catch (e) { spindle.log?.warn?.('[vellum_engine] chapter-vault: ' + ((e as Error)?.message ?? e)); return { ok: false, reason: 'error', created: 0, updated: 0, removed: 0 }; }
  finally {
    _chapterVaulting.delete(chatId);
    if (_chapterVaultAgain.delete(chatId)) void maybeChapterVault(chatId, userId);
  }
}

/** Finish non-canonical archive side effects without holding the summarizer
 * window open. The Chronicle append is the durability boundary; UI refresh,
 * Vault projection, and host message hiding are independently retryable
 * projections. A slow world-books or chat-mutation API must never make a
 * completed chapter/arc/book look stuck at its final phase. */
function continueArchiveMaintenance(chatId: string, userId: string | null, broadcast = true): void {
  if (broadcast) void broadcastState(chatId, userId).catch((e) => {
    spindle.log?.warn?.('[vellum_engine] archive state broadcast: ' + ((e as Error)?.message ?? e));
  });
  void maybeChapterVault(chatId, userId).catch((e) => {
    spindle.log?.warn?.('[vellum_engine] archive vault projection: ' + ((e as Error)?.message ?? e));
  });
  void syncArchiveHide(chatId).catch((e) => {
    spindle.log?.warn?.('[vellum_engine] archive hide sync: ' + ((e as Error)?.message ?? e));
  });
}

let _summarizing = new Set<string>();
const _summaryAbort = new Map<string, AbortController>();

type SummaryMode = 'auto' | 'manual' | 'resummarize' | 'pick' | 'arc' | 'book';

/** One real-time frontend stream per summarizer run. Text chunks are batched for
 * ~50ms so token streaming stays smooth without flooding the extension bridge. */
function beginSummaryRun(chatId: string, userId: string | null, mode: SummaryMode, total: number): {
  runId: string;
  options: SummaryRunOptions;
  finish: (ok: boolean, extra?: Record<string, unknown>) => void;
} | null {
  if (_summarizing.has(chatId)) return null;
  _summarizing.add(chatId);
  const controller = new AbortController();
  _summaryAbort.set(chatId, controller);
  const runId = `sum_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const target = userId ?? currentUser() ?? undefined;
  const sendStream = (payload: Record<string, unknown>): void => {
    try { spindle.sendToFrontend?.({ type: 'vellum_summarizer_stream', runId, mode, ...payload }, target); } catch { /* best effort */ }
  };
  let pending = '';
  let pendingMeta: Pick<SummaryProgress, 'phase' | 'kind' | 'sourceCount' | 'covers' | 'attempt'> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  const flushPending = (): void => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!pending || !pendingMeta) return;
    sendStream({ event: 'chunk', ...pendingMeta, delta: pending });
    pending = '';
    pendingMeta = null;
  };
  const report = (update: SummaryProgress): void => {
    if (update.status === 'chunk' && update.delta) {
      const same = pendingMeta?.phase === update.phase && pendingMeta?.attempt === update.attempt;
      if (!same) flushPending();
      pendingMeta = { phase: update.phase, kind: update.kind, sourceCount: update.sourceCount, covers: update.covers, attempt: update.attempt };
      pending += update.delta;
      if (pending.length >= 240) flushPending();
      else if (!timer) timer = setTimeout(flushPending, 50);
      return;
    }
    flushPending();
    sendStream({ event: 'progress', ...update });
  };
  sendStream({ event: 'start', total: Math.max(1, total), auto: mode === 'auto' });
  return {
    runId,
    options: { onProgress: report, signal: controller.signal },
    finish(ok, extra = {}): void {
      if (closed) return;
      closed = true;
      flushPending();
      sendStream({ event: ok && !controller.signal.aborted ? 'complete' : 'failed', cancelled: controller.signal.aborted, ...extra });
      if (_summaryAbort.get(chatId) === controller) {
        _summaryAbort.delete(chatId);
        _summarizing.delete(chatId);
      }
    },
  };
}

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
  const stream = beginSummaryRun(chatId, userId, 'auto', 1);
  if (!stream) return;
  let streamFinished = false;
  try {
    // tell the UI a pass actually STARTED (auto runs off the response path, so the
    // user otherwise has no signal it's happening). The manual button already
    // toasts on click; this covers the automatic cadence.
    spindle.sendToFrontend?.({ type: 'vellum_summarize_start', chatId, auto: true }, userId ?? currentUser() ?? undefined);
    const result = await summarizeWindow(state, userId, cfg.autoWindow, await chatNames(chatId, userId), cfg, stream.options);
    const evs = result.events;
    if (evs.length) {
      await append(chatId, evs);
      reportArchiveSaved(evs, result.tokens, stream.options);
      invalidateIndex(chatId);
      spindle.log?.info?.('[vellum_engine] auto-summarized a chapter');
    }
    stream.finish(true, { rounds: evs.length ? 1 : 0, tokens: result.tokens });
    streamFinished = true;
    if (evs.length) continueArchiveMaintenance(chatId, userId);
  } catch (e) {
    spindle.log?.warn?.('[vellum_engine] auto-summary: ' + ((e as Error)?.message ?? e));
    stream.finish(false, { reason: 'error' });
    streamFinished = true;
  } finally {
    if (!streamFinished) stream.finish(false, { reason: 'stopped' });
  }
}
const AUTO_SUMMARY_AT = 16; // compress the oldest 8 once 16 turn-memories accrue

async function boot(): Promise<void> {
  await restoreUser();
  await wireCapabilities(); // attach interceptor + generation fold if already granted
  spindle.log?.info?.('[vellum_engine] booted — event-log core online');
}
void boot();

/**
 * Build optional parameter injection for the interceptor (generation_parameters
 * capability). Conservative and opt-in per chat: returns {} when nothing to
 * inject, so the interceptor can skip adding the `parameters` key entirely when
 * the permission is absent or injection is disabled. This never surprises users.
 */
async function buildParamInjection(chatId: string, _state: ChronicleState): Promise<Record<string, unknown>> {
  // Gate on a per-chat opt-in var (default off). When disabled or unset, return
  // empty so the interceptor result shape is unchanged. Chat vars are cached, so
  // this read is cheap on the hot path.
  try {
    const optIn = await getChatVar(chatId, 'vellum_param_injection').catch(() => '');
    if (!optIn || optIn === '0' || optIn === 'false') return {};
    // When enabled, we could inject parameters here. For now, keep it empty as
    // a conservative no-op placeholder. Extensions or future VELLUM versions can
    // populate this with e.g. temperature nudges or response_format for keeping
    // the <vellum> block parseable. The infrastructure is wired; the injection
    // logic is opt-in and can be expanded later without touching the interceptor.
    return {};
  } catch {
    return {};
  }
}

/**
 * Build a scene query from the tail of the prompt the interceptor is assembling.
 * We pull the last few message contents so recall keys off what's happening NOW.
 * 
 * NEW: Sharpen the query using interceptor context flags (__isChatHistory,
 * __isWorldInfoEntry) to weight actual chat history over injected world-info. When
 * the flags are present, we prefer messages marked as chat history; when absent
 * (older host), behavior is identical to today (use all messages). Additive and
 * backward-compatible — never breaks existing behavior.
 */
function sceneQuery(messages: readonly any[], ctx?: { activatedWorldInfo?: readonly any[] }): string {
  try {
    if (!Array.isArray(messages) || !messages.length) return '';
    const flagged = messages.some((m) => m && (Object.prototype.hasOwnProperty.call(m, '__isChatHistory') || Object.prototype.hasOwnProperty.call(m, '__isWorldInfoEntry')));
    const history = flagged
      ? messages.filter((m) => m?.__isChatHistory === true && !m?.__isWorldInfoEntry)
      : messages.filter((m) => m?.role === 'user' || m?.role === 'assistant');
    const source = history.length ? history : messages;
    const joined = source.slice(-6).map((m: any) => stripProseRefreshCommand(typeof m?.content === 'string' ? m.content : '')).join(' ');
    // Preserve the newest prompt tail. Prefix slicing made an old long message
    // crowd out the latest user action, which is the strongest retrieval signal.
    return joined.length > 2400 ? joined.slice(-2400) : joined;
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

// --- permission-gated wiring --------------------------------------------
// The host rejects interceptor/generation registration when the permission
// isn't granted, and won't re-wire on its own when the user grants it later.
// So we attach each piece behind a capability check, idempotently, and re-run
// the whole attach pass whenever permissions change — no reload required.
let _interceptorDispose: (() => void) | null = null;
let _generationDispose: (() => void) | null = null;
let _wireChain: Promise<void> = Promise.resolve();

// Hard self-imposed deadline for the whole injection build on the prompt path.
// buildInjectionHybrid can call spindle.memories.chatMemory.warm (no timeout) and
// up to 4 sequential controller LLM calls; a slow host must never consume the
// full 15s interceptorTimeoutMs or hang the chat. On expiry we return the
// untouched messages. Kept well under the host budget.
const INTERCEPTOR_DEADLINE_MS = 5000;

function wireCapabilities(): Promise<void> {
  const next = _wireChain.catch(() => {}).then(() => wireCapabilitiesInner());
  _wireChain = next;
  return next;
}

async function wireCapabilitiesInner(): Promise<void> {
  const interceptorGranted = await has('interceptor');
  if (!interceptorGranted && _interceptorDispose) {
    try { _interceptorDispose(); } finally { _interceptorDispose = null; }
    spindle.log?.info?.('[vellum_engine] interceptor unwired after permission revoke');
  }
  // INTERCEPT: inject authoritative cast/bonds + scene-relevant recall.
  if (!_interceptorDispose && interceptorGranted && spindle.registerInterceptor) {
    try {
      // The host calls (messages, context) and expects the messages array back
      // (or { messages, breakdown }). We PREPEND our injection as a system
      // message rather than returning a custom shape — returning anything
      // without `.messages` breaks the host's `normalized.messages`.
      _interceptorDispose = spindle.registerInterceptor(async (messages, context: InterceptorContextDTO) => {
        const rawOut = Array.isArray(messages) ? messages : [];
        // Stateless one-turn command. It is computed outside the timed build so
        // a slow recall path can still fall back to the refresh governor.
        const refreshText = proseRefreshInjection(rawOut, stripScaffold);
        // Consume current and historical command lines from this transient
        // prompt copy. The saved conversation remains untouched.
        let out = scrubProseRefreshCommands(rawOut);
        // Race the entire injection build against a hard deadline. If the build
        // (host warm + up to 4 controller calls) stalls, we return the untouched
        // messages so a slow host API can never hang the chat or eat the budget.
        const build = (async () => {
          // Live permission gate: the host won't un-register us when the user
          // revokes `interceptor` mid-session, so honor revocation here by
          // returning the untouched messages (pass-through).
          if (!(await has('interceptor'))) return out;
          const uid = context.userId;
          rememberUser(uid);
          const chatId = context.chatId;
          if (!chatId) return out;
          const contractKey = userChatKey(uid, chatId);
          let activePreset: any = null;
          let turnContract: TurnContract | null = null;
          if (context.presetId && (await has('presets')) && spindle.presets?.get) {
            activePreset = await spindle.presets.get(context.presetId, uid);
            turnContract = resolveTurnContract(activePreset);
            // Dry-run previews must not replace the contract belonging to the
            // real generation. A later interceptor without presetId also must
            // not erase it before GENERATION_ENDED performs the state pass.
            if (!context.isDryRun) {
              _presetByUserChat.set(contractKey, context.presetId);
              if (turnContract) {
                _turnContractByUserChat.set(contractKey, turnContract);
                await setChatVar(chatId, TURN_CONTRACT_CHAT_VAR, JSON.stringify({ presetId: context.presetId, contract: turnContract }));
              } else {
                _turnContractByUserChat.delete(contractKey);
                await setChatVar(chatId, TURN_CONTRACT_CHAT_VAR, '');
              }
            }
          }
          const state = await loadState(chatId);
          if (activePreset && turnContract?.argent) {
            const blocks = (activePreset.prompt_order ?? activePreset.blocks ?? []) as any[];
            const values = (activePreset.metadata?.promptVariables ?? {}) as any;
            let capsule = compileArgentPolicy(blocks, values);
            const newest = [...rawOut].reverse().find(m => m.__isChatHistory && m.role === 'user');
            const explicit = typeof newest?.content === 'string' && /(?:\(\(worldgen\)\)|OOC:\s*worldgen)/i.test(newest.content);
            if (turnContract.worldgen && turnContract.state && (!state.genesisTurn || explicit)) capsule = 'Genesis is eligible this turn: establish a bounded world frame in completed prose. Facts remain provisional until confirmed.\n' + capsule;
            // Some host builds strip HTML comments before extension
            // interception. The selected ARGENT preset is sufficient authority
            // to append its final effective policy even when source markers are
            // gone; marker-based removal still runs whenever they survive.
            out = applyArgentPolicy(out, capsule, true);
            // The compiler follows the actual main connection, not an unrelated default.
            if (!context.isDryRun) await setChatVar(chatId, 'vellum_compiler_connection', context.mainDispatch?.descriptor?.connectionId ?? '');
          }
          if (!state.turns && !Object.keys(state.cast).length) {
            if (!refreshText) return out;
            const rec = recordInjection(chatId, 0, refreshText, [], { source: 'prose-refresh' });
            try { spindle.sendToFrontend?.({ type: 'vellum_injection_push', chatId, record: rec }, uid); } catch { /* best effort */ }
            return { messages: [{ role: 'system', content: refreshText }, ...out], breakdown: [{ messageIndex: 0, name: 'VELLUM Prose Refresh' }] };
          }
          const present = state.scene.present ?? [];
          const nameOf = (id: string): string => state.cast[id]?.name ?? id;
          const version = logVersion(chatId);
          // Fetch every INDEPENDENT per-chat input in parallel (chat vars are
          // cached, but this also removes serialized await-chains on the hot
          // pre-response path). The traversal-mode read gates the controller/
          // precompute choice, so it's awaited first; everything else overlaps.
          const [tmodeRaw, traversalAxis, caps, directives, locks, calText, nextSceneText, limitsText, logEvents, livingRaw, lastSimRaw, blockExampleRaw] = await Promise.all([
            getChatVar(chatId, 'vellum_traversal_mode').catch(() => ''),
            getChatVar(chatId, 'vellum_traversal_axis').then(readAxis).catch(() => 'temporal' as const),
            budgetCaps(chatId),
            readDirectives(chatId),
            readLocks(chatId),
            calendarInjection(chatId, state.day || 0, state),
            nextSceneInjection(chatId, state),
            hardLimitsInjection(chatId),
            loadLog(chatId).then((l) => l.events).catch(() => [] as VellumEvent[]),
            getChatVar(chatId, 'vellum_living_clock').catch(() => ''),
            getChatVar(chatId, 'vellum_sim_day').catch(() => ''),
            getChatVar(chatId, 'vellum_block_example').catch(() => ''),
          ]);
          const tmode = tmodeRaw === 'tree' ? 'tree' : 'flat';
          // Controller-guided traversal (variant A), opt-in per chat. Builds a
          // CallModel backed by a cheap, timeout-bounded controller generation;
          // buildInjectionHybrid falls back to the deterministic path on any miss.
          // Selection is made against the current prompt. Reusing a ranking made
          // after the previous turn can miss the newest topic entirely.
          const pre = null;
          // The refresh command should be immediate and reliable. Use the normal
          // deterministic recall path for this one turn instead of spending the
          // interceptor deadline on optional controller traversal.
          const controller = refreshText ? undefined : await traversalController(chatId, uid, tmode === 'tree' ? 800 : 1500);
          // EXPERIMENTAL: Interceptor "halt generation momentarily" (Item 6). Gated
          // behind a per-chat opt-in var (vellum_halt_on_warm, default off) AND a
          // short cap (1500ms) to avoid user-perceived stalls. When disabled, this
          // block is a no-op and the interceptor proceeds immediately. When enabled,
          // it could pause generation to finish a critical precompute/warm, but that
          // logic is opt-in and conservative. The infrastructure is wired; the halt
          // implementation awaits host API confirmation and real-world latency testing.
          // For now, this is a placeholder that never halts (conservative no-op).
          const haltEnabled = false; // TODO: read getChatVar(chatId, 'vellum_halt_on_warm') and gate strictly
          if (haltEnabled) {
            // Future: implement bounded halt here using host's documented halt/resume
            // mechanism from context. Always wrap in withTimeout(1500ms) so a stalled
            // warm can never wedge the turn. Log each halt via spindle.log?.info?.
            // Ship Items 1–5 first; land Item 6 last, behind its opt-in.
          }
          const inj = await buildInjectionHybrid(chatId, state, sceneQuery(out, { activatedWorldInfo: context?.activatedWorldInfo }), uid, 1, version, controller, tmode, pre, traversalAxis);
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
          // Block example — when enabled, inject the previous turn's actual
          // <vellum> block as a worked example so the model sees a concrete,
          // story-specific instance of the expected output format. Placed LAST
          // in the injection so it sits closest to the generation point, where
          // recency bias is strongest. Off by default (opt-in via Actions menu)
          // because it costs ~400–700 tokens per turn.
          let blockExampleText = '';
          if ((await activeTurnContract(chatId, uid))?.stateCompiler !== 'engine' && (blockExampleRaw === '1' || blockExampleRaw === 'true' || blockExampleRaw === 'on')) {
            try {
              const lastAsst = await latestAssistantContent(chatId);
              if (lastAsst.ok && lastAsst.value) {
                const raw = extractVellumBlock(lastAsst.value);
                if (raw) {
                  // Cap at 2400 chars: a legitimately large block (many NPCs,
                  // full delta) can run ~2000 chars; 2400 avoids truncating it
                  // while capping a pathologically verbose model.
                  const capped = raw.length > 2400 ? raw.slice(0, 2400) + '\n…' : raw;
                  blockExampleText = '[BLOCK EXAMPLE — your previous turn\'s state block, shown so you can match its structure exactly. Reproduce the same format in your reply.]\n' + capped;
                }
              }
            } catch { /* best effort — never block generation */ }
          }
          // Refresh goes last inside VELLUM's system injection so it is the
          // freshest style instruction while every continuity/output contract
          // above it remains binding.
          const injText = [limitsText, inj.text, locText, driftText, moodText, offText, livingText, lockText, plantText, calText, spineText, nextSceneText, dirText, blockExampleText, refreshText].filter(Boolean).join('\n\n');
          if (!injText) return out;
          const rec = recordInjection(chatId, state.turns || 0, injText, inj.recallIds, { source: inj.source, trace: inj.trace ?? inj.treeTrace });
          // Fix 11 — live retrieval feed: push the record so the Injection tab
          // streams in real time instead of only on manual Refresh.
          try { spindle.sendToFrontend?.({ type: 'vellum_injection_push', chatId, record: rec }, uid); } catch { /* best effort */ }
          const head = { role: 'system', content: injText };
          const result: any = { messages: [head, ...out], breakdown: [{ messageIndex: 0, name: 'VELLUM Recall' }] };
          // INTERCEPTOR PARAMETER INJECTION (generation_parameters capability):
          // Optionally inject generation parameters (e.g. nudging temperature or
          // attaching a response_format for the user-facing turn so the <vellum>
          // state block stays parseable). Gate strictly on generation_parameters
          // so the return shape is byte-for-byte identical to today when absent.
          if (await has('generation_parameters')) {
            const injected = await buildParamInjection(chatId, state);
            if (injected && Object.keys(injected).length) result.parameters = injected;
          }
          return result;
        })();
        try {
          const result = await withTimeout(build, INTERCEPTOR_DEADLINE_MS, 'interceptor');
          const assembled = (Array.isArray(result) ? result : result.messages) as import('lumiverse-spindle-types').LlmMessageDTO[];
          if (context.chatId && spindle.tokens?.countMessages) {
            const model = context.mainDispatch?.descriptor?.model;
            void Promise.all([
              spindle.tokens.countMessages(assembled, { userId: context.userId, ...(model ? { model } : {}) }),
              spindle.tokens.countMessages(assembled.filter(m => m.__isChatHistory), { userId: context.userId, ...(model ? { model } : {}) }),
            ]).then(async ([total, history]) => {
              const report = { ...total, input: total.total_tokens, history: history.total_tokens, standing: Math.max(0, total.total_tokens - history.total_tokens), capturedAt: Date.now() };
              await setChatVar(context.chatId, 'vellum_assembled_budget', JSON.stringify(report));
              spindle.sendToFrontend?.({ type: 'vellum_assembled_budget', report }, context.userId);
            }).catch(e => spindle.log?.warn?.('[vellum_engine] token measurement unavailable: ' + String(e)));
          }
          return result;
        } catch (e) {
          // Timeout OR any build error — never block the chat. A user-requested
          // prose refresh still gets its lightweight governor even if recall
          // failed; otherwise ship messages byte-for-byte untouched.
          spindle.log?.warn?.('[vellum_engine] interceptor: ' + ((e as Error)?.message ?? e));
          if (refreshText) return { messages: [{ role: 'system', content: refreshText }, ...out], breakdown: [{ messageIndex: 0, name: 'VELLUM Prose Refresh' }] };
          return out;
        }
      }, 120);
      spindle.log?.info?.('[vellum_engine] interceptor wired');
    } catch (e) { spindle.log?.warn?.('[vellum_engine] interceptor wiring deferred: ' + ((e as Error)?.message ?? e)); }
  }

  const generationGranted = await has('generation');
  if (!generationGranted && _generationDispose) {
    try { _generationDispose(); } finally { _generationDispose = null; }
    spindle.log?.info?.('[vellum_engine] generation fold unwired after permission revoke');
  }

  // FOLD on generation end (requires the generation permission to subscribe).
  if (!_generationDispose && generationGranted) {
    try {
      _generationDispose = spindle.on('GENERATION_ENDED', async (p: GenerationEndedPayloadDTO, userId?: string) => {
        // Failed generations have no committed assistant message to fold.
        if (p.error || !p.messageId) return;
        if (!userId) { spindle.log?.warn?.('[vellum_engine] generation event missing userId; refusing ambiguous routing.'); return; }
        rememberUser(userId);
        const chatId = p.chatId || (await activeChatId(userId));
        if (!chatId) return;
        void foldChat(chatId, userId).catch((e) => {
          spindle.log?.warn?.('[vellum_engine] generation fold failed: ' + ((e as Error)?.message ?? e));
          spindle.sendToFrontend({ type: 'vellum_toast', level: 'warning', msg: 'VELLUM could not save this tracker update. Use Refresh after checking extension storage.' }, userId);
        });
      });
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
  _vaultSyncJobs.delete(chatId);
  _chapterVaulting.delete(chatId);
  _chapterVaultAgain.delete(chatId);
  try { _summaryAbort.get(chatId)?.abort(); } catch { /* ignore */ }
  _summaryAbort.delete(chatId);
  _summarizing.delete(chatId);
  _blockWarnByChat.delete(chatId);
  for (const key of _presetByUserChat.keys()) if (key.endsWith('\u0000' + chatId)) _presetByUserChat.delete(key);
  for (const key of _turnContractByUserChat.keys()) if (key.endsWith('\u0000' + chatId)) _turnContractByUserChat.delete(key);
  // clear this chat's block-repair attempt keys (keyed by chatId\0messageId)
  const rp = chatId + '\u0000';
  for (const k of _blockRepairAttempts) if (k.startsWith(rp)) _blockRepairAttempts.delete(k);
  for (const [key, timer] of _reconcileTimers) {
    if (key.endsWith('\u0000' + chatId)) { clearTimeout(timer); _reconcileTimers.delete(key); }
  }
}

const _activeChatByUser = new Map<string, string>();
const _reconcileTimers = new Map<string, ReturnType<typeof setTimeout>>();

function eventChatId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, any>;
  const value = p.chatId ?? p.chat_id ?? p.forkedChatId ?? p.message?.chat_id ?? p.chat?.id;
  return typeof value === 'string' && value ? value : null;
}

/** Coalesce edit/delete/swipe bursts into one authoritative fold. The fold path
 * compares every stored complete-content signature, rolls back at the first
 * divergence, and handles message-count shrink after deletion. */
function scheduleReconcile(chatId: string | null, userId?: string): void {
  if (!chatId || !userId) {
    if (chatId) spindle.log?.warn?.('[vellum_engine] mutation event missing userId; refusing ambiguous routing for ' + chatId + '.');
    return;
  }
  const key = userId + '\u0000' + chatId;
  const previous = _reconcileTimers.get(key);
  if (previous) clearTimeout(previous);
  _reconcileTimers.set(key, setTimeout(() => {
    _reconcileTimers.delete(key);
    lastSigByChat.delete(chatId);
    void foldChat(chatId, userId).catch((e) => {
      spindle.log?.warn?.('[vellum_engine] mutation reconcile failed: ' + ((e as Error)?.message ?? e));
      spindle.sendToFrontend({ type: 'vellum_toast', level: 'warning', msg: 'VELLUM could not reconcile this edited turn. Use Refresh after checking extension storage.' }, userId);
    });
  }, 100));
}

const _lifecycleDisposers: Array<() => void> = [];
try {
  _lifecycleDisposers.push(spindle.on('PERMISSION_CHANGED', () => {
    invalidatePermissions();
    invalidateConnCache();
    void wireCapabilities();
  }));
  _lifecycleDisposers.push(spindle.on('CHAT_SWITCHED', (raw: unknown, userId?: string) => {
    const p = raw as ChatSwitchedPayloadDTO;
    if (userId) rememberUser(userId);
    invalidateChatCaps(); invalidateChatVars(); invalidateConnCache(userId);
    const next = p.chatId;
    const userKey = userId ?? '__single_user__';
    const previous = _activeChatByUser.get(userKey) ?? null;
    if (previous && previous !== next) pruneChatState(previous);
    if (next) { _activeChatByUser.set(userKey, next); invalidate(next); }
    else _activeChatByUser.delete(userKey);
    if (userId) spindle.sendToFrontend({ type: 'vellum_preview_chat_resolved', chatId: next ?? '' }, userId);
  }));
  for (const event of ['MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'SWIPE_EDITED'] as const) {
    _lifecycleDisposers.push(spindle.on(event, (payload: unknown, userId?: string) => {
      scheduleReconcile(eventChatId(payload), userId);
    }));
  }
  _lifecycleDisposers.push(spindle.on('CHAT_FORKED', (payload: ChatForkedPayloadDTO, userId?: string) => {
    invalidate(payload.forkedChatId);
    scheduleReconcile(payload.forkedChatId, userId);
  }));
  _lifecycleDisposers.push(spindle.on('EXTENSION_UNLOADED', () => {
    try { _interceptorDispose?.(); } finally { _interceptorDispose = null; }
    try { _generationDispose?.(); } finally { _generationDispose = null; }
    for (const timer of _reconcileTimers.values()) clearTimeout(timer);
    _reconcileTimers.clear();
    for (const dispose of _lifecycleDisposers.splice(0)) { try { dispose(); } catch { /* host cleanup is best effort */ } }
  }));
} catch (e) {
  spindle.log?.warn?.('[vellum_engine] lifecycle wiring failed: ' + ((e as Error)?.message ?? e));
}

// --- theme persistence ----------------------------------------------------
const THEME_PATH = 'vellum/theme.json';
const PREFS_PATH = 'vellum/prefs.json';

function legacyClaimPath(path: string): string {
  return 'vellum/migration-1.1.6-' + path.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.json';
}

const _personalClaimQueues = new Map<string, Promise<unknown>>();

/** Serialize each one-time shared-to-personal migration so concurrent operator
 * users cannot both claim the old singleton value before its marker is written. */
function claimLegacyPersonal(path: string, userId: string): Promise<string | null> {
  const previous = _personalClaimQueues.get(path) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(async () => {
    if (await spindle.userStorage.exists(path, userId)) return spindle.userStorage.read(path, userId);
    const marker = legacyClaimPath(path);
    if ((await spindle.storage.exists(marker)) || !(await spindle.storage.exists(path))) return null;
    const legacy = await spindle.storage.read(path);
    await spindle.userStorage.write(path, legacy, userId);
    await spindle.storage.write(marker, JSON.stringify({ migratedAt: Date.now() }));
    return legacy;
  });
  _personalClaimQueues.set(path, run.then(() => undefined, () => undefined));
  return run;
}

/** Read personal UI data from isolated storage. The first authenticated user on
 * an upgraded personal install may claim the old shared value once; a marker
 * prevents that legacy blob from being copied into every operator user. */
async function readPersonalFile(path: string, userId: string | null): Promise<string | null> {
  const resolved = requireUser(userId);
  if (!resolved.ok) return null;
  const uid = resolved.value;
  try {
    if (await spindle.userStorage.exists(path, uid)) return await spindle.userStorage.read(path, uid);
    return await claimLegacyPersonal(path, uid);
  } catch (e) {
    spindle.log?.warn?.('[vellum_engine] personal storage read failed for ' + path + ': ' + ((e as Error)?.message ?? e));
  }
  return null;
}

async function writePersonalFile(path: string, json: string, userId: string): Promise<void> {
  await spindle.userStorage.write(path, json, userId);
}

async function readTheme(userId: string | null): Promise<string | null> { return readPersonalFile(THEME_PATH, userId); }
async function writeTheme(json: string, userId: string): Promise<void> { return writePersonalFile(THEME_PATH, json, userId); }

// --- window-prefs persistence ---------------------------------------------
async function readPrefs(userId: string | null): Promise<string | null> { return readPersonalFile(PREFS_PATH, userId); }
async function writePrefs(json: string, userId: string): Promise<void> { return writePersonalFile(PREFS_PATH, json, userId); }

// --- frontend dispatch table ---------------------------------------------
// Each entry is isolated; a throw in one handler can't affect the others.
type Handler = (payload: any, userId: string) => Promise<void> | void;
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
    // Three distinct operations share this handler:
    //   full (default)  — RECONSTRUCT from the transcript: clear the derived log,
    //                      then re-fold every turn (cast/relations/knowledge/
    //                      journal + per-turn memories). Use to recover after loss.
    //   messagesOnly    — ADDITIVE backfill: do NOT clear anything. Just capture
    //                      the per-turn message memories for any turn missing one,
    //                      leaving all existing cast/relations/knowledge/secrets/
    //                      journal untouched. (memory.record dedups by id.)
    //   cleanTurns      — NON-DESTRUCTIVE re-clean: re-run turnGist/stripScaffold
    //                      over EXISTING turn memories and rewrite (memory.edit)
    //                      only those whose cleaned text changed. Fixes past turns
    //                      that leaked reverie/vellum/spk scaffold, WITHOUT touching
    //                      cast/relations/knowledge/journal or re-folding anything.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) { spindle.sendToFrontend?.({ type: 'vellum_rebuild_done', ok: false, reason: 'no_active_chat' }, uid); return; }
    const messagesOnly = !!p?.messagesOnly;
    const cleanTurns = !!p?.cleanTurns;

    // --- cleanTurns: targeted, non-destructive re-clean of existing turn memories ---
    if (cleanTurns) {
      try {
        const msgs = await allTurnContents(chatId);
        const names = await chatNames(chatId, uid);
        const prior = await loadState(chatId);
        const turnMems = prior.memories.filter((m) => m.tier === 'turn');
        const evs: VellumEvent[] = [];
        for (const m of turnMems) {
          // recover the turn number from the memory id (turn_<chat6>_<n>) so we
          // re-clean from the RAW transcript, not the already-(partially-)stripped
          // stored text — that catches leaks the old regex missed entirely.
          const tn = Number(String(m.id).split('_').pop());
          const raw = Number.isFinite(tn) ? (msgs[tn - 1] ?? '').trim() : '';
          const cleaned = raw ? turnGist(raw, names) : turnGist(m.text, names);
          if (cleaned && cleaned !== m.text) {
            evs.push({ seq: nextSeqLocal(), turn: m.turn, day: 0, src: 'system', kind: 'memory.edit', id: m.id, text: cleaned } as VellumEvent);
          }
        }
        if (evs.length) { await append(chatId, evs); invalidateIndex(chatId); await broadcastState(chatId, uid); }
        spindle.sendToFrontend?.({ type: 'vellum_rebuild_done', ok: true, cleaned: evs.length, cleanTurns: true }, uid);
        spindle.log?.info?.(`[vellum_engine] re-cleaned ${evs.length} turn memor${evs.length === 1 ? 'y' : 'ies'} (non-destructive)`);
      } catch (e) {
        spindle.sendToFrontend?.({ type: 'vellum_rebuild_done', ok: false, reason: (e as Error)?.message ?? 'error' }, uid);
      }
      return;
    }

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
    // Deleting or editing a chapter/arc/book memory must reconcile its mirrored Vault.
    // entry (drop orphans; re-project edited detail/keys).
    if (p.cmd === 'memory_delete' || p.cmd === 'memory_edit') {
      void maybeChapterVault(chatId, uid);
      await syncArchiveHide(chatId);
    }
  },
  vellum_summarize: async (p, uid) => {
    // manual "summarize past turns" — compress as many full windows as exist.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const cfg = await summarizerCfg(chatId);
    const state = await loadState(chatId);
    const win = Math.max(cfg.minWindow, Math.min(4, cfg.autoWindow)); // manual uses a smaller window so short chats still fold
    const total = Math.max(1, Math.floor(state.memories.filter((m) => m.tier === 'turn').length / win));
    const stream = beginSummaryRun(chatId, uid, 'manual', total);
    if (!stream) { spindle.sendToFrontend?.({ type: 'vellum_summarize_done', ok: false, reason: 'busy' }, uid); return; }
    try {
      const { rounds, tokens } = await summarizeAll(state, uid, (evs) => append(chatId, evs), win, await chatNames(chatId, uid), (done, roundTotal, tokensSoFar) => {
        invalidateIndex(chatId);
        void broadcastState(chatId, uid).catch((e) => spindle.log?.warn?.('[vellum_engine] summary round broadcast: ' + ((e as Error)?.message ?? e)));
        spindle.sendToFrontend?.({ type: 'vellum_summarize_progress', done, total: roundTotal, tokens: tokensSoFar }, uid);
      }, cfg, stream.options);
      invalidateIndex(chatId);
      const cancelled = !!stream.options.signal?.aborted;
      stream.finish(!cancelled, { rounds, tokens, ...(cancelled ? { reason: 'cancelled' } : {}) });
      spindle.sendToFrontend?.({ type: 'vellum_summarize_done', ok: !cancelled, ...(cancelled ? { reason: 'cancelled' } : {}), rounds, tokens }, uid);
      if (rounds) continueArchiveMaintenance(chatId, uid);
    } catch (e) {
      const reason = (e as Error)?.message ?? String(e);
      stream.finish(false, { reason });
      spindle.log?.warn?.('[vellum_engine] summarize: ' + reason);
      spindle.sendToFrontend?.({ type: 'vellum_summarize_done', ok: false, reason }, uid);
    }
  },
  vellum_resummarize: async (p, uid) => {
    // Rebuild ALL chapter summaries with the current pipeline. Drop every chapter
    // memory (the reducer restores each chapter's subsumed turn-memories), then
    // re-run summarizeAll over the restored turns. Fixes old/low-quality gists.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) { spindle.sendToFrontend?.({ type: 'vellum_resummarize_done', ok: false, reason: 'no_active_chat' }, uid); return; }
    if (!(await has('generation'))) { spindle.sendToFrontend?.({ type: 'vellum_resummarize_done', ok: false, reason: 'no_generation' }, uid); return; }
    let stream: ReturnType<typeof beginSummaryRun> = null;
    try {
      let state = await loadState(chatId);
      const chapters = state.memories.filter((m) => m.tier === 'chapter');
      stream = beginSummaryRun(chatId, uid, 'resummarize', Math.max(1, chapters.length));
      if (!stream) { spindle.sendToFrontend?.({ type: 'vellum_resummarize_done', ok: false, reason: 'busy' }, uid); return; }
      if (chapters.length) {
        const drops = chapters.map((m) => ({ seq: nextSeqLocal(), turn: state.turns || 0, day: state.day || 0, src: 'user', kind: 'memory.drop', id: m.id } as VellumEvent));
        state = await append(chatId, drops); // reducer restores the subsumed turns
        invalidateIndex(chatId);
        await broadcastState(chatId, uid);
      }
      const cfg = await summarizerCfg(chatId);
      const win = Math.max(cfg.minWindow, Math.min(4, cfg.autoWindow));
      const { rounds, tokens } = await summarizeAll(state, uid, (evs) => append(chatId, evs), win, await chatNames(chatId, uid), (done, total, tokensSoFar) => {
        invalidateIndex(chatId);
        void broadcastState(chatId, uid).catch((e) => spindle.log?.warn?.('[vellum_engine] resummary round broadcast: ' + ((e as Error)?.message ?? e)));
        spindle.sendToFrontend?.({ type: 'vellum_summarize_progress', done, total, tokens: tokensSoFar }, uid);
      }, cfg, stream.options);
      invalidateIndex(chatId);
      const cancelled = !!stream.options.signal?.aborted;
      stream.finish(!cancelled, { rounds, tokens, ...(cancelled ? { reason: 'cancelled' } : {}) });
      spindle.sendToFrontend?.({ type: 'vellum_resummarize_done', ok: !cancelled, ...(cancelled ? { reason: 'cancelled' } : {}), rounds, tokens }, uid);
      if (rounds) continueArchiveMaintenance(chatId, uid);
    } catch (e) {
      const reason = (e as Error)?.message ?? String(e);
      stream?.finish(false, { reason });
      spindle.log?.warn?.('[vellum_engine] resummarize: ' + reason);
      spindle.sendToFrontend?.({ type: 'vellum_resummarize_done', ok: false, reason }, uid);
    }
  },
  vellum_summarize_cancel: async (p, uid) => {
    const chatId = p?.chatId || (await activeChatId(uid));
    const controller = chatId ? _summaryAbort.get(chatId) : undefined;
    if (controller) controller.abort();
    spindle.sendToFrontend?.({ type: 'vellum_summarize_cancelled', ok: !!controller }, uid);
  },
  vellum_get_summarizer: async (p, uid) => {
    // hand the UI the current config + the built-in default prompts (so the
    // editor can show them and offer a one-click reset).
    const chatId = p?.chatId || (await activeChatId(uid));
    const cfg = chatId ? await summarizerCfg(chatId) : DEFAULT_CFG;
    spindle.sendToFrontend?.({ type: 'vellum_summarizer_state', cfg, defaults: { chapter: DEFAULT_CHAPTER_PROMPT, arc: DEFAULT_ARC_PROMPT, book: DEFAULT_BOOK_PROMPT, gist: DEFAULT_GIST_PROMPT } }, uid);
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
    const stream = beginSummaryRun(chatId, uid, 'pick', 1);
    if (!stream) { spindle.sendToFrontend?.({ type: 'vellum_summarize_done', ok: false, reason: 'busy' }, uid); return; }
    try {
      const { events, tokens } = await summarizeFromPlan(state, uid, plan, await chatNames(chatId, uid), cfg, 'chapter', stream.options);
      if (events.length) { await append(chatId, events); reportArchiveSaved(events, tokens, stream.options); }
      invalidateIndex(chatId);
      const cancelled = !!stream.options.signal?.aborted;
      stream.finish(!cancelled, { rounds: events.length ? 1 : 0, tokens, ...(cancelled ? { reason: 'cancelled' } : {}) });
      spindle.sendToFrontend?.({ type: 'vellum_summarize_done', ok: !cancelled, ...(cancelled ? { reason: 'cancelled' } : {}), rounds: events.length ? 1 : 0, tokens, picked: plan.sourceIds.length }, uid);
      if (events.length) continueArchiveMaintenance(chatId, uid);
    } catch (e) {
      const reason = (e as Error)?.message ?? String(e);
      stream.finish(false, { reason });
      spindle.log?.warn?.('[vellum_engine] summarize pick: ' + reason);
      spindle.sendToFrontend?.({ type: 'vellum_summarize_done', ok: false, reason }, uid);
    }
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
    const stream = beginSummaryRun(chatId, uid, 'arc', 1);
    if (!stream) { spindle.sendToFrontend?.({ type: 'vellum_arc_done', ok: false, reason: 'busy' }, uid); return; }
    try {
      const { events, tokens } = await summarizeFromPlan(state, uid, plan, await chatNames(chatId, uid), cfg, 'arc', stream.options);
      if (events.length) { await append(chatId, events); reportArchiveSaved(events, tokens, stream.options); }
      invalidateIndex(chatId);
      const cancelled = !!stream.options.signal?.aborted;
      stream.finish(!cancelled, { rounds: events.length ? 1 : 0, tokens, ...(cancelled ? { reason: 'cancelled' } : {}) });
      spindle.sendToFrontend?.({ type: 'vellum_arc_done', ok: !cancelled, ...(cancelled ? { reason: 'cancelled' } : {}), rounds: events.length ? 1 : 0, tokens, bound: plan.sourceIds.length }, uid);
      if (events.length) continueArchiveMaintenance(chatId, uid);
    } catch (e) {
      const reason = (e as Error)?.message ?? String(e);
      stream.finish(false, { reason });
      spindle.log?.warn?.('[vellum_engine] summarize arc: ' + reason);
      spindle.sendToFrontend?.({ type: 'vellum_arc_done', ok: false, reason }, uid);
    }
  },
  vellum_book: async (p, uid) => {
    // Fold ARC memories into a BOOK. The new record keeps the complete recursive
    // ancestry, so deleting it restores arcs and every underlying chapter/turn.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) { spindle.sendToFrontend?.({ type: 'vellum_book_done', ok: false, reason: 'no_active_chat' }, uid); return; }
    if (!(await has('generation'))) { spindle.sendToFrontend?.({ type: 'vellum_book_done', ok: false, reason: 'no_generation' }, uid); return; }
    const cfg = await summarizerCfg(chatId);
    const state = await loadState(chatId);
    const ids: string[] = Array.isArray(p?.ids) ? p.ids.map(String) : [];
    const plan = ids.length ? planBookFrom(state, ids, 2) : planBook(state, 2, 1);
    if (!plan) { spindle.sendToFrontend?.({ type: 'vellum_book_done', ok: false, reason: 'too_few' }, uid); return; }
    const stream = beginSummaryRun(chatId, uid, 'book', 1);
    if (!stream) { spindle.sendToFrontend?.({ type: 'vellum_book_done', ok: false, reason: 'busy' }, uid); return; }
    try {
      const { events, tokens } = await summarizeFromPlan(state, uid, plan, await chatNames(chatId, uid), cfg, 'book', stream.options);
      if (events.length) { await append(chatId, events); reportArchiveSaved(events, tokens, stream.options); }
      invalidateIndex(chatId);
      const cancelled = !!stream.options.signal?.aborted;
      stream.finish(!cancelled, { rounds: events.length ? 1 : 0, tokens, ...(cancelled ? { reason: 'cancelled' } : {}) });
      spindle.sendToFrontend?.({ type: 'vellum_book_done', ok: !cancelled, ...(cancelled ? { reason: 'cancelled' } : {}), rounds: events.length ? 1 : 0, tokens, bound: plan.sourceIds.length }, uid);
      if (events.length) continueArchiveMaintenance(chatId, uid);
    } catch (e) {
      const reason = (e as Error)?.message ?? String(e);
      stream.finish(false, { reason });
      spindle.log?.warn?.('[vellum_engine] summarize book: ' + reason);
      spindle.sendToFrontend?.({ type: 'vellum_book_done', ok: false, reason }, uid);
    }
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
    // user create/edit: source:'user' (drops the auto icon on edit). New places
    // default to unpinned (recency-keyed); the user pins to force always-inject.
    await append(chatId, [{ seq: nextSeqLocal(), turn: state.turns || 0, day: 0, src: 'user', kind: 'location.set', id, name, ...(p?.note !== undefined ? { note: String(p.note).slice(0, 200) } : {}), ...(p?.parent !== undefined ? { parent: String(p.parent) } : {}), source: 'user' } as VellumEvent]);
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
    // pin (pinned:true → always injected) or unpin (pinned:false → recency-keyed).
    // Toggling pin NEVER changes provenance — a model place stays source:'auto'
    // (so unpinning restores its auto icon), a user place stays source:'user'.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId || !p?.id) return;
    const id = String(p.id);
    const state = await loadState(chatId);
    const cur = (state.locations ?? []).find((l) => l.id === id);
    if (!cur) return;
    const pinned = p?.pinned === undefined ? cur.pinned !== true : !!p.pinned; // toggle when unspecified
    await append(chatId, [{ seq: nextSeqLocal(), turn: state.turns || 0, day: 0, src: 'user', kind: 'location.set', id, name: cur.name, pinned } as VellumEvent]);
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
    const categories = await loadCategories(uid);
    if (!(await hasVault())) { spindle.sendToFrontend?.({ type: 'vellum_vault', ok: false, reason: 'no_permission', categories, books: [], attached: [], activated: [], suggestions: [] }, uid); return; }
    await vaultBroadcast(chatId ?? '', uid);
    if (chatId && (await getChatVar(chatId, 'vellum_vault_dirty')) === '1') void maybeVaultSync(chatId, uid);
  },
  vellum_vault_category: async (p, uid) => {
    // upsert/delete a category. payload.op = 'upsert'|'delete'
    if (p?.op === 'delete' && p?.id) await deleteCategory(String(p.id), uid);
    else if (p?.cat) {
      const c = p.cat as Partial<VaultCategory>;
      const id = c.id || ('custom_' + Date.now().toString(36));
      const base = c.builtin ? null : customCategory(id, String(c.label || 'Custom'), String(c.glyph || '\u2727'), String(c.color || '#cdbfa0'));
      await upsertCategory({ ...(base ?? {}), ...(c as VaultCategory), id }, uid);
    }
    const categories = await loadCategories(uid);
    spindle.sendToFrontend?.({ type: 'vellum_vault_categories', categories }, uid);
    const chatId = p?.chatId || (await activeChatId(uid));
    if (chatId) void maybeVaultSync(chatId, uid);
  },
  vellum_vault_op: async (p, uid) => {
    // book + entry CRUD. payload.op decides.
    const chatId = p?.chatId || (await activeChatId(uid));
    const done = (ok: boolean, extra?: Record<string, unknown>) => spindle.sendToFrontend?.({ type: 'vellum_vault_done', op: p?.op, ok, ...(extra || {}) }, uid);
    if (!(await hasVault())) { done(false, { reason: 'no_permission' }); return; }
    try {
      const cats = await loadCategories(uid);
      if (p.op === 'book_create') { const r = await createBook(String(p.name || 'New Lorebook'), String(p.description || ''), uid, chatId ?? '', 'manual'); if (r.ok && p.attach && chatId) await setBookAttached(chatId, r.value, true, uid); done(r.ok, r.ok ? { bookId: r.value } : { reason: r.error }); }
      else if (p.op === 'book_update') { const r = await updateBook(String(p.bookId), String(p.name || ''), p.description, uid); done(r.ok, r.ok ? {} : { reason: r.error }); }
      else if (p.op === 'book_attach') { if (!chatId) { done(false, { reason: 'no_active_chat' }); return; } const ok = await setBookAttached(chatId, String(p.bookId), !!p.attach, uid); done(ok); }
      else if (p.op === 'book_claim') {
        if (!chatId) { done(false, { reason: 'no_active_chat' }); return; }
        const snap = await vaultSnapshot(chatId, uid);
        if (!snap.complete) { done(false, { reason: 'incomplete_snapshot' }); return; }
        const r = await adoptBookForChat(snap, String(p.bookId), chatId, uid);
        const failed = r.ok ? r.value.entriesFailed : 0;
        done(r.ok && failed === 0, r.ok ? { books: 1, entries: r.value.entriesClaimed, skipped: r.value.entriesSkipped, failed, ...(failed ? { reason: 'entry_claim_failed' } : {}) } : { reason: r.error });
      }
      else if (p.op === 'books_claim_attached') {
        if (!chatId) { done(false, { reason: 'no_active_chat' }); return; }
        const snap = await vaultSnapshot(chatId, uid);
        if (!snap.complete) { done(false, { reason: 'incomplete_snapshot' }); return; }
        const candidates = snap.books.filter((b) => {
          const foreign = (!!b.ownerChatId && b.ownerChatId !== chatId) || b.entries.some((e) => !!e.ownerChatId && e.ownerChatId !== chatId);
          const completeOwner = b.vellum && b.ownerChatId === chatId && b.entries.every((e) => e.vellum && e.ownerChatId === chatId && (e.schemaVersion ?? 0) >= VAULT_SCHEMA_VERSION);
          return b.attachedToChat && !foreign && !completeOwner;
        });
        let books = 0; let entries = 0; let skipped = 0; let failed = 0; let reason = '';
        for (const book of candidates) {
          const r = await adoptBookForChat(snap, book.id, chatId, uid);
          if (!r.ok) { failed++; reason ||= r.error; continue; }
          books++; entries += r.value.entriesClaimed; skipped += r.value.entriesSkipped; failed += r.value.entriesFailed;
          if (r.value.entriesFailed) reason ||= 'entry_claim_failed';
        }
        done(failed === 0, { books, entries, skipped, failed, protected: snap.books.filter((b) => b.attachedToChat && ((!!b.ownerChatId && b.ownerChatId !== chatId) || b.entries.some((e) => !!e.ownerChatId && e.ownerChatId !== chatId))).length, ...(reason ? { reason } : {}) });
      }
      else if (p.op === 'entry_create') {
        const cat = resolveCategory(cats, p.category);
        const settings: EntrySettings = p.settings ?? cat.defaults;
        // auto-resolve a target book: explicit → a VELLUM book → create+attach one
        let bookId = String(p.bookId || '');
        if (!bookId) {
          const snap = await vaultSnapshot(chatId ?? '', uid);
          bookId = chatId ? ownedBooks(snap, chatId).find((b) => b.role === 'manual')?.id ?? '' : '';
          if (!bookId) { const cr = await createBook('VELLUM Vault', 'Lore authored in the Vault', uid, chatId ?? '', 'manual'); if (!cr.ok) { done(false, { reason: cr.error }); return; } bookId = cr.value; if (chatId && !(await setBookAttached(chatId, bookId, true, uid))) { done(false, { reason: 'attach_failed' }); return; } }
        }
        const r = await createEntry({ bookId, key: splitList(p.key), keysecondary: splitList(p.keysecondary), content: String(p.content || ''), comment: String(p.comment || ''), settings, category: cat.id, source: 'manual', ownerChatId: chatId ?? '', vaultRole: 'manual' }, uid);
        done(r.ok, r.ok ? { entryId: r.value } : { reason: r.error });
      } else if (p.op === 'entry_update') {
        const snap = await vaultSnapshot(chatId ?? '', uid);
        const existing = snap.books.flatMap((b) => b.entries).find((e) => e.id === String(p.entryId));
        if (!existing) { done(false, { reason: 'entry_not_found' }); return; }
        if (existing.ownerChatId && existing.ownerChatId !== chatId) { done(false, { reason: 'foreign_owner' }); return; }
        const patch: Record<string, unknown> = {};
        const nextKey = p.key !== undefined ? splitList(p.key) : existing.key;
        const nextContent = p.content !== undefined ? String(p.content) : existing.content;
        const overrides = new Set(existing.overrideFields ?? []);
        if (p.key !== undefined && nextKey.join('\u0000') !== existing.key.join('\u0000')) overrides.add('key');
        if (p.content !== undefined && nextContent.trim() !== existing.content.trim()) overrides.add('content');
        if (p.key !== undefined) patch.key = nextKey;
        if (p.keysecondary !== undefined) patch.keysecondary = splitList(p.keysecondary);
        if (p.content !== undefined) patch.content = nextContent;
        if (p.comment !== undefined) patch.comment = String(p.comment);
        if (p.settings) Object.assign(patch, settingsToEntryFields(p.settings));
        if (typeof p.disabled === 'boolean') patch.disabled = p.disabled;
        patch.extensions = extensionsFromEntry(existing, { category: String(p.category || existing.category || 'concepts'), source: existing.vellum ? (existing.source || 'manual') : 'manual', content: nextContent, key: nextKey, ownerChatId: chatId ?? existing.ownerChatId ?? '', vaultRole: existing.vaultRole ?? 'manual', overrideFields: [...overrides] });
        const r = await updateEntry(String(p.entryId), patch, uid); done(r.ok, r.ok ? {} : { reason: r.error });
      } else if (p.op === 'entry_delete') { const r = await deleteEntry(String(p.entryId), uid); done(r.ok, r.ok ? {} : { reason: r.error }); }
      else if (p.op === 'entry_unlink') {
        // convert an auto-managed entry to hand-owned: keep vellum tag + category,
        // drop the source link so Tier-B sync never touches it again
        const snap = await vaultSnapshot(chatId ?? '', uid);
        const existing = snap.books.flatMap((b) => b.entries).find((e) => e.id === String(p.entryId));
        if (!existing || (existing.ownerChatId && existing.ownerChatId !== chatId)) { done(false, { reason: existing ? 'foreign_owner' : 'entry_not_found' }); return; }
        const r = await updateEntry(String(p.entryId), { extensions: extensionsFromEntry(existing, { category: String(p.category || existing.category), source: 'manual', link: '', canonicalType: '', canonicalId: '', ownerChatId: chatId ?? '', vaultRole: 'manual', overrideFields: ['content', 'key'] }) }, uid);
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
      if (promo.audience !== 'public') { done(false, { reason: 'private_record' }); return; }
      const cats = await loadCategories(uid);
      const cat = resolveCategory(cats, promo.category);
      const snap = await vaultSnapshot(chatId, uid);
      // target a VELLUM-owned book (create one if none), reuse if entry already linked
      let bookId = p.bookId || ownedBooks(snap, chatId).find((b) => b.role === 'manual')?.id;
      if (!bookId) { const r = await createBook('VELLUM Vault', 'Lore promoted from the chronicle', uid, chatId, 'manual'); if (!r.ok) { done(false, { reason: r.error }); return; } bookId = r.value; if (!(await setBookAttached(chatId, bookId, true, uid))) { done(false, { reason: 'attach_failed' }); return; } }
      const existing = ownedEntries(snap, chatId).find((e) => e.link === promo.link);
      if (existing) { const r = await syncEntry(existing, promo.content, promo.key, promo.hash, promo.link, cat.id, uid, true, promo.comment, promo.keysecondary); done(r.ok, r.ok ? { updated: true } : { reason: r.error }); }
      else { const r = await createEntry({ bookId, key: promo.key, keysecondary: promo.keysecondary, content: promo.content, comment: promo.comment, settings: cat.defaults, category: cat.id, source: promo.source, link: promo.link, hash: promo.hash, ownerChatId: chatId, vaultRole: 'manual' }, uid); done(r.ok, r.ok ? { entryId: r.value } : { reason: r.error }); }
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
      if (p?.action === 'accept') {
        const snap = await vaultSnapshot(chatId ?? '', uid); const existing = snap.books.flatMap((b) => b.entries).find((e) => e.id === String(p.entryId));
        if (existing && (!existing.ownerChatId || existing.ownerChatId === chatId)) await updateEntry(existing.id, { extensions: extensionsFromEntry(existing, { pending: false, ownerChatId: chatId ?? existing.ownerChatId ?? '' }) }, uid);
      }
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
      invalidateMood(chatId); // count may regrow to the same → force a mood rebuild
      lastSigByChat.delete(chatId);
      // Engine compilation stages the replacement and publishes it atomically;
      // inline compatibility still truncates inside the serialized fold.
      await foldChat(chatId, uid, undefined, maxTurn - 1);
      spindle.sendToFrontend?.({ type: 'vellum_refresh_done', ok: true, refolded: maxTurn }, uid);
    } catch (e) {
      spindle.log?.warn?.('[vellum_engine] refresh: ' + ((e as Error)?.message ?? e));
      spindle.sendToFrontend?.({ type: 'vellum_refresh_done', ok: false, reason: 'error' }, uid);
    }
  },
  vellum_repair_block: async (p, uid) => {
    // MANUAL block repair — the on-demand sibling of the auto-repair path in
    // foldChatInner. Unlike auto-repair it does NOT require the
    // `vellum_autoretry_block` toggle and IGNORES the per-message attempt cap
    // (`_blockRepairAttempts`), so a user can retry after the one automatic
    // attempt failed. Transcribes the latest assistant turn's prose into a
    // <vellum> block, appends it, and re-folds. Idempotent-ish: if the latest
    // turn already parses to real state, we report that instead of stacking a
    // second block.
    const chatId = p?.chatId || (await activeChatId(uid));
    const done = (ok: boolean, reason?: string): void => { spindle.sendToFrontend?.({ type: 'vellum_repair_block_done', ok, ...(reason ? { reason } : {}) }, uid); };
    if (!chatId) { done(false, 'no_active_chat'); return; }
    if (!(await has('generation'))) { done(false, 'no_generation'); return; }
    try {
      // newest assistant message: the one to transcribe + patch.
      const raw = await getRawMessages(chatId);
      let asst: any = null;
      for (let i = raw.length - 1; i >= 0; i--) { if (raw[i]?.role === 'assistant') { asst = raw[i]; break; } }
      const msgId = asst?.id ? String(asst.id) : '';
      if (!msgId) { done(false, 'no_turn'); return; }
      const asstContent = activeContent(asst);
      // Already has a parseable state block? Don't stack a second one. This
      // checks ONLY for a foldable <vellum> block via the shared parser — it
      // deliberately does NOT require a <reverie> block. Some models (deepseek
      // especially) routinely omit reverie while still emitting/needing state,
      // so gating manual repair on reverie would wrongly block or skip it.
      const { state: existingState, source: existingSource } = parseState(asstContent);
      if (existingState && (existingSource === 'json' || existingSource === 'json-partial')) { done(false, 'already_parsed'); return; }
      if (!spindle.chat?.updateMessage) { done(false, 'unsupported'); return; }
      const prior = await loadState(chatId);
      const msgs = await allTurnContents(chatId);
      const prose = stripScaffold(asstContent);
      const ctxHeader = buildRepairContext(prior, msgs.length || (prior.turns || 0) + 1);
      const repaired = await repairStateBlock(prose, ctxHeader, uid);
      if (!repaired) { done(false, 'no_block'); return; }
      await spindle.chat.updateMessage(chatId, msgId, { content: asstContent + '\n\n' + repaired.block });
      // clear both guards so the re-fold isn't blocked and a later auto-pass is fresh.
      _blockRepairAttempts.delete(chatId + '\u0000' + msgId);
      _blockWarnByChat.delete(chatId);
      spindle.log?.info?.(`[vellum_engine] manual block-repair: recovered a <vellum> block for the latest turn (${repaired.source}); re-folding.`);
      void foldChat(chatId, uid);
      done(true);
    } catch (e) {
      spindle.log?.warn?.('[vellum_engine] manual block-repair: ' + ((e as Error)?.message ?? e));
      done(false, 'error');
    }
  },
  vellum_set_hide: async (p, uid) => {
    // toggle hide-summarized-turns; persist the preference in a chat var
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const enabled = !!p?.enabled;
    try { await setChatVar(chatId, 'vellum_hide_summarized', enabled ? '1' : ''); } catch { /* best effort */ }
    const state = await loadState(chatId);
    const res = await syncHideOnFile(chatId, enabled, archivedTurnNumbers(state));
    spindle.sendToFrontend?.({ type: 'vellum_hide_done', ok: true, enabled, ...res }, uid);
  },
  vellum_set_traversal: async (p, uid) => {
    // controller-guided retrieval mode: off | flat (one-shot) | tree (tiered
    // book→arc→chapter→leaf drill). Persisted in chat vars; needs generation to engage.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const mode = (p?.mode === 'flat' || p?.mode === 'tree') ? p.mode : (p?.enabled ? 'flat' : 'off');
    const enabled = mode !== 'off';
    try { await setChatVar(chatId, 'vellum_traversal', enabled ? '1' : ''); } catch { /* best effort */ }
    try { await setChatVar(chatId, 'vellum_traversal_mode', mode === 'tree' ? 'tree' : 'flat'); } catch { /* best effort */ }
    if (p?.axis === 'character' || p?.axis === 'temporal' || p?.axis === 'hybrid') { try { await setChatVar(chatId, 'vellum_traversal_axis', p.axis); } catch { /* best effort */ } }
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
  vellum_set_autoretry: async (p, uid) => {
    // toggle block auto-repair; persist in a chat var. Costs ONE extra generation
    // per turn that drops its <vellum> block, so it's opt-in and gated on the
    // generation perm (mirrors the off-screen/tidy toggles).
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const enabled = !!p?.enabled;
    try { await setChatVar(chatId, 'vellum_autoretry_block', enabled ? '1' : ''); } catch { /* best effort */ }
    spindle.sendToFrontend?.({ type: 'vellum_autoretry_set_done', ok: true, enabled, available: await has('generation') }, uid);
  },
  vellum_set_block_example: async (p, uid) => {
    // toggle the block-example injection: prepends the previous turn's actual
    // <vellum> block as a worked example at the end of the VELLUM system
    // injection (closest to the generation point). Pure injection, no generation
    // cost beyond the ~400–700 token overhead per turn.
    const chatId = p?.chatId || (await activeChatId(uid));
    if (!chatId) return;
    const enabled = !!p?.enabled;
    try { await setChatVar(chatId, 'vellum_block_example', enabled ? '1' : ''); } catch { /* best effort */ }
    spindle.sendToFrontend?.({ type: 'vellum_block_example_set_done', ok: true, enabled }, uid);
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
    // Chapter-vault mode: off | keyed (default) | constant. Detailed hierarchical
    // summaries mirror to the Vault; the Chronicle keeps their lean gists.
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
  vellum_set_theme: async (p, uid) => { if (typeof p?.theme === 'string') await writeTheme(p.theme, uid); },
  vellum_get_theme: async (_p, uid) => { const t = await readTheme(uid); spindle.sendToFrontend({ type: 'vellum_theme', theme: t }, uid); },
  vellum_set_prefs: async (p, uid) => { if (typeof p?.prefs === 'string') await writePrefs(p.prefs, uid); },
  vellum_get_prefs: async (_p, uid) => { const t = await readPrefs(uid); spindle.sendToFrontend({ type: 'vellum_prefs', prefs: t }, uid); },

  // --- Preset Editor Tab handlers ------------------------------------------

  /** Feature 1: explicit companion link/unlink. Stamps or clears
   *  metadata.vellum_engine on the specified preset. The host fires
   *  ctx.ui.presetEditor.onChange automatically after the write. */
  vellum_preset_tab_link: async (p, uid) => {
    const presetId = String(p?.presetId ?? '').trim();
    const link = !!p?.link;
    const done = (ok: boolean) => spindle.sendToFrontend?.({ type: 'vellum_preset_tab_link_done', ok, linked: link }, uid ?? currentUser());
    spindle.log?.info?.(`[vellum_engine] preset_tab_link: received presetId=${presetId || '(empty)'} link=${link} uid=${uid || '(none)'}`);
    if (!presetId) { spindle.log?.warn?.('[vellum_engine] preset_tab_link: no presetId — aborting'); done(false); return; }
    const hasPresets = await has('presets');
    spindle.log?.info?.(`[vellum_engine] preset_tab_link: has(presets)=${hasPresets} presets.get=${!!spindle.presets?.get} presets.update=${!!spindle.presets?.update}`);
    if (!hasPresets) { spindle.log?.warn?.('[vellum_engine] preset_tab_link: presets permission not granted — aborting'); done(false); return; }
    let res;
    if (link) {
      const meta = { version: VELLUM_VERSION, identifier: 'vellum_engine', linkedAt: Date.now() };
      res = await stampPresetMetadata(presetId, meta, uid);
    } else {
      // Unlink: clear the identifier field while preserving the rest of the metadata
      if (!spindle.presets?.get || !spindle.presets?.update) { done(false); return; }
      const preset = await spindle.presets.get(presetId, uid);
      if (!preset) { done(false); return; }
      const vellum = preset.metadata?.vellum_engine ?? {};
      const meta = { ...vellum, identifier: null };
      res = await stampPresetMetadata(presetId, meta, uid);
    }
    spindle.log?.info?.(`[vellum_engine] preset_tab_link: stamp result ok=${!!res?.ok}${res && !res.ok ? ' error=' + res.error : ''}`);
    done(!!res?.ok);
  },

  /** Feature 2: insert the canonical VELLUM state-block into a preset that
   *  is missing it. Creates a system block at position post_history so the
   *  engine always receives a <vellum> state block. */
  vellum_preset_tab_fix_instructions: async (p, uid) => {
    const presetId = String(p?.presetId ?? '').trim();
    const done = (ok: boolean, reason?: string) => spindle.sendToFrontend?.({ type: 'vellum_preset_tab_fix_done', ok, ...(reason ? { reason } : {}) }, uid ?? currentUser());
    if (!presetId) { done(false, 'no_preset'); return; }
    if (!(await has('presets'))) { done(false, 'no_permission'); return; }
    if (!spindle.presets?.blocks?.create) { done(false, 'no_api'); return; }
    // Canonical VELLUM STATE instruction — the minimal signature that teaches
    // the model to emit a <vellum> JSON block after every response.
    // This is the same core content as the v2-state block in vellum-ii.json.
    const content = VELLUM_STATE_BLOCK_CONTENT;
    try {
      await spindle.presets.blocks.create(presetId, {
        name: 'VELLUM \u2014 State Block',
        role: 'system',
        position: 'post_history',
        enabled: true,
        content,
      }, { userId: uid });
      spindle.log?.info?.('[vellum_engine] inserted state block into preset ' + presetId);
      done(true);
    } catch (e) {
      spindle.log?.warn?.('[vellum_engine] fix_instructions failed: ' + ((e as Error)?.message ?? e));
      done(false, (e as Error)?.message ?? 'error');
    }
  },

  /** Feature 4: diagnostic status for the preset editor tab — permission
   *  state, active provider/model, and last extraction health. */
  vellum_preset_tab_get_status: async (_p, uid) => {
    const permission = await has('generation_parameters');
    const generationOk = await has('generation');
    // Provider/model from the default connection. Invalidate the cache first so a
    // user who switched their connection mid-session sees the CURRENT one (this is
    // a diagnostic, on-demand read — freshness beats the tiny extra list call).
    let provider = '', model = '';
    try {
      if (generationOk) {
        invalidateConnCache(uid);
        const connId = await defaultConnectionId(uid);
        if (connId && spindle.connections?.get) {
          const conn = await spindle.connections.get(connId, uid);
          if (conn) { provider = String(conn.provider ?? ''); model = String(conn.model ?? ''); }
        }
      }
    } catch { /* best effort */ }
    // Extraction health: _extractFails===0 means last completed pass was clean
    const extractOk = _extractFails === 0;
    spindle.sendToFrontend?.({
      type: 'vellum_preset_tab_status',
      permission,
      generationOk,
      provider,
      model,
      extractOk,
    }, uid ?? currentUser());
  },

  /** Persist the companion preset's prompt-variable VALUES chosen in the host
   *  preset tab's Loom editor. Backend fallback for hosts without the scoped
   *  save-coordinator write (older hosts / mobile); the desktop path prefers
   *  ctx.ui.presetEditor.updatePreset. Writes metadata.promptVariables via the
   *  shared revision-safe merge (retries once on a revision conflict) and never
   *  touches prompt content. Requires `presets`. */
  vellum_preset_vars_save: async (p, uid) => {
    const presetId = String(p?.presetId ?? '').trim();
    const pv = (p && typeof p.promptVariables === 'object' && p.promptVariables) ? p.promptVariables : {};
    const done = (ok: boolean) => spindle.sendToFrontend?.({ type: 'vellum_preset_vars_saved', ok, presetId }, uid ?? currentUser());
    if (!presetId) { done(false); return; }
    const res = await updatePresetMetadataKey(presetId, 'promptVariables', pv, uid);
    if (!res.ok) spindle.log?.warn?.('[vellum_engine] preset_vars_save: ' + res.error);
    done(res.ok);
  },

  /** Assemble the preset against a live chat with the in-progress variables,
   *  then run one quiet generation to produce a short prose sample. */
  vellum_argent_measure: async (p, uid) => {
    try {
      const preset = await spindle.presets.get(String(p.presetId), uid ?? undefined);
      if (!preset || !resolveTurnContract(preset)?.argent || !p.chatId) throw new Error('Open an ARGENT preset and an active chat first.');
      const blocks = (preset.prompt_order ?? (preset as any).blocks ?? []) as any[];
      const values = p.promptVariables ?? preset.metadata?.promptVariables ?? {};
      const assembled = await spindle.assemble({ blocks, chatId: String(p.chatId), promptVariables: values }, uid ?? undefined);
      const messages = applyArgentPolicy(assembled.messages, compileArgentPolicy(blocks, values));
      const total = await spindle.tokens.countMessages(messages, { userId: uid ?? undefined });
      const history = await spindle.tokens.countMessages(messages.filter(m => m.__isChatHistory), { userId: uid ?? undefined });
      const reservedOutput = Number((preset as any).parameters?.max_tokens ?? (preset as any).samplerOverrides?.maxTokens ?? 20000);
      const contextLimit = Number(p.contextLimit) > 0 ? Number(p.contextLimit) : null;
      const report = { ...total, input: total.total_tokens, history: history.total_tokens, standing: total.total_tokens - history.total_tokens, reservedOutput, remaining: contextLimit === null ? null : contextLimit - total.total_tokens - reservedOutput, contextLimit, scope: 'Host assembly with current controls; live measurements also include VELLUM recall.' };
      spindle.sendToFrontend?.({ type: 'vellum_assembled_budget', report }, uid ?? undefined);
    } catch (e) { spindle.sendToFrontend?.({ type: 'vellum_assembled_budget', error: String(e) }, uid ?? undefined); }
  },
  vellum_preview_assemble: async (p, uid) => {
    const resolvedUid = uid;
    const presetId = String(p?.presetId ?? '').trim();
    const chatId = String(p?.chatId ?? '').trim();
    const pv = (p && typeof p.promptVariables === 'object' && p.promptVariables) ? p.promptVariables : {};
    const done = (sampleText: string | null, error?: string) => spindle.sendToFrontend?.(
      { type: 'vellum_preview_assembled', sampleText, ...(error ? { error } : {}) }, resolvedUid);
    if (!presetId || !chatId) { done(null, 'no_chat'); return; }
    if (!(await has('generation')) || !(spindle as any).assemble) { done(null, 'generation_unavailable'); return; }
    try {
      const preset = await (spindle as any).presets?.get?.(presetId, resolvedUid);
      // The preset object stores blocks under `prompt_order` (NOT `blocks`).
      // spindle.assemble's input field is `blocks`, fed from preset.prompt_order.
      const allBlocks = Array.isArray(preset?.prompt_order) ? preset.prompt_order
        : Array.isArray(preset?.blocks) ? preset.blocks
        : null;
      if (!allBlocks || !allBlocks.length) { done(null, 'no_blocks'); return; }
      // VELLUM-specific: the sample must showcase ONLY the variables that shape
      // the PROSE ITSELF — voice, register, genre, era, tonal cast, pacing,
      // fine-tuning, imperfection, scribe rotation, romance/disposition warmth.
      // Everything else (character card, scenario, world info, chat history,
      // engine contract, state block, visual toolkit, NSFW, jailbreak, memory,
      // errata) is excluded so the paragraph reflects the dials, not the story.
      const PROSE_BLOCK_IDS = new Set<string>([
        'v2-config',        // pov, length, tense, prose, stakes, genre, dialogue, agency, distance, pacing, genre2
        'v2-doctrine',      // doctrine_strictness, sentence_cap
        'v2-register',      // house style
        'v2-prose-tuning',  // metaphor, diction, sensory, filter_words, paragraph_shape, profanity
        'v2-genre',         // genre grammar
        'v2-era',           // era / idiom
        'v2-tonal-cast',    // emotional filter / wavelength
        'v2-antislop',      // anti-slop
        'v2-romance',       // romance pace (warmth of prose)
        'v2-disposition',   // world disposition (warmth/chill of diction)
        'v2-scribes',       // voice rotation
        'v2-imperfection',  // rough hand
      ]);
      const proseBlocks = allBlocks.filter((b: any) => b?.id && PROSE_BLOCK_IDS.has(String(b.id)));
      const blocks = proseBlocks.length ? proseBlocks : allBlocks;
      const result = await (spindle as any).assemble({ blocks, chatId, promptVariables: pv }, resolvedUid);
      const partText = (c: any): string => {
        if (typeof c === 'string') return c;
        if (Array.isArray(c)) return c.map((seg: any) => typeof seg === 'string' ? seg : (typeof seg?.text === 'string' ? seg.text : '')).join('');
        return '';
      };
      const messages = Array.isArray(result?.messages)
        ? result.messages
          .filter((m: any) => m?.role === 'system' || m?.role === 'user' || m?.role === 'assistant')
          .map((m: any) => ({ role: m.role, content: partText(m.content) }))
          .filter((m: any) => m.content.trim())
        : [];
      if (!messages.length) { done(null, 'assembly_empty'); return; }
      // Strip all chat history — keep only system messages so generation is a
      // style demo, not a continuation of the active scene. Add a single neutral
      // trigger so the model writes without anchoring to any specific scene.
      const systemOnly = messages.filter((m: any) => m.role === 'system');
      if (!systemOnly.length) { done(null, 'assembly_empty'); return; }
      // Single-line probe so the model has nothing to analyse. A leading space
      // in the assistant prefill prevents empty-content issues on strict providers.
      systemOnly.push(
        { role: 'system', content: 'Write one short standalone paragraph of fiction in this style. No characters from any story. No analysis. No explanation. Output only the paragraph.' },
        { role: 'assistant', content: ' ' },
      );
      const generated = await internalGenerate(
        systemOnly,
        { max_tokens: 1200, temperature: 0.85 },
        resolvedUid,
        { reasoningOff: true, timeoutMs: 45_000 },
      );
      if (!generated.ok || !generated.value.trim()) {
        done(null, generated.ok ? 'generation_empty' : generated.error);
        return;
      }
      // Strip XML reasoning tags.
      const REASONING_RE = /<(think|thinking|reverie|reasoning|reflection|scratchpad|antml:thinking|draft|plan|planning)>[\s\S]*?<\/\1>/gi;
      const afterTags = generated.value.replace(REASONING_RE, '').trim();
      // Planning always comes first; the actual prose paragraph is always last.
      // Take the final paragraph that is longer than 40 chars as the sample.
      const paras = afterTags.split(/\n\s*\n/).map((s: string) => s.trim()).filter((s: string) => s.length > 40);
      const sample = paras[paras.length - 1] ?? afterTags;
      done(sample.trim() || null);
    } catch (e) {
      spindle.log?.warn?.('[vellum_engine] preview_assemble: ' + ((e as Error)?.message ?? e));
      done(null, 'generation_failed');
    }
  },

  /** Resolve the active chat id for the preset editor tab's live preview.
   *  Uses spindle.chats.getActive (the host's authoritative active-chat surface).
   *  Returns the chat id or an empty string. */
  vellum_preview_resolve_chat: async (_p, uid) => {
    // Must resolve an actual user id — passing null to getActive throws on this
    // host because it's user-scoped and the null path is not guarded.
    const resolvedUid = uid ?? currentUser();
    let chatId = '';
    try {
      const c = await spindle.chats.getActive(resolvedUid);
      chatId = c?.id ? String(c.id) : '';
    } catch { /* best effort */ }
    // Fallback: the last chat we saw via CHAT_SWITCHED. getActive reads the
    // user's activeChatId setting and can be empty on a cold worker (before the
    // first turn / before the uid is known), whereas the per-user map is captured
    // from the switch event and is reliable once the user has opened any chat.
    if (!chatId) chatId = _activeChatByUser.get(resolvedUid) ?? '';
    spindle.sendToFrontend?.({ type: 'vellum_preview_chat_resolved', chatId }, resolvedUid);
  },

  /** Mobile fallback: resolve the IN-USE preset + its blocks backend-side so the
   *  Actions -> "Preset editor" modal shows the same link/health/budget features
   *  the desktop host tab does. On desktop the tab reads ctx.ui.presetEditor
   *  .getState() (the preset OPEN in the editor); that host API is ABSENT on
   *  mobile, so we must resolve the preset ourselves. Resolution order, best
   *  first: (1) the active connection's preset_id — the preset actually driving
   *  generation, which is what the user means by "my preset"; (2) any preset
   *  carrying vellum_engine link metadata; (3) the sole preset if there's only
   *  one; (4) the first. Returns { id, name, metadata, blocks } for the shared
   *  panel builder. Requires `presets`. */
  vellum_preset_panel_open: async (_p, uid) => {
    // The modal gets BOTH the resolved active preset (for health/budget) AND a
    // roster of every preset (id, name, linked) so a Link/Unlink control is
    // ALWAYS available — even when auto-resolution finds nothing, the user can
    // pick any preset and link it. Desktop reads the open editor draft instead,
    // so `presets` is mobile-only extra data the desktop tab ignores.
    const send = (preset: unknown, presets: unknown[] = []) => spindle.sendToFrontend?.({ type: 'vellum_preset_panel', preset, presets }, uid ?? currentUser());
    if (!(await has('presets')) || !spindle.presets?.get) { send(null); return; }
    try {
      // Roster of all presets (best-effort) — powers the always-present picker.
      let all: any[] = [];
      if (spindle.presets?.list) {
        try { const r = await spindle.presets.list({ limit: 100, ...(uid ? { userId: uid } : {}) }); if (Array.isArray(r?.data)) all = r.data; } catch { /* list optional */ }
      }
      const roster = all.map((x: any) => ({
        id: x?.id,
        name: x?.name ?? x?.id,
        linked: x?.metadata?.vellum_engine?.identifier === 'vellum_engine',
      })).filter((x: any) => x.id);
      // AUTHORITATIVE LINKED-STATE: presets.list() metadata can be stale or
      // summarized (list-vs-get divergence), so a freshly-linked preset can read
      // linked:false in the roster even though get() shows it linked — that's the
      // "linked in the tab, not in the modal" bug. Re-fetch each roster entry via
      // presets.get (authoritative, same source the desktop draft reflects) and
      // trust its metadata. Bounded to a sane cap so a huge preset library can't
      // storm the host; beyond it we keep the list flag.
      if (spindle.presets?.get && roster.length) {
        const CAP = 40;
        await Promise.all(roster.slice(0, CAP).map(async (r: any) => {
          try {
            const full = await spindle.presets.get(r.id, uid);
            if (full) r.linked = (full.metadata?.vellum_engine as { identifier?: string } | undefined)?.identifier === 'vellum_engine';
          } catch { /* keep the list-derived flag on a failed refetch */ }
        }));
      }

      // (1) the active connection's bound preset — the one actually in use. This
      // is the mobile equivalent of "the preset the editor has open" and is the
      // single most important fix: list[0] was almost never the right preset.
      let preset: any = null;
      try {
        const connId = await defaultConnectionId(uid);
        if (connId && spindle.connections?.get) {
          const conn = await spindle.connections.get(connId, uid);
          const pid = conn?.preset_id;
          if (pid) preset = await spindle.presets.get(pid, uid);
        }
      } catch { /* connection/preset lookup best-effort — fall through to list */ }

      // (2/3/4) fall back to the preset list: a linked companion, else (if only
      // one exists) that one, else the first.
      if (!preset?.id && all.length) {
        preset = all.find((x: any) => x?.metadata?.vellum_engine?.identifier === 'vellum_engine')
          ?? (all.length === 1 ? all[0] : null)
          ?? all[0];
      }
      if (!preset?.id) { send(null, roster); return; }

      // Blocks power the health-check + prompt-budget features. UserPresetDTO
      // carries them as `prompt_order` (not `blocks`); pull them explicitly when
      // neither field is already populated.
      let blocks: unknown[] = Array.isArray(preset.blocks) ? preset.blocks
        : Array.isArray(preset.prompt_order) ? preset.prompt_order : [];
      if (!blocks.length && spindle.presets?.blocks?.list) {
        try { const b = await spindle.presets.blocks.list(preset.id, uid); if (Array.isArray(b)) blocks = b; } catch { /* blocks optional */ }
      }
      send({ id: preset.id, name: preset.name ?? preset.id, metadata: preset.metadata ?? {}, blocks }, roster);
    } catch (e) {
      spindle.log?.warn?.('[vellum_engine] preset_panel_open: ' + ((e as Error)?.message ?? e));
      send(null);
    }
  },
};

try {
  spindle.onFrontendMessage?.(async (payload: any, userId: string) => {
    // The sender id is authenticated host context. Never trust a payload field
    // or a process-global "last user" when routing operator-scoped requests.
    const uid = userId;
    rememberUser(uid);
    const h = payload?.type && dispatch[payload.type];
    if (!h) return;
    try { await h(payload, uid); }
    catch (e) {
      spindle.log?.warn?.('[vellum_engine] dispatch ' + payload.type + ': ' + ((e as Error)?.message ?? e));
      spindle.sendToFrontend({ type: 'vellum_toast', level: 'warning', msg: 'VELLUM could not save that change. Check extension storage and try again.' }, uid);
    }
  });
} catch { /* messaging optional */ }

try { spindle.log?.info?.('[vellum_engine] backend loaded'); } catch { /* ignore */ }

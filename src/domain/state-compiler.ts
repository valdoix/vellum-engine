import { z } from 'zod';
import { ParsedState } from '../parse/parsed.js';
import { normalizeStateBlockObject } from '../parse/state-block.js';
import { canonId, hashStr } from '../core/ids.js';
import { clockEvidenceAgrees, clockTime, elapsedClockFloor, liveTurnClockFloor, parseClock, reconcileDay, supportsDayAdvance } from './clock.js';
import { factTokens, similarFact } from './fact-match.js';
import type { ChronicleState } from './types.js';
import type { VellumEvent } from '../core/events.js';
import { isCurrentSituationLore, selectLorebookCanon, type LorebookCanonEntry } from './lorebook-canon.js';
import { normalizeSecretAudience } from './secret-audience.js';
import { cleanSceneTitle, proseSceneHeader } from './scene-transition.js';
import {
  activityNeedsAccessPath,
  actorCanActInParallel,
  actorLabels,
  autonomousParallelActivityAllowed,
  canonicalActorLocation,
  evidenceGroundsActorActivity,
  evidenceGroundsActorResolution,
  evidenceGroundsMove,
  evidenceGroundsWorldActivity,
  evidenceGroundsWorldMove,
  evidenceGroundsWorldResolution,
  evidenceHasAccessPath,
  evidenceMentionsActor,
  sameLocation,
} from './parallel-canon.js';
import { subplotProofSufficient } from './offscreen.js';

/** Compilation rejects malformed data. The legacy parser remains a separate salvage lane. */
function strict(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodCatch) return strict(schema.removeCatch());
  if (schema instanceof z.ZodOptional) return strict(schema.unwrap()).optional();
  if (schema instanceof z.ZodObject) return z.object(Object.fromEntries(Object.entries(schema.shape).map(([k, v]) => [k, strict(v as z.ZodTypeAny)]))).strict();
  if (schema instanceof z.ZodArray) return z.array(strict(schema.element)).max(200);
  if (schema instanceof z.ZodString) return schema.max(4000);
  return schema;
}
const text = z.string().trim().min(1).max(4000);
const name = z.string().trim().min(1).max(120);
const item = (shape: z.ZodRawShape) => z.array(z.object(shape).strict()).max(100);
const Delta = strict(ParsedState.shape.delta.removeCatch().unwrap()) as z.ZodObject<any>;
// Arcs cannot stall: a blocked attempt belongs to a child thread. Keep the
// compiler schema, semantic validator, inline normalizer, and event schema in
// agreement instead of advertising an operation that extraction later drops.
const CompilerArc = (strict(ParsedState.shape.delta.removeCatch().unwrap().shape.arcs.unwrap().element) as z.ZodObject<any>)
  .extend({ op: z.enum(['new', 'advance', 'resolve']) });
const CompilerDelta = Delta.extend({ arcs: z.array(CompilerArc).max(200).optional() });
export const CompilerState = z.object({
  turn: z.number().int().nonnegative(), day: z.number().int().nonnegative(),
  scene: z.object({ title: z.string().trim().min(1).max(100).optional(), transition: z.enum(['continue', 'scene', 'time_skip']).optional(), loc: text, time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), clock: z.number().int().min(0).max(1439), tension: z.number().min(0).max(10).optional(), weather: z.string().max(500).optional() }).strict(),
  present: item({ id: name, presence: z.enum(['spotlight', 'periphery']).optional(), mood: z.string().max(500).optional(), doing: z.string().max(500).optional(), condition: z.string().max(500).optional(), thought: z.string().max(1200), traits: z.array(name).max(12).optional() }),
  // `parallel` remains engine-reconciled from operation ledgers. Durable
  // offscreen rows are permitted when Living World autonomy is active and are
  // validated against the same closed cast/location firewall as ((parallel)).
  delta: CompilerDelta.omit({ parallel: true }),
  ext: z.object({
    scars: item({ who: name, was: text, about: name.optional() }).optional(),
    codex: item({ id: name.optional(), op: z.enum(['add', 'refresh']).optional(), fact: text, tag: name.optional() }).optional(),
    inventory: item({ who: name, item: text, op: z.enum(['gain', 'lose', 'give', 'scene', 'note']), to: name.optional(), note: text.optional() }).optional(),
    timeline: item({ event: text, day: z.number().int().nonnegative().optional(), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), location: name.optional(), participants: z.array(name).max(20).optional(), importance: z.enum(['minor', 'major', 'critical']).optional() }).optional(),
    intent: item({ who: name, goal: text, nextStep: text, constraints: z.array(text).max(8).optional(), destination: name.optional(), deadlineDay: z.number().int().nonnegative().optional(), deadlineClock: z.number().int().min(0).max(1439).optional(), status: z.enum(['active', 'blocked', 'complete']).optional() }).optional(),
    affect: item({ who: name, valence: z.number().int().min(-2).max(2), arousal: z.number().int().min(0).max(2), control: z.number().int().min(-2).max(2), direction: text, cause: text.optional() }).optional(),
    introduction: item({ who: name, role: text, want: text, constraint: text, counterTrait: text, voiceTell: text, culturalAnchor: text, physicalDetail: text }).optional(),
    plant: item({ what: text, subject: name.optional(), maturity: z.number().int().min(0).max(5).optional(), minMaturity: z.number().int().min(0).max(5).optional(), dependsOn: z.array(name).max(20).optional(), blockedBy: z.array(name).max(20).optional(), dueDay: z.number().int().nonnegative().optional(), dueClock: z.number().int().min(0).max(1439).optional(), expiryDay: z.number().int().nonnegative().optional() }).optional(), payoff: item({ what: text }).optional(),
  }).strict(),
}).strict();
export const CompilerCandidate = z.object({
  state: CompilerState,
  parallelOps: item({ op: z.enum(['start', 'advance', 'move', 'resolve']), who: name, where: text.optional(), activity: text.optional(), evidence: z.string().max(4000).optional() }),
  parallelWorldOps: item({
    op: z.enum(['start', 'advance', 'move', 'resolve']),
    priorActivity: text.optional(),
    priorWhere: text.optional(),
    where: text.optional(),
    activity: text.optional(),
    note: text.optional(),
    evidence: z.string().max(4000).optional(),
  }).optional(),
  // Every prior row must be accounted for. A forgotten actor cannot silently disappear.
  parallelReviewed: z.array(name).max(200),
  evidence: item({ path: text, quote: z.string().max(4000).optional() }),
  // Plot mutations get a stricter, track-specific proof record. Generic prose
  // evidence is insufficient: the compiler must identify the exact prior row,
  // state its previous and resulting conditions, and classify the causal step.
  trackEvidence: item({
    path: z.string().regex(/^delta\.(threads|arcs)\.\d+$/),
    targetId: name,
    before: text,
    after: text,
    quote: z.string().max(4000).optional(),
    basis: z.enum(['new_open_question', 'direct_development', 'blocked_attempt', 'closed_question', 'child_milestone', 'structural_milestone']),
    childThreadIds: z.array(name).max(20).optional(),
  }),
  genesis: z.boolean(),
}).strict();
export type StateCandidate = z.infer<typeof CompilerCandidate>;
export type CompilerInput = {
  prior: ChronicleState;
  turn: number;
  prose: string;
  userInput?: string;
  userName: string;
  /** The host's {{char}} card. This stays separate from the authoritative
   * player persona in userName, including when Cast supplies an override. */
  characterName?: string;
  genesisAllowed: boolean;
  verbosity?: 'lean' | 'full';
  codexAllowed?: boolean;
  inventoryAllowed?: boolean;
  livingWorld?: 'off' | 'minimal' | 'active' | 'sandbox';
  configuredLivingWorld?: 'off' | 'minimal' | 'active' | 'sandbox';
  social?: 'off' | 'reactive' | 'living' | 'autonomous';
  politics?: 'off' | 'living' | 'autonomous';
  argent?: boolean;
  agency?: 'protected' | 'continuity' | 'director';
  personaState?: boolean;
  /** 'none' relaxes only the semantic evidence audit (quotes, grounding
   * overlap, proof quotation matching). Deterministic gates — identities,
   * canon/life state, chronology, plot-causality transitions, and ARGENT
   * requirements — remain fully binding in both modes. */
  evidenceMode?: 'evidence' | 'none';
  /** Relevant entries from lorebooks explicitly attached to this chat. These
   * constrain objective world canon; they are never automatic actor knowledge. */
  lorebookCanon?: readonly LorebookCanonEntry[];
};
export interface CompilationSuggestion { id: string; kind: 'thread' | 'arc' | 'offscreen'; row: Record<string, unknown>; reason: string }
export type Compilation = { ok: true; block: string; candidate: StateCandidate; baseHash: string; recovered?: string[]; suggestions?: CompilationSuggestion[] } | { ok: false; errors: string[]; draft?: unknown; fragment?: string };
export const stateRevision = (state: ChronicleState): string => hashStr(JSON.stringify(state));

/** Mandatory ARGENT output is separate from optional extraction. A compact
 * provider reply may omit engine-owned boilerplate, but it may not skip the
 * preset's opening plot ledger or an enabled Sandbox world's activity floor. */
export function argentRequirementErrors(candidate: StateCandidate, input: CompilerInput): string[] {
  if (!input.argent) return [];
  const narrative = input.prose.trim();
  const inCharacter = !!narrative && !/^\s*(?:OOC:|\(\()/i.test(narrative);
  const hasOpenThread = input.prior.threads.some(row => !/resolv/i.test(row.status || ''));
  const hasOpenArc = input.prior.arcs.some(row => !/resolv/i.test(row.status || ''));
  const needsOpeningPlot = !hasOpenThread && narrative.length >= 40 && inCharacter;
  const newSubplots = (candidate.state.delta.offscreen ?? []).filter((row: { op?: string }) => row.op === 'new');
  const subplotThreadRefs = new Set(newSubplots.map((row: { thread?: string }) => trackTitleKey(row.thread ?? '')).filter(Boolean));
  const threads = (candidate.state.delta.threads ?? []).filter((row: { op?: string; id?: string; name: string }) =>
    row.op === 'new'
    // Sandbox subplots may need their own durable plot tracks on the opening
    // pass. They are not additional foreground opening candidates merely
    // because the prior ledger is empty.
    && !subplotThreadRefs.has(trackTitleKey(row.id ?? ''))
    && !subplotThreadRefs.has(trackTitleKey(row.name)));
  const arcs = (candidate.state.delta.arcs ?? []).filter((row: { op?: string }) => row.op === 'new');
  const errors: string[] = [];
  if (needsOpeningPlot && threads.length !== 1) errors.push('ARGENT requires exactly one grounded opening thread when the plot ledger is empty');
  if (needsOpeningPlot && !hasOpenArc) {
    const openingArcRef = threads.length === 1 ? trackTitleKey(threads[0]!.arc ?? '') : '';
    const openingArcs = openingArcRef
      ? arcs.filter((row: { id?: string; name: string }) => openingArcRef === trackTitleKey(row.id ?? '') || openingArcRef === trackTitleKey(row.name))
      : [];
    // Only the arc actually linked by the foreground opener is the opening
    // parent. Independent subplot arcs must not inflate this cardinality.
    if ((threads.length === 1 && openingArcs.length !== 1) || (threads.length === 0 && arcs.length === 0)) {
      errors.push('ARGENT requires exactly one grounded opening parent arc when no parent arc exists');
    }
    if (threads.length === 1 && openingArcs.length !== 1) errors.push('ARGENT opening thread must link to the exact opening arc title');
  }
  if (inCharacter && input.livingWorld === 'sandbox') {
    const newSubplotCount = newSubplots.length;
    const parallelEvents = candidate.parallelOps.length + (candidate.parallelWorldOps?.length ?? 0);
    if (newSubplotCount < 2) errors.push(`ARGENT Sandbox requires at least 2 new durable subplots; received ${newSubplotCount}`);
    if (parallelEvents < 4) errors.push(`ARGENT Sandbox requires at least 4 parallel event operations; received ${parallelEvents}`);
  }
  return errors;
}

function compilerLorebookCanon(input: CompilerInput): LorebookCanonEntry[] {
  const p = input.prior;
  const focus = `${input.userInput ?? ''}\n${input.prose}\n${p.scene.location}\n${p.scene.present.map(id => p.cast[id]?.name ?? id).join(' ')}`.toLocaleLowerCase();
  return selectLorebookCanon(input.lorebookCanon ?? [], focus);
}

function lorebookQuoteEntry(entries: readonly LorebookCanonEntry[], quote: string): LorebookCanonEntry | undefined {
  const exact = String(quote ?? '').trim();
  if (!exact) return undefined;
  return entries.find(entry => sourceSupportsEvidence(entry.content, exact)
    || (entry.title ? sourceSupportsEvidence(entry.title, exact) : false)
    || entry.keys?.some(key => sourceSupportsEvidence(key, exact))
    || entry.secondaryKeys?.some(key => sourceSupportsEvidence(key, exact)));
}

/** Evidence is authored text, not a byte protocol. Providers routinely preserve
 * the exact words while changing curly quotes, dash width, non-breaking spaces,
 * or line wrapping. Canonicalize only those presentation differences; word order
 * and content still have to occur contiguously in the allowed source. */
function evidenceText(value: unknown): string {
  return String(value ?? '').normalize('NFKC')
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
}

function sourceContainsEvidence(source: unknown, quote: unknown): boolean {
  const needle = evidenceText(quote);
  return !!needle && evidenceText(source).includes(needle);
}

/** Evidence is a factual grounding statement, not a byte-for-byte quotation
 * protocol. Exact passages still win, while a concise paraphrase is accepted
 * only when most of its meaningful words are present in the source. Row-level
 * semantic gates below still reject overreach, reversed subjects, and unrelated
 * plot movement. */
function sourceSupportsEvidence(source: unknown, evidence: unknown): boolean {
  if (sourceContainsEvidence(source, evidence)) return true;
  const wanted = [...factTokens(String(evidence ?? ''))];
  const found = [...factTokens(String(source ?? ''))];
  if (!wanted.length || !found.length) return false;
  const shared = wanted.filter(token => found.some(candidate => tokenRelated(token, candidate))).length;
  if (wanted.length === 1) return wanted[0]!.length >= 4 && shared === 1;
  return shared >= 2 && shared / wanted.length >= 0.6;
}

/** Final event-contract check for a strict compiler candidate. Validation says
 * a row is true; this check says extraction actually represented it. It runs
 * before the Chronicle append, turning any future validator/extractor drift
 * into a held repair instead of a false-success window. */
export function auditCompiledEvents(candidate: { state: { delta: Partial<NonNullable<ParsedState['delta']>> } }, events: readonly VellumEvent[]): string[] {
  const errors: string[] = [];
  const delta = candidate.state.delta;
  const plotMatch = (kind: 'thread.op' | 'arc.op', row: { name: string; op: string; note?: string }): boolean => events.some(event =>
    event.kind === kind && trackTitleKey(event.name) === trackTitleKey(row.name)
      && event.op === row.op && (!row.note || event.note === row.note));
  for (let index = 0; index < (delta.threads ?? []).length; index++) {
    const row = delta.threads![index]!;
    if (!plotMatch('thread.op', row)) errors.push(`validated thread was not materialized: delta.threads.${index}`);
    if (row.arc && !events.some(event => event.kind === 'thread.set' && trackTitleKey(event.name) === trackTitleKey(row.name) && !!event.arc)) {
      errors.push(`validated thread arc link was not materialized: delta.threads.${index}`);
    }
  }
  for (let index = 0; index < (delta.arcs ?? []).length; index++) {
    if (!plotMatch('arc.op', delta.arcs![index]!)) errors.push(`validated arc was not materialized: delta.arcs.${index}`);
  }
  for (let index = 0; index < (delta.offscreen ?? []).length; index++) {
    const row = delta.offscreen![index]!;
    const event = events.find((item): item is Extract<VellumEvent, { kind: 'offscreen.op' }> => item.kind === 'offscreen.op' && item.id === row.id);
    if (!event) errors.push(`validated subplot was not materialized: delta.offscreen.${index}`);
    else if (row.thread && !event.thread) errors.push(`validated subplot thread link was not materialized: delta.offscreen.${index}`);
    else if (row.impact && event.impact !== row.impact) errors.push(`validated subplot impact was not materialized: delta.offscreen.${index}`);
    else if (row.beatKind && event.beatKind !== row.beatKind) errors.push(`validated subplot beat type was not materialized: delta.offscreen.${index}`);
    else if (row.grounding && !event.grounding) errors.push(`validated subplot grounding was not materialized: delta.offscreen.${index}`);
    if (row.arc && row.thread && (!event?.thread || !events.some(item => item.kind === 'thread.set' && item.id === event.thread && !!item.arc))) {
      errors.push(`validated subplot arc bridge was not materialized: delta.offscreen.${index}`);
    }
  }
  if (delta.parallel !== undefined) {
    const event = events.find((item): item is Extract<VellumEvent, { kind: 'parallel.set' }> => item.kind === 'parallel.set');
    if (!event) errors.push('validated parallel snapshot was not materialized');
    else for (let index = 0; index < delta.parallel.length; index++) {
      const row = delta.parallel[index]!;
      if (!event.items.some(item => item.activity === row.activity
        && String(item.where ?? '') === String(row.where ?? '')
        && canonId(item.who ?? '') === canonId(row.who ?? ''))) errors.push(`validated parallel row was not materialized: delta.parallel.${index}`);
    }
  }
  return errors;
}

export interface ParallelGrounding {
  source: 'offscreen';
  id: string;
  evidence: string;
}

/**
 * Canonical prior-state lines that may ground a new current parallel row when
 * the selected Living World mode is autonomous. These are deliberately narrow:
 * only active, actor-addressed off-screen subplots are exposed. Plot threads
 * are author knowledge and may describe events the absent actor never learned.
 * Static cast biography and generic lore cannot be promoted into a claim that
 * somebody is doing something right now.
 */
export function parallelGrounding(input: CompilerInput): ParallelGrounding[] {
  if (input.livingWorld !== 'active' && input.livingWorld !== 'sandbox') return [];
  const rows: ParallelGrounding[] = [];
  for (const subplot of input.prior.offscreen.filter(row => row.status === 'active').slice(0, 30)) {
    const actor = subplot.who ? input.prior.cast[canonId(subplot.who)] : undefined;
    const who = actor?.name ?? subplot.who;
    if (who && subplot.where && subplot.gist) {
      rows.push({ source: 'offscreen', id: subplot.id, evidence: `${who} at ${subplot.where}: ${subplot.gist}` });
    }
  }
  return rows.slice(0, 120);
}

function locationAncestors(state: ChronicleState, raw: string): Set<string> {
  const byId = new Map((state.locations ?? []).map(row => [canonId(row.id), row]));
  const start = (state.locations ?? []).find(row => sameLocation(row.name, raw) || canonId(row.id) === canonId(raw));
  const out = new Set<string>();
  let current = start;
  for (let depth = 0; current && depth < 12; depth++) {
    const id = canonId(current.id);
    if (!id || out.has(id)) break;
    out.add(id);
    current = current.parent ? byId.get(canonId(current.parent)) : undefined;
  }
  return out;
}

function sharedMeaningfulToken(a: string, b: string): boolean {
  const left = [...factTokens(a)];
  const right = [...factTokens(b)];
  return left.some(token => token.length >= 5 && right.some(candidate => tokenRelated(token, candidate)));
}

/** A parallel destination need not be stated in the visible prose, but it must
 * belong to the established story geography and connect to either the actor or
 * the current/last-known locale. This admits local choices such as Spike at the
 * Bronze while rejecting an arbitrary Beijing jump in a Sunnydale story. */
function autonomousDestinationPlausible(
  input: CompilerInput,
  lorebookCanon: readonly LorebookCanonEntry[],
  who: string,
  destination: string,
): boolean {
  const where = destination.trim();
  if (!where) return false;
  const actor = input.prior.cast[canonId(who)];
  if (!actor || actor.deceased) return false;
  const anchor = canonicalActorLocation(input.prior, who);
  if (anchor && sameLocation(anchor.where, where)) return true;

  const location = (input.prior.locations ?? []).find(row => sameLocation(row.name, where) || canonId(row.id) === canonId(where));
  const chroniclePassages = [
    ...(input.prior.locations ?? []).map(row => `${row.name} ${row.note ?? ''}`),
    ...input.prior.lore.filter(row => row.status !== 'rejected').map(row => row.fact),
  ];
  const lorebookPassages = lorebookCanon.flatMap(entry => [
    entry.title ?? '', ...(entry.keys ?? []), ...(entry.secondaryKeys ?? []), entry.content,
  ]);
  const passages = [...chroniclePassages, ...lorebookPassages].filter(text => sourceContainsEvidence(text, where));
  if (!location && !passages.length) return false;

  const destinationAncestors = locationAncestors(input.prior, location?.id ?? where);
  const anchors = [anchor?.where, input.prior.scene.location].filter((value): value is string => !!value?.trim());
  for (const rawAnchor of anchors) {
    const anchorAncestors = locationAncestors(input.prior, rawAnchor);
    if ([...destinationAncestors].some(id => anchorAncestors.has(id))) return true;
    if (passages.some(passage => sourceContainsEvidence(passage, rawAnchor) || sharedMeaningfulToken(passage, rawAnchor))) return true;
  }
  const labels = actorLabels(input.prior, who);
  const actorCanon = [actor.note ?? '', actor.role ?? '', actor.introduction?.culturalAnchor ?? '', ...lorebookPassages]
    .filter(text => labels.some(label => sourceContainsEvidence(text, label)));
  return actorCanon.some(passage => sourceContainsEvidence(passage, where));
}

function autonomousWorldLocationPlausible(
  input: CompilerInput,
  lorebookCanon: readonly LorebookCanonEntry[],
  destination: string | undefined,
): boolean {
  const where = destination?.trim();
  if (!where) return false;
  if (sameLocation(input.prior.scene.location, where)) return true;
  if ((input.prior.locations ?? []).some(row => sameLocation(row.name, where) || canonId(row.id) === canonId(where))) return true;
  if (input.prior.parallel.some(row => sameLocation(row.where, where))) return true;
  if (input.prior.offscreen.some(row => sameLocation(row.where, where))) return true;
  return lorebookCanon.some(entry => [entry.title ?? '', ...(entry.keys ?? []), ...(entry.secondaryKeys ?? []), entry.content]
    .some(passage => sourceContainsEvidence(passage, where)));
}

function elapsedCompilerMinutes(input: CompilerInput, day: number, clock: number): number {
  const priorClock = input.prior.scene.clock ?? parseClock(input.prior.scene.time) ?? 0;
  return Math.max(0, day * 1440 + clock - (input.prior.day * 1440 + priorClock));
}

function normalizedIncludes(haystack: string, needle: string): boolean {
  return haystack.normalize('NFKC').toLocaleLowerCase().includes(needle.normalize('NFKC').toLocaleLowerCase().trim());
}

function tokenRelated(a: string, b: string): boolean {
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  return min >= 5 && a.slice(0, 5) === b.slice(0, 5);
}

const KNOWLEDGE_SOURCE_GENERIC = new Set(['source', 'access', 'path', 'direct', 'explicit', 'information', 'fact']);

function knowledgeSourceGrounded(source: string, quote: string): boolean {
  if (normalizedIncludes(quote, source)) return true;
  const wanted = [...factTokens(source)].filter(token => !KNOWLEDGE_SOURCE_GENERIC.has(token));
  const found = [...factTokens(quote)];
  return wanted.some(token => found.some(candidate => tokenRelated(token, candidate)));
}

/** A quote may be real yet support only a fraction of an over-expanded fact.
 * Require at least half of the durable proposition's content words to occur in
 * its evidence. This rejects private-thought guesses and subject reversals while
 * retaining compact paraphrases such as "the key is seven". */
function knowledgeFactGrounded(fact: string, quote: string): boolean {
  const wanted = [...factTokens(fact)];
  const found = [...factTokens(quote)];
  if (!wanted.length || !found.length) return false;
  const shared = wanted.filter(token => found.some(candidate => tokenRelated(token, candidate))).length;
  return shared >= Math.max(1, Math.ceil(wanted.length / 2));
}

function rowClaimText(section: string, row: Record<string, any>): string {
  const fields: Record<string, string[]> = {
    bonds: ['why', 'label'], journal: ['memory'], secrets: ['secret', 'text'],
    factions: ['name', 'kind', 'why'], factionRelations: ['kind', 'why'],
    scars: ['was'], codex: ['fact'], inventory: ['item', 'note'], timeline: ['event'],
    intent: ['goal', 'nextStep'], affect: ['direction', 'cause'],
    introduction: ['role', 'want', 'constraint', 'counterTrait', 'voiceTell', 'culturalAnchor', 'physicalDetail'],
    plant: ['what'], payoff: ['what'],
  };
  return (fields[section] ?? []).map(field => String(row[field] ?? '').trim()).filter(Boolean).join(' ');
}

/** Generic materiality backstop for state families that do not have a stronger
 * specialized semantic gate. It prevents a real but unrelated passage from
 * being attached to an invented row while allowing concise paraphrase. */
function evidenceGroundsRowClaim(section: string, row: Record<string, any>, evidence: string): boolean {
  const claim = [...factTokens(rowClaimText(section, row))];
  if (!claim.length) return true;
  const support = [...factTokens(evidence)];
  const shared = claim.filter(token => support.some(candidate => tokenRelated(token, candidate))).length;
  const minimum = section === 'introduction' ? Math.min(2, claim.length) : Math.max(1, Math.ceil(claim.length / 2));
  return shared >= minimum;
}

/** Track titles are model-facing labels, while ids remain engine-owned. Match a
 * returned title conservatively: case/spacing/curly apostrophes may differ, but
 * paraphrases may not silently target a different plotline. */
function trackTitleKey(value: string): string {
  return String(value || '').normalize('NFKC').replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function trackBefore(track: { name: string; status: string; beats: string[] }): string {
  return track.beats[track.beats.length - 1]?.trim() || track.status?.trim() || track.name.trim();
}

function sameTransitionText(a: string, b: string): boolean {
  const ak = trackTitleKey(a), bk = trackTitleKey(b);
  return !!ak && (ak === bk || similarFact(a, b));
}

const PLOT_GENERIC = new Set([
  'plot', 'thread', 'arc', 'story', 'situation', 'question', 'goal', 'issue',
  'relationship', 'romance', 'mystery', 'conflict', 'journey', 'future', 'effect',
  'development', 'progress', 'advance', 'advanced', 'resolve', 'resolved', 'stall',
]);

function castVocabulary(state: ChronicleState): Set<string> {
  const out = new Set<string>();
  for (const actor of Object.values(state.cast)) {
    for (const label of [actor.name, ...(actor.aka ?? [])]) for (const token of factTokens(label)) out.add(token);
  }
  return out;
}

function substantiveTokens(value: string, cast: Set<string>): Set<string> {
  return new Set([...factTokens(value)].filter(token => !cast.has(token) && !PLOT_GENERIC.has(token)));
}

function overlapCount(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const token of a) if (b.has(token)) count++;
  return count;
}

/** Conservative lexical backstop for the semantic compiler. The proof's note
 * must both (a) restate concrete material from its exact quote and (b) connect
 * to the prior track's own topic/history. Ambiguous paraphrases are omitted on
 * retry rather than allowing an unrelated beat to corrupt long-term state. */
function plotProofGrounded(
  track: { name: string; status: string; beats: string[] } | undefined,
  title: string,
  proof: StateCandidate['trackEvidence'][number],
  state: ChronicleState,
): boolean {
  const cast = castVocabulary(state);
  const quote = substantiveTokens(proof.quote, cast);
  const after = substantiveTokens(proof.after, cast);
  const grounded = overlapCount(quote, after);
  if (!quote.size || !after.size || grounded < (Math.min(quote.size, after.size) <= 2 ? 1 : 2)) return false;
  if (!track) {
    const titleTokens = substantiveTokens(title, cast);
    return titleTokens.size > 0 && overlapCount(titleTokens, after) > 0;
  }
  if (proof.basis === 'child_milestone') return true;
  const anchors = substantiveTokens([track.name, ...track.beats.slice(-3), track.status].join(' '), cast);
  return anchors.size > 0 && overlapCount(anchors, after) > 0;
}

/** A provider-neutral JSON schema generated from the same strict validator. */
export function jsonSchema(s: z.ZodTypeAny): Record<string, unknown> {
  if (s instanceof z.ZodOptional) return jsonSchema(s.unwrap());
  if (s instanceof z.ZodDefault) return jsonSchema(s.removeDefault());
  if (s instanceof z.ZodCatch) return jsonSchema(s.removeCatch());
  if (s instanceof z.ZodNullable) return { anyOf: [jsonSchema(s.unwrap()), { type: 'null' }] };
  if (s instanceof z.ZodUnion) return { anyOf: s.options.map((option: z.ZodTypeAny) => jsonSchema(option)) };
  if (s instanceof z.ZodLiteral) return { const: s.value, type: typeof s.value };
  if (s instanceof z.ZodRecord) return { type: 'object', additionalProperties: jsonSchema(s.valueSchema) };
  if (s instanceof z.ZodObject) return { type: 'object', additionalProperties: false, properties: Object.fromEntries(Object.entries(s.shape).map(([k, v]) => [k, jsonSchema(v as z.ZodTypeAny)])), required: Object.entries(s.shape).filter(([, v]) => !(v instanceof z.ZodOptional)).map(([k]) => k) };
  if (s instanceof z.ZodArray) return { type: 'array', items: jsonSchema(s.element), maxItems: s._def.maxLength?.value };
  if (s instanceof z.ZodEnum) return { type: 'string', enum: s.options };
  if (s instanceof z.ZodBoolean) return { type: 'boolean' };
  if (s instanceof z.ZodNumber) return { type: s.isInt ? 'integer' : 'number', ...(s.minValue !== null ? { minimum: s.minValue } : {}), ...(s.maxValue !== null ? { maximum: s.maxValue } : {}) };
  if (s instanceof z.ZodString) return { type: 'string', ...(s.minLength ? { minLength: s.minLength } : {}), ...(s.maxLength ? { maxLength: s.maxLength } : {}), ...Object.assign({}, ...s._def.checks.filter(c => c.kind === 'regex').map(c => ({ pattern: (c as { regex: RegExp }).regex.source }))) };
  if (s instanceof z.ZodUnknown || s instanceof z.ZodAny) return {};
  throw new Error('Unsupported compiler schema: ' + s._def.typeName);
}

/**
 * Provider-facing schema for Engine Pass. The canonical validator remains
 * authoritative, but the model does not need to repeat the complete T1
 * snapshot or the engine's evidence/proof bookkeeping. Omitted core fields are
 * restored from prior state by preparedCompilerCandidate(); evidence may live
 * beside the changed row and is lifted out before strict validation.
 */
export function compilerProviderSchema(evidenceMode: 'evidence' | 'none' = 'evidence'): Record<string, unknown> {
  const schema = structuredClone(jsonSchema(CompilerCandidate)) as any;
  schema.required = ['state'];
  delete schema.properties.evidence;
  delete schema.properties.trackEvidence;
  delete schema.properties.parallelReviewed;

  const state = schema.properties.state;
  state.required = [];
  state.properties.scene.required = [];
  state.properties.scene.properties.evidence = {
    type: 'object', additionalProperties: false, required: [],
    properties: { loc: { type: 'string' }, time: { type: 'string' }, present: { type: 'string' } },
  };
  state.properties.present.items.required = ['id'];
  state.properties.present.items.properties.evidence = { type: 'string' };

  for (const branch of [state.properties.delta, state.properties.ext]) {
    for (const property of Object.values(branch.properties ?? {}) as any[]) {
      if (property?.type !== 'array' || !property.items?.properties) continue;
      property.items.properties.evidence = { type: 'string' };
    }
  }
  // The evidence-aware fields on parallel operations are only requested when
  // the chat keeps the semantic evidence audit. In no-evidence mode the
  // provider schema drops them so models never spend tokens on quotations.
  if (evidenceMode === 'none') {
    delete state.properties.scene.properties.evidence;
    delete state.properties.present.items.properties.evidence;
    for (const branch of [state.properties.delta, state.properties.ext]) {
      for (const property of Object.values(branch.properties ?? {}) as any[]) {
        if (property?.type !== 'array' || !property.items?.properties) continue;
        delete property.items.properties.evidence;
      }
    }
    for (const key of ['parallelOps', 'parallelWorldOps']) {
      const arr = schema.properties[key];
      if (arr?.items?.required) arr.items.required = arr.items.required.filter((k: string) => k !== 'evidence');
    }
  }
  return schema;
}

export function validateCompilation(raw: unknown, input: CompilerInput): Compilation {
  const parsed = CompilerCandidate.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) };
  const c = parsed.data;
  const s = c.state;
  const errors: string[] = [];
  const noEvidence = input.evidenceMode === 'none';
  if (s.turn !== input.turn) errors.push('turn must equal the engine turn');
  const priorClock = input.prior.scene.clock ?? parseClock(input.prior.scene.time) ?? 0;
  const currentTurnSource = `${input.userInput ?? ''}\n${input.prose}`;
  const lorebookCanon = compilerLorebookCanon(input);
  const lorebookEvidence = (quote: string): LorebookCanonEntry | undefined => lorebookQuoteEntry(lorebookCanon, quote);
  const visibleHeader = proseSceneHeader(input.prose);
  // Legacy Chronicles can lack a scene id even after many turns. Do not turn
  // that migration gap into a permanent title-validation failure; only the
  // actual first compiler turn or an explicit pending opener is mandatory.
  const openingScene = input.prior.scene.pending === true || (input.turn <= 1 && !input.prior.scene.id);
  const opensBoundary = openingScene || s.scene.transition === 'scene' || s.scene.transition === 'time_skip';
  const lorebookPathAllowed = (path: string, entry: LorebookCanonEntry): boolean => {
    if ((path === 'scene.loc' || path === 'scene.time') && openingScene) return isCurrentSituationLore(entry);
    const match = path.match(/^delta\.(threads|arcs|offscreen)\.(\d+)$/);
    if (match) {
      const row = (s.delta as Record<string, Array<Record<string, unknown>> | undefined>)[match[1]!]?.[Number(match[2])];
      if (row?.op !== 'new') return false;
      return match[1] !== 'offscreen' || isCurrentSituationLore(entry);
    }
    if (/^delta\.(factions|factionRelations)\.\d+$/.test(path)) return true;
    if (/^ext\.(codex|timeline|introduction|plant)\.\d+$/.test(path)) return true;
    if (/^ext\.(intent|affect|inventory)\.\d+$/.test(path)) return isCurrentSituationLore(entry);
    return false;
  };
  if (opensBoundary && !cleanSceneTitle(s.scene.title)) errors.push('new scene requires scene.title');
  if (visibleHeader && cleanSceneTitle(s.scene.title) !== visibleHeader.title) errors.push('scene.title must match the visible scene header');
  // A time cut in the latest player input is part of this turn even when the
  // generated prose does not repeat it. Deterministically repair a candidate
  // that left the clock frozen or advanced it by less than the stated duration.
  let flooredClock = elapsedClockFloor(input.prior.day, priorClock, s.day, s.scene.clock, currentTurnSource);
  if (!flooredClock.inferred) flooredClock = liveTurnClockFloor(input.prior.day, priorClock, flooredClock.day, flooredClock.clock, currentTurnSource);
  if (flooredClock.inferred) {
    s.day = flooredClock.day;
    s.scene.clock = flooredClock.clock;
    s.scene.time = clockTime(flooredClock.clock);
  }
  // State output carries an elapsed story-day count. Reconcile it before the
  // absolute-clock gate so a compiler that copied a visible calendar component
  // (October 17 -> day:17) is repaired to the prior count rather than either
  // corrupting the Chronicle or discarding every other valid state update.
  const reportedDay = s.day;
  const timeProof = noEvidence
    ? undefined
    : c.evidence.find(e => e.path === 'scene.time' && (sourceSupportsEvidence(currentTurnSource, e.quote) || !!lorebookEvidence(e.quote)));
  const proofAt = timeProof ? currentTurnSource.indexOf(timeProof.quote) : -1;
  const proofContext = proofAt >= 0
    ? currentTurnSource.slice(Math.max(0, proofAt - 80), Math.min(currentTurnSource.length, proofAt + timeProof!.quote.length + 80))
    : (flooredClock.inferred || (timeProof && sourceSupportsEvidence(currentTurnSource, timeProof.quote)) ? currentTurnSource : undefined);
  const dayAdvanceEvidence = s.day > input.prior.day
    && (flooredClock.inferred || supportsDayAdvance(proofContext, priorClock, s.scene.clock, s.day - input.prior.day, s.day));
  const dayReconcile = reconcileDay(s.day, input.prior.day, dayAdvanceEvidence, { priorClock, newClock: s.scene.clock });
  s.day = dayReconcile.day;
  const recoveredDayCount = s.day !== reportedDay;
  const elapsedMinutes = elapsedCompilerMinutes(input, s.day, s.scene.clock);
  // A quote that names a recognizable time of day must support the compiled
  // endpoint, not merely exist somewhere in the turn. Coarse labels use broad,
  // wrapping periods (03:05 is night); explicit HH:MM remains precise enough to
  // reject a genuinely contradictory endpoint.
  if (timeProof && !clockEvidenceAgrees(timeProof.quote, s.scene.clock)) errors.push('scene.time evidence disagrees with compiled clock');
  const [h, m] = s.scene.time.split(':').map(Number);
  if (h! * 60 + m! !== s.scene.clock) errors.push('time and clock disagree');
  if (s.day * 1440 + s.scene.clock < input.prior.day * 1440 + priorClock) errors.push('clock moves backward');
  const currentTurnEvidencePath = (path: string): boolean => path === 'scene.loc' || path === 'scene.time' || path.startsWith('present.add.') || path.startsWith('present.remove.');
  const parallelAutonomy = input.livingWorld === 'active' || input.livingWorld === 'sandbox';
  const quoteAllowed = (path: string, quote: string): boolean => sourceSupportsEvidence(currentTurnEvidencePath(path) ? currentTurnSource : input.prose, quote)
    || !!lorebookEvidence(quote)
    // Living/Active and Autonomous/Sandbox are simulation passes as well as
    // extractors. Off-screen rows may carry a concise plausibility rationale
    // checked below against canonical life, place, time, and knowledge state.
    || (parallelAutonomy && path.startsWith('delta.offscreen.') && !!quote.trim());
  const needsEvidence = (path: string, changed: boolean, derived = false) => {
    if (noEvidence) return;
    if (changed && !derived && !c.evidence.some(e => e.path === path && quoteAllowed(path, e.quote))) errors.push(`missing evidence: ${path}`);
  };
  needsEvidence('scene.loc', s.scene.loc !== input.prior.scene.location);
  needsEvidence('scene.time', s.day !== input.prior.day || s.scene.clock !== input.prior.scene.clock, flooredClock.inferred);
  if (c.genesis && (!input.genesisAllowed || !(s.ext.codex?.length))) errors.push('genesis requires an eligible request and established world facts');
  if (s.ext.codex?.length && input.codexAllowed === false && !(input.genesisAllowed && c.genesis)) errors.push('codex output is disabled');
  if (s.ext.inventory?.length && input.inventoryAllowed === false) errors.push('inventory output is disabled');
  const present = new Set<string>();
  const allowed = new Set(Object.keys(input.prior.cast));
  const player = canonId(input.userName);
  if (player) allowed.add(player);
  const personaLabels = [input.userName, input.prior.cast[player]?.name, ...(input.prior.cast[player]?.aka ?? [])]
    .map(value => evidenceText(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim())
    .filter(value => value.length >= 2);
  const mentionsPersona = (...values: unknown[]): boolean => {
    if (!personaLabels.length) return false;
    const haystack = ` ${values.flatMap(value => Array.isArray(value) ? value : [value]).map(value => evidenceText(value).replace(/[^\p{L}\p{N}]+/gu, ' ')).join(' ')} `;
    return personaLabels.some(label => haystack.includes(` ${label} `));
  };
  const literalName = (n: string) => input.prose.toLocaleLowerCase().includes(n.toLocaleLowerCase());
  for (const p of s.present) {
    const id = canonId(p.id);
    if (present.has(id)) errors.push(`duplicate present actor: ${p.id}`);
    if (!allowed.has(id) && !literalName(p.id)) errors.push(`unsupported identity: ${p.id}`);
    present.add(id); allowed.add(id);
    if (id === player) {
      if (!input.personaState) {
        if (p.thought || p.mood || p.doing || p.condition || p.traits?.length) errors.push('player fields must be empty');
      } else {
        // Persona State is explicit permission for a private tracker snapshot,
        // independent of the narrative agency mode. Requiring verbatim prose
        // evidence made Forbidden and Minor Continuity silently blank the row.
        // The compiler may infer these metadata fields from the current scene,
        // latest input, prior detail, and established characterization.
        for (const field of ['mood', 'doing', 'condition', 'thought'] as const) {
          if (!p[field]?.trim()) errors.push(`persona state requires ${field}`);
        }
        const traits = (p.traits ?? []).map((trait: string) => trait.trim().toLocaleLowerCase()).filter(Boolean).sort();
        if (!traits.length) errors.push('persona state requires traits');
      }
    }
  }
  if (input.personaState && player && !present.has(player)) errors.push('persona state requires the player in present');
  const priorPresent = new Set(input.prior.scene.present.map(canonId));
  for (const id of priorPresent) needsEvidence(`present.remove.${id}`, !present.has(id));
  for (const id of present) if (id !== player) needsEvidence(`present.add.${id}`, !priorPresent.has(id));
  const known = (n: string) => allowed.has(canonId(n)) || literalName(n);
  const evidence = new Map<string, string>();
  for (const e of c.evidence) {
    if (evidence.has(e.path)) errors.push(`duplicate evidence path: ${e.path}`);
    else evidence.set(e.path, e.quote);
  }
  for (const e of c.evidence) {
    if (noEvidence) continue;
    if (input.personaState && e.path.startsWith('present.persona.')) {
      // Evidence is optional for tracker-only inference. If a compiler includes
      // it, still reject fabricated quotations.
      const allowed = sourceSupportsEvidence(input.userInput ?? '', e.quote) || sourceSupportsEvidence(input.prose, e.quote);
      if (!allowed) errors.push(`persona evidence is not grounded in the current turn: ${e.path}`);
    } else if (!quoteAllowed(e.path, e.quote)) errors.push(`evidence is not grounded in the current scene or attached canon: ${e.path}`);
    else {
      const lore = lorebookEvidence(e.quote);
      if (lore && !sourceSupportsEvidence(currentTurnEvidencePath(e.path) ? currentTurnSource : input.prose, e.quote) && !lorebookPathAllowed(e.path, lore)) {
        errors.push(`lorebook evidence cannot establish this kind of change: ${e.path}`);
      }
    }
  }
  const subplotRows = s.delta.offscreen ?? [];
  if (input.livingWorld === 'active') {
    if (subplotRows.length > 2) errors.push('offscreen deltas exceed the active row cap of 2');
    if (subplotRows.filter((row: { op?: string }) => row.op === 'new').length > 1) errors.push('offscreen deltas exceed the active new-row cap of 1');
  }
  for (const [section, rows] of Object.entries(s.delta)) {
    if (!Array.isArray(rows)) continue;
    rows.forEach((row: Record<string, any>, index: number) => {
      const path = `delta.${section}.${index}`;
      const rowEvidence = evidence.get(path) ?? (section === 'offscreen' ? String(row.grounding?.rationale ?? '') : '');
      if (!noEvidence && !rowEvidence) errors.push(`missing evidence: ${path}`);
      if (!noEvidence && rowEvidence && !['threads', 'arcs', 'knowledge', 'offscreen', 'secretReveals'].includes(section)
        && !evidenceGroundsRowClaim(section, row, rowEvidence)) errors.push(`evidence does not materially ground the state change: ${path}`);
      for (const key of ['who', 'keeper', 'about']) if (row[key] && !known(row[key])) errors.push(`unknown ${key}: ${row[key]}`);
      if (section === 'bonds' && (!known(row.a) || !known(row.b) || canonId(row.a) === canonId(row.b))) errors.push('invalid bond identities');
      if (noEvidence) {
        if (section === 'knowledge' && !row.source?.trim()) errors.push('knowledge requires a transmission source');
      } else
      if (section === 'knowledge' && (!row.source?.trim() || !evidence.has(`delta.knowledge.${index}`))) errors.push('knowledge requires a transmission source and evidence');
      if (section === 'knowledge' && !noEvidence) {
        const holder = canonId(row.who);
        const quote = evidence.get(`delta.knowledge.${index}`) ?? '';
        const onStageThisTurn = input.prior.scene.present.map(canonId).includes(holder) || present.has(holder);
        if (quote && !knowledgeFactGrounded(String(row.fact ?? ''), quote)) errors.push(`knowledge fact overreaches its evidence: ${row.who}`);
        if (quote && !knowledgeSourceGrounded(String(row.source ?? ''), quote)) errors.push(`knowledge source is not grounded in its evidence: ${row.who}`);
        // The compiler can read the main scene; an absent character cannot. A
        // durable off-stage update therefore needs the recipient named in the
        // evidence and a witnessed/delivered access channel in that same quote.
        if (!onStageThisTurn && (!quote || !evidenceMentionsActor(input.prior, row.who, quote) || !evidenceHasAccessPath(quote))) {
          errors.push(`off-stage knowledge lacks a delivered access path: ${row.who}`);
        }
      }
      if (section === 'offscreen') {
        const path = `delta.offscreen.${index}`;
        const quote = evidence.get(path) ?? String(row.grounding?.rationale ?? '');
        if (input.livingWorld !== 'active' && input.livingWorld !== 'sandbox') errors.push('offscreen deltas require Living World active or sandbox');
        const prior = input.prior.offscreen.find(item => item.id === row.id);
        if (row.op === 'new' && prior) errors.push(`offscreen new id already exists: ${row.id}`);
        if (row.op !== 'new' && !prior) errors.push(`offscreen mutation requires an existing id: ${row.id}`);
        if (!subplotProofSufficient(row as any, prior)) {
          if (!row.impact?.trim()) errors.push(`subplot lacks a concrete story impact: ${row.id}`);
          else if (!row.beatKind) errors.push(`subplot beat lacks a progress/obstacle/consequence/bridge/resolution type: ${row.id}`);
          else if (!row.grounding?.rationale) errors.push(`subplot lacks semantic grounding evidence: ${row.id}`);
          else if (row.op !== 'new') errors.push(`subplot beat must prove a changed prior condition with grounding.before and grounding.after: ${row.id}`);
          else errors.push(`subplot grounding does not cover its actor and location: ${row.id}`);
        }
        if (row.op !== 'resolve' && mentionsPersona(row.who, row.name, row.gist, row.hooks, row.stakes)) {
          errors.push(`persona cannot appear in an offscreen subplot: ${row.id}`);
        }
        const actorId = row.who ? canonId(row.who) : prior?.who ? canonId(prior.who) : '';
        if (actorId) {
          if (!input.prior.cast[actorId] || actorId === player) errors.push(`offscreen actor must be a known NPC: ${row.who ?? prior?.who}`);
          if (input.prior.cast[actorId]?.deceased) errors.push(`deceased actor cannot act offscreen: ${row.who ?? prior?.who}`);
          if (present.has(actorId)) errors.push(`present actor cannot also be offscreen: ${row.who ?? prior?.who}`);
          const actorName = input.prior.cast[actorId]?.name ?? String(row.who ?? prior?.who ?? '');
          const currentSourceGrounded = !noEvidence && (sourceSupportsEvidence(input.prose, quote) || !!lorebookEvidence(quote));
          const autonomousGrounded = parallelAutonomy && actorCanActInParallel(input.prior, actorName)
            && (row.op === 'resolve'
              ? !!prior && (noEvidence || evidenceGroundsActorResolution(input.prior, actorName, quote))
              : !!row.where && !!row.gist
                && autonomousParallelActivityAllowed(row.gist)
                && autonomousDestinationPlausible(input, lorebookCanon, actorName, row.where)
                && (noEvidence || evidenceGroundsActorActivity(input.prior, actorName, row.where, row.gist, quote)));
          if (row.op === 'resolve') {
            if (!quote && !noEvidence) errors.push(`offscreen resolution is not grounded: ${row.id}`);
            else if (!(currentSourceGrounded || autonomousGrounded)) errors.push(`offscreen resolution is not grounded: ${row.id}`);
            else if (!noEvidence && !evidenceGroundsActorResolution(input.prior, actorName, quote)) errors.push(`offscreen resolution is not grounded: ${row.id}`);
          } else if (!row.where || !row.gist || !(noEvidence || !!quote) || !(currentSourceGrounded || autonomousGrounded) || (!noEvidence && !evidenceMentionsActor(input.prior, actorName, quote))) {
            errors.push(`offscreen beat needs a living named NPC and a scene-grounded or canon-plausible place/activity: ${row.id}`);
          }
          if (!noEvidence && row.op !== 'new' && prior?.where && row.where && !sameLocation(prior.where, row.where)
            && !(evidenceGroundsMove(input.prior, actorName, row.where, quote)
              && (currentSourceGrounded || (autonomousGrounded && elapsedMinutes > 0)))) {
            errors.push(`offscreen relocation is not feasible from ${prior.where}: ${row.id}`);
          }
        } else if (row.op === 'resolve') {
          if (!quote && !noEvidence) errors.push(`offscreen world resolution is not grounded: ${row.id}`);
          else if (!noEvidence && !evidenceGroundsWorldResolution(prior?.where, quote)) errors.push(`offscreen world resolution is not grounded: ${row.id}`);
        } else {
          const currentSourceGrounded = !noEvidence && (sourceSupportsEvidence(input.prose, quote) || !!lorebookEvidence(quote));
          const autonomousGrounded = parallelAutonomy && !!row.gist
            && autonomousParallelActivityAllowed(row.gist)
            && autonomousWorldLocationPlausible(input, lorebookCanon, row.where)
            && (noEvidence || evidenceGroundsWorldActivity(row.where, row.gist, quote));
          if (!row.gist || !(noEvidence || !!quote) || !(currentSourceGrounded || autonomousGrounded)) {
            errors.push(`offscreen world beat needs a scene-grounded or canon-plausible place/activity: ${row.id}`);
          }
        }
        if (!noEvidence && row.op !== 'resolve' && row.gist && activityNeedsAccessPath(row.gist) && !evidenceHasAccessPath(quote)) {
          errors.push(`offscreen knowledge/reaction lacks a delivered access path: ${row.id}`);
        }
      }
      if (section === 'secrets') {
        const secretText = String(row.secret ?? row.text ?? '').trim();
        const audience = normalizeSecretAudience(String(row.keeper ?? ''), row.from);
        const rawAudience = (Array.isArray(row.from) ? row.from : typeof row.from === 'string' ? row.from.split(',') : [])
          .map((value: unknown) => canonId(String(value ?? '').trim())).filter(Boolean);
        if (!secretText) errors.push('new secret requires text');
        if (audience.length !== rawAudience.length || audience.some((id, audienceIndex) => id !== rawAudience[audienceIndex])) {
          errors.push('secret audience must contain distinct named people other than the keeper');
        }
        for (const target of audience) if (!known(target)) errors.push(`unknown secret audience: ${target}`);
        const keeper = canonId(String(row.keeper ?? ''));
        if (input.prior.secrets.some(secret => secret.keeper === keeper && similarFact(secret.text, secretText))) {
          errors.push('tracked secret was recreated; update it by exact id with secretReveals');
        }
      }
      if (section === 'secretReveals') {
        const secret = input.prior.secrets.find(x => x.id === row.id);
        if (!secret) errors.push(`unknown secret id: ${row.id}`);
        if (!Array.isArray(row.to)) errors.push('secret reveal requires an explicit recipient list');
        for (const target of row.to ?? []) if (!known(target)) errors.push(`unknown secret recipient: ${target}`);
      }
    });
  }

  // PLOT CAUSALITY GATE. An exact quote alone can be unrelated to the named
  // track. Require a one-to-one proof record that pins an existing engine id,
  // repeats its actual prior condition, states the new condition verbatim as
  // the note, and uses an operation-appropriate causal basis. This turns a plot
  // update into an auditable before -> evidence -> after transition.
  const proofs = new Map<string, StateCandidate['trackEvidence'][number]>();
  for (const proof of c.trackEvidence) {
    if (proofs.has(proof.path)) errors.push(`duplicate plot proof: ${proof.path}`);
    else proofs.set(proof.path, proof);
  }
  const plotRows = [
    ...((s.delta.threads ?? []).map((row: Record<string, any>, index: number) => ({ section: 'threads' as const, row, index }))),
    ...((s.delta.arcs ?? []).map((row: Record<string, any>, index: number) => ({ section: 'arcs' as const, row, index }))),
  ];
  const changedThreadIds = new Set<string>();
  for (const { section, row, index } of plotRows) {
    if (section !== 'threads') continue;
    const target = input.prior.threads.find(t => trackTitleKey(t.name) === trackTitleKey(row.name));
    if (target && row.op !== 'new') changedThreadIds.add(target.id);
  }
  // In no-evidence mode the model omits trackEvidence quotations. Synthesize a
  // deterministic proof from the prior canonical state and the row's own note so
  // the causality gate (target, before -> after, basis, changed condition) still
  // runs without demanding a quotation. The quote is never lexically validated.
  if (noEvidence) for (const { section, row, index } of plotRows) {
    const path = `delta.${section}.${index}`;
    if (proofs.has(path)) continue;
    const note = String(row.note ?? '').trim();
    if (!note) continue; // the note-required error below covers this
    const priorList = section === 'threads' ? input.prior.threads : input.prior.arcs;
    const target = priorList.find(t => trackTitleKey(t.name) === trackTitleKey(String(row.name ?? '')));
    const op = String(row.op ?? 'advance');
    proofs.set(path, {
      path, targetId: target ? target.id : 'new',
      before: target ? trackBefore(target) : 'absent',
      after: note, quote: note,
      basis: op === 'new' ? 'new_open_question' : op === 'resolve' ? 'closed_question'
        : section === 'threads' && op === 'stall' ? 'blocked_attempt'
        : section === 'threads' ? 'direct_development' : 'structural_milestone',
    } as StateCandidate['trackEvidence'][number]);
  }

  // Graph references are part of the accepted transaction, not advisory text.
  // They may target a canonical row or another row created in this candidate,
  // but never disappear merely because that target did not exist at T0.
  const resolvesTrack = (raw: unknown, prior: ChronicleState['threads'], candidateRows: Array<Record<string, any>>): boolean => {
    const key = trackTitleKey(String(raw ?? ''));
    return !!key && (prior.some(track => trackTitleKey(track.id) === key || trackTitleKey(track.name) === key)
      || candidateRows.some(track => trackTitleKey(track.id ?? '') === key || trackTitleKey(track.name) === key));
  };
  const candidateThreads = (s.delta.threads ?? []) as Array<Record<string, any>>;
  const candidateArcs = (s.delta.arcs ?? []) as Array<Record<string, any>>;
  for (let index = 0; index < candidateThreads.length; index++) {
    const row = candidateThreads[index]!;
    if (row.arc && !resolvesTrack(row.arc, input.prior.arcs, candidateArcs)) errors.push(`unknown parent arc: delta.threads.${index}`);
  }
  for (let index = 0; index < (s.delta.offscreen ?? []).length; index++) {
    const row = (s.delta.offscreen ?? [])[index] as Record<string, any>;
    if (row.thread && !resolvesTrack(row.thread, input.prior.threads, candidateThreads)) errors.push(`unknown subplot thread: delta.offscreen.${index}`);
    if (row.arc && !row.thread) errors.push(`subplot arc requires a thread link: delta.offscreen.${index}`);
    if (row.arc && !resolvesTrack(row.arc, input.prior.arcs, candidateArcs)) errors.push(`unknown subplot arc: delta.offscreen.${index}`);
  }
  const allowedBasis = (section: 'threads' | 'arcs', op: string): Set<string> => {
    if (op === 'new') return new Set(['new_open_question']);
    if (op === 'resolve') return new Set(['closed_question']);
    if (section === 'threads' && op === 'advance') return new Set(['direct_development']);
    if (section === 'threads' && op === 'stall') return new Set(['blocked_attempt']);
    if (section === 'arcs' && op === 'advance') return new Set(['child_milestone', 'structural_milestone']);
    return new Set();
  };
  for (const { section, row, index } of plotRows) {
    const path = `delta.${section}.${index}`;
    const proof = proofs.get(path);
    if (!proof) { errors.push(`missing plot proof: ${path}`); continue; }
    const quote = evidence.get(path);
    if (!noEvidence && (!quote || evidenceText(proof.quote) !== evidenceText(quote) || !(sourceSupportsEvidence(input.prose, proof.quote) || !!lorebookEvidence(proof.quote)))) errors.push(`plot proof must be grounded in the current scene or attached canon: ${path}`);
    if (!noEvidence && lorebookEvidence(proof.quote) && row.op !== 'new') errors.push(`lorebook baseline cannot advance or resolve an existing plot row: ${path}`);
    const note = String(row.note ?? '').trim();
    if (!note) errors.push(`plot change requires a concrete resulting condition: ${path}`);
    else if (evidenceText(proof.after) !== evidenceText(note)) errors.push(`plot proof after must equal the plot note: ${path}`);
    if (!allowedBasis(section, String(row.op)).has(proof.basis)) errors.push(`plot proof basis does not match ${section}.${row.op}: ${path}`);

    const priorList = section === 'threads' ? input.prior.threads : input.prior.arcs;
    const target = priorList.find(t => trackTitleKey(t.name) === trackTitleKey(row.name));
    if (row.op === 'new') {
      if (target) errors.push(`new plot row already exists: ${path}`);
      if (proof.targetId !== 'new' || trackTitleKey(proof.before) !== 'absent') errors.push(`new plot proof must target new from absent: ${path}`);
    } else {
      if (!target || /resolv/i.test(target.status || '')) errors.push(`plot mutation must target an open exact prior title: ${path}`);
      else {
        if (proof.targetId !== target.id) errors.push(`plot proof target id mismatch: ${path}`);
        const before = trackBefore(target);
        const priorConditions = [before, target.status, ...target.beats.slice(-3)];
        if (!priorConditions.some(condition => sameTransitionText(proof.before, condition))) errors.push(`plot proof before does not match prior state: ${path}`);
        if (note && row.op !== 'resolve' && sameTransitionText(before, note)) errors.push(`plot change does not alter the prior condition: ${path}`);
      }
    }

    if (!noEvidence && !plotProofGrounded(target, String(row.name), proof, input.prior)) errors.push(`plot proof is not grounded in the tracked situation: ${path}`);

    if (section === 'arcs' && proof.basis === 'child_milestone') {
      const arc = target;
      const children = new Set(input.prior.threads.filter(t => t.arc === arc?.id).map(t => t.id));
      const cited = proof.childThreadIds ?? [];
      if (!cited.length || !cited.some((id: string) => children.has(id) && changedThreadIds.has(id))) {
        errors.push(`arc child milestone requires a changed linked thread: ${path}`);
      }
    }
    if (section === 'threads' && proof.childThreadIds?.length) errors.push(`thread proof cannot cite child threads: ${path}`);
  }
  for (const path of proofs.keys()) if (!plotRows.some(x => `delta.${x.section}.${x.index}` === path)) errors.push(`orphan plot proof: ${path}`);
  const pathsByQuote = new Map<string, string[]>();
  for (const proof of c.trackEvidence) pathsByQuote.set(proof.quote, [...(pathsByQuote.get(proof.quote) ?? []), proof.path]);
  for (const paths of pathsByQuote.values()) {
    if (paths.length < 2) continue;
    const rows = paths.map(path => ({ path, proof: proofs.get(path), plot: plotRows.find(x => `delta.${x.section}.${x.index}` === path) }));
    const thread = rows.find(x => x.plot?.section === 'threads');
    const arc = rows.find(x => x.plot?.section === 'arcs');
    const threadTarget = thread?.plot ? input.prior.threads.find(t => trackTitleKey(t.name) === trackTitleKey(thread.plot!.row.name)) : undefined;
    const arcTarget = arc?.plot ? input.prior.arcs.find(t => trackTitleKey(t.name) === trackTitleKey(arc.plot!.row.name)) : undefined;
    const validParentPair = paths.length === 2 && !!threadTarget && !!arcTarget
      && threadTarget.arc === arcTarget.id && arc?.proof?.basis === 'child_milestone'
      && !!arc.proof.childThreadIds?.includes(threadTarget.id);
    if (!validParentPair) errors.push(`one prose quote cannot advance unrelated plot rows: ${paths.join(', ')}`);
  }
  for (const [section, rows] of Object.entries(s.ext)) {
    if (!Array.isArray(rows)) continue;
    rows.forEach((row: any, i: number) => {
      const path = `ext.${section}.${i}`;
      const rowEvidence = evidence.get(path) ?? '';
      if (!noEvidence) {
        if (!rowEvidence) errors.push(`missing evidence: ${path}`);
        else if (!evidenceGroundsRowClaim(section, row, rowEvidence)) errors.push(`evidence does not materially ground the state change: ${path}`);
      }
      if (row.who && row.who !== 'world' && !known(row.who)) errors.push(`unknown owner: ${row.who}`);
      if (row.op === 'give' && (!row.to || !known(row.to))) errors.push('give requires a known recipient');
      if (section === 'codex' && row.op === 'refresh' && (!row.id || !input.prior.lore.some(x => x.id === row.id))) errors.push(`codex refresh requires an existing id: ${row.id ?? '(missing)'}`);
      if (section === 'codex' && row.id && !input.prior.lore.some(x => x.id === row.id)) errors.push(`unknown codex id: ${row.id}`);
      if (section === 'timeline') {
        if (row.location && !literalName(row.location) && row.location !== input.prior.scene.location && !(input.prior.locations ?? []).some(x => x.name === row.location)) errors.push(`unknown timeline location: ${row.location}`);
        for (const participant of row.participants ?? []) if (!known(participant)) errors.push(`unknown timeline participant: ${participant}`);
      }
      if ((section === 'intent' || section === 'affect' || section === 'introduction') && canonId(row.who) === player) errors.push(`${section} is NPC-only`);
      if (section === 'introduction') {
        const actor = input.prior.cast[canonId(row.who)];
        if (actor?.introduction) errors.push(`introduction packet already exists: ${row.who}`);
        const signature = `${String(row.want).toLocaleLowerCase()}\u0000${String(row.voiceTell).toLocaleLowerCase()}`;
        if (Object.values(input.prior.cast).some(other => other.introduction && `${other.introduction.want.toLocaleLowerCase()}\u0000${other.introduction.voiceTell.toLocaleLowerCase()}` === signature)) errors.push(`introduction packet is not distinct: ${row.who}`);
      }
    });
  }
  // Actor rows are operation-addressable. Anonymous world rows have no stable
  // identity, so preserve them verbatim; the previous implementation filtered
  // them out here and Engine Second Pass silently erased them every turn.
  const anonymousRows = input.prior.parallel
    .filter(p => !p.who)
    .map(p => ({ ...(p.where ? { where: p.where } : {}), activity: p.activity, ...(p.note ? { note: p.note } : {}) }));
  const rows = new Map(input.prior.parallel.filter(p => p.who).map(p => {
    const id = canonId(p.who!);
    return [id, { who: input.prior.cast[id]?.name ?? p.who!, where: p.where ?? '', activity: p.activity, note: p.note }];
  }));
  // Durable subplots are the authoritative physical commitment. Build the T1
  // commitment independently of the volatile parallel snapshot; after all
  // operations, the snapshot must mirror the newest active beat exactly.
  const subplotState = new Map(input.prior.offscreen.map((row, index) => [row.id, { ...row, _order: (row.lastTurn ?? 0) * 1000 + index }]));
  const resolvedSubplotActors = new Set<string>();
  for (let index = 0; index < (s.delta.offscreen ?? []).length; index++) {
    const mutation = s.delta.offscreen![index] as Record<string, any>;
    const prior = subplotState.get(mutation.id);
    const actor = canonId(String(mutation.who ?? prior?.who ?? ''));
    if (mutation.op === 'resolve') {
      if (prior) subplotState.set(mutation.id, { ...prior, status: 'resolved', _order: input.turn * 1000 + index });
      if (actor) resolvedSubplotActors.add(actor);
      continue;
    }
    subplotState.set(mutation.id, {
      ...(prior ?? { id: mutation.id, name: mutation.name ?? mutation.id, status: 'active', gist: '', beats: [], firstTurn: input.turn, lastTurn: input.turn }),
      ...mutation, status: 'active', who: actor || undefined, _order: input.turn * 1000 + index,
    });
  }
  const subplotCommitments = new Map<string, { id: string; where: string; activity: string; order: number }>();
  for (const subplot of subplotState.values()) {
    const actor = canonId(String(subplot.who ?? ''));
    if (!actor || subplot.status !== 'active' || !subplot.where?.trim() || !subplot.gist?.trim()) continue;
    const current = subplotCommitments.get(actor);
    const order = Number(subplot._order ?? 0);
    if (!current || order >= current.order) subplotCommitments.set(actor, { id: subplot.id, where: subplot.where, activity: subplot.gist, order });
  }
  const operated = new Set<string>();
  const autonomousSupport = parallelGrounding(input);
  for (const op of c.parallelOps) {
    const id = canonId(op.who);
    if (id === player || mentionsPersona(op.who, op.activity, op.evidence)) errors.push(`persona cannot appear in a parallel event: ${op.who}`);
    if (operated.has(id)) errors.push(`duplicate parallel operation: ${id}`);
    operated.add(id);
    const previous = rows.get(id);
    const opEvidenceText = String(op.evidence ?? '');
    const sourceProof = opEvidenceText && (sourceSupportsEvidence(input.prose, opEvidenceText) || !!lorebookEvidence(opEvidenceText)) ? opEvidenceText : '';
    const sourceGrounded = !!sourceProof && (op.op === 'resolve'
      ? evidenceGroundsActorResolution(input.prior, op.who, sourceProof)
      : op.op === 'move'
        ? !!op.where?.trim() && evidenceGroundsMove(input.prior, op.who, op.where, sourceProof)
        : !!op.where?.trim() && !!op.activity?.trim()
          && evidenceGroundsActorActivity(input.prior, op.who, op.where, op.activity, sourceProof));
    const priorBacked = !sourceGrounded && op.op === 'start'
      && autonomousSupport.some(row => row.evidence === op.evidence
        && !!op.where && !!op.activity
        && evidenceGroundsActorActivity(input.prior, op.who, op.where, op.activity, row.evidence));
    const autonomousProof = parallelAutonomy && actorCanActInParallel(input.prior, op.who)
      && (noEvidence
        ? op.op === 'resolve'
          ? !!previous
          : !!op.where?.trim() && !!op.activity?.trim()
            && autonomousParallelActivityAllowed(op.activity)
            && autonomousDestinationPlausible(input, lorebookCanon, op.who, op.where)
        : !!opEvidenceText.trim() && (op.op === 'resolve'
          ? !!previous && evidenceGroundsActorResolution(input.prior, op.who, opEvidenceText)
          : !!op.where?.trim() && !!op.activity?.trim()
            && autonomousParallelActivityAllowed(op.activity)
            && autonomousDestinationPlausible(input, lorebookCanon, op.who, op.where)
            && evidenceGroundsActorActivity(input.prior, op.who, op.where, op.activity, opEvidenceText)
            && (op.op !== 'move' || (elapsedMinutes > 0 && evidenceGroundsMove(input.prior, op.who, op.where, opEvidenceText)))));
    const operationProof = (sourceGrounded ? sourceProof : '') || ((priorBacked || autonomousProof) ? opEvidenceText : '');
    const grounded = priorBacked || sourceGrounded || autonomousProof;
    if (!grounded) errors.push(`parallel operation is not grounded in the scene or a canon-plausible life/location/activity: ${id}`);
    if (!known(op.who)) errors.push(`unknown parallel actor: ${id}`);
    if (input.prior.cast[id]?.deceased) errors.push(`deceased actor cannot act in parallel: ${id}`);
    if (op.op === 'start' && rows.has(id)) errors.push(`parallel start already exists: ${id}`);
    if (op.op !== 'start' && !rows.has(id)) errors.push(`parallel operation has no prior row: ${id}`);
    const anchor = canonicalActorLocation(input.prior, id);
    const anchorStale = (input.prior.cast[id]?.lastLocationTurn ?? -1) < input.turn - 1;
    if (op.op === 'start' && anchor && op.where && !sameLocation(anchor.where, op.where)
      && !(autonomousProof && anchorStale)
      && !(operationProof && elapsedMinutes > 0 && evidenceGroundsMove(input.prior, op.who, op.where, operationProof))
      && !noEvidence) {
      errors.push(`parallel start contradicts canonical location ${anchor.where}: ${id}`);
    }
    if (op.op === 'advance' && previous?.where && op.where && !sameLocation(previous.where, op.where)) {
      errors.push(`parallel advance cannot relocate ${id}; use move with travel evidence`);
    }
    if (op.op === 'move' && previous?.where && op.where && sameLocation(previous.where, op.where)) {
      errors.push(`parallel move does not change location: ${id}`);
    }
    if (!noEvidence && op.op !== 'resolve' && op.activity && activityNeedsAccessPath(op.activity)
      && !evidenceHasAccessPath(operationProof || op.evidence)) {
      errors.push(`parallel knowledge/reaction lacks a delivered access path: ${id}`);
    }
    if (op.op === 'resolve') rows.delete(id);
    else {
      if (!op.where?.trim() || !op.activity?.trim()) errors.push(`parallel ${op.op} requires where and activity`);
      rows.set(id, { who: op.who, where: op.where ?? '', activity: op.activity ?? '', note: undefined });
    }
  }
  const operatedWorld = new Set<string>();
  for (const op of c.parallelWorldOps ?? []) {
    if (mentionsPersona(op.activity, op.note, op.evidence)) errors.push('persona cannot appear in a parallel world event');
    const opEvidenceText = String(op.evidence ?? '');
    const sourceProof = opEvidenceText && (sourceSupportsEvidence(input.prose, opEvidenceText) || !!lorebookEvidence(opEvidenceText)) ? opEvidenceText : '';
    const autonomousProof = parallelAutonomy
      && (noEvidence
        ? op.op === 'resolve'
          ? true
          : !!op.activity?.trim() && autonomousParallelActivityAllowed(op.activity)
            && autonomousWorldLocationPlausible(input, lorebookCanon, op.where ?? op.priorWhere)
        : !!opEvidenceText.trim()
          && (op.op === 'resolve'
            ? evidenceGroundsWorldResolution(op.priorWhere, opEvidenceText)
            : !!op.activity?.trim()
              && autonomousParallelActivityAllowed(op.activity)
              && autonomousWorldLocationPlausible(input, lorebookCanon, op.where ?? op.priorWhere)
              && evidenceGroundsWorldActivity(op.where ?? op.priorWhere, op.activity, opEvidenceText)
              && (op.op !== 'move' || (!!op.where && elapsedMinutes > 0 && evidenceGroundsWorldMove(op.where, opEvidenceText)))));
    const operationProof = sourceProof || (autonomousProof ? opEvidenceText : '');
    if (!operationProof && !noEvidence) errors.push('parallel world operation is not grounded in the scene or a canon-plausible place/activity');
    if (op.op === 'start') {
      if (op.priorActivity || op.priorWhere) errors.push('parallel world start cannot target a prior row');
      if (!op.activity?.trim()) errors.push('parallel world start requires activity');
      else if (!operationProof && !noEvidence) errors.push('parallel world start is not grounded to place and activity');
      else if (operationProof && !noEvidence && !evidenceGroundsWorldActivity(op.where, op.activity, operationProof)) errors.push('parallel world start is not grounded to place and activity');
      else anonymousRows.push({ ...(op.where ? { where: op.where } : {}), activity: op.activity, ...(op.note ? { note: op.note } : {}) });
      continue;
    }
    if (!op.priorActivity?.trim()) { errors.push(`parallel world ${op.op} requires priorActivity`); continue; }
    const matches = anonymousRows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.activity === op.priorActivity && (!op.priorWhere || row.where === op.priorWhere));
    if (matches.length !== 1) { errors.push(`parallel world ${op.op} must target one exact prior row`); continue; }
    const target = matches[0]!;
    const key = `${target.row.where ?? ''}\u0000${target.row.activity}`;
    if (operatedWorld.has(key)) errors.push('duplicate parallel world operation');
    operatedWorld.add(key);
    if (op.op === 'resolve') {
      if (operationProof && !noEvidence && !evidenceGroundsWorldResolution(target.row.where, operationProof)) errors.push('parallel world resolve lacks an explicit ending at its established place');
      else anonymousRows.splice(target.index, 1);
    }
    else if (!op.activity?.trim()) errors.push(`parallel world ${op.op} requires activity`);
    else {
      if (op.op === 'advance' && target.row.where && op.where && !sameLocation(target.row.where, op.where)) errors.push('parallel world advance cannot change location; use move');
      if (!noEvidence && op.op === 'move' && (!op.where || sameLocation(target.row.where, op.where) || !operationProof || !evidenceGroundsWorldMove(op.where, operationProof))) errors.push('parallel world move requires a new destination and movement evidence');
      if (operationProof && !noEvidence && !evidenceGroundsWorldActivity(op.where ?? target.row.where, op.activity, operationProof)) errors.push(`parallel world ${op.op} is not grounded to place and activity`);
      anonymousRows[target.index] = { ...(op.where ? { where: op.where } : target.row.where ? { where: target.row.where } : {}), activity: op.activity, ...(op.note ? { note: op.note } : {}) };
    }
  }
  // Arrivals are removed by the engine; unchanged off-stage actors survive omissions.
  for (const id of resolvedSubplotActors) rows.delete(id);
  for (const [id, commitment] of subplotCommitments) {
    if (present.has(id)) { rows.delete(id); continue; }
    const parallel = rows.get(id);
    if (operated.has(id) && parallel && (!sameLocation(parallel.where, commitment.where) || parallel.activity.trim() !== commitment.activity.trim())) {
      errors.push(`parallel activity contradicts active subplot ${commitment.id}: ${id}`);
      continue;
    }
    rows.set(id, {
      who: input.prior.cast[id]?.name ?? id,
      where: commitment.where,
      activity: commitment.activity,
      note: undefined,
    });
  }
  for (const id of present) rows.delete(id);
  if (errors.length) return { ok: false, errors };
  const state = { ...s, delta: { ...s.delta, parallel: [...anonymousRows, ...rows.values()] } };
  return {
    ok: true,
    candidate: c,
    baseHash: stateRevision(input.prior),
    block: `<vellum>\n${JSON.stringify(state)}\n</vellum>`,
    ...(recoveredDayCount ? { recovered: ['state.day (kept canonical story-day count)'] } : {}),
  };
}

/**
 * Build a conservative, structurally complete document that a repair pass can
 * patch when the provider stopped before returning parseable JSON. It contains
 * only the prior canonical snapshot and empty change sets, so using it as the
 * repair base cannot invent a story change by itself.
 */
export function compilerRepairBase(input: CompilerInput): StateCandidate {
  const priorClock = input.prior.scene.clock ?? parseClock(input.prior.scene.time) ?? 0;
  const player = canonId(input.userName);
  return {
    state: {
      turn: input.turn,
      day: input.prior.day,
      scene: {
        loc: input.prior.scene.location || 'Unknown location',
        time: clockTime(priorClock),
        clock: priorClock,
        // A legacy or externally edited Chronicle may contain an old invalid
        // value. Do not let that poison every repair base: tension is optional,
        // and only an already-valid canonical value is safe to carry forward.
        ...(Number.isFinite(input.prior.scene.tension) && input.prior.scene.tension >= 0 && input.prior.scene.tension <= 10
          ? { tension: input.prior.scene.tension }
          : {}),
        ...(input.prior.scene.weather ? { weather: input.prior.scene.weather } : {}),
      },
      present: input.prior.scene.present.map(id => {
        const actor = input.prior.cast[canonId(id)];
        const detail = input.prior.scene.detail.find(row => canonId(row.id) === canonId(id));
        const isPlayer = canonId(id) === player;
        return {
          id: actor?.name ?? id,
          ...(detail?.presence ? { presence: detail.presence } : {}),
          ...(detail?.mood && (!isPlayer || input.personaState) ? { mood: detail.mood } : {}),
          ...(detail?.doing && (!isPlayer || input.personaState) ? { doing: detail.doing } : {}),
          ...(detail?.condition && (!isPlayer || input.personaState) ? { condition: detail.condition } : {}),
          thought: (!isPlayer || input.personaState) ? detail?.thought ?? '' : '',
          ...(actor?.traits?.length && (!isPlayer || input.personaState) ? { traits: actor.traits } : {}),
        };
      }),
      delta: {},
      ext: {},
    },
    parallelOps: [],
    parallelWorldOps: [],
    parallelReviewed: input.prior.parallel
      .filter(row => row.who)
      .map(row => input.prior.cast[canonId(row.who!)]?.name ?? row.who!),
    evidence: [],
    trackEvidence: [],
    genesis: false,
  };
}

/** Apply RFC 7396 JSON Merge Patch without permitting prototype keys. Arrays
 * are atomic in the format, which is desirable here: a repair replaces only a
 * faulty evidence/delta list while untouched branches stay byte-for-byte equal. */
export function applyCompilerMergePatch(base: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return structuredClone(patch);
  const target: Record<string, unknown> = base && typeof base === 'object' && !Array.isArray(base)
    ? structuredClone(base as Record<string, unknown>)
    : {};
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
    if (value === null) delete target[key];
    else target[key] = applyCompilerMergePatch(target[key], value);
  }
  return target;
}

function pruneCompilerShape(value: unknown, schema: Record<string, any>): unknown {
  if (schema.anyOf) {
    const branch = schema.anyOf.find((option: Record<string, unknown>) => option.type === 'array' ? Array.isArray(value)
      : option.type === 'object' ? !!value && typeof value === 'object' && !Array.isArray(value)
        : option.type === typeof value) ?? schema.anyOf[0];
    return pruneCompilerShape(value, branch);
  }
  if (schema.type === 'array') return Array.isArray(value) ? value.map(item => pruneCompilerShape(item, schema.items ?? {})) : value;
  if (schema.type !== 'object' || !value || typeof value !== 'object' || Array.isArray(value) || !schema.properties) return value;
  const source = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(schema.properties).filter(([key]) => key in source).map(([key, child]) => [key, pruneCompilerShape(source[key], child as Record<string, any>)]));
}

function compilerRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function adoptCompilerKey(owner: Record<string, any>, canonical: string, aliases: string[]): void {
  if (owner[canonical] !== undefined) return;
  for (const alias of aliases) {
    if (owner[alias] === undefined) continue;
    owner[canonical] = owner[alias];
    delete owner[alias];
    return;
  }
}

/** Canonicalize the paths providers most often copy from the full candidate
 * shape. Evidence paths are relative to state, even though models commonly
 * emit `state.scene.loc`, JSONPath, bracket indexes, or inline section names. */
function canonicalCompilerPath(value: unknown): string {
  let path = String(value ?? '').trim()
    .replace(/^\$\.?/, '')
    .replace(/\[(?:["']?)([A-Za-z_][\w-]*|\d+)(?:["']?)\]/g, '.$1')
    .replace(/\.+/g, '.')
    .replace(/^state\./i, '')
    .replace(/^delta\.(?:relations|relationships)(?=\.|$)/i, 'delta.bonds')
    .replace(/^delta\.(?:plotThreads|plot_threads)(?=\.|$)/i, 'delta.threads')
    .replace(/^delta\.(?:storyArcs|story_arcs)(?=\.|$)/i, 'delta.arcs')
    .replace(/^delta\.(?:offscreenEvents|offscreen_events|subplots)(?=\.|$)/i, 'delta.offscreen')
    .replace(/^delta\.(?:parallelEvents|parallel_events)(?=\.|$)/i, 'delta.parallel')
    .replace(/^delta\.faction_relations(?=\.|$)/i, 'delta.factionRelations')
    .replace(/^scene\.(?:location|place)$/i, 'scene.loc')
    .replace(/^scene\.clock$/i, 'scene.time')
    .replace(/^extensions?(?=\.|$)/i, 'ext')
    .replace(/^\.+|\.+$/g, '');
  return path;
}

function compilerQuote(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!compilerRecord(value)) return '';
  for (const key of ['quote', 'evidence', 'text', 'source', 'excerpt']) {
    const nested = value[key];
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
  }
  return '';
}

/** Preserve the source's exact casing and whitespace when a provider returns a
 * case-insensitive or whitespace-normalized quotation. This never fabricates
 * text: the returned slice must still exist verbatim in the current turn. */
function exactCompilerQuote(quote: string, source: string): string {
  if (!quote || source.includes(quote)) return quote;
  const direct = source.toLocaleLowerCase().indexOf(quote.toLocaleLowerCase());
  if (direct >= 0) return source.slice(direct, direct + quote.length);
  const pattern = quote.split(/\s+/).filter(Boolean).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  if (!pattern) return quote;
  const match = new RegExp(pattern, 'iu').exec(source);
  return match?.[0] ?? quote;
}

/** Find an unambiguous provider-supplied field that is itself a contiguous
 * current-turn excerpt. This fills bookkeeping the model omitted; it never
 * manufactures a quotation or accepts a paraphrase as evidence. */
function inferredRowEvidence(row: Record<string, any>, source: string): string {
  for (const key of ['note', 'gist', 'memory', 'fact', 'event', 'why', 'was', 'activity', 'secret', 'nextStep', 'goal', 'what']) {
    const value = typeof row[key] === 'string' ? row[key].trim() : '';
    if (value && sourceContainsEvidence(source, value)) return value;
  }
  return '';
}

function compilerArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function normalizeEvidenceRows(value: unknown, source: string): Array<Record<string, string>> {
  const rows: unknown[] = compilerRecord(value) && !('path' in value)
    ? Object.entries(value).map(([path, quote]) => ({ path, quote }))
    : compilerArray(value);
  const byPath = new Map<string, Record<string, string>>();
  for (const value of rows) {
    if (!compilerRecord(value)) continue;
    const path = canonicalCompilerPath(value.path ?? value.field ?? value.target ?? value.key);
    const rawQuote = compilerQuote(value.quote ?? value.evidence ?? value.source ?? value.text ?? value.excerpt);
    if (!path || !rawQuote || byPath.has(path)) continue;
    byPath.set(path, { path, quote: exactCompilerQuote(rawQuote, source) });
  }
  return [...byPath.values()];
}

function normalizePlotProofRows(root: Record<string, any>, input: CompilerInput, source: string): void {
  root.trackEvidence = compilerArray(root.trackEvidence).flatMap((value): Record<string, any>[] => {
    if (!compilerRecord(value)) return [];
    adoptCompilerKey(value, 'path', ['field', 'target', 'key']);
    adoptCompilerKey(value, 'targetId', ['target_id', 'id', 'trackId', 'track_id']);
    adoptCompilerKey(value, 'before', ['previous', 'prior', 'beforeState', 'before_state']);
    adoptCompilerKey(value, 'after', ['result', 'next', 'afterState', 'after_state', 'note']);
    adoptCompilerKey(value, 'quote', ['evidence', 'source', 'text', 'excerpt']);
    adoptCompilerKey(value, 'basis', ['reason', 'kind', 'type']);
    adoptCompilerKey(value, 'childThreadIds', ['linkedThreads', 'linked_threads', 'childThreads', 'child_threads']);
    value.path = canonicalCompilerPath(value.path);
    value.quote = exactCompilerQuote(compilerQuote(value.quote), source);
    if (typeof value.childThreadIds === 'string') value.childThreadIds = value.childThreadIds.split(/[,;|]/).map((part: string) => part.trim()).filter(Boolean);
    const basis = String(value.basis ?? '').trim().toLocaleLowerCase().replace(/[\s-]+/g, '_');
    const basisAliases: Record<string, string> = {
      new: 'new_open_question', open_question: 'new_open_question', new_question: 'new_open_question',
      advance: 'direct_development', development: 'direct_development', direct: 'direct_development',
      stall: 'blocked_attempt', blocked: 'blocked_attempt', resolve: 'closed_question', closed: 'closed_question',
      milestone: 'structural_milestone', child: 'child_milestone',
    };
    value.basis = basisAliases[basis] ?? basis;
    return [value];
  });

  const delta = compilerRecord(root.state?.delta) ? root.state.delta : {};
  for (const section of ['threads', 'arcs'] as const) {
    const rows = Array.isArray(delta[section]) ? delta[section] : [];
    const prior = section === 'threads' ? input.prior.threads : input.prior.arcs;
    rows.forEach((row: Record<string, any>, index: number) => {
      const path = `delta.${section}.${index}`;
      const target = prior.find(track => trackTitleKey(track.name) === trackTitleKey(String(row.name ?? '')));
      let proof = root.trackEvidence.find((item: Record<string, any>) => item.path === path);
      // `status:"open"` is a common snapshot spelling. The shared block
      // normalizer maps it to `new`; retarget it when that title already exists.
      if (target && row.op === 'new') row.op = 'advance';
      // Models often emit `status:"active"` on a thread; the shared normalizer
      // adopts it as `op` and maps "active" to "advance". When that thread does
      // not exist in the prior ledger, "advance" is impossible — it must be a
      // new opener. Correct the op so ARGENT and plot causality see it as such.
      if (!target && (row.op === 'advance' || row.op === 'stall')) row.op = 'new';
      const evidence = root.evidence?.find((item: Record<string, any>) => item.path === path);
      if (!proof && row.note && (input.evidenceMode === 'none' || evidence?.quote)) {
        const op = String(row.op ?? 'advance');
        proof = {
          path,
          targetId: target ? target.id : 'new',
          before: target ? trackBefore(target) : 'absent',
          after: String(row.note),
          quote: evidence?.quote ?? String(row.note),
          basis: op === 'new' ? 'new_open_question'
            : op === 'resolve' ? 'closed_question'
              : section === 'threads' && op === 'stall' ? 'blocked_attempt'
                : section === 'threads' ? 'direct_development' : 'structural_milestone',
        };
        root.trackEvidence.push(proof);
      }
      if (!proof) return;
      if (target) {
        if (!proof.targetId || proof.targetId === 'new' || proof.targetId === row.id) proof.targetId = target.id;
        if (!proof.before || trackTitleKey(proof.before) === 'absent') proof.before = trackBefore(target);
        if (proof.basis === 'new_open_question' && row.op === 'advance') proof.basis = section === 'threads' ? 'direct_development' : 'structural_milestone';
      } else if (row.op === 'new') {
        if (!proof.targetId || proof.targetId === row.id) proof.targetId = 'new';
        if (!proof.before) proof.before = 'absent';
      }
      if (!proof.after && row.note) proof.after = String(row.note);
    });
  }
}

/** Compatibility layer shared by initial Engine Pass output and merge-patch
 * repairs. It only canonicalizes unambiguous shape/format drift; the semantic
 * validator remains responsible for chronology, canon, agency, and causality. */
function normalizeCompilerEnvelope(root: Record<string, any>, input: CompilerInput): void {
  adoptCompilerKey(root, 'parallelOps', ['parallel_ops', 'parallelOperations', 'parallel_operations']);
  adoptCompilerKey(root, 'parallelWorldOps', ['parallel_world_ops', 'parallelWorldOperations', 'worldOps', 'world_ops']);
  adoptCompilerKey(root, 'parallelReviewed', ['parallel_reviewed', 'reviewedParallel', 'reviewed_parallel']);
  adoptCompilerKey(root, 'trackEvidence', ['track_evidence', 'plotEvidence', 'plot_evidence']);
  adoptCompilerKey(root, 'genesis', ['isGenesis', 'is_genesis']);
  const source = `${input.userInput ?? ''}\n${input.prose}`;
  const state = compilerRecord(root.state) ? root.state : {};
  // Older/full-state providers put the on-stage id list and its tracker rows
  // inside scene.present + scene.detail. The Engine Pass schema uses one
  // top-level array of present objects instead. Rejoin those two losslessly
  // before normalizeStateBlockObject filters non-object roster members; if we
  // wait until after that pass, every string id (including the persona) has
  // already disappeared and repair can loop on a false "player in present"
  // failure.
  const legacyScene = compilerRecord(state.scene) ? state.scene : undefined;
  const suppliedPresent = Array.isArray(state.present)
    ? state.present
    : Array.isArray(legacyScene?.present) ? legacyScene.present : undefined;
  if (suppliedPresent) {
    const details = new Map(
      compilerArray(legacyScene?.detail)
        .filter(compilerRecord)
        .map(row => [canonId(String(row.id ?? row.name ?? row.who ?? row.character ?? '')), row] as const)
        .filter(([id]) => !!id),
    );
    const player = canonId(input.userName);
    state.present = suppliedPresent.flatMap(value => {
      const row = compilerRecord(value) ? { ...value } : { id: String(value ?? '').trim() };
      const id = canonId(String(row.id ?? row.name ?? row.who ?? row.character ?? ''));
      if (!id) return [];
      const detail = details.get(id);
      const merged: Record<string, any> = detail ? { ...detail, ...row } : row;
      if (player && id === player) {
        merged.id = input.userName;
        const priorDetail = input.prior.scene.detail.find(entry => canonId(entry.id) === player);
        for (const field of ['mood', 'doing', 'condition', 'thought'] as const) {
          if (!String(merged[field] ?? '').trim() && priorDetail?.[field]) merged[field] = priorDetail[field];
        }
        const priorTraits = input.prior.cast[player]?.traits;
        if ((!Array.isArray(merged.traits) || !merged.traits.length) && priorTraits?.length) merged.traits = priorTraits;
      }
      return [merged];
    });
  }
  normalizeStateBlockObject(state);
  if (input.personaState && input.userName && Array.isArray(state.present)) {
    for (const row of state.present) {
      if (!compilerRecord(row)) continue;
      const id = canonId(String(row.id ?? row.name ?? ''));
      if (['vellum_persona', 'player', 'user', 'persona'].includes(id)) row.id = input.userName;
    }
  }
  root.state = state;

  const embeddedEvidence: Array<Record<string, unknown>> = [];
  const remember = (path: string, row: unknown): void => {
    if (!compilerRecord(row)) return;
    const quote = compilerQuote(row.evidence ?? row.quote ?? row.source);
    if (quote) embeddedEvidence.push({ path, quote });
  };
  if (compilerRecord(state.scene)) {
    if (compilerRecord(state.scene.evidence)) {
      remember('scene.loc', { evidence: state.scene.evidence.loc ?? state.scene.evidence.location });
      remember('scene.time', { evidence: state.scene.evidence.time ?? state.scene.evidence.clock });
      const rosterQuote = compilerQuote(state.scene.evidence.present ?? state.scene.evidence.roster);
      if (rosterQuote && Array.isArray(state.present)) {
        const priorPresent = new Set(input.prior.scene.present.map(canonId));
        const nextPresent = new Set(state.present.filter(compilerRecord).map(row => canonId(String(row.id ?? row.name ?? ''))).filter(Boolean));
        for (const id of nextPresent) if (!priorPresent.has(id)) embeddedEvidence.push({ path: `present.add.${id}`, quote: rosterQuote });
        for (const id of priorPresent) if (!nextPresent.has(id)) embeddedEvidence.push({ path: `present.remove.${id}`, quote: rosterQuote });
      }
    }
  }
  if (compilerRecord(state.delta)) for (const [section, rows] of Object.entries(state.delta)) {
    compilerArray(rows).forEach((row, index) => remember(`delta.${section}.${index}`, row));
  }
  if (compilerRecord(state.ext)) for (const [section, rows] of Object.entries(state.ext)) {
    compilerArray(rows).forEach((row, index) => remember(`ext.${section}.${index}`, row));
  }
  const explicitEvidence = normalizeEvidenceRows(root.evidence, source);
  const inferredEvidence: Array<Record<string, unknown>> = [];
  if (input.evidenceMode !== 'none') {
  if (compilerRecord(state.delta)) for (const [section, rows] of Object.entries(state.delta)) {
    compilerArray(rows).forEach((row, index) => {
      if (!compilerRecord(row)) return;
      const path = `delta.${section}.${index}`;
      if (explicitEvidence.some(entry => entry.path === path) || embeddedEvidence.some(entry => entry.path === path)) return;
      const quote = inferredRowEvidence(row, source);
      if (quote) inferredEvidence.push({ path, quote });
    });
  }
  if (compilerRecord(state.ext)) for (const [section, rows] of Object.entries(state.ext)) {
    compilerArray(rows).forEach((row, index) => {
      if (!compilerRecord(row)) return;
      const path = `ext.${section}.${index}`;
      if (explicitEvidence.some(entry => entry.path === path) || embeddedEvidence.some(entry => entry.path === path)) return;
      const quote = inferredRowEvidence(row, source);
      if (quote) inferredEvidence.push({ path, quote });
    });
  }
  }
  root.evidence = normalizeEvidenceRows([...explicitEvidence, ...embeddedEvidence, ...inferredEvidence], source);

  for (const key of ['parallelOps', 'parallelWorldOps'] as const) {
    root[key] = compilerArray(root[key]).flatMap(value => {
      if (!compilerRecord(value)) return [];
      adoptCompilerKey(value, 'op', ['action', 'operation', 'status']);
      adoptCompilerKey(value, 'who', ['id', 'actor', 'character']);
      adoptCompilerKey(value, 'where', ['loc', 'location']);
      adoptCompilerKey(value, 'activity', ['gist', 'event', 'doing']);
      value.evidence = exactCompilerQuote(compilerQuote(value.evidence ?? value.quote ?? value.source), source);
      if (input.evidenceMode === 'none' && !String(value.evidence ?? '').trim()) {
        value.evidence = [value.op, value.who, value.where, value.activity, value.note]
          .filter(part => typeof part === 'string' && part.trim()).join(' — ').trim() || 'autonomous operation';
      }
      return [value];
    });
  }
  root.parallelReviewed = compilerArray(root.parallelReviewed).map(value => String(value).trim()).filter(Boolean);
  normalizePlotProofRows(root, input, source);
  // A valid trackEvidence quote is also the evidence for that same plot path.
  // Providers need not duplicate it byte-for-byte in two sibling arrays.
  root.evidence = normalizeEvidenceRows([
    ...root.evidence,
    ...root.trackEvidence.map((proof: Record<string, any>) => ({ path: proof.path, quote: proof.quote })),
  ], source);
}

const COMPILER_STATE_KEYS = [
  'v', 'turn', 'day', 'scene', 'currentScene', 'current_scene', 'present', 'charactersPresent', 'characters_present', 'roster', 'persona', 'personaState', 'persona_state', 'playerState', 'player_state',
  'delta', 'ext', 'extensions', 'extension', 'bonds', 'relations', 'relationships', 'threads', 'plotThreads', 'plot_threads',
  'arcs', 'storyArcs', 'story_arcs', 'journal', 'knowledge', 'secrets', 'secretReveals', 'factions', 'factionRelations',
  'faction_relations', 'parallel', 'parallelEvents', 'parallel_events', 'offscreen', 'offscreenEvents', 'offscreen_events', 'subplots',
] as const;

function looksLikeCompilerState(value: unknown): value is Record<string, any> {
  return compilerRecord(value) && COMPILER_STATE_KEYS.some(key => value[key] !== undefined);
}

/** Fill only required structural boilerplate and discard unsupported keys before
 * strict validation. Defaults preserve prior state; they never create a delta. */
function preparedCompilerCandidate(raw: unknown, input: CompilerInput): unknown {
  if (!compilerRecord(raw)) return raw;
  let normalized = structuredClone(raw);
  for (const key of ['candidate', 'result', 'output']) {
    if (!compilerRecord(normalized.state) && (compilerRecord(normalized[key]?.state) || looksLikeCompilerState(normalized[key]))) normalized = normalized[key];
  }
  if (!compilerRecord(normalized.state) && looksLikeCompilerState(normalized)) {
    normalized.state = Object.fromEntries(COMPILER_STATE_KEYS.filter(key => normalized[key] !== undefined).map(key => [key, normalized[key]]));
  }
  normalizeCompilerEnvelope(normalized, input);
  const pruned = pruneCompilerShape(normalized, jsonSchema(CompilerCandidate));
  if (!pruned || typeof pruned !== 'object' || Array.isArray(pruned)) return pruned;
  const root = pruned as Record<string, any>;
  const state = root.state && typeof root.state === 'object' && !Array.isArray(root.state) ? root.state : {};
  const rawScene = state.scene && typeof state.scene === 'object' && !Array.isArray(state.scene) ? state.scene : {};
  const priorClock = input.prior.scene.clock ?? parseClock(input.prior.scene.time) ?? 0;
  const normalizedClock = typeof rawScene.clock === 'string' ? parseClock(rawScene.clock) : rawScene.clock;
  const suppliedClock = Number.isSafeInteger(normalizedClock) ? normalizedClock : undefined;
  const suppliedTimeClock = typeof rawScene.time === 'string' ? parseClock(rawScene.time) : undefined;
  const clock = suppliedClock ?? suppliedTimeClock ?? priorClock;
  // parseClock deliberately accepts friendly provider spellings ("2:47 AM",
  // "three in the morning", "dusk"). The compiler owns normalization: when
  // both fields exist, the explicit minute clock is authoritative and time is
  // rewritten to its exact zero-padded representation before validation.
  const time = clockTime(clock);
  const visibleHeader = proseSceneHeader(input.prose);
  const priorRows = input.prior.scene.present.map(id => {
    const actor = input.prior.cast[id];
    const detail = input.prior.scene.detail.find(row => canonId(row.id) === id);
    return { id: actor?.name ?? id, ...(detail?.presence ? { presence: detail.presence } : {}), ...(detail?.mood ? { mood: detail.mood } : {}), ...(detail?.doing ? { doing: detail.doing } : {}), ...(detail?.condition ? { condition: detail.condition } : {}), thought: detail?.thought ?? '', ...(actor?.traits?.length ? { traits: actor.traits } : {}) };
  });
  root.state = {
    ...state,
    turn: Number.isSafeInteger(state.turn) ? state.turn : input.turn,
    day: Number.isSafeInteger(state.day) ? state.day : input.prior.day,
    scene: { ...rawScene, ...(!rawScene.title && visibleHeader ? { title: visibleHeader.title } : {}), ...(!rawScene.title && !visibleHeader && (!rawScene.transition || rawScene.transition === 'continue') && input.prior.scene.title ? { title: input.prior.scene.title } : {}), loc: typeof rawScene.loc === 'string' && rawScene.loc.trim() ? rawScene.loc : input.prior.scene.location, time, clock },
    present: Array.isArray(state.present) ? state.present : priorRows,
    delta: state.delta && typeof state.delta === 'object' && !Array.isArray(state.delta) ? state.delta : {},
    ext: state.ext && typeof state.ext === 'object' && !Array.isArray(state.ext) ? state.ext : {},
  };
  // Present rows are snapshots only when supplied, but a thought is optional
  // provider work. Fill the internal shape from prior tracker detail (or empty)
  // so a missing flourish cannot erase an otherwise valid roster update.
  for (const row of Array.isArray(root.state.present) ? root.state.present : []) {
    if (!compilerRecord(row) || typeof row.thought === 'string') continue;
    const id = canonId(String(row.id ?? row.name ?? ''));
    row.thought = input.prior.scene.detail.find(detail => canonId(detail.id) === id)?.thought ?? '';
  }
  // Normalize the only user-shaped identity arrays before schema validation.
  // This turns a provider loop such as ["Cersei", "Cersei", ...] into one
  // bounded audience instead of discarding the whole otherwise-valid candidate.
  for (const row of Array.isArray(root.state.delta.secrets) ? root.state.delta.secrets : []) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !('from' in row)) continue;
    row.from = normalizeSecretAudience(String(row.keeper ?? ''), row.from);
  }
  for (const row of Array.isArray(root.state.delta.secretReveals) ? root.state.delta.secretReveals : []) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !Array.isArray(row.to)) continue;
    const secret = input.prior.secrets.find(candidate => candidate.id === row.id);
    row.to = normalizeSecretAudience(secret?.keeper ?? '', row.to);
  }
  root.parallelOps = Array.isArray(root.parallelOps) ? root.parallelOps : [];
  root.parallelWorldOps = Array.isArray(root.parallelWorldOps) ? root.parallelWorldOps : [];
  root.parallelReviewed = Array.isArray(root.parallelReviewed)
    ? root.parallelReviewed
    : input.prior.parallel.filter(row => row.who).map(row => input.prior.cast[canonId(row.who!)]?.name ?? row.who!);
  root.evidence = Array.isArray(root.evidence) ? root.evidence : [];
  root.trackEvidence = Array.isArray(root.trackEvidence) ? root.trackEvidence : [];
  root.genesis = typeof root.genesis === 'boolean' ? root.genesis : false;

  // A malformed optional member should cost only that member, not the complete
  // scene snapshot. Zod gives the exact array index; remove those rows once and
  // let the strict schema and semantic validator decide the remainder.
  for (let pass = 0; pass < 4; pass++) {
    const checked = CompilerCandidate.safeParse(root);
    if (checked.success) return checked.data;
    let changed = false;
    const removals = new Map<any[], Set<number>>();
    for (const path of checked.error.issues.map(issue => issue.path)) {
      const index = path.find(value => typeof value === 'number');
      if (typeof index !== 'number') continue;
      const prefix = path.slice(0, path.indexOf(index)).join('.');
      if (!/^state\.(delta|ext)\.[^.]+$/.test(prefix) && !/^(parallelOps|parallelWorldOps|evidence|trackEvidence|parallelReviewed)$/.test(prefix)) continue;
      let owner: any = root;
      for (const key of path.slice(0, path.indexOf(index))) owner = owner?.[key as any];
      if (Array.isArray(owner) && index < owner.length) {
        const indexes = removals.get(owner) ?? new Set<number>();
        indexes.add(index); removals.set(owner, indexes);
      }
    }
    for (const [owner, indexes] of removals) {
      for (const index of [...indexes].sort((a, b) => b - a)) owner.splice(index, 1);
      changed = true;
    }
    if (!changed) break;
  }
  return root;
}

/**
 * Keep a structurally valid compiler reply useful when one optional mutation is
 * unsupported. The strict validator remains the authority: this routine starts
 * from the candidate's core scene/roster snapshot, then admits each delta,
 * extension, and parallel operation only when the whole candidate still passes.
 * It never rewrites evidence or manufactures a state change.
 */
export function salvageCompilation(raw: unknown, input: CompilerInput): Compilation {
  const prepared = preparedCompilerCandidate(raw, input);
  const shapeRecovered = JSON.stringify(prepared) !== JSON.stringify(raw);
  const parsed = CompilerCandidate.safeParse(prepared);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) };
  const original = parsed.data;
  const direct = validateCompilation(structuredClone(original), input);
  if (direct.ok) return shapeRecovered ? { ...direct, recovered: ['candidate shape'] } : direct;

  const currentSource = `${input.userInput ?? ''}\n${input.prose}`;
  const selectedLorebook = compilerLorebookCanon(input);
  const validEvidence = original.evidence.filter((entry, index, rows) => {
    if (input.evidenceMode === 'none') return rows.findIndex(other => other.path === entry.path) === index;
    const source = entry.path === 'scene.loc' || entry.path === 'scene.time'
      || entry.path.startsWith('present.add.') || entry.path.startsWith('present.remove.')
      ? currentSource : input.prose;
    return (sourceContainsEvidence(source, entry.quote) || !!lorebookQuoteEntry(selectedLorebook, entry.quote))
      && rows.findIndex(other => other.path === entry.path) === index;
  });
  const evidenceFor = (path: string): StateCandidate['evidence'][number] | undefined =>
    input.evidenceMode === 'none' ? undefined : validEvidence.find(entry => entry.path === path);
  const priorClock = input.prior.scene.clock ?? parseClock(input.prior.scene.time) ?? 0;
  const scene = structuredClone(original.state.scene);
  const parsedSceneClock = parseClock(scene.time);
  if (parsedSceneClock !== null && parsedSceneClock !== undefined) scene.clock = parsedSceneClock;
  else scene.time = clockTime(scene.clock);
  if (original.state.day * 1440 + scene.clock < input.prior.day * 1440 + priorClock) {
    original.state.day = input.prior.day;
    scene.clock = priorClock;
    scene.time = clockTime(priorClock);
  }
  if (scene.loc !== input.prior.scene.location && !evidenceFor('scene.loc')) scene.loc = input.prior.scene.location || scene.loc;
  if ((original.state.day !== input.prior.day || scene.clock !== priorClock) && !evidenceFor('scene.time')) {
    original.state.day = input.prior.day;
    scene.clock = priorClock;
    scene.time = clockTime(priorClock);
  }

  const known = new Set(Object.keys(input.prior.cast));
  const player = canonId(input.userName);
  if (player) known.add(player);
  const priorPresent = new Set(input.prior.scene.present.map(canonId));
  const priorDetail = new Map(input.prior.scene.detail.map(row => [canonId(row.id), row]));
  const seen = new Set<string>();
  const present: StateCandidate['state']['present'] = [];
  for (const row of original.state.present) {
    const id = canonId(row.id);
    if (!id || seen.has(id)) continue;
    const established = known.has(id) || input.prose.toLocaleLowerCase().includes(row.id.toLocaleLowerCase());
    if (!established) continue;
    if (!priorPresent.has(id) && id !== player && !evidenceFor(`present.add.${id}`)) continue;
    const old = priorDetail.get(id);
    const merged = { ...old, ...row, id: row.id };
    if (id === player && !input.personaState) {
      merged.mood = ''; merged.doing = ''; merged.condition = ''; merged.thought = '';
      delete (merged as Record<string, unknown>).traits;
    }
    seen.add(id);
    present.push(merged);
  }
  for (const id of priorPresent) {
    if (seen.has(id) || evidenceFor(`present.remove.${id}`)) continue;
    const actor = input.prior.cast[id];
    const old = priorDetail.get(id);
    if (!actor) continue;
    const restored: StateCandidate['state']['present'][number] = { id: actor.name, thought: old?.thought ?? '' };
    if (old?.presence) restored.presence = old.presence;
    if (old?.mood) restored.mood = old.mood;
    if (old?.doing) restored.doing = old.doing;
    if (old?.condition) restored.condition = old.condition;
    if (actor.traits?.length) restored.traits = actor.traits;
    if (id === player && !input.personaState) {
      restored.thought = ''; restored.mood = ''; restored.doing = ''; restored.condition = ''; delete restored.traits;
    }
    seen.add(id);
    present.push(restored);
  }

  const coreEvidence = validEvidence.filter(entry => entry.path === 'scene.loc' || entry.path === 'scene.time'
    || entry.path.startsWith('present.add.') || entry.path.startsWith('present.remove.') || entry.path.startsWith('present.persona.'));
  let accepted: StateCandidate = {
    state: { turn: input.turn, day: original.state.day, scene, present, delta: {}, ext: {} },
    parallelOps: [], parallelWorldOps: [],
    parallelReviewed: input.prior.parallel.filter(row => row.who).map(row => input.prior.cast[canonId(row.who!)]?.name ?? row.who!),
    evidence: coreEvidence, trackEvidence: [], genesis: false,
  };
  const core = validateCompilation(structuredClone(accepted), input);
  if (!core.ok) return { ok: false, errors: [...new Set([...direct.errors, ...core.errors])].slice(0, 50) };

  const dropped: string[] = [];
  const suggestions: CompilationSuggestion[] = [];
  const attemptCandidate = (build: (candidate: StateCandidate) => void): { ok: true } | { ok: false; errors: string[] } => {
    const trial = structuredClone(accepted);
    build(trial);
    const checked = validateCompilation(trial, input);
    if (checked.ok) { accepted = trial; return { ok: true }; }
    return { ok: false, errors: checked.errors };
  };
  const tryCandidate = (label: string, build: (candidate: StateCandidate) => void, suggestion?: Omit<CompilationSuggestion, 'id' | 'reason'>): boolean => {
    const result = attemptCandidate(build);
    if (result.ok) return true;
    dropped.push(label);
    if (suggestion) suggestions.push({
      id: `suggest_${input.turn}_${suggestion.kind}_${hashStr(`${label}\u0000${JSON.stringify(suggestion.row)}`).slice(0, 10)}`,
      ...suggestion,
      reason: result.errors[0] ?? 'The strict compiler could not ground this change.',
    });
    return false;
  };

  // Plot rows form a graph. Admit the complete valid graph first so a new child
  // may reference a new parent arc in this same candidate. If the graph itself
  // is invalid, fall back to row-level salvage and retain every rejected row as
  // an explicit suggestion.
  const plotSections = new Set(['threads', 'arcs']);
  const hasPlotRows = !!((original.state.delta.threads?.length ?? 0) + (original.state.delta.arcs?.length ?? 0));
  const plotGraphAccepted = hasPlotRows && attemptCandidate(candidate => {
    for (const section of ['threads', 'arcs'] as const) {
      const rows = original.state.delta[section] ?? [];
      if (!rows.length) continue;
      (candidate.state.delta as Record<string, unknown[]>)[section] = structuredClone(rows);
      rows.forEach((_row: unknown, index: number) => {
        const path = `delta.${section}.${index}`;
        const proof = evidenceFor(path); if (proof) candidate.evidence.push(proof);
        const trackProof = original.trackEvidence.find(entry => entry.path === path); if (trackProof) candidate.trackEvidence.push(trackProof);
      });
    }
  }).ok;

  const appendDeltaRow = (candidate: StateCandidate, section: string, row: unknown, originalIndex: number): void => {
    const delta = candidate.state.delta as Record<string, unknown[]>;
    const next = [...(delta[section] ?? []), row];
    delta[section] = next;
    const path = `delta.${section}.${next.length - 1}`;
    const oldPath = `delta.${section}.${originalIndex}`;
    const proof = evidenceFor(oldPath);
    if (proof) candidate.evidence.push({ ...proof, path });
    const trackProof = original.trackEvidence.find(entry => entry.path === oldPath);
    if (trackProof) candidate.trackEvidence.push({ ...trackProof, path });
  };

  if (hasPlotRows && !plotGraphAccepted) {
    let pending = (['threads', 'arcs'] as const).flatMap(section => (original.state.delta[section] ?? []).map((row: Record<string, unknown>, originalIndex: number) => ({ section, row, originalIndex, errors: [] as string[] })));
    for (let pass = 0; pending.length && pass <= pending.length; pass++) {
      let progressed = false;
      const next: typeof pending = [];
      for (const item of pending) {
        const result = attemptCandidate(candidate => appendDeltaRow(candidate, item.section, item.row, item.originalIndex));
        if (result.ok) progressed = true;
        else next.push({ ...item, errors: result.errors });
      }
      pending = next;
      if (!progressed) break;
    }
    for (const item of pending) {
      const label = `delta.${item.section}.${item.originalIndex}`;
      dropped.push(label);
      suggestions.push({
        id: `suggest_${input.turn}_${item.section === 'threads' ? 'thread' : 'arc'}_${hashStr(`${label}\u0000${JSON.stringify(item.row)}`).slice(0, 10)}`,
        kind: item.section === 'threads' ? 'thread' : 'arc', row: structuredClone(item.row) as Record<string, unknown>,
        reason: item.errors[0] ?? 'The strict compiler could not ground this change.',
      });
    }
  }

  for (const [section, rows] of Object.entries(original.state.delta)) {
    if (!Array.isArray(rows)) continue;
    if (plotSections.has(section)) continue;
    rows.forEach((row, originalIndex) => tryCandidate(`delta.${section}.${originalIndex}`, candidate => {
      appendDeltaRow(candidate, section, row, originalIndex);
    }, section === 'threads' || section === 'arcs' || section === 'offscreen'
      ? { kind: section === 'threads' ? 'thread' : section === 'arcs' ? 'arc' : 'offscreen', row: structuredClone(row) as Record<string, unknown> }
      : undefined));
  }
  for (const [section, rows] of Object.entries(original.state.ext)) {
    if (!Array.isArray(rows)) continue;
    rows.forEach((row, originalIndex) => tryCandidate(`ext.${section}.${originalIndex}`, candidate => {
      const ext = candidate.state.ext as Record<string, unknown[]>;
      const next = [...(ext[section] ?? []), row];
      ext[section] = next;
      const proof = evidenceFor(`ext.${section}.${originalIndex}`);
      if (proof) candidate.evidence.push({ ...proof, path: `ext.${section}.${next.length - 1}` });
      if (section === 'codex' && original.genesis && input.genesisAllowed) candidate.genesis = true;
    }));
  }
  original.parallelOps.forEach((operation, index) => tryCandidate(`parallelOps.${index}`, candidate => { candidate.parallelOps.push(operation); }));
  (original.parallelWorldOps ?? []).forEach((operation, index) => tryCandidate(`parallelWorldOps.${index}`, candidate => {
    (candidate.parallelWorldOps ??= []).push(operation);
  }));
  if (original.genesis && !accepted.genesis) tryCandidate('genesis', candidate => { candidate.genesis = true; });

  const final = validateCompilation(accepted, input);
  if (!final.ok) return final;
  const recovered = [...(shapeRecovered ? ['candidate shape'] : []), ...dropped];
  return { ...final, ...(recovered.length ? { recovered } : {}), ...(suggestions.length ? { suggestions } : {}) };
}

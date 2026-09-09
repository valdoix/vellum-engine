import { z } from 'zod';
import { ParsedState } from '../parse/parsed.js';
import { canonId, hashStr } from '../core/ids.js';
import { clockTime, elapsedClockFloor, parseClock, reconcileDay, supportsDayAdvance } from './clock.js';
import { factTokens, similarFact } from './fact-match.js';
import type { ChronicleState } from './types.js';
import type { LorebookCanonEntry } from './lorebook-canon.js';
import {
  activityNeedsAccessPath,
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
export const CompilerState = z.object({
  turn: z.number().int().nonnegative(), day: z.number().int().nonnegative(),
  scene: z.object({ loc: text, time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), clock: z.number().int().min(0).max(1439), tension: z.number().min(0).max(10).optional(), weather: z.string().max(500).optional() }).strict(),
  present: item({ id: name, mood: z.string().max(500).optional(), doing: z.string().max(500).optional(), condition: z.string().max(500).optional(), thought: z.string().max(1200), traits: z.array(name).max(12).optional() }),
  delta: Delta.omit({ parallel: true }),
  ext: z.object({
    scars: item({ who: name, was: text, about: name.optional() }).optional(),
    codex: item({ id: name.optional(), op: z.enum(['add', 'refresh']).optional(), fact: text, tag: name.optional() }).optional(),
    inventory: item({ who: name, item: text, op: z.enum(['gain', 'lose', 'give', 'scene', 'note']), to: name.optional(), note: text.optional() }).optional(),
    timeline: item({ event: text, day: z.number().int().nonnegative().optional(), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), location: name.optional(), participants: z.array(name).max(20).optional(), importance: z.enum(['minor', 'major', 'critical']).optional() }).optional(),
    plant: item({ what: text }).optional(), payoff: item({ what: text }).optional(),
  }).strict(),
}).strict();
export const CompilerCandidate = z.object({
  state: CompilerState,
  parallelOps: item({ op: z.enum(['start', 'advance', 'move', 'resolve']), who: name, where: text.optional(), activity: text.optional(), evidence: text }),
  parallelWorldOps: item({
    op: z.enum(['start', 'advance', 'move', 'resolve']),
    priorActivity: text.optional(),
    priorWhere: text.optional(),
    where: text.optional(),
    activity: text.optional(),
    note: text.optional(),
    evidence: text,
  }).optional(),
  // Every prior row must be accounted for. A forgotten actor cannot silently disappear.
  parallelReviewed: z.array(name).max(200),
  evidence: item({ path: text, quote: text }),
  // Plot mutations get a stricter, track-specific proof record. Generic prose
  // evidence is insufficient: the compiler must identify the exact prior row,
  // state its previous and resulting conditions, and classify the causal step.
  trackEvidence: item({
    path: z.string().regex(/^delta\.(threads|arcs)\.\d+$/),
    targetId: name,
    before: text,
    after: text,
    quote: text,
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
  genesisAllowed: boolean;
  verbosity?: 'lean' | 'full';
  codexAllowed?: boolean;
  inventoryAllowed?: boolean;
  livingWorld?: 'off' | 'minimal' | 'active' | 'sandbox';
  agency?: 'protected' | 'continuity' | 'director';
  personaState?: boolean;
  /** Relevant entries from lorebooks explicitly attached to this chat. These
   * constrain objective world canon; they are never automatic actor knowledge. */
  lorebookCanon?: readonly LorebookCanonEntry[];
};
export type Compilation = { ok: true; block: string; candidate: StateCandidate; baseHash: string; recovered?: string[] } | { ok: false; errors: string[] };
export const stateRevision = (state: ChronicleState): string => hashStr(JSON.stringify(state));

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

export function validateCompilation(raw: unknown, input: CompilerInput): Compilation {
  const parsed = CompilerCandidate.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) };
  const c = parsed.data;
  const s = c.state;
  const errors: string[] = [];
  if (s.turn !== input.turn) errors.push('turn must equal the engine turn');
  const priorClock = input.prior.scene.clock ?? parseClock(input.prior.scene.time) ?? 0;
  const currentTurnSource = `${input.userInput ?? ''}\n${input.prose}`;
  // A time cut in the latest player input is part of this turn even when the
  // generated prose does not repeat it. Deterministically repair a candidate
  // that left the clock frozen or advanced it by less than the stated duration.
  const flooredClock = elapsedClockFloor(input.prior.day, priorClock, s.day, s.scene.clock, currentTurnSource);
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
  const timeProof = c.evidence.find(e => e.path === 'scene.time' && currentTurnSource.includes(e.quote));
  const proofAt = timeProof ? currentTurnSource.indexOf(timeProof.quote) : -1;
  const proofContext = proofAt >= 0
    ? currentTurnSource.slice(Math.max(0, proofAt - 80), Math.min(currentTurnSource.length, proofAt + timeProof!.quote.length + 80))
    : (flooredClock.inferred ? currentTurnSource : undefined);
  const dayAdvanceEvidence = s.day > input.prior.day
    && supportsDayAdvance(proofContext, priorClock, s.scene.clock, s.day - input.prior.day);
  const dayReconcile = reconcileDay(s.day, input.prior.day, dayAdvanceEvidence, { priorClock, newClock: s.scene.clock });
  s.day = dayReconcile.day;
  const recoveredDayCount = s.day !== reportedDay;
  const [h, m] = s.scene.time.split(':').map(Number);
  if (h! * 60 + m! !== s.scene.clock) errors.push('time and clock disagree');
  if (s.day * 1440 + s.scene.clock < input.prior.day * 1440 + priorClock) errors.push('clock moves backward');
  const currentTurnEvidencePath = (path: string): boolean => path === 'scene.loc' || path === 'scene.time' || path.startsWith('present.add.') || path.startsWith('present.remove.');
  const evidenceSource = (path: string): string => currentTurnEvidencePath(path) ? currentTurnSource : input.prose;
  const needsEvidence = (path: string, changed: boolean, derived = false) => {
    if (changed && !derived && !c.evidence.some(e => e.path === path && evidenceSource(path).includes(e.quote))) errors.push(`missing evidence: ${path}`);
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
    } else if (!p.thought.trim()) errors.push(`missing NPC thought: ${p.id}`);
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
    if (input.personaState && e.path.startsWith('present.persona.')) {
      // Evidence is optional for tracker-only inference. If a compiler includes
      // it, still reject fabricated quotations.
      const allowed = (input.userInput ?? '').includes(e.quote) || input.prose.includes(e.quote);
      if (!allowed) errors.push(`persona evidence is not a current-turn source quote: ${e.path}`);
    } else if (!evidenceSource(e.path).includes(e.quote)) errors.push(`evidence is not an allowed source quote: ${e.path}`);
  }
  for (const [section, rows] of Object.entries(s.delta)) {
    if (!Array.isArray(rows)) continue;
    rows.forEach((row: Record<string, any>, index: number) => {
      if (!evidence.has(`delta.${section}.${index}`)) errors.push(`missing evidence: delta.${section}.${index}`);
      for (const key of ['who', 'keeper', 'about']) if (row[key] && !known(row[key])) errors.push(`unknown ${key}: ${row[key]}`);
      if (section === 'bonds' && (!known(row.a) || !known(row.b) || canonId(row.a) === canonId(row.b))) errors.push('invalid bond identities');
      if (section === 'knowledge' && (!row.source?.trim() || !evidence.has(`delta.knowledge.${index}`))) errors.push('knowledge requires a transmission source and evidence');
      if (section === 'knowledge') {
        const holder = canonId(row.who);
        const quote = evidence.get(`delta.knowledge.${index}`) ?? '';
        const onStageThisTurn = input.prior.scene.present.map(canonId).includes(holder) || present.has(holder);
        if (!onStageThisTurn && quote && !knowledgeSourceGrounded(String(row.source ?? ''), quote)) errors.push(`knowledge source is not grounded in its evidence: ${row.who}`);
        // The compiler can read the main scene; an absent character cannot. A
        // durable off-stage update therefore needs the recipient named in the
        // evidence and a witnessed/delivered access channel in that same quote.
        if (!onStageThisTurn && (!quote || !evidenceMentionsActor(input.prior, row.who, quote) || !evidenceHasAccessPath(quote))) {
          errors.push(`off-stage knowledge lacks a delivered access path: ${row.who}`);
        }
      }
      if (section === 'secretReveals') {
        const secret = input.prior.secrets.find(x => x.id === row.id);
        if (!secret) errors.push(`unknown secret id: ${row.id}`);
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
    if (!quote || proof.quote !== quote || !input.prose.includes(proof.quote)) errors.push(`plot proof must reuse exact prose evidence: ${path}`);
    const note = String(row.note ?? '').trim();
    if (!note) errors.push(`plot change requires a concrete resulting condition: ${path}`);
    else if (trackTitleKey(proof.after) !== trackTitleKey(note)) errors.push(`plot proof after must equal the plot note: ${path}`);
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
        if (trackTitleKey(proof.before) !== trackTitleKey(before)) errors.push(`plot proof before does not match prior state: ${path}`);
        if (note && row.op !== 'resolve' && sameTransitionText(before, note)) errors.push(`plot change does not alter the prior condition: ${path}`);
      }
    }

    if (!plotProofGrounded(target, String(row.name), proof, input.prior)) errors.push(`plot proof is not grounded in the tracked situation: ${path}`);

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
      if (!evidence.has(`ext.${section}.${i}`)) errors.push(`missing evidence: ext.${section}.${i}`);
      if (row.who && row.who !== 'world' && !known(row.who)) errors.push(`unknown owner: ${row.who}`);
      if (row.op === 'give' && (!row.to || !known(row.to))) errors.push('give requires a known recipient');
      if (section === 'codex' && row.op === 'refresh' && (!row.id || !input.prior.lore.some(x => x.id === row.id))) errors.push(`codex refresh requires an existing id: ${row.id ?? '(missing)'}`);
      if (section === 'codex' && row.id && !input.prior.lore.some(x => x.id === row.id)) errors.push(`unknown codex id: ${row.id}`);
      if (section === 'timeline') {
        if (row.location && !literalName(row.location) && row.location !== input.prior.scene.location && !(input.prior.locations ?? []).some(x => x.name === row.location)) errors.push(`unknown timeline location: ${row.location}`);
        for (const participant of row.participants ?? []) if (!known(participant)) errors.push(`unknown timeline participant: ${participant}`);
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
  const reviewed = new Set(c.parallelReviewed.map(canonId));
  for (const id of rows.keys()) if (!reviewed.has(id)) errors.push(`parallel actor not reviewed: ${id}`);
  const operated = new Set<string>();
  const autonomousSupport = parallelGrounding(input);
  for (const op of c.parallelOps) {
    const id = canonId(op.who);
    if (operated.has(id)) errors.push(`duplicate parallel operation: ${id}`);
    operated.add(id);
    const previous = rows.get(id);
    const proseQuote = input.prose.includes(op.evidence) ? op.evidence : '';
    const priorBacked = !proseQuote && op.op === 'start'
      && autonomousSupport.some(row => row.evidence === op.evidence
        && !!op.where && !!op.activity
        && evidenceGroundsActorActivity(input.prior, op.who, op.where, op.activity, row.evidence));
    let grounded = priorBacked;
    if (proseQuote) {
      if (op.op === 'start') grounded = !!op.where && !!op.activity
        && evidenceGroundsActorActivity(input.prior, op.who, op.where, op.activity, proseQuote);
      else if (op.op === 'move') grounded = !!op.where && evidenceGroundsMove(input.prior, op.who, op.where, proseQuote)
        && (!previous || previous.activity === op.activity || (!!op.activity && evidenceGroundsActorActivity(input.prior, op.who, op.where, op.activity, proseQuote)));
      else if (op.op === 'advance') grounded = !!op.where && !!op.activity
        && evidenceGroundsActorActivity(input.prior, op.who, op.where, op.activity, proseQuote);
      else grounded = evidenceGroundsActorResolution(input.prior, op.who, proseQuote);
    }
    if (!grounded) errors.push(`parallel operation is not grounded to actor, place, and activity: ${id}`);
    if (!known(op.who)) errors.push(`unknown parallel actor: ${id}`);
    if (op.op === 'start' && rows.has(id)) errors.push(`parallel start already exists: ${id}`);
    if (op.op !== 'start' && !rows.has(id)) errors.push(`parallel operation has no prior row: ${id}`);
    const anchor = canonicalActorLocation(input.prior, id);
    if (op.op === 'start' && anchor && op.where && !sameLocation(anchor.where, op.where)
      && !(proseQuote && evidenceGroundsMove(input.prior, op.who, op.where, proseQuote))) {
      errors.push(`parallel start contradicts canonical location ${anchor.where}: ${id}`);
    }
    if (op.op === 'advance' && previous?.where && op.where && !sameLocation(previous.where, op.where)) {
      errors.push(`parallel advance cannot relocate ${id}; use move with travel evidence`);
    }
    if (op.op === 'move' && previous?.where && op.where && sameLocation(previous.where, op.where)) {
      errors.push(`parallel move does not change location: ${id}`);
    }
    if (op.op !== 'resolve' && op.activity && activityNeedsAccessPath(op.activity)
      && !(proseQuote ? evidenceHasAccessPath(proseQuote) : evidenceHasAccessPath(op.evidence))) {
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
    const proseQuote = input.prose.includes(op.evidence) ? op.evidence : '';
    if (!proseQuote) errors.push('parallel world operation lacks prose evidence');
    if (op.op === 'start') {
      if (op.priorActivity || op.priorWhere) errors.push('parallel world start cannot target a prior row');
      if (!op.activity?.trim()) errors.push('parallel world start requires activity');
      else if (!proseQuote || !evidenceGroundsWorldActivity(op.where, op.activity, proseQuote)) errors.push('parallel world start is not grounded to place and activity');
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
      if (!proseQuote || !evidenceGroundsWorldResolution(target.row.where, proseQuote)) errors.push('parallel world resolve lacks an explicit ending at its established place');
      else anonymousRows.splice(target.index, 1);
    }
    else if (!op.activity?.trim()) errors.push(`parallel world ${op.op} requires activity`);
    else {
      if (op.op === 'advance' && target.row.where && op.where && !sameLocation(target.row.where, op.where)) errors.push('parallel world advance cannot change location; use move');
      if (op.op === 'move' && (!op.where || sameLocation(target.row.where, op.where) || !proseQuote || !evidenceGroundsWorldMove(op.where, proseQuote))) errors.push('parallel world move requires a new destination and movement evidence');
      if (!proseQuote || !evidenceGroundsWorldActivity(op.where ?? target.row.where, op.activity, proseQuote)) errors.push(`parallel world ${op.op} is not grounded to place and activity`);
      anonymousRows[target.index] = { ...(op.where ? { where: op.where } : target.row.where ? { where: target.row.where } : {}), activity: op.activity, ...(op.note ? { note: op.note } : {}) };
    }
  }
  // Arrivals are removed by the engine; unchanged off-stage actors survive omissions.
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

/** Fill only required structural boilerplate and discard unsupported keys before
 * strict validation. Defaults preserve prior state; they never create a delta. */
function preparedCompilerCandidate(raw: unknown, input: CompilerInput): unknown {
  const pruned = pruneCompilerShape(raw, jsonSchema(CompilerCandidate));
  if (!pruned || typeof pruned !== 'object' || Array.isArray(pruned)) return pruned;
  const root = pruned as Record<string, any>;
  const state = root.state && typeof root.state === 'object' && !Array.isArray(root.state) ? root.state : {};
  const rawScene = state.scene && typeof state.scene === 'object' && !Array.isArray(state.scene) ? state.scene : {};
  const priorClock = input.prior.scene.clock ?? parseClock(input.prior.scene.time) ?? 0;
  const suppliedClock = Number.isSafeInteger(rawScene.clock) ? rawScene.clock : undefined;
  const suppliedTime = typeof rawScene.time === 'string' && parseClock(rawScene.time) !== null && parseClock(rawScene.time) !== undefined ? rawScene.time : undefined;
  const clock = suppliedClock ?? (suppliedTime ? parseClock(suppliedTime) : undefined) ?? priorClock;
  const time = suppliedTime ?? clockTime(clock);
  const priorRows = input.prior.scene.present.map(id => {
    const actor = input.prior.cast[id];
    const detail = input.prior.scene.detail.find(row => canonId(row.id) === id);
    return { id: actor?.name ?? id, ...(detail?.mood ? { mood: detail.mood } : {}), ...(detail?.doing ? { doing: detail.doing } : {}), ...(detail?.condition ? { condition: detail.condition } : {}), thought: detail?.thought ?? '', ...(actor?.traits?.length ? { traits: actor.traits } : {}) };
  });
  root.state = {
    ...state,
    turn: Number.isSafeInteger(state.turn) ? state.turn : input.turn,
    day: Number.isSafeInteger(state.day) ? state.day : input.prior.day,
    scene: { ...rawScene, loc: typeof rawScene.loc === 'string' && rawScene.loc.trim() ? rawScene.loc : input.prior.scene.location, time, clock },
    present: Array.isArray(state.present) ? state.present : priorRows,
    delta: state.delta && typeof state.delta === 'object' && !Array.isArray(state.delta) ? state.delta : {},
    ext: state.ext && typeof state.ext === 'object' && !Array.isArray(state.ext) ? state.ext : {},
  };
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
  const validEvidence = original.evidence.filter((entry, index, rows) => {
    const source = entry.path === 'scene.loc' || entry.path === 'scene.time'
      || entry.path.startsWith('present.add.') || entry.path.startsWith('present.remove.')
      ? currentSource : input.prose;
    return source.includes(entry.quote) && rows.findIndex(other => other.path === entry.path) === index;
  });
  const evidenceFor = (path: string) => validEvidence.find(entry => entry.path === path);
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
    } else if (id !== player && !merged.thought?.trim()) continue;
    seen.add(id);
    present.push(merged);
  }
  for (const id of priorPresent) {
    if (seen.has(id) || evidenceFor(`present.remove.${id}`)) continue;
    const actor = input.prior.cast[id];
    const old = priorDetail.get(id);
    if (!actor || (id !== player && !old?.thought?.trim())) continue;
    const restored: StateCandidate['state']['present'][number] = { id: actor.name, thought: old?.thought ?? '' };
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
  const tryCandidate = (label: string, build: (candidate: StateCandidate) => void): void => {
    const trial = structuredClone(accepted);
    build(trial);
    const checked = validateCompilation(trial, input);
    if (checked.ok) accepted = trial;
    else dropped.push(label);
  };

  for (const [section, rows] of Object.entries(original.state.delta)) {
    if (!Array.isArray(rows)) continue;
    rows.forEach((row, originalIndex) => tryCandidate(`delta.${section}.${originalIndex}`, candidate => {
      const delta = candidate.state.delta as Record<string, unknown[]>;
      const next = [...(delta[section] ?? []), row];
      delta[section] = next;
      const path = `delta.${section}.${next.length - 1}`;
      const oldPath = `delta.${section}.${originalIndex}`;
      const proof = evidenceFor(oldPath);
      if (proof) candidate.evidence.push({ ...proof, path });
      const trackProof = original.trackEvidence.find(entry => entry.path === oldPath);
      if (trackProof) candidate.trackEvidence.push({ ...trackProof, path });
    }));
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
  return { ...final, ...(recovered.length ? { recovered } : {}) };
}

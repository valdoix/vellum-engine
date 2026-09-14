import { internalGenerate } from '../host/generation.js';
import { applyCompilerMergePatch, argentRequirementErrors, compilerProviderSchema, compilerRepairBase, parallelGrounding, salvageCompilation, type CompilerInput, type Compilation } from '../domain/state-compiler.js';
import { canonId } from '../core/ids.js';
import { formatDate } from '../domain/date-format.js';
import { selectLorebookCanon } from '../domain/lorebook-canon.js';
import { normalizeSecretAudience } from '../domain/secret-audience.js';
import { engineValidationCapabilities, SUBPLOT_TITLE_CONTRACT, type EvidenceMode } from '../domain/state-protocol.js';

export interface CompilerProgress {
  status: 'start' | 'requesting' | 'chunk' | 'reasoning' | 'retry' | 'validating' | 'validated' | 'failed';
  attempt: number;
  delta?: string;
  text?: string;
  message?: string;
  errors?: string[];
}

export interface CompilerRunOptions {
  onProgress?: (update: CompilerProgress) => void;
  signal?: AbortSignal;
  attempt?: number;
  /** Truncated output from the rejected request. It is evidence for repair, not
   * the merge-patch base, and is never filed directly. */
  rejectedFragment?: string;
  generation?: { maxTokens?: number; timeoutMs?: number; temperature?: number; reasoning?: import('lumiverse-spindle-types').GenerationReasoningOverrideDTO; schema?: boolean };
}

/**
 * Engine Pass returns one complete JSON document, so a low output ceiling is
 * worse than a slightly generous reservation: a token stop leaves the final
 * braces unwritten and the whole candidate has to be discarded. Lean mode is
 * still encouraged to stay compact by the prompt; these are safety ceilings,
 * not output targets.
 */
export const ENGINE_OUTPUT_TOKENS = { lean: 20000, full: 20000 } as const;
export const ENGINE_TIMEOUT_MS = { lean: 120_000, full: 120_000 } as const;

const NO_EVIDENCE_DIRECTIVE = '\nEVIDENCE MODE — NONE: Evidence quotations are disabled for this chat. Do not emit the root evidence array, trackEvidence quotations, or evidence fields on rows, scene, subplots, or parallel operations. Never copy prose to satisfy a quote requirement. The engine still validates identities, canon/life state, chronology, causality, plot continuity, and plausibility, and still derives bookkeeping itself. Subplot grounding (basis/rationale/before/after) and knowledge transmission sources remain required. Shape reminder: plot mutations belong in state.delta as {op,id,name,note,arc}; durable subplots belong in state.delta.offscreen; current parallel operations belong at root parallelOps. Do not emit Chronicle snapshot fields such as status, summary, proof, openedTurn, or linkedThreads, and never put offscreen or parallelOps inside state.ext.';

const ENGINE_PASS_EVIDENCE_TRAINING = `
ENGINE PASS TRAINING — EVIDENCE MODE: Treat this as shape training only; never copy its names, facts, ids, time, or cast into the current answer. Suppose the prior plot ledger is empty and the completed source separately establishes (A) "Buffy is alive after clawing out of her grave and does not know who restored her." and (B) "Her unexplained return from death begins a new crisis." The canonical plot portion is:
{"state":{"turn":2,"day":0,"scene":{"loc":"Cemetery","time":"22:18","clock":1338},"present":[{"id":"Buffy Summers","thought":"I need to know why I am back."}],"delta":{"threads":[{"op":"new","id":"t_return","name":"Why Buffy Returned","note":"Buffy is alive after clawing out of her grave and does not know who restored her.","arc":"a_return"}],"arcs":[{"op":"new","id":"a_return","name":"Return from Death","note":"Her unexplained return from death begins a new crisis."}]},"ext":{}},"parallelOps":[],"parallelWorldOps":[],"parallelReviewed":[],"evidence":[{"path":"delta.threads.0","quote":"Buffy is alive after clawing out of her grave and does not know who restored her."},{"path":"delta.arcs.0","quote":"Her unexplained return from death begins a new crisis."}],"trackEvidence":[{"path":"delta.threads.0","targetId":"new","before":"absent","after":"Buffy is alive after clawing out of her grave and does not know who restored her.","quote":"Buffy is alive after clawing out of her grave and does not know who restored her.","basis":"new_open_question"},{"path":"delta.arcs.0","targetId":"new","before":"absent","after":"Her unexplained return from death begins a new crisis.","quote":"Her unexplained return from death begins a new crisis.","basis":"new_open_question"}],"genesis":false}
Each evidence.path targets exactly one changed row. Each trackEvidence.after exactly equals that row's note. For an existing plot row, copy its exact prior title and stable id into the proof target, state its accepted prior condition in before, and use a genuinely changed condition in note/after. Durable world beats go in state.delta.offscreen; their current actor operations go at root parallelOps. state.ext is only for scars, Codex, inventory, timeline, NPC intent/affect/introduction, plants, and payoffs. Never emit snapshot aliases such as status, title, summary, proof, openedTurn, or linkedThreads in a compiler mutation.`;

const ENGINE_PASS_NO_EVIDENCE_TRAINING = `
ENGINE PASS TRAINING — NO-EVIDENCE MODE: Treat this as shape training only; never copy its names, facts, ids, time, or cast into the current answer. Suppose the prior plot ledger is empty and the completed source establishes that Buffy is alive after clawing out of her grave, does not know who restored her, and her return begins a new crisis. The canonical plot portion is:
{"state":{"turn":2,"day":0,"scene":{"loc":"Cemetery","time":"22:18","clock":1338},"present":[{"id":"Buffy Summers","thought":"I need to know why I am back."}],"delta":{"threads":[{"op":"new","id":"t_return","name":"Why Buffy Returned","note":"Buffy is alive after clawing out of her grave and does not know who restored her.","arc":"a_return"}],"arcs":[{"op":"new","id":"a_return","name":"Return from Death","note":"Her unexplained return from death begins a new crisis."}]},"ext":{}},"parallelOps":[],"parallelWorldOps":[],"parallelReviewed":[],"genesis":false}
There is deliberately no evidence array, no trackEvidence array, and no row evidence field. No-evidence removes quotations only; note must still state the concrete resulting condition, new rows still use op:"new", and existing rows still need a real before-to-after change that the engine can verify against prior state. Durable world beats go in state.delta.offscreen; their current actor operations go at root parallelOps. state.ext is only for scars, Codex, inventory, timeline, NPC intent/affect/introduction, plants, and payoffs. Never emit snapshot aliases such as status, title, summary, proof, openedTurn, or linkedThreads in a compiler mutation.`;

function enginePassTraining(evidenceMode: EvidenceMode): string {
  return engineValidationCapabilities(evidenceMode).requireEvidence ? ENGINE_PASS_EVIDENCE_TRAINING : ENGINE_PASS_NO_EVIDENCE_TRAINING;
}

export const STATE_COMPILER_SYSTEM = `Compile the completed narrative into VELLUM state. Return one JSON object and no prose. Never continue the visible story; Autonomous/Sandbox may create private off-screen simulation state for Director.
SUBPLOT LOCATION INTENT: When where is supplied on an update, set locationOp to retain (same place), refine (a more specific nearby address), or move (actual travel). Never smuggle movement through a wording change.

WORKFLOW: (1) reconstruct the complete current scene and on-stage roster; (2) audit every supported state family for changes established by this turn; (3) retain every supported durable change once; (4) attach a concise accurate grounding passage or rationale to each changed row; (5) reconcile plot and parallel graphs; (6) serialize. Lean and Full have identical content coverage. Lean only simplifies formatting with shorter notes and fewer optional descriptive fields; it never omits a supported fact, event, state family, character, plot change, or parallel operation. Neither mode may stop after scene or persona state when the completed turn establishes other durable changes.

Return the current scene and complete present roster inside {"state":{...}} on every pass. delta and ext are change sets: omit their unchanged families, but do not omit a real supported change. Root evidence, trackEvidence, and parallelReviewed are engine bookkeeping and may be omitted because the engine derives them. The engine may restore harmless missing boilerplate for compatibility; that fallback is not permission to skip extraction.

SCENE AND ROSTER: Emit the current location, exact HH:MM time and matching minute clock, plus title/transition/tension/weather when supported. day is elapsed story-day count, never a calendar date, and time is monotonic. Include every named on-stage character once. The supplied identity.playerPersona is the exact player/persona, even when the focal character or identity.characterCard ({{char}}) is someone else. Never infer the persona from {{char}}, narrative focus, roster order, or whose interiority is shown. When the persona is on stage, use that exact identity. With controls.personaState on, always populate the persona's mood, condition, doing, concise first-person thought, and stable traits from the current turn or continuing canonical state. With it off, keep persona tracker fields empty. Give each on-stage NPC a concise first-person, knowledge-limited thought when the turn supports one; never fabricate knowledge.

DELTA AUDIT: Check bonds, threads, arcs, journal, knowledge, new secrets, secret reveals, factions, faction relations, and durable off-screen subplots. Then check scars, Codex, inventory, timeline milestones, NPC intent, affect, introductions, plants, and payoffs. Extract concrete changes such as a discovery, disclosure, decision, transfer, injury, arrival/departure, status change, newly opened problem, changed leverage, completed obstacle, or durable commitment. A dramatic physical or plot event must not disappear merely because the scene snapshot captured its immediate pose. Combine redundant facts and omit transient color, but do not turn "concise" into empty delta/ext objects.

EVIDENCE AND CANON: Evidence is semantic support, not a quotation-matching test. For every scene change and delta/ext row ask: "Is this evidence factually correct, and does it materially ground this claim in the current scene or attached canon?" If yes, accept it. The evidence may be an exact excerpt, a faithful paraphrase, or a relevant lorebook passage; it need not repeat the row word for word. Reject evidence that is merely related, contradicts the current scene, reverses who did what, or supports only part of an expanded claim. Lorebook canon may establish objective setting facts and a new baseline, but never grants private character knowledge. Knowledge still needs a depicted access path. Use exact established identities and ids; a secret reveal uses its existing id.

PLOT AUDIT: Audit threads and arcs on every turn. A new thread requires a newly established actionable unresolved question, promise, threat, task, or obstacle. Advance, stall, or resolve an existing row only when this turn directly changes that exact situation's options, knowledge, leverage, deadline, possession, location, commitment, obstacle, or answer. Each plot note states the concrete new condition. Plot rows need a concrete new condition directly caused by this turn; no change is better than generic progress. An arc advances only with a changed linked child thread or an independently depicted structural milestone.

SUBPLOT AUDIT: A subplot is a durable causal commitment, not an ambient meanwhile line. Its id is a stable machine reference; its name is ${SUBPLOT_TITLE_CONTRACT}. Every new/advanced/resolved delta.offscreen row needs beatKind (progress, obstacle, consequence, bridge, or resolution), a concrete impact explaining which person, relationship, resource, schedule, information path, institution, or future foreground option changes, and grounding with basis[], rationale, optional refs[], and transition fields. For advance/resolve, grounding.before must faithfully identify the prior accepted subplot condition and grounding.after must identify the new condition and match gist (or the stated closure). Rewording the same activity is not progress. Prior accepted subplot history is valid continuity evidence; scale additional evidence to the claim: routine acts need canon compatibility, projects need motive/capability/access/time, travel needs route/time, knowledge needs delivery, social consequences need interaction, and irreversible outcomes need a multi-beat causal chain. A promoted parallel row may establish the initial actor/place/activity, but durability still requires motive, impact, and a foreground bridge.

PARALLEL AND AUTONOMY: Parallel/off-screen rows describe what is happening elsewhere now. Their evidence does not need to come from visible prose. For each proposed actor event ask: Is the character established and alive at T1? Are they absent from present? Is this location compatible with their last canonical location, elapsed travel time, the setting geography, and attached lore? Is the activity in character, feasible, reversible at the selected autonomy tier, and limited to knowledge they could possess? If yes, provide a short plausibility rationale and accept it. Example: Spike may plausibly be at the Bronze in a Sunnydale scene when canon establishes both character and venue; do not place him in Beijing merely to create activity when no route, elapsed time, or lore establishes that move. Hard reject deceased actors, teleportation, arbitrary remote locations, narrator knowledge, and unsupported irreversible outcomes. Preserve absent rows by omission. Living World active/sandbox may use prior.parallelSupport as a current baseline. Living World active or Social/Politics living enables the bounded Living/Active tier (up to two due rows and one new reversible line). Living World sandbox or Social/Politics autonomous enables Autonomous/Sandbox: create at least two new durable subplots (delta.offscreen rows with op:"new", fresh id, living NPC actor, canon-plausible place, concrete gist, beatKind, impact, grounding) and at least four parallel event operations on every in-character pass, with no narrative maximum. Foreground threads (delta.threads) and parallel snapshot rows (delta.parallel) do not count toward this floor. More are allowed when canon, motive, logistics, time, and knowledge support them. Social living allows only small NPC bond drift and autonomous allows bounded category change. Politics living allows only small standing drift and autonomous may change relation kinds. Never create player bonds, choices, consent, acts, or any subplot/parallel role for the persona character.

SUBPLOT/PARALLEL CONSISTENCY: The newest active subplot beat is the physical authority for its actor. The final parallel snapshot must use the same actor, place, and activity; it cannot show that actor doing something incompatible elsewhere. If the foreground reaches that place and time, the actor belongs in the prose and present roster unless the turn explicitly establishes an exit, interruption, or concealment. Foreground truth may interrupt or move a subplot, but must update the subplot rather than silently leaving two realities.

ARGENT REQUIREMENTS: Meet every nonzero value in the supplied requirements object. When the plot ledger is empty, create exactly one strongest grounded foreground actionable thread and, only when no parent arc exists, exactly one clear parent arc linked by its exact title. A new thread referenced by a new offscreen row is that subplot's durable track, not an additional foreground opener. Preserve the current parallel snapshot by omission; emit every grounded due operation and required new subplot for the active tier. When requirements.sandboxNewSubplotMinimum is nonzero, the turn must include at least that many new delta.offscreen rows with op:"new"; foreground threads and parallel snapshot rows do not count toward this floor.

Respect controls and player agency. Persona fields are private tracker state only and never license prose behavior. genesis is true only for an eligible initial Codex baseline.`;

export const STATE_COMPILER_REPAIR_SYSTEM = `For this repair call, regenerate a corrected VELLUM compiler candidate as an RFC 7396 JSON Merge Patch against the supplied repairBase. Return only {"patch":{...}}.
The validationErrors are the repair specification and the supplied source (canonical prior state, completed prose, latest user input, controls, requirements, and canon) is the only source of truth. The failed attempt is intentionally not supplied as repair evidence. Do not preserve, reconstruct, or defend a field merely because it may have appeared in that attempt.
Create any supported content required to fix every listed error, even when it was absent from the rejected attempt: for example, add a missing persona thought, rebuild the complete present roster, create a required grounded opening thread and parent arc, or regenerate required subplot and parallel operations. You may replace an entire array or branch when that is the clearest repair. Do not continue the visible story or invent unsupported facts.
When an error concerns evidence, re-evaluate the underlying claim instead of hunting for an exact quotation. A faithful paraphrase or relevant lorebook passage is valid when it materially supports the claim and agrees with the current scene. For parallel simulation, regenerate from the alive cast, canonical locations, elapsed time, motives, lore, and knowledge boundaries; visible-prose support is optional, factual plausibility is mandatory.
When an error concerns a subplot, regenerate the actual causal beat from prior.offscreen and canon: supply concrete impact, semantic grounding, and an honest before -> after transition. Do not preserve a decorative or unchanged beat. Keep its actor/place/activity identical to the final parallel snapshot, or move/interrupt it through one grounded transition.
The patch applies to repairBase: a JSON object recursively edits an object, an array replaces that one array, and null deletes that one property. Omit only branches that already match repairBase. The final patched candidate, not the rejected attempt, must satisfy the original compiler contract and every active requirement.`;

export function compilerContext(input: CompilerInput): string {
  const p = input.prior;
  const focus = `${input.userInput ?? ''}\n${input.prose}\n${p.scene.location}\n${p.scene.present.map(id => p.cast[id]?.name ?? id).join(' ')}`.toLocaleLowerCase();
  const lorebookCanon = selectLorebookCanon(input.lorebookCanon ?? [], focus);
  const focusTokens = new Set(focus.normalize('NFKC').match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  const relevance = (value: unknown): number => {
    const text = String(JSON.stringify(value) ?? '').toLocaleLowerCase();
    let score = 0;
    for (const token of new Set(text.normalize('NFKC').match(/[\p{L}\p{N}]{3,}/gu) ?? [])) if (focusTokens.has(token)) score += 1;
    return score;
  };
  const byRelevant = <T>(rows: T[], cap: number): T[] => rows.slice().sort((a, b) => {
    const related = relevance(b) - relevance(a);
    if (related) return related;
    return (((b as any).lastTurn ?? (b as any).turn ?? (b as any).formedTurn ?? 0)
      - ((a as any).lastTurn ?? (a as any).turn ?? (a as any).formedTurn ?? 0));
  }).slice(0, cap);
  const currentIds = new Set([...p.scene.present, ...canonMentions(input, p.cast)]);
  const cast = Object.values(p.cast).sort((a, b) => Number(currentIds.has(b.id)) - Number(currentIds.has(a.id)) || b.lastTurn - a.lastTurn).slice(0, 60);
  const effectiveWorld = input.livingWorld ?? 'off';
  const openingPlot = !!input.argent && !p.threads.some(row => !/resolv/i.test(row.status || ''));
  const openingArc = openingPlot && !p.arcs.some(row => !/resolv/i.test(row.status || ''));
  return JSON.stringify({
    turn: input.turn, prose: input.prose.slice(0, 24000), latestUser: input.userInput?.slice(0, 12000) ?? '',
    identity: {
      playerPersona: { id: canonId(input.userName), name: input.userName },
      characterCard: { id: canonId(input.characterName ?? ''), name: input.characterName ?? '' },
      rule: 'playerPersona is authoritative for the persona/player; characterCard is {{char}} and must never replace it',
    },
    // Retain the flat field for compatibility with older provider behavior and
    // existing diagnostics while making the two identities unambiguous.
    userName: input.userName,
    genesisAllowed: input.genesisAllowed, verbosity: input.verbosity,
    outputContract: {
      contentCoverage: 'all_supported_durable_changes',
      sceneAndPresent: 'complete_current_snapshot',
      format: input.verbosity === 'full' ? 'expanded_fields' : 'compact_fields',
      rule: 'format changes representation only; it never reduces facts, events, state families, cast, plot changes, or parallel operations',
    },
    evidencePolicy: input.evidenceMode === 'none' ? {
      mode: 'none',
      rule: 'evidence quotations are neither requested nor validated; every change must still be factually correct and canon-consistent',
    } : {
      mode: 'evidence',
      question: 'Is the evidence factually correct and materially grounded in the current scene or attached canon?',
      accepted: ['exact passage', 'faithful paraphrase', 'relevant lorebook passage'],
      rejected: ['merely related text', 'partial support for a larger claim', 'contradiction', 'reversed actor or subject'],
    },
    parallelPolicy: {
      proseQuoteRequired: false,
      question: 'Is the actor alive and is this activity/location feasible now under chronology, geography, lore, motive, and limited knowledge?',
      hardReject: ['deceased actor', 'present actor', 'teleportation', 'arbitrary remote location', 'knowledge leak', 'unsupported irreversible outcome'],
    },
    subplotPolicy: {
      principle: 'a subplot is a durable causal commitment, while parallel is its current-location snapshot',
      required: ['beatKind', 'impact', 'grounding.basis', 'grounding.rationale'],
      beatKinds: ['progress', 'obstacle', 'consequence', 'bridge', 'resolution'],
      transition: 'advance and resolve require grounding.before from the prior accepted condition and grounding.after matching the new condition',
      evidenceScale: {
        routine: 'canon compatibility and concise rationale',
        project: 'motive, capability, access, time, and concrete impact',
        travel: 'origin, destination, route, and elapsed time',
        knowledge: 'delivered access path',
        social: 'interaction or communication',
        irreversible: 'established multi-beat chain; prefer foreground completion',
      },
      continuity: 'the newest active subplot beat is the actor physical authority and parallel must mirror it exactly',
      intersection: 'when foreground reaches the subplot place/time, show the actor or explicitly establish exit/concealment',
    },
    controls: {
      codex: input.codexAllowed !== false, inventory: input.inventoryAllowed !== false,
      livingWorld: input.configuredLivingWorld ?? input.livingWorld ?? 'off',
      effectiveLivingWorld: input.livingWorld ?? 'off', social: input.social ?? 'off', politics: input.politics ?? 'off',
      agency: input.agency ?? 'protected', personaState: input.personaState === true,
      evidenceMode: input.evidenceMode ?? 'evidence',
    },
    requirements: input.argent ? {
      openingThreads: openingPlot ? 1 : 0, openingArcs: openingArc ? 1 : 0,
      parallelSnapshot: effectiveWorld === 'active' || effectiveWorld === 'sandbox',
      subplotDueCap: effectiveWorld === 'active' ? 2 : 0,
      subplotNewCap: effectiveWorld === 'active' ? 1 : 0,
      sandboxNewSubplotMinimum: effectiveWorld === 'sandbox' ? 2 : 0,
      sandboxParallelEventMinimum: effectiveWorld === 'sandbox' ? 4 : 0,
      sandboxMaximum: effectiveWorld === 'sandbox' ? 'none' : undefined,
    } : {},
    prior: {
      dayCount: p.day, displayedDate: formatDate(p.day, p.dateFormat || 'day', p), scene: p.scene, cast: cast.map(c => ({ id: c.id, name: c.name, aka: c.aka, status: c.status, deceased: c.deceased === true, traits: c.traits, role: c.role, note: c.note, lastLocation: c.lastLocation, lastLocationTurn: c.lastLocationTurn, intent: c.intent, affect: c.affect, introduction: c.introduction })),
      relations: byRelevant(p.relations, 40), knowledge: byRelevant(p.knowledge, 40),
      // Only the fields needed to correlate a disclosure are sent back. This
      // also guarantees that an audience polluted by an older build cannot be
      // echoed and amplified into the next compiler response.
      secrets: byRelevant(p.secrets, 40).map(secret => ({
        id: secret.id, keeper: secret.keeper, text: secret.text.slice(0, 1200), revealed: secret.revealed,
        from: normalizeSecretAudience(secret.keeper, secret.from, secret.revealedTo),
        revealedTo: normalizeSecretAudience(secret.keeper, secret.revealedTo),
      })),
      journal: byRelevant(p.journal, 24),
      threads: byRelevant(p.threads.filter(t => !/resolv/i.test(t.status)), 24), arcs: byRelevant(p.arcs.filter(t => !/resolv/i.test(t.status)), 16),
      parallel: p.parallel, parallelSupport: parallelGrounding(input), offscreen: byRelevant(p.offscreen.filter(row => row.status === 'active'), 24), factions: byRelevant(Object.values(p.factions), 24), factionRelations: byRelevant(p.factionRelations, 30),
      lore: byRelevant(p.lore.filter(l => l.status !== 'rejected'), 32), items: byRelevant(p.items, 40), plants: byRelevant(p.plants.filter(x => x.status === 'planted'), 24),
      locations: byRelevant(p.locations ?? [], 20),
      lorebookCanon: lorebookCanon.map(entry => ({ id: entry.id, bookId: entry.bookId, title: entry.title, keys: entry.keys, secondaryKeys: entry.secondaryKeys, content: entry.content, constant: entry.constant, priority: entry.priority, category: entry.category, group: entry.group })),
    },
  });
}

function canonMentions(input: CompilerInput, cast: CompilerInput['prior']['cast']): string[] {
  const text = `${input.userInput ?? ''}\n${input.prose}`.toLocaleLowerCase();
  return Object.values(cast).filter(actor => [actor.name, ...(actor.aka ?? [])].some(name => name.length >= 2 && text.includes(name.toLocaleLowerCase()))).map(actor => actor.id);
}

/** Recover complete JSON objects from providers that ignore response_format and
 * wrap the answer in a code fence or a short preface. The scan is quote-aware,
 * so braces inside prose strings cannot truncate a valid candidate. Partial
 * objects remain rejected. */
function replyJsonObjects(raw: string): unknown[] {
  const source = String(raw || '').replace(/<think[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '');
  // Some providers bold the JSON itself (`{**"state":...**}`). Remove only
  // markdown bold markers outside quoted strings; literal asterisks in story
  // data remain byte-for-byte intact.
  let text = '', inString = false, escaped = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (inString) {
      text += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; text += char; continue; }
    if (char === '*' && source[index + 1] === '*') { index += 1; continue; }
    text += char;
  }
  text = text.trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? [parsed] : [];
  } catch { /* scan balanced objects */ }
  const out: unknown[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf('{', cursor);
    if (start < 0) break;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let i = start; i < text.length; i++) {
      const char = text[i]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') { inString = true; continue; }
      if (char === '{' || char === '[') depth += 1;
      else if (char === '}' || char === ']') {
        depth -= 1;
        if (depth === 0) { end = i; break; }
        if (depth < 0) break;
      }
    }
    if (end < 0) { cursor = start + 1; continue; }
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) out.push(parsed);
    } catch { /* keep scanning */ }
    cursor = end + 1;
  }
  return out;
}

export function compilerReplyObjects(raw: string): unknown[] {
  return replyJsonObjects(raw).filter(value => 'state' in (value as Record<string, unknown>));
}

export function compilerPatchObjects(raw: string): Array<{ patch: Record<string, unknown> }> {
  return replyJsonObjects(raw).filter((value): value is { patch: Record<string, unknown> } => {
    const patch = (value as Record<string, unknown>).patch;
    return !!patch && typeof patch === 'object' && !Array.isArray(patch);
  });
}

export async function compileState(input: CompilerInput, userId: string | null, connectionId?: string, generate: typeof internalGenerate = internalGenerate, run?: CompilerRunOptions): Promise<Compilation> {
  const evidenceMode = input.evidenceMode ?? 'evidence';
  const schema = compilerProviderSchema(evidenceMode);
  const context = compilerContext(input);
  const mode = input.verbosity === 'full'
    ? 'FULL: audit every listed state family and emit every supported durable change with all supported optional metadata.'
    : 'LEAN: audit every listed state family and emit the same supported durable changes as Full. Simplify only the JSON formatting: use shorter notes and omit optional descriptive metadata that carries no additional fact. Never reduce content coverage.';
  const evidenceDirective = evidenceMode === 'none'
    ? NO_EVIDENCE_DIRECTIVE
    : '';
  const attemptNo = Math.max(1, Math.round(run?.attempt ?? 1));
  try { run?.onProgress?.({ status: 'start', attempt: attemptNo }); } catch { /* a progress UI must never interrupt compilation */ }
  let streamed = '';
  const contract = input.verbosity === 'full' ? 'full' : 'lean';
  const maxTokens = run?.generation?.maxTokens ?? ENGINE_OUTPUT_TOKENS[contract];
  // Preparation above is local and complete. Report the provider wait as its own
  // phase so a slow first token is never misdiagnosed as a stuck state compiler.
  try { run?.onProgress?.({ status: 'requesting', attempt: attemptNo, message: 'Compiler request sent; waiting for the first output token.' }); } catch { /* best effort */ }
  const result = await generate([
    { role: 'system', content: STATE_COMPILER_SYSTEM + '\n' + mode + evidenceDirective + enginePassTraining(evidenceMode) + '\nThe provider schema permits omitted bookkeeping for compatibility, but the requested payload always includes state.scene and state.present. All nonzero preset requirements still apply.' },
    { role: 'user', content: context },
  ], { temperature: run?.generation?.temperature ?? 0, max_tokens: maxTokens }, userId,
  {
    reasoningOff: true,
    ...(run?.generation?.reasoning ? { reasoning: run.generation.reasoning } : {}),
    // The deadline must accommodate the larger complete-object budget. A
    // response that finishes before a terminal timeout is still recovered from
    // `streamed` below, while a genuinely stalled provider remains bounded.
    timeoutMs: run?.generation?.timeoutMs ?? ENGINE_TIMEOUT_MS[contract],
    signal: run?.signal,
    ...(connectionId ? { connectionId } : {}),
    ...(run?.generation?.schema === false ? {} : { responseFormat: { type: 'json_schema', json_schema: { name: 'vellum_compilation', strict: false, schema } } }),
    onStream: (update) => {
      try {
        if (update.type === 'content' && update.token) {
          streamed += update.token;
          run?.onProgress?.({ status: 'chunk', attempt: attemptNo, delta: update.token });
        } else if (update.type === 'reasoning') run?.onProgress?.({ status: 'reasoning', attempt: attemptNo });
      } catch { /* a progress UI must never interrupt generation */ }
    },
  });
  const raw = result.ok ? result.value : streamed;
  if (raw.trim()) {
    try { run?.onProgress?.({ status: 'validating', attempt: attemptNo, text: raw }); } catch { /* best effort */ }
    // If a provider emits a draft/example and then a corrected document, the
    // final complete object is authoritative, matching inline <vellum> parsing.
    // Do not borrow errors from an earlier object either: the Engine window and
    // Repair Engine must describe the exact same final candidate. Previously a
    // stale draft with tension 11 could supply the error while the visible final
    // object correctly showed tension 7.
    const candidate = compilerReplyObjects(raw).at(-1);
    if (candidate) {
      const validated = salvageCompilation(candidate, input);
      if (validated.ok) {
        const required = argentRequirementErrors(validated.candidate, input);
        if (required.length) {
          // ARGENT cardinality errors are downstream symptoms when salvage had
          // to drop a proposed plot/subplot row. Surface the concrete rejection
          // first so the Engine window and repair pass explain what was wrong
          // with the visible row instead of claiming it did not exist.
          const rejectionErrors = (validated.suggestions ?? []).map(suggestion => {
            const label = String(suggestion.row.name ?? suggestion.row.title ?? suggestion.row.id ?? suggestion.kind).trim();
            return `Rejected ${suggestion.kind}${label ? ` "${label}"` : ''}: ${suggestion.reason}`;
          });
          const errors = [...new Set([...rejectionErrors, ...required])];
          try { run?.onProgress?.({ status: 'failed', attempt: attemptNo, text: JSON.stringify(candidate), errors: errors.slice(0, 20), message: errors[0] }); } catch { /* best effort */ }
          return { ok: false, errors, draft: candidate, fragment: raw.slice(0, 32000) };
        }
        try { run?.onProgress?.({ status: 'validated', attempt: attemptNo, text: validated.block, ...(validated.recovered?.length ? { message: `Recovered locally; omitted ${validated.recovered.length} unsupported change${validated.recovered.length === 1 ? '' : 's'}.` } : {}) }); } catch { /* best effort */ }
        return validated;
      }
      try { run?.onProgress?.({ status: 'failed', attempt: attemptNo, text: JSON.stringify(candidate), errors: validated.errors.slice(0, 20), message: validated.errors[0] }); } catch { /* best effort */ }
      return { ok: false, errors: validated.errors, draft: candidate, fragment: raw.slice(0, 32000) };
    }
    const errors = ['Response was not one complete JSON object'];
    try { run?.onProgress?.({ status: 'failed', attempt: attemptNo, text: raw, errors, message: errors[0] }); } catch { /* best effort */ }
    return { ok: false, errors, draft: compilerRepairBase(input), fragment: raw.slice(0, 32000) };
  }
  const errors = [result.ok ? 'Response was empty' : result.error];
  try { run?.onProgress?.({ status: 'failed', attempt: attemptNo, errors, message: errors[0] }); } catch { /* best effort */ }
  return { ok: false, errors, draft: compilerRepairBase(input) };
}

/** Reconstruct a failed compilation from canonical prior state plus the actual
 * source turn. The failed attempt is not supplied to the repair model. The provider emits an
 * RFC 7396 patch against a conservative canonical base, then VELLUM applies the
 * same strict salvage/semantic validation used by the first compiler pass. */
export async function repairCompilation(
  input: CompilerInput,
  _rejectedDraft: unknown,
  validationErrors: readonly string[],
  userId: string | null,
  connectionId?: string,
  generate: typeof internalGenerate = internalGenerate,
  run?: CompilerRunOptions,
): Promise<Compilation> {
  const attemptNo = Math.max(1, Math.round(run?.attempt ?? 2));
  const repairBase = compilerRepairBase(input);
  const repairContext = JSON.stringify({
    validationErrors: [...new Set(validationErrors.map(String).filter(Boolean))].slice(0, 50),
    authority: 'validationErrors identify what must be fixed; source is canonical truth; the failed attempt is not repair evidence',
    repairBase,
    source: JSON.parse(compilerContext(input)),
  });
  const patchSchema = {
    type: 'object', additionalProperties: false, required: ['patch'],
    properties: { patch: { type: 'object', additionalProperties: true } },
  };
  try {
    run?.onProgress?.({
      status: 'retry', attempt: attemptNo,
      text: JSON.stringify(repairBase),
      message: 'Regenerating corrected state from the canonical turn and its validation errors.',
      errors: validationErrors.slice(0, 20),
    });
  } catch { /* best effort */ }
  let streamed = '';
  try { run?.onProgress?.({ status: 'requesting', attempt: attemptNo, message: 'Repair request sent; waiting for the patch.' }); } catch { /* best effort */ }
  const result = await generate([
    { role: 'system', content: STATE_COMPILER_SYSTEM + (input.evidenceMode === 'none' ? NO_EVIDENCE_DIRECTIVE : '') + enginePassTraining(input.evidenceMode ?? 'evidence') + '\n\n' + STATE_COMPILER_REPAIR_SYSTEM },
    { role: 'user', content: repairContext },
  ], { temperature: run?.generation?.temperature ?? 0, max_tokens: run?.generation?.maxTokens ?? ENGINE_OUTPUT_TOKENS[input.verbosity === 'full' ? 'full' : 'lean'] }, userId, {
    reasoningOff: true,
    ...(run?.generation?.reasoning ? { reasoning: run.generation.reasoning } : {}),
    timeoutMs: run?.generation?.timeoutMs ?? ENGINE_TIMEOUT_MS[input.verbosity === 'full' ? 'full' : 'lean'],
    signal: run?.signal,
    ...(connectionId ? { connectionId } : {}),
    ...(run?.generation?.schema === false ? {} : { responseFormat: { type: 'json_schema', json_schema: { name: 'vellum_compilation_patch', strict: false, schema: patchSchema } } }),
    onStream: (update) => {
      try {
        if (update.type === 'content' && update.token) {
          streamed += update.token;
          run?.onProgress?.({ status: 'chunk', attempt: attemptNo, delta: update.token });
        } else if (update.type === 'reasoning') run?.onProgress?.({ status: 'reasoning', attempt: attemptNo });
      } catch { /* progress must never interrupt repair */ }
    },
  });
  const raw = result.ok ? result.value : streamed;
  if (!raw.trim()) {
    const errors = [result.ok ? 'Repair response was empty' : result.error];
    try { run?.onProgress?.({ status: 'failed', attempt: attemptNo, errors, message: errors[0] }); } catch { /* best effort */ }
    return { ok: false, errors, draft: repairBase };
  }
  const envelope = compilerPatchObjects(raw).at(-1);
  if (envelope) {
    const patched = applyCompilerMergePatch(repairBase, envelope.patch);
    if (JSON.stringify(patched) === JSON.stringify(repairBase)) {
      const errors = ['Repair patch made no changes to the canonical repair base'];
      try { run?.onProgress?.({ status: 'failed', attempt: attemptNo, text: JSON.stringify(patched), errors, message: errors[0] }); } catch { /* best effort */ }
      return { ok: false, errors, draft: patched, fragment: raw.slice(0, 32000) };
    }
    try { run?.onProgress?.({ status: 'validating', attempt: attemptNo, text: JSON.stringify(patched), message: 'Applying and validating the repair patch.' }); } catch { /* best effort */ }
    const validated = salvageCompilation(patched, input);
    if (validated.ok) {
      const required = argentRequirementErrors(validated.candidate, input);
      if (required.length) {
        try { run?.onProgress?.({ status: 'failed', attempt: attemptNo, text: JSON.stringify(patched), errors: required.slice(0, 20), message: required[0] }); } catch { /* best effort */ }
        return { ok: false, errors: required, draft: patched, fragment: raw.slice(0, 32000) };
      }
      try { run?.onProgress?.({ status: 'validated', attempt: attemptNo, text: validated.block, message: 'Repair patch validated.' }); } catch { /* best effort */ }
      return validated;
    }
    try { run?.onProgress?.({ status: 'failed', attempt: attemptNo, text: JSON.stringify(patched), errors: validated.errors.slice(0, 20), message: validated.errors[0] }); } catch { /* best effort */ }
    return { ok: false, errors: validated.errors, draft: patched, fragment: raw.slice(0, 32000) };
  }
  const errors = ['Repair response did not contain one JSON merge patch'];
  try { run?.onProgress?.({ status: 'failed', attempt: attemptNo, text: raw, errors, message: errors[0] }); } catch { /* best effort */ }
  return { ok: false, errors, draft: repairBase, fragment: raw.slice(0, 32000) };
}

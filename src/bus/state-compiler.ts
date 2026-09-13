import { internalGenerate } from '../host/generation.js';
import { applyCompilerMergePatch, argentRequirementErrors, compilerProviderSchema, compilerRepairBase, parallelGrounding, salvageCompilation, type CompilerInput, type Compilation } from '../domain/state-compiler.js';
import { canonId } from '../core/ids.js';
import { formatDate } from '../domain/date-format.js';
import { selectLorebookCanon } from '../domain/lorebook-canon.js';
import { normalizeSecretAudience } from '../domain/secret-audience.js';

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
export const ENGINE_OUTPUT_TOKENS = { lean: 12000, full: 20000 } as const;
export const ENGINE_TIMEOUT_MS = { lean: 90_000, full: 120_000 } as const;

export const STATE_COMPILER_SYSTEM = `Compile VELLUM state after the completed narrative. Return one JSON object and no prose. Never continue the visible story; Autonomous/Sandbox may create private off-screen simulation state for Director.
Return only changes inside {"state":{...}}. You may omit turn, day, scene, present, delta, ext, and every unchanged field; the engine restores prior state and validates the result. If present changed, include the complete current roster; thoughts are optional. Outside a nonzero preset requirement, prefer an empty state object to a guess.
For each delta/ext row, put the shortest exact supporting excerpt in that row as "evidence". For private Autonomous/Sandbox rows, evidence may instead be a concise causal rationale grounded in canonical T0. Do not build separate evidence, trackEvidence, or parallelReviewed arrays; the engine derives them.
Use exact established identities and ids. Never invent facts, actors, places, knowledge, travel, relationships, possessions, or plot movement. Autonomous/Sandbox may originate activity and consequences from canonical motives and world pressure, but not invent the anchors themselves. Lorebook canon may ground a new baseline, but not private knowledge.
Time is monotonic. day is elapsed story-day count, never a calendar date. For a scene location, time, or roster change, put the short exact excerpt in scene.evidence as loc, time, or present.
Record durable changes only. Knowledge needs a depicted access path. A secret reveal uses its existing id. Plot rows need a concrete new condition directly caused by this turn; no change is better than generic progress.
Parallel/off-screen rows describe what is happening elsewhere now. Preserve absent rows by omission. Move or resolve only with direct evidence; absent actors do not learn main-scene facts without delivery or witness. Living World active/sandbox may use prior.parallelSupport as a current baseline.
ARGENT autonomy remains authoritative: Living World active or Social/Politics living enables the bounded Living/Active tier (up to two due rows and one new reversible line). Living World sandbox or Social/Politics autonomous enables Autonomous/Sandbox: create at least two new durable subplots and at least four parallel event operations on every in-character pass, with no narrative maximum. More are allowed when canon, motive, logistics, time, and knowledge support them. Social living allows only small NPC bond drift and autonomous allows bounded category change. Politics living allows only small standing drift and autonomous may change relation kinds. Never create player bonds, choices, consent, acts, or any subplot/parallel role for the persona character.
Meet every active preset requirement in the supplied requirements object. For ARGENT, an empty plot ledger requires exactly one strongest grounded foreground actionable thread and, only when no parent arc exists, exactly one clear parent arc linked by its exact title. A new thread referenced by a new offscreen row is that subplot's durable track, not an additional foreground opener. Preserve the current parallel snapshot by omission; emit every grounded due operation and required new subplot for the active tier.
Respect controls and player agency. The supplied identity.playerPersona is the exact player/persona, even when the focal story character or identity.characterCard ({{char}}) is someone else. Never infer the persona from {{char}}, narrative focus, roster order, or whose interiority is shown. Persona fields are private tracker state only. genesis is true only for an eligible initial Codex baseline.`;

export const STATE_COMPILER_REPAIR_SYSTEM = `For this repair call, this output rule supersedes the original complete-document instruction: repair a rejected VELLUM compiler document with a minimal RFC 7396 JSON Merge Patch. Return only {"patch":{...}}.
The supplied draft is the base document. A rejectedFragment may show useful unfinished output from the failed call; treat it only as a clue and copy nothing unsupported. Include only branches that must change. A JSON object recursively edits an object, an array replaces that one array, and null deletes that one property. Never repeat an unchanged branch and never return the complete compiler document.
Fix every listed validation error. Recheck the completed prose for a directly supported field or change the rejected draft plainly missed because of that error, but do not continue the story or invent facts. Preserve every valid scene, roster, delta, evidence, plot, and parallel member already in the draft. If an invalid optional mutation cannot be grounded, delete only that row and repair the corresponding evidence indexes. The patched result must satisfy the original compiler contract.`;

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
    controls: {
      codex: input.codexAllowed !== false, inventory: input.inventoryAllowed !== false,
      livingWorld: input.configuredLivingWorld ?? input.livingWorld ?? 'off',
      effectiveLivingWorld: input.livingWorld ?? 'off', social: input.social ?? 'off', politics: input.politics ?? 'off',
      agency: input.agency ?? 'protected', personaState: input.personaState === true,
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
      dayCount: p.day, displayedDate: formatDate(p.day, p.dateFormat || 'day', p), scene: p.scene, cast: cast.map(c => ({ id: c.id, name: c.name, aka: c.aka, status: c.status, traits: c.traits, lastLocation: c.lastLocation, lastLocationTurn: c.lastLocationTurn, intent: c.intent, affect: c.affect, introduction: c.introduction })),
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
      parallel: p.parallel, parallelSupport: parallelGrounding(input), factions: byRelevant(Object.values(p.factions), 24), factionRelations: byRelevant(p.factionRelations, 30),
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
  const schema = compilerProviderSchema();
  const context = compilerContext(input);
  const mode = input.verbosity === 'full'
    ? 'FULL: check every state family, but still emit only supported changes.'
    : 'LEAN: emit only the few material changes.';
  const attemptNo = Math.max(1, Math.round(run?.attempt ?? 1));
  try { run?.onProgress?.({ status: 'start', attempt: attemptNo }); } catch { /* a progress UI must never interrupt compilation */ }
  let streamed = '';
  const contract = input.verbosity === 'full' ? 'full' : 'lean';
  const maxTokens = run?.generation?.maxTokens ?? ENGINE_OUTPUT_TOKENS[contract];
  // Preparation above is local and complete. Report the provider wait as its own
  // phase so a slow first token is never misdiagnosed as a stuck state compiler.
  try { run?.onProgress?.({ status: 'requesting', attempt: attemptNo, message: 'Compiler request sent; waiting for the first output token.' }); } catch { /* best effort */ }
  const result = await generate([
    { role: 'system', content: STATE_COMPILER_SYSTEM + '\n' + mode + '\nThe only mandatory root key is "state"; all nonzero preset requirements still apply.' },
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
    let closest: string[] | null = null;
    let closestDraft: unknown;
    // If a provider emits a draft/example and then a corrected document, the
    // final complete object is authoritative, matching inline <vellum> parsing.
    // Reading oldest-first could commit a valid but superseded clock snapshot.
    for (const candidate of compilerReplyObjects(raw).reverse()) {
      const validated = salvageCompilation(candidate, input);
      if (validated.ok) {
        const required = argentRequirementErrors(validated.candidate, input);
        if (required.length) {
          if (!closest || required.length < closest.length) { closest = required; closestDraft = candidate; }
          continue;
        }
        try { run?.onProgress?.({ status: 'validated', attempt: attemptNo, text: validated.block, ...(validated.recovered?.length ? { message: `Recovered locally; omitted ${validated.recovered.length} unsupported change${validated.recovered.length === 1 ? '' : 's'}.` } : {}) }); } catch { /* best effort */ }
        return validated;
      }
      if (!closest || validated.errors.length < closest.length) {
        closest = validated.errors;
        closestDraft = candidate;
      }
    }
    const errors = closest ?? ['Response was not one complete JSON object'];
    try { run?.onProgress?.({ status: 'failed', attempt: attemptNo, errors: errors.slice(0, 20), message: errors[0] }); } catch { /* best effort */ }
    return { ok: false, errors, draft: closestDraft ?? compilerRepairBase(input), fragment: raw.slice(0, 32000) };
  }
  const errors = [result.ok ? 'Response was empty' : result.error];
  try { run?.onProgress?.({ status: 'failed', attempt: attemptNo, errors, message: errors[0] }); } catch { /* best effort */ }
  return { ok: false, errors, draft: compilerRepairBase(input) };
}

/**
 * Repair a rejected draft without asking the model to regenerate it. The model
 * emits only an RFC 7396 merge patch; VELLUM applies that patch locally and runs
 * the same strict salvage/semantic validation used by the first compiler pass.
 */
export async function repairCompilation(
  input: CompilerInput,
  rejectedDraft: unknown,
  validationErrors: readonly string[],
  userId: string | null,
  connectionId?: string,
  generate: typeof internalGenerate = internalGenerate,
  run?: CompilerRunOptions,
): Promise<Compilation> {
  const attemptNo = Math.max(1, Math.round(run?.attempt ?? 2));
  const draft = rejectedDraft && typeof rejectedDraft === 'object' && !Array.isArray(rejectedDraft)
    ? structuredClone(rejectedDraft)
    : compilerRepairBase(input);
  // A held draft can predate a deterministic compatibility recovery added by a
  // newer build. Revalidate the specific false-negative roster failure before
  // spending another provider call; this lets Repair Engine recover an already
  // complete legacy scene.present + scene.detail document immediately.
  if (validationErrors.includes('persona state requires the player in present')) {
    const recovered = salvageCompilation(draft, input);
    if (recovered.ok && !argentRequirementErrors(recovered.candidate, input).length) {
      try { run?.onProgress?.({ status: 'validated', attempt: attemptNo, text: recovered.block, message: 'Held draft recovered by compatibility normalization.' }); } catch { /* best effort */ }
      return recovered;
    }
  }
  const repairContext = JSON.stringify({
    validationErrors: [...new Set(validationErrors.map(String).filter(Boolean))].slice(0, 50),
    draft,
    ...(run?.rejectedFragment ? { rejectedFragment: run.rejectedFragment.slice(0, 32000) } : {}),
    source: JSON.parse(compilerContext(input)),
  });
  const patchSchema = {
    type: 'object', additionalProperties: false, required: ['patch'],
    properties: { patch: { type: 'object', additionalProperties: true } },
  };
  try {
    run?.onProgress?.({
      status: 'retry', attempt: attemptNo,
      text: JSON.stringify(draft),
      message: 'Repairing the rejected draft with a minimal patch.',
      errors: validationErrors.slice(0, 20),
    });
  } catch { /* best effort */ }
  let streamed = '';
  try { run?.onProgress?.({ status: 'requesting', attempt: attemptNo, message: 'Repair request sent; waiting for the patch.' }); } catch { /* best effort */ }
  const result = await generate([
    { role: 'system', content: STATE_COMPILER_SYSTEM + '\n\n' + STATE_COMPILER_REPAIR_SYSTEM },
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
    return { ok: false, errors, draft };
  }
  let closest = [...validationErrors];
  let closestDraft: unknown = draft;
  for (const envelope of compilerPatchObjects(raw).reverse()) {
    const patched = applyCompilerMergePatch(draft, envelope.patch);
    if (JSON.stringify(patched) === JSON.stringify(draft)) {
      closest = ['Repair patch made no changes to the rejected draft'];
      continue;
    }
    try { run?.onProgress?.({ status: 'validating', attempt: attemptNo, text: JSON.stringify(patched), message: 'Applying and validating the repair patch.' }); } catch { /* best effort */ }
    const validated = salvageCompilation(patched, input);
    if (validated.ok) {
      const required = argentRequirementErrors(validated.candidate, input);
      if (required.length) {
        if (!closest.length || required.length <= closest.length) { closest = required; closestDraft = patched; }
        continue;
      }
      try { run?.onProgress?.({ status: 'validated', attempt: attemptNo, text: validated.block, message: 'Repair patch validated.' }); } catch { /* best effort */ }
      return validated;
    }
    if (!closest.length || validated.errors.length <= closest.length) {
      closest = validated.errors;
      closestDraft = patched;
    }
  }
  const errors = closest.length ? closest : ['Repair response did not contain one JSON merge patch'];
  try { run?.onProgress?.({ status: 'failed', attempt: attemptNo, errors: errors.slice(0, 20), message: errors[0] }); } catch { /* best effort */ }
  return { ok: false, errors, draft: closestDraft, fragment: raw.slice(0, 32000) };
}

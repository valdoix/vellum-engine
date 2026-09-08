import type { PromptBlockSnapshotDTO, UserPresetDTO } from 'lumiverse-spindle-types';

export interface TurnContract {
  active: boolean;
  argent: boolean;
  state: boolean;
  reverie: boolean;
  dialogueColor: boolean;
  reasoningRoute: string;
  stateCompiler: 'engine' | 'inline';
  stateVerbosity: 'lean' | 'full';
  codex: boolean;
  inventory: boolean;
  worldgen: boolean;
  livingWorld: 'off' | 'minimal' | 'active' | 'sandbox';
  agency: 'protected' | 'continuity' | 'director';
}

export type AgencyMode = TurnContract['agency'];
export interface TurnAgencyLedger {
  through: number;
  runs: Array<[turn: number, agency: AgencyMode]>;
}

type PresetLike = Partial<UserPresetDTO> & {
  blocks?: PromptBlockSnapshotDTO[];
  prompt_order?: PromptBlockSnapshotDTO[];
  metadata?: Record<string, unknown>;
};

function blocksOf(preset: PresetLike): PromptBlockSnapshotDTO[] {
  if (Array.isArray(preset.prompt_order)) return preset.prompt_order;
  return Array.isArray(preset.blocks) ? preset.blocks : [];
}

function variableValue(preset: PresetLike, name: string): unknown {
  const blocks = blocksOf(preset);
  const promptVariables = preset.metadata?.promptVariables;
  const selected = promptVariables && typeof promptVariables === 'object'
    ? promptVariables as Record<string, Record<string, unknown>>
    : {};
  for (const block of blocks) {
    const def = block.variables?.find((candidate) => candidate.name === name);
    if (!def) continue;
    const byBlock = selected[block.id];
    const value = byBlock && Object.prototype.hasOwnProperty.call(byBlock, name)
      ? byBlock[name]
      : def.defaultValue;
    const options = 'options' in def && Array.isArray(def.options) ? def.options : [];
    if (!options.length) return value;
    const option = options.find((candidate) => candidate.id === value
      || candidate.value === value
      || (typeof value === 'string' && candidate.label === value));
    return option?.id ?? value;
  }
  return undefined;
}

function on(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

/** Per-chat permission for the optional Engine Second Pass. Unset is enabled so
 * existing chats keep their current behavior after upgrading. Accept legacy
 * boolean spellings defensively because chat variables are host-owned strings. */
export function enginePassEnabled(value: unknown): boolean {
  if (value === false || value === 0) return false;
  if (typeof value !== 'string') return true;
  return !['off', 'false', '0', 'disabled'].includes(value.trim().toLowerCase());
}

/** Per-chat permission to retain persona tracker detail. This is
 * intentionally opt-in so an unset value preserves the historical hard blank. */
export function personaStateEnabled(value: unknown): boolean {
  return value === true || value === 1
    || (typeof value === 'string' && ['1', 'true', 'on', 'enabled'].includes(value.trim().toLowerCase()));
}

/** Prompt guidance for the per-chat Persona State option. Tracking is a
 * separate permission from narrative authorship: Forbidden and Minor
 * Continuity still govern prose, while the private VELLUM snapshot may always
 * maintain the persona's current state and interiority when this option is on. */
export function personaStateGuidance(enabled: boolean, contract: TurnContract | null, personaName = ''): string {
  if (!enabled || contract?.state === false) return '';
  const safeName = String(personaName || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 120) || 'the player persona';
  const mode = contract?.agency ?? 'protected';
  if (contract?.stateCompiler === 'engine') {
    return `[PERSONA STATE TRACKING — ON]\nKeep ${safeName} in the on-stage cast. The private VELLUM compiler must populate their current mood, physical condition, activity, concise first-person thought, and stable traits on every turn, including ${mode} agency. Persona State is explicit permission for tracker-only inference from the latest input, completed scene, prior persona state, and established characterization. It does not authorize any corresponding speech, decision, action, reaction, sensation, or interiority in story prose; continue to obey the selected ${mode} prose-agency contract. Do not emit tracker fields, JSON, or a state block.`;
  }
  return `[PERSONA STATE TRACKING — ON]\nIn the final VELLUM present roster, put ${safeName} first and always populate current mood, physical condition, activity, a concise first-person thought, and stable traits, including under ${mode} agency. Infer the private tracker snapshot from the latest input, completed scene, prior persona state, and established characterization; preserve stable traits and continuing conditions until they change. Persona State is tracker-only permission and does not authorize corresponding player speech, decisions, actions, reactions, sensations, or interiority in story prose. The selected ${mode} prose-agency contract remains fully binding. Persona tracker fields do not require an evidence quote.`;
}

type MessageLike = { role?: unknown; content?: unknown; __isChatHistory?: unknown };

interface EffectiveMarker {
  state?: unknown;
  compiler?: unknown;
  verbosity?: unknown;
  reasoning?: unknown;
  dialogueColor?: unknown;
  codex?: unknown;
  inventory?: unknown;
  worldgen?: unknown;
  livingWorld?: unknown;
  agency?: unknown;
}

function livingWorldMode(value: unknown, fallback: TurnContract['livingWorld']): TurnContract['livingWorld'] {
  return value === 'off' || value === 'minimal' || value === 'active' || value === 'sandbox' ? value : fallback;
}

function agencyMode(value: unknown, fallback: TurnContract['agency']): TurnContract['agency'] {
  if (value === 'forbidden') return 'protected';
  return value === 'protected' || value === 'continuity' || value === 'director' ? value : fallback;
}

/** The assistant ordinal this assembled request will create or replace. */
export function prospectiveAssistantTurn(messages: readonly MessageLike[]): number {
  const flagged = messages.some((message) => Object.prototype.hasOwnProperty.call(message, '__isChatHistory'));
  const history = flagged ? messages.filter((message) => message.__isChatHistory === true) : messages;
  return history.reduce((count, message) => count + (message.role === 'assistant' ? 1 : 0), 0) + 1;
}

export function parseTurnAgencyLedger(raw: unknown): TurnAgencyLedger {
  if (typeof raw !== 'string' || !raw) return { through: 0, runs: [] };
  try {
    const value = JSON.parse(raw) as { t?: unknown; r?: unknown };
    const through = Number.isSafeInteger(value.t) && Number(value.t) > 0 ? Number(value.t) : 0;
    if (!Array.isArray(value.r)) return { through, runs: [] };
    const byTurn = new Map<number, AgencyMode>();
    for (const row of value.r) {
      if (!Array.isArray(row) || !Number.isSafeInteger(row[0]) || row[0] < 1 || row[0] > through) continue;
      const agency = row[1] === 'p' ? 'protected' : row[1] === 'c' ? 'continuity' : row[1] === 'd' ? 'director' : null;
      if (agency) byTurn.set(row[0], agency);
    }
    const runs = [...byTurn.entries()].sort((a, b) => a[0] - b[0]);
    return { through, runs };
  } catch {
    return { through: 0, runs: [] };
  }
}

export function agencyAtTurn(ledger: TurnAgencyLedger, turn: number, fallback: AgencyMode = 'protected'): AgencyMode {
  let agency = fallback;
  for (const [from, value] of ledger.runs) {
    if (from > turn) break;
    agency = value;
  }
  return agency;
}

/** Record one turn while retaining the agency previously assigned to later turns. */
export function recordTurnAgency(ledger: TurnAgencyLedger, turn: number, agency: AgencyMode): TurnAgencyLedger {
  if (!Number.isSafeInteger(turn) || turn < 1) return ledger;
  const previousThrough = ledger.through;
  const restore = turn < previousThrough ? agencyAtTurn(ledger, turn + 1) : null;
  const points = new Map(ledger.runs);
  points.set(turn, agency);
  if (restore) points.set(turn + 1, restore);
  const through = Math.max(previousThrough, turn);
  const runs: TurnAgencyLedger['runs'] = [];
  let prior: AgencyMode = 'protected';
  for (const [from, value] of [...points.entries()].filter(([from]) => from <= through).sort((a, b) => a[0] - b[0])) {
    if (value === prior) continue;
    runs.push([from, value]);
    prior = value;
  }
  return { through, runs };
}

export function serializeTurnAgencyLedger(ledger: TurnAgencyLedger): string {
  const code = (agency: AgencyMode): 'p' | 'c' | 'd' => agency === 'protected' ? 'p' : agency === 'continuity' ? 'c' : 'd';
  return JSON.stringify({ t: ledger.through, r: ledger.runs.map(([turn, agency]) => [turn, code(agency)]) });
}

function effectiveMarker(messages: readonly MessageLike[]): EffectiveMarker | null {
  for (const message of messages) {
    if (message.__isChatHistory || typeof message.content !== 'string') continue;
    const match = message.content.match(/<!--VELLUM-EFFECTIVE\s+({[^\r\n]*})\s*-->/);
    if (!match) continue;
    try {
      const parsed = JSON.parse(match[1]!) as EffectiveMarker;
      if (parsed && typeof parsed === 'object') return parsed;
    } catch { /* fall through to expanded-prompt inference */ }
  }
  return null;
}

function assembledPrompt(messages: readonly MessageLike[]): string {
  return messages
    .filter((message) => !message.__isChatHistory && typeof message.content === 'string')
    .map((message) => String(message.content))
    .join('\n');
}

/**
 * Recover ARGENT's contract from the assembled prompt when an older host does
 * not include presetId in InterceptorContext. The machine marker is definitive;
 * the legacy path requires both ARGENT's final output heading and a distinctive
 * ARGENT/state-compiler anchor so ordinary prompts cannot opt into VELLUM by
 * mentioning one phrase in chat history.
 */
function embeddedArgentContract(marker: EffectiveMarker | null, prompt: string): TurnContract | null {
  const legacyArgent = /\[OUTPUT — FOLLOW EXACTLY\]/i.test(prompt)
    && /\[(?:ARGENT (?:CORE|— (?:VERBOSE REVERIE|COMPACT REVERIE|PRIVATE|SILENT ONE-PASS))|ENGINE SECOND PASS|FINAL AGENCY ANCHOR — (?:protected|continuity|director))\]/i.test(prompt);
  if (!marker && !legacyArgent) return null;
  return {
    active: true,
    argent: true,
    state: true,
    reverie: true,
    dialogueColor: true,
    reasoningRoute: 'compact',
    stateCompiler: 'engine',
    stateVerbosity: 'lean',
    codex: true,
    inventory: true,
    worldgen: false,
    livingWorld: 'active',
    agency: 'protected',
  };
}

/** Resolve the output contract from the exact preset selected for this chat. */
export function resolveTurnContract(preset: PresetLike | null | undefined): TurnContract | null {
  if (!preset) return null;
  const blocks = blocksOf(preset);
  const ids = new Set(blocks.map((block) => block.id));
  const argent = preset.id === 'vellum-ii-argent-loom'
    || preset.name === 'VELLUM II — ARGENT LOOM'
    || (ids.has('arg-control') && ids.has('arg-output-contract'));
  const hasStateControl = blocks.some((block) => block.variables?.some((variable) => variable.name === 'state_on'));
  const linked = argent || hasStateControl || !!preset.metadata?.vellum_engine;
  if (!linked) return null;

  const reasoningRoute = String(variableValue(preset, 'reasoning_route') ?? (on(variableValue(preset, 'reverie'), false) ? 'compact' : 'silent'));
  return {
    active: true,
    argent,
    state: on(variableValue(preset, 'state_on'), true),
    reverie: reasoningRoute === 'compact' || reasoningRoute === 'verbose',
    dialogueColor: argent && on(variableValue(preset, 'dialogue_color'), true),
    reasoningRoute,
    stateCompiler: argent && variableValue(preset, 'state_compiler') === 'engine' ? 'engine' : 'inline',
    stateVerbosity: variableValue(preset, 'state_verbosity') === 'full' ? 'full' : 'lean',
    codex: argent && on(variableValue(preset, 'codex'), true),
    inventory: argent && on(variableValue(preset, 'inventory'), true),
    worldgen: argent && on(variableValue(preset, 'worldgen'), false),
    livingWorld: argent ? livingWorldMode(variableValue(preset, 'living_world'), 'active') : 'off',
    agency: argent ? agencyMode(variableValue(preset, 'agency'), 'protected') : 'protected',
  };
}

/**
 * Refine a preset's base contract from the host-assembled prompt. The assembled
 * text has already received profile overrides, so output-critical VELLUM
 * behavior follows the exact values used for this generation. Official ARGENT
 * presets expose a machine-readable marker; structural prompt signatures keep
 * older presets safe when the marker is absent.
 */
export function resolveTurnContractFromMessages(
  preset: PresetLike | null | undefined,
  messages: readonly MessageLike[],
): TurnContract | null {
  const marker = effectiveMarker(messages);
  const prompt = assembledPrompt(messages);
  const base = resolveTurnContract(preset) ?? embeddedArgentContract(marker, prompt);
  if (!base) return null;
  const next = { ...base };

  if (marker) {
    next.state = on(marker.state, base.state);
    next.dialogueColor = base.argent && on(marker.dialogueColor, base.dialogueColor);
    next.reasoningRoute = typeof marker.reasoning === 'string' ? marker.reasoning : base.reasoningRoute;
    next.reverie = next.reasoningRoute === 'compact' || next.reasoningRoute === 'verbose';
    next.stateCompiler = marker.compiler === 'engine' ? 'engine' : marker.compiler === 'inline' ? 'inline' : base.stateCompiler;
    next.stateVerbosity = marker.verbosity === 'full' ? 'full' : marker.verbosity === 'lean' ? 'lean' : base.stateVerbosity;
    next.codex = base.argent && on(marker.codex, base.codex);
    next.inventory = base.argent && on(marker.inventory, base.inventory);
    next.worldgen = base.argent && on(marker.worldgen, base.worldgen);
    next.livingWorld = base.argent ? livingWorldMode(marker.livingWorld, base.livingWorld) : 'off';
    next.agency = base.argent ? agencyMode(marker.agency, base.agency) : 'protected';
    return next;
  }

  if (base.argent) {
    if (/\[ARGENT — VERBOSE REVERIE\]/i.test(prompt)) next.reasoningRoute = 'verbose';
    else if (/\[ARGENT — COMPACT REVERIE\]/i.test(prompt)) next.reasoningRoute = 'compact';
    else if (/\[ARGENT — PRIVATE\]/i.test(prompt)) next.reasoningRoute = 'native';
    else if (/\[ARGENT — SILENT ONE-PASS\]/i.test(prompt)) next.reasoningRoute = 'silent';
    next.reverie = next.reasoningRoute === 'compact' || next.reasoningRoute === 'verbose';
    if (/\[FINAL AGENCY ANCHOR — director\]|MODE director:/i.test(prompt)) next.agency = 'director';
    else if (/\[FINAL AGENCY ANCHOR — continuity\]|MODE continuity:/i.test(prompt)) next.agency = 'continuity';
    else if (/\[FINAL AGENCY ANCHOR — protected\]|MODE protected:/i.test(prompt)) next.agency = 'protected';

    const outputContractPresent = /\[OUTPUT — FOLLOW EXACTLY\]/i.test(prompt);
    if (outputContractPresent) {
      const engineSecondPass = /\[ENGINE SECOND PASS\][^\n]*engine compiles and validates state separately/i.test(prompt);
      next.state = engineSecondPass || /\[VELLUM STATE[^\n]*CONTRACT\]|\[STATE SERIALIZATION[^\n]*FINAL GATE\]|one complete <vellum>|ends with <\/vellum>/i.test(prompt);
      next.dialogueColor = /\[COLORED DIALOGUE[^\n]*(?:CONTRACT|MARKUP)\]/i.test(prompt);
      if (next.state) {
        const inlineSchema = /\[VELLUM STATE — (?:LEAN|FULL) CONTRACT\]|\[STATE COMPILER — FINAL\]/i.test(prompt);
        next.stateCompiler = engineSecondPass || !inlineSchema ? 'engine' : 'inline';
        if (/\[VELLUM STATE — FULL CONTRACT\]/i.test(prompt)) next.stateVerbosity = 'full';
        else if (/\[VELLUM STATE — LEAN CONTRACT\]/i.test(prompt)) next.stateVerbosity = 'lean';
      }
      next.codex = /\[THE CODEX\]|ext\.codex/i.test(prompt);
      next.inventory = /\[POSSESSIONS\]|ext\.inventory/i.test(prompt);
      next.worldgen = /\[CARTOGRAPHER — OPENING OR EXPLICIT RUN\]/i.test(prompt);
      if (/\[LIVING WORLD\]/i.test(prompt)) {
        if (/This is an autonomous world;[^\n]*one actor among many/i.test(prompt)) next.livingWorld = 'sandbox';
        else if (/The world does not pause when[^\n]*looks away/i.test(prompt)) next.livingWorld = 'active';
        else if (/On a time skip or re-entry, allow one small concrete sign/i.test(prompt)) next.livingWorld = 'minimal';
        else if (/does not run an independent off-screen activity engine\. Render only what reaches the visible scene/i.test(prompt)) next.livingWorld = 'off';
      }
    }
  } else if (/\[OUTPUT FORMAT|\[STATE BLOCK — MANDATORY|\[VELLUM STATE\]/i.test(prompt)) {
    next.state = /<vellum>|\[STATE BLOCK — MANDATORY|\[VELLUM STATE\]/i.test(prompt);
  }
  return next;
}

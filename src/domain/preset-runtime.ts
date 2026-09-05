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
  };
}

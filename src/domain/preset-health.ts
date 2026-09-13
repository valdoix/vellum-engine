import type { PromptBlockSnapshotDTO } from 'lumiverse-spindle-types';

export const VELLUM_STATE_CONTRACT_VERSION = '2.3';

/** Canonical compatibility contract inserted into ordinary Loom presets. */
export const VELLUM_STATE_BLOCK_CONTENT =
  '[VELLUM STATE] After the prose, on a new line, append ONE raw-JSON <vellum>...</vellum> block (the display layer hides it). '
  + 'Valid JSON, current scene plus deltas — omit unchanged optional fields. Fields:\n'
  + '{ turn:int, day:int, scene:{title?,transition?:"continue"|"scene"|"time_skip",loc,time:"HH:MM",clock:int 0-1439,tension:0-10,weather}, '
  + 'present:[{id or name,mood,condition,doing,thought,traits,evidence}], '
  + 'delta:{ bonds:[{a,b,aff,trust,addCats:[],removeCats:[],why}], threads:[{op:new|advance|stall|resolve,name,note}], '
  + 'arcs:[{op:new|advance|stall|resolve,name,note}], journal:[{who,about,memory,kind,weight,sentiment}], '
  + 'knowledge:[{who,fact,about,reliability:knows|believes|suspects|wrong|unaware,truth:true|false|unknown,source}], '
  + 'secrets:[{keeper,secret,from}], secretReveals:[{id:"exact prior secret id",to:[names]}], factionRelations:[{from,to,trust,respect,fear,hostility,why}], parallel:[{who,where,activity}] }, '
  + 'ext:{ scars:[{who,was,about}], codex:[{id:"existing id when refreshing",op:add|refresh,fact,tag}], inventory:[{who,item,op:gain|lose|give|scene|note,to,note}], timeline:[{event,day,time:"HH:MM",location,participants:[names],importance:minor|major|critical}] } }\n'
  + 'When a scene is active, scene.time and scene.clock MUST describe the same exact instant. present[] MUST include {{user}} whenever on-screen. Leave mood/condition/doing/thought empty and traits [] unless the VELLUM runtime PERSONA STATE option explicitly says ON; when ON, always populate current mood, condition, doing, concise first-person thought, and stable traits as tracker-only metadata regardless of player-agency mode. This does not authorize corresponding player behavior in prose. '
  + 'Give a newly opened scene a concise, evocative, spoiler-free title grounded in its opening; preserve a user title exactly. Use transition scene or time_skip only for a supported boundary, otherwise continue. '
  + 'Include every named on-stage NPC with a concise first-person private thought limited to that NPC\'s knowledge. '
  + 'Use secretReveals with the existing id when prose discloses a tracked secret, and add recipient knowledge with its source; never recreate that secret as new. Refresh changed Codex facts by existing id. '
  + 'Audit threads and arcs every turn, including turn 1: capture the strongest supported unresolved question and its broader parent arc when clear, and prefer one directly changed thread plus its linked arc later. Never invent a cadence or progress. Reuse an exact existing title and require a concrete note only when this prose directly changes that tracked situation; mentions, shared characters, mood/theme/location, and elapsed time are not progress. Thread stall requires a blocked attempt and resolve requires actual closure. An arc advances only from a changed child thread or a structural milestone in the arc itself. '
  + 'Always close the </vellum> tag.';

export type StateContractKind = 'argent' | 'vellum' | 'compatibility' | 'unknown';
export type StateContractStatus = 'healthy' | 'repairable' | 'invalid' | 'missing';

export interface StateContractIssue {
  code: string;
  message: string;
  blockId?: string;
}

export interface StateContractHealth {
  status: StateContractStatus;
  kind: StateContractKind;
  version: string;
  expectedHash: string;
  primaryBlockId: string | null;
  issues: StateContractIssue[];
}

type BlockLike = Partial<PromptBlockSnapshotDTO> & { id?: string; name?: string; content?: string };

export function stateContractHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const EXPECTED_HASH = stateContractHash(VELLUM_STATE_BLOCK_CONTENT);
const REQUIRED_SCHEMA_TERMS = [
  '<vellum>', '</vellum>', 'scene', 'present', 'knowledge', 'secrets',
  'secretReveals', 'scars', 'codex', 'inventory', 'timeline',
];

function contentOf(block: BlockLike | undefined): string {
  return typeof block?.content === 'string' ? block.content : '';
}

function structuralIssues(block: BlockLike, expectedPosition?: 'pre_history' | 'post_history'): StateContractIssue[] {
  const issues: StateContractIssue[] = [];
  const id = String(block.id ?? '');
  if (block.enabled === false) issues.push({ code: 'disabled', blockId: id, message: 'The state contract block is disabled.' });
  if (block.role !== 'system') issues.push({ code: 'role', blockId: id, message: 'The state contract must use the system role.' });
  if (expectedPosition && block.position !== expectedPosition) {
    issues.push({ code: 'position', blockId: id, message: `The state contract must be placed ${expectedPosition.replace('_', ' ')}.` });
  } else if (!expectedPosition && block.position !== 'pre_history' && block.position !== 'post_history') {
    issues.push({ code: 'position', blockId: id, message: 'The state contract has no valid Loom placement.' });
  }
  return issues;
}

/** Validate the actual state-contract graph instead of accepting any mention of `<vellum>`. */
export function assessVellumStateContract(input: readonly BlockLike[] | null | undefined): StateContractHealth {
  const blocks = Array.isArray(input) ? input : [];
  const byId = new Map(blocks.map((block) => [String(block.id ?? ''), block]));
  const expectedHash = EXPECTED_HASH;

  const argentDetected = byId.has('arg-output-contract') || byId.has('arg-state-schema') || byId.has('arg-state-final');
  if (argentDetected) {
    const issues: StateContractIssue[] = [];
    const schema = byId.get('arg-state-schema');
    const final = byId.get('arg-state-final');
    const output = byId.get('arg-output-contract');
    if (!schema) issues.push({ code: 'argent_schema_missing', message: 'ARGENT state schema block is missing.' });
    if (!final) issues.push({ code: 'argent_final_missing', message: 'ARGENT final state compiler block is missing.' });
    if (!output) issues.push({ code: 'argent_output_missing', message: 'ARGENT final output contract is missing.' });
    for (const requiredId of ['arg-state-schema', 'arg-state-final', 'arg-output-contract']) {
      const count = blocks.filter((block) => block.id === requiredId).length;
      if (count > 1) issues.push({ code: 'duplicate', blockId: requiredId, message: `Found ${count} copies of ${requiredId}.` });
    }
    if (schema) issues.push(...structuralIssues(schema, 'pre_history'));
    if (final) issues.push(...structuralIssues(final, 'post_history'));
    if (output) issues.push(...structuralIssues(output, 'post_history'));
    if (schema && !/VELLUM STATE[^\n]*CONTRACT/i.test(contentOf(schema))) {
      issues.push({ code: 'argent_schema_stale', blockId: String(schema.id ?? ''), message: 'ARGENT state schema is incomplete or obsolete.' });
    }
    if (final && !/(?:STATE COMPILER[^\n]*FINAL|FINAL STATE COMPILER)/i.test(contentOf(final))) {
      issues.push({ code: 'argent_final_stale', blockId: String(final.id ?? ''), message: 'ARGENT final state compiler contract is incomplete or obsolete.' });
    }
    if (output) {
      if (!/OUTPUT[^\n]*FOLLOW EXACTLY/i.test(contentOf(output))) {
        issues.push({ code: 'argent_output_stale', blockId: String(output.id ?? ''), message: 'ARGENT output contract is incomplete or obsolete.' });
      }
      const lastEnabled = [...blocks].reverse().find((block) => block.enabled !== false && block.marker !== 'category');
      if (lastEnabled?.id !== output.id) {
        issues.push({ code: 'argent_output_order', blockId: String(output.id ?? ''), message: 'ARGENT output contract is not the final enabled Loom block.' });
      }
    }
    return {
      status: issues.length ? 'invalid' : 'healthy',
      kind: 'argent',
      version: 'ARGENT',
      expectedHash,
      primaryBlockId: schema?.id ? String(schema.id) : null,
      issues,
    };
  }

  const primaries = blocks.filter((block) => {
    const id = String(block.id ?? '');
    const name = String(block.name ?? '');
    const content = contentOf(block);
    return id === 'v2-state'
      || /^VELLUM\s*[—-]\s*State Block$/i.test(name)
      || /^\s*(?:\{\{if[^\n]*\}\}\s*)?\[VELLUM STATE\]/i.test(content);
  });
  if (!primaries.length) {
    return { status: 'missing', kind: 'unknown', version: VELLUM_STATE_CONTRACT_VERSION, expectedHash, primaryBlockId: null, issues: [{ code: 'missing', message: 'No VELLUM state contract block was found.' }] };
  }
  if (primaries.length > 1) {
    return {
      status: 'invalid', kind: 'vellum', version: VELLUM_STATE_CONTRACT_VERSION, expectedHash,
      primaryBlockId: String(primaries[0]?.id ?? '') || null,
      issues: [{ code: 'duplicate', message: `Found ${primaries.length} primary VELLUM state blocks. Resolve the duplicates before repairing.` }],
    };
  }

  const primary = primaries[0]!;
  const content = contentOf(primary);
  const isVellumPreset = primary.id === 'v2-state';
  const issues = structuralIssues(primary, isVellumPreset ? 'pre_history' : 'post_history');
  for (const term of REQUIRED_SCHEMA_TERMS) {
    if (!content.toLowerCase().includes(term.toLowerCase())) {
      issues.push({ code: 'schema_term', blockId: String(primary.id ?? ''), message: `State contract is missing required schema term: ${term}.` });
    }
  }
  const exactCompatibility = stateContractHash(content) === expectedHash;
  if (!isVellumPreset && !exactCompatibility) {
    issues.push({ code: 'hash', blockId: String(primary.id ?? ''), message: 'Compatibility state contract does not match the current canonical version.' });
  }
  return {
    status: issues.length ? (isVellumPreset ? 'invalid' : 'repairable') : 'healthy',
    kind: isVellumPreset ? 'vellum' : 'compatibility',
    version: isVellumPreset ? 'VELLUM II' : VELLUM_STATE_CONTRACT_VERSION,
    expectedHash,
    primaryBlockId: String(primary.id ?? '') || null,
    issues,
  };
}

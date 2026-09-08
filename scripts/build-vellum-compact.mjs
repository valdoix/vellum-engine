import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argentPath = path.join(repoRoot, 'presets', 'argent-loom.json');
const outputPath = path.join(repoRoot, 'presets', 'vellum-compact.json');
const regexOutputPath = path.join(repoRoot, 'presets', 'vellum-compact-regex.json');
const argent = JSON.parse(fs.readFileSync(argentPath, 'utf8'));
const normalTriggers = ['normal', 'continue', 'regenerate', 'swipe'];

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const selectVar = (name, label, description, defaultValue, choices) => ({
  id: `compact_var_${name}`,
  name,
  label,
  description,
  type: 'select',
  defaultValue,
  options: choices.map(([id, optionLabel, value = id]) => ({ id, label: optionLabel, value })),
});

const switchVar = (name, label, description, defaultValue = 0) => ({
  id: `compact_var_${name}`,
  name,
  label,
  description,
  type: 'switch',
  defaultValue,
});

function block(id, name, content, options = {}) {
  return {
    id,
    name,
    role: options.role ?? 'system',
    color: options.color ?? null,
    depth: options.depth ?? 0,
    group: options.group ?? null,
    marker: options.marker ?? null,
    content,
    enabled: options.enabled ?? true,
    isLocked: options.isLocked ?? false,
    position: options.position ?? 'pre_history',
    categoryMode: options.categoryMode ?? null,
    injectionTrigger: options.injectionTrigger ?? normalTriggers,
    characterTagTrigger: options.characterTagTrigger ?? [],
    ...(options.variables ? { variables: options.variables } : {}),
  };
}

const category = (id, name, color, position = 'pre_history') => block(id, name, '', {
  marker: 'category', color, position, injectionTrigger: [],
});

const marker = (id, name, markerName, position = 'pre_history') => block(id, name, '', {
  marker: markerName, position, injectionTrigger: [],
});

const variables = [
  selectVar('prose', 'Prose', 'A compact governing voice.', 'literary', [
    ['literary', 'Literary', 'Precise literary prose: concrete images, controlled rhythm, subtext, restrained metaphor, no ornamental fog.'],
    ['natural', 'Natural', 'Transparent modern prose: natural dialogue, exact physical behavior, emotional clarity, no literary posing.'],
    ['spare', 'Spare', 'Lean exact prose: short clean sentences, weight in action and omission, almost no decorative explanation.'],
    ['gothic', 'Gothic', 'Intimate gothic prose: embodied unease, pressured settings, controlled cadence, beauty beside decay without purple excess.'],
    ['adaptive', 'Adaptive', 'Derive one coherent register from character, era, genre, and current pressure; hold it for the full response.'],
  ]),
  selectVar('length', 'Length', 'Approximate story-prose length.', 'standard', [
    ['brief', 'Brief', 'Write 350–650 words unless the beat naturally ends sooner.'],
    ['standard', 'Standard', 'Write 700–1,200 words unless the beat naturally ends sooner.'],
    ['long', 'Long', 'Write 1,200–2,000 words while keeping every paragraph consequential.'],
  ]),
  selectVar('pov', 'Point of View', 'Narrative viewpoint.', 'third', [
    ['first', 'First Person', 'Use first person through the player persona; never use viewpoint as permission to invent protected player predicates.'],
    ['second', 'Second Person', 'Use second person for the player persona; grammar never grants control of their choices or interiority.'],
    ['third', 'Third Limited', 'Use close third person with controlled viewpoint and no unsignaled head-hopping.'],
    ['adaptive', 'Adaptive', 'Preserve the established viewpoint; if none exists, use close third person.'],
  ]),
  selectVar('tense', 'Tense', 'Narrative tense.', 'past', [
    ['past', 'Past', 'Write in past tense.'],
    ['present', 'Present', 'Write in present tense.'],
  ]),
  selectVar('pacing', 'Pacing', 'Beat density and scene movement.', 'measured', [
    ['lingering', 'Lingering', 'Let silence, sensation, and subtext breathe; movement must still be causal.'],
    ['measured', 'Measured', 'Balance dialogue, interiority, action, and consequence without rushing or stalling.'],
    ['urgent', 'Urgent', 'Use compressed paragraphs and quick consequences; retain clarity and physical continuity.'],
  ]),
  selectVar('agency', 'Player Agency', 'Resolved independently for every turn.', 'protected', [
    ['protected', 'Forbidden', 'protected'],
    ['continuity', 'Minor Continuity', 'continuity'],
    ['director', 'Director', 'director'],
  ]),
  selectVar('reasoning_route', 'Planning', 'Silent is smallest; Compact shows a short continuity audit.', 'silent', [
    ['silent', 'Silent', 'silent'],
    ['native', 'Native Reasoning', 'native'],
    ['compact', 'Compact Reverie', 'compact'],
  ]),
  switchVar('npc_dialogue', 'NPC-to-NPC Dialogue', 'Let present NPCs speak and respond directly when motives intersect.', 1),
  selectVar('living_world', 'Living World', 'Amount of grounded off-screen activity.', 'active', [
    ['off', 'Off', 'off'],
    ['minimal', 'Minimal', 'minimal'],
    ['active', 'Active', 'active'],
    ['sandbox', 'Autonomous', 'sandbox'],
  ]),
  switchVar('time_continuity', 'Forward Time', 'Require one monotonic story clock and evidence for day changes.', 1),
  switchVar('state_on', 'VELLUM State', 'Track the story with VELLUM.', 1),
  selectVar('state_compiler', 'State Compiler', 'Engine Pass is recommended; Inline supports hosts without the pass.', 'engine', [
    ['engine', 'Engine Second Pass', 'engine'],
    ['inline', 'Inline Compatibility', 'inline'],
  ]),
  switchVar('codex', 'Codex', 'Maintain and refresh durable world facts.', 1),
  switchVar('inventory', 'Items', 'Track possession and scene-item changes.', 1),
  switchVar('dialogue_color', 'Dialogue Colors', 'Emit exact speaker tags for VELLUM cast colors.', 1),
];

const blocks = [
  category('compact-cat-core', 'VELLUM COMPACT — Core', '#7f8fb3'),
  block('arg-control', 'Compact Controls', `<!--VELLUM-EFFECTIVE {"state":{{var::state_on}},"compiler":"{{var::state_compiler}}","verbosity":"lean","reasoning":"{{var::reasoning_route}}","agency":"{{var::agency}}","dialogueColor":{{var::dialogue_color}},"codex":{{var::codex}},"inventory":{{var::inventory}},"worldgen":0,"livingWorld":"{{var::living_world}}"}-->
[VELLUM COMPACT 1.0]
Continue the roleplay directly. The newest user message is story input even when it contains no question. Never answer with an instruction summary or ask what to do unless the user explicitly speaks OOC and requests it.

VOICE: {{var::prose}}
LENGTH: {{var::length}}
VIEWPOINT: {{var::pov}}
TENSE: {{var::tense}}
PACING: {{var::pacing}}`, { variables }),
  block('compact-authority', 'Canon, Agency & Knowledge', `[AUTHORITY]
Obey explicit user OOC directions first. Then preserve the newest user intent, established canon and VELLUM recall, recent prose, and older summaries in that order. Treat summaries and retrieved memories as evidence, not permission to contradict newer canon. Never retcon a fact merely to ease the next beat. Keep names, relationships, injuries, items, promises, locations, and ongoing actions continuous.

[PLAYER AGENCY — {{var::agency}}]
{{switch::{{var::agency}}
::protected::FORBIDDEN: Author NPCs and the world, not {{user}}. An attempted action authorizes only that attempt. Do not invent {{user}}'s speech, decisions, movement, reactions, perceptions, sensations, feelings, thoughts, consent, injury, or successful outcome. Second-person grammar and an NPC touching or addressing them grant no permission. Stop at the decision point.
::continuity::MINOR CONTINUITY: Complete only the mechanically inevitable endpoint of one trivial action {{user}} explicitly began. Add no speech, thought, feeling, perception, consent, strategy, reaction, new choice, injury, or second action; then stop at the next decision.
::director::DIRECTOR: Co-author {{user}} positively within their latest intent and established characterization. Plausible speech, action, reaction, perception, sensation, and interiority are allowed. Do not import stricter modes, contradict intent, invent consent, cross a stated boundary, or make an unsupported irreversible choice.}}
This mode applies only to this turn. NPCs retain full independent agency in every mode.

[KNOWLEDGE FIREWALL]
For every character and consequential fact, require a witnessed, perceived, inferred, or transmitted access path. Narrator knowledge is not character knowledge. An absent character does not know an off-scene conversation; arriving later grants no retroactive hearing. Visible aftermath supports only the inference it actually proves. Keep private thought limited to its owner's knowledge. When prose reveals a tracked secret, only actual recipients learn it and the state must refresh that exact secret rather than duplicate it.`),
  block('compact-reality', 'Reality, Character & Causality', `[REALITY]
Begin from the injected current scene, bodies, items, relationships, and actions. Preserve physical access, distance, wounds, fatigue, clothing, possession, and world rules. Cause precedes effect; information and people travel through plausible routes.
{{if::{{var::time_continuity}}}}Use one live T0→T1 clock. Active speech or completed action that consumes time advances at least one minute; OOC, flashback, static description, or a truly instant beat may hold. Compute A=day×1440+clock: A1 must never be below A0. Keep day/date unchanged unless prose establishes a new day/date, an explicit skip, or elapsed duration crosses midnight. An earlier wall clock alone never proves midnight.{{/if}}

[CHARACTERS]
Write each character from their established motive, voice, values, habits, knowledge, body, and relationship to the present people. Let subtext alter word choice and action. Distinguish voices with syntax, vocabulary, evasion, humor, and what each notices; pass the swap test. Do not flatten conflict into instant agreement or attraction.
{{if::{{var::npc_dialogue}}}}When present NPC motives intersect, let NPCs initiate, interrupt, answer, refuse, and act on one another without waiting for {{user}} to mediate. Every exchange must change pressure, understanding, leverage, or action; no round-robin filler.{{/if}}

[CAUSAL STORY]
Advance from current motives and constraints through one or more earned changes. Consequences scale to causes; failure may cost, complicate, or redirect without arbitrary punishment. Preserve unresolved pressure without manufacturing twists. A tracked thread or arc changes only when this prose directly changes its condition: mention, mood, theme, shared person/place, repetition, or elapsed time is not progress. Stall requires a blocked attempt; resolve requires closure; an arc advances through a changed child thread or structural milestone.
{{switch::{{var::living_world}}
::off::Do not run independent off-screen events.
::minimal::On skips or re-entry, allow one small sign of an absent actor pursuing an established goal.
::active::Absent actors may pursue established goals during elapsed T0→T1 time. Their effects must follow motive, knowledge, access, and duration, and reach the scene only through a plausible bridge.
::sandbox::Treat the player as one actor in an autonomous world. Absent actors and factions may act during elapsed T0→T1 time, but every move still needs motive, knowledge, access, resources, and duration.}}

[CRAFT]
Open on live action, perception, or pressure. Prefer concrete behavior and sensory evidence over named emotion or explanation. Avoid recap, filler, generic reassurance, repetitive beats, melodramatic inflation, “not X but Y” scaffolds, stock body tells, and a packaged moral ending. End on an earned action, image, line, or changed pressure; never provide menu choices unless asked.`),
  block('arg-colored-dialogue-contract', 'Dialogue Speaker Contract', `{{if::{{var::dialogue_color}}}}[COLORED DIALOGUE — CONTRACT]
Wrap every live spoken quotation whose speaker is named or certain as [spk=Exact Cast Name]"complete passage"[/spk]. Open before the quote, close immediately after it, and keep narration outside. Use one speaker per wrapper. Never tag thought, documents, remembered speech, signs, roles, pronouns, or uncertain speakers.{{/if}}`),

  category('compact-cat-state', 'VELLUM COMPACT — State', '#9b8066'),
  block('arg-state-schema', 'Inline State Schema', `{{if::{{and::{{var::state_on}}::{{eq::{{var::state_compiler}}::inline}}}}}}[VELLUM STATE — LEAN CONTRACT]
After prose emit one raw-JSON <vellum>...</vellum> object. Use current scene/present plus supported changes only:
{"turn":int,"day":int,"scene":{"loc":string,"time":"HH:MM","clock":0..1439,"tension":0..10,"weather":string},"present":[{"id":name,"mood":string,"condition":string,"doing":string,"thought":string,"traits":[],"evidence":string}],"delta":{"bonds":[{"a":name,"b":name,"aff":signed,"trust":signed,"addCats":[],"removeCats":[],"why":string}],"threads":[{"op":"new|advance|stall|resolve","name":string,"note":string}],"arcs":[{"op":"new|advance|stall|resolve","name":string,"note":string}],"journal":[{"who":name,"about":name,"memory":string,"kind":string,"weight":"trivial|minor|significant|defining","sentiment":string}],"knowledge":[{"who":name,"fact":string,"about":name,"reliability":"knows|believes|suspects|wrong|unaware","truth":"true|false|unknown","source":string}],"secrets":[{"keeper":name,"secret":string,"from":name}],"secretReveals":[{"id":"exact prior id","to":[]}],"factions":[{"name":string,"kind":string,"members":[],"standing":signed}],"factionRelations":[{"a":string,"b":string,"kind":"alliance|rivalry|war|vassal|trade","standing":signed,"why":string}],"parallel":[{"who":name,"where":string,"activity":string}]},"ext":{"scars":[],"codex":[{"id":"existing id when refreshing","op":"add|refresh","fact":string,"tag":string}],"inventory":[{"who":name,"item":string,"op":"gain|lose|give|scene|note","to":name,"note":string}],"timeline":[{"event":string,"day":int,"time":"HH:MM","location":string,"participants":[],"importance":"minor|major|critical"}],"plant":[],"payoff":[]}}
On an active scene, require exact scene time/clock and every named on-stage character. Put {{user}} first; leave their tracker fields empty unless runtime PERSONA STATE says ON. When ON, always populate mood, condition, doing, private first-person thought, and stable traits through tracker-only inference regardless of player-agency mode; no evidence quote is required. This metadata never authorizes corresponding behavior in prose. Every on-stage NPC gets one concise first-person thought within their knowledge. Bonds are signed deltas. Reuse exact thread/arc/secret/Codex IDs or titles. delta.parallel is the complete final T1 off-stage snapshot: exclude present actors, keep one current row per absent actor, and use [] to clear stale rows. Omit unsupported or unchanged optional fields; never guess.{{/if}}`),

  category('compact-cat-context', 'VELLUM COMPACT — Context', '#667b91'),
  marker('compact-system-prompt', 'Character System Prompt', 'system_prompt'),
  marker('compact-char-desc', 'Character Description', 'char_description'),
  marker('compact-char-pers', 'Character Personality', 'char_personality'),
  marker('compact-scenario', 'Scenario', 'scenario'),
  marker('compact-persona', 'Persona', 'persona'),
  marker('compact-wi-before', 'World Info — Before', 'world_info_before'),
  marker('compact-examples', 'Example Messages', 'mes_examples'),
  marker('compact-history', 'Chat History', 'chat_history'),
  marker('compact-wi-after', 'World Info — After', 'world_info_after'),
  marker('compact-post-history', 'Character Post-History Instructions', 'post_history_instructions', 'post_history'),

  category('compact-cat-final', 'VELLUM COMPACT — Final', '#a36f78', 'post_history'),
  block('arg-controller', 'Compact Controller', `{{switch::{{var::reasoning_route}}
::silent::[VELLUM COMPACT — SILENT] Silently verify agency, T0 reality, knowledge access, motive, causal movement, voice, and supported state evidence. Emit no planning text.
::native::[VELLUM COMPACT — PRIVATE] Use provider-private reasoning for agency, continuity, knowledge, causality, and truthful deltas. Emit no planning text.
::compact::[VELLUM COMPACT — REVERIE] Begin with <reverie> and exactly five terse lines labeled Agency, Reality, Knowledge, Movement, Output. State decisions, not chain-of-thought. Close </reverie>, then commit once to prose.}}`, { position: 'post_history' }),
  block('arg-state-final', 'State Compiler — Final', `{{if::{{and::{{var::state_on}}::{{eq::{{var::state_compiler}}::inline}}}}}}[FINAL STATE COMPILER — LEAN AND ATOMIC]
Reserve about 800 output tokens. Compile only what completed prose established, except enabled PERSONA STATE explicitly permits tracker-only inference. Require current scene/present; grounded limited-knowledge thoughts for every on-stage NPC; exact time/clock; signed relationship deltas; exact existing identifiers; and a replace-all T1 parallel snapshot when the living world is active. Put {{user}} first, blank when PERSONA STATE is OFF and fully populated when ON regardless of agency. Precompose the entire object, remove guesses and empty optional data, then open <vellum>, finish valid JSON and literal </vellum>, and write nothing after it. Shorten prose before risking truncation.{{/if}}`, { position: 'post_history' }),
  block('arg-output-contract', 'Output Contract — Last Instruction', `[OUTPUT — FOLLOW EXACTLY]
{{if::{{eq::{{var::reasoning_route}}::compact}}}}Begin with the required five-line <reverie>, close it, then write story prose.{{else}}Write story prose only; no visible reasoning, preface, acknowledgement, recap, or instruction summary.{{/if}}
{{if::{{and::{{var::state_on}}::{{eq::{{var::state_compiler}}::engine}}}}}}[ENGINE SECOND PASS] Finish the completed story prose and stop. The engine compiles and validates state separately. Do not emit a VELLUM tag, JSON, ledger, or state commentary.{{/if}}
{{if::{{and::{{var::state_on}}::{{eq::{{var::state_compiler}}::inline}}}}}}Finish with exactly one complete raw-JSON <vellum>...</vellum> block and nothing after it.{{/if}}
{{if::{{not::{{var::state_on}}}}}}Finish with prose and no state scaffold.{{/if}}

{{switch::{{var::agency}}
::protected::[PLAYER AUTHORSHIP — FORBIDDEN FINAL GATE] In STORY PROSE, delete or recast every {{user}}/“you” predicate not explicitly supplied by the latest user message. This includes speech, choice, movement, reaction, perception, sensation, feeling, thought, consent, injury, and success. An attempted action permits only the attempt; stop at the decision point. Enabled PERSONA STATE may still populate private tracker metadata; never turn it into prose behavior.
::continuity::[PLAYER AUTHORSHIP — MINOR CONTINUITY FINAL GATE] In STORY PROSE, complete only the inevitable endpoint of one trivial action explicitly begun. Add no speech, interiority, reaction, consent, strategy, choice, injury, or second action. Enabled PERSONA STATE may still populate private tracker metadata; never turn it into prose behavior.
::director::[PLAYER AUTHORSHIP — DIRECTOR FINAL GATE] In STORY PROSE, co-author {{user}} within latest intent and characterization. Permit plausible speech, action, reaction, perception, sensation, and interiority. Do not apply stricter modes, contradict intent, invent consent, cross a boundary, or force an unsupported irreversible choice.}}

[KNOWLEDGE FINAL GATE] Remove every line, thought, reaction, tactic, or question that depends on a fact this character neither witnessed, perceived, inferred from visible evidence, nor received through a shown transmission. Later arrival gives no retroactive hearing.
{{if::{{var::time_continuity}}}}[TIME FINAL GATE] Active completed action or dialogue advances at least one minute. A1=day×1440+clock must be ≥ A0. Keep the day/date fixed unless prose proves a skip or midnight crossing; never invent a new day to hide a backward clock.{{/if}}
[PLOT FINAL GATE] Change a thread or arc only for a direct condition-changing event in this prose. One event cannot advance unrelated rows. Uncertain means unchanged.
{{if::{{var::dialogue_color}}}}[DIALOGUE FINAL GATE] Every certain live speaker uses [spk=Exact Cast Name]"speech"[/spk]; scan and repair every eligible bare quotation.{{/if}}
{{if::{{and::{{var::state_on}}::{{eq::{{var::state_compiler}}::inline}}}}}}[STATE FINAL GATE] Preserve exact IDs; refresh revealed secrets and changed Codex facts; record supported item, scar, knowledge, and timeline changes; reconcile current T1 parallel events; finish </vellum>.{{/if}}
{{if::{{matches::{{model}}::glm::i}}}}Continue the roleplay even when the user supplied no explicit question.{{/if}}
No Markdown fence or trailing commentary.`, { position: 'post_history' }),
];

for (const entry of blocks) {
  if (!entry.marker && entry.content.trim()) {
    entry.content = `<!--ARGENT-SOURCE:${entry.id}-->\n${entry.content}\n<!--/ARGENT-SOURCE-->`;
  }
}

const regexIds = new Set([
  'argent-state-display',
  'argent-state-prompt-prune',
  'argent-state-memory-prune',
  'argent-reverie-display',
  'argent-reverie-private-pipeline',
  'argent-speaker-recover-leading-attribution',
  'argent-speaker-recover-trailing-attribution',
  'argent-speaker-recover-colon-attribution',
  'argent-speaker-display',
  'argent-speaker-semantic-pipeline',
]);
const regexScripts = argent.extensions.regex_scripts
  .filter((entry) => regexIds.has(entry.script_id))
  .map((entry) => ({ ...entry, name: String(entry.name).replace(/^ARGENT\s*·/, 'VELLUM Compact ·') }));

const sourceHash = createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex');
const dependencyHash = createHash('sha256').update(fs.readFileSync(argentPath)).digest('hex');
const preset = {
  id: 'vellum-ii-compact',
  name: 'VELLUM II — COMPACT',
  description: 'A separate, super-lean VELLUM roleplay preset capped at 5,000 standing-prompt tokens. It keeps strict per-turn player agency, limited knowledge, monotonic time, character fidelity, causal plot movement, NPC autonomy, dialogue colors, and full VELLUM Engine Second Pass continuity while offering a much smaller control surface.',
  presetVersion: '1.0.0',
  schemaVersion: 2,
  samplerOverrides: {
    enabled: true,
    maxTokens: 12000,
    contextSize: null,
    temperature: 0.85,
    topP: 0.95,
    minP: null,
    topK: null,
    frequencyPenalty: null,
    presencePenalty: null,
    repetitionPenalty: null,
    streaming: true,
  },
  promptBehavior: {},
  completionSettings: {
    assistantPrefill: '',
    reasoningPrefill: 'Check agency, current reality, knowledge access, motive, causal movement, and truthful continuity.',
    assistantImpersonation: '',
    continuePrefill: false,
    continuePostfix: ' ',
    namesBehavior: 0,
    squashSystemMessages: false,
    useSystemPrompt: true,
    enableWebSearch: false,
    sendInlineMedia: true,
    enableFunctionCalling: true,
    includeUsage: false,
  },
  advancedSettings: {
    seed: -1,
    customStopStrings: [],
    collapseMessages: false,
    trimIncompleteWords: false,
  },
  blocks,
  extensions: { regex_scripts: regexScripts },
  metadata: {
    vellum_engine: {
      identifier: 'vellum_engine',
      policyCompiler: 1,
      compactPreset: true,
      promptTokenCeiling: 5000,
      sourceHash,
      dependencyHash,
    },
  },
};

const requiredMarkers = [
  'system_prompt', 'char_description', 'char_personality', 'scenario', 'persona',
  'world_info_before', 'mes_examples', 'chat_history', 'world_info_after', 'post_history_instructions',
];
for (const required of requiredMarkers) assert(blocks.some((entry) => entry.marker === required), `Missing marker ${required}`);
assert(blocks.at(-1)?.id === 'arg-output-contract', 'Output contract must be the final block');
assert(blocks.find((entry) => entry.id === 'arg-state-schema')?.position === 'pre_history', 'State schema must be pre-history');
assert(blocks.find((entry) => entry.id === 'arg-state-final')?.position === 'post_history', 'State final must be post-history');
assert(variables.find((entry) => entry.name === 'agency')?.options.map((entry) => entry.id).join(',') === 'protected,continuity,director', 'Agency modes are incomplete');
assert(variables.find((entry) => entry.name === 'state_compiler')?.defaultValue === 'engine', 'Engine Second Pass must be the default');
assert(regexScripts.length === regexIds.size, 'A required compact regex script is missing');
assert(new Set(regexScripts.map((entry) => entry.script_id)).size === regexScripts.length, 'Duplicate compact regex script id');

// This bound is deliberately conservative: it counts every mutually-exclusive
// macro branch and every option value together, although a real assembled turn
// can select only one. Staying below it guarantees every configuration remains
// below the advertised 5,000-token standing-prompt ceiling at the repo's
// established four-characters-per-token estimator.
const enabledPromptChars = blocks.filter((entry) => entry.enabled).reduce((sum, entry) => sum + entry.content.length, 0);
const optionValueChars = variables.reduce((sum, variable) => sum + (variable.options ?? []).reduce((n, option) => n + String(option.value ?? '').length, 0), 0);
const conservativePromptTokens = Math.ceil((enabledPromptChars + optionValueChars) / 4);
assert(conservativePromptTokens <= 5000, `Compact prompt exceeds 5,000-token hard ceiling: ${conservativePromptTokens}`);

const checkOnly = process.argv.includes('--check');
const serialized = `${JSON.stringify(preset, null, 2)}\n`;
const regexSerialized = `${JSON.stringify({
  version: 1,
  type: 'lumiverse_regex_scripts',
  scripts: regexScripts,
  exported_at: Date.UTC(2026, 8, 9),
}, null, 2)}\n`;
if (checkOnly) {
  assert(fs.existsSync(outputPath), 'Generated compact preset is missing; run bun run build:compact');
  assert(fs.readFileSync(outputPath, 'utf8') === serialized, 'Generated compact preset differs; run bun run build:compact');
  assert(fs.existsSync(regexOutputPath), 'Generated compact regex export is missing; run bun run build:compact');
  assert(fs.readFileSync(regexOutputPath, 'utf8') === regexSerialized, 'Generated compact regex export differs; run bun run build:compact');
} else {
  fs.writeFileSync(outputPath, serialized, 'utf8');
  fs.writeFileSync(regexOutputPath, regexSerialized, 'utf8');
}

console.log(JSON.stringify({
  outputPath,
  regexOutputPath,
  name: preset.name,
  version: preset.presetVersion,
  blocks: blocks.length,
  controls: variables.length,
  regexScripts: regexScripts.length,
  conservativePromptTokens,
  bytes: Buffer.byteLength(serialized),
}, null, 2));

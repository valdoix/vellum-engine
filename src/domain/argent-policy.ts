import { expandMacros } from './preset-macro-lite.js';
export interface PolicyVariable { name: string; label?: string; defaultValue: unknown; options?: { id: string; label?: string; value?: unknown }[] }
export interface PolicyBlock { id: string; content?: string; variables?: PolicyVariable[] }
export type VariableValues = Record<string, Record<string, unknown>>;
function canonicalOptionId(variable: PolicyVariable, value: unknown): unknown {
  if (!variable.options?.length) return value;
  const option = variable.options.find((candidate) => candidate.id === value
    || candidate.value === value
    || (typeof value === 'string' && candidate.label === value));
  return option?.id ?? value;
}
export function policyValues(blocks: PolicyBlock[], selected: VariableValues = {}): Record<string, unknown> {
  return Object.fromEntries(blocks.flatMap(b => (b.variables ?? []).map(v => [v.name, canonicalOptionId(v, selected[b.id]?.[v.name] ?? v.defaultValue)])));
}
const enabled = (v: unknown) => v === true || v === 1 || v === '1' || v === 'on';
export const ARGENT_PROFILES: Record<string, Record<string, unknown>> = {
  'Literary Default': { prose: 'lucid', agency: 'protected', length: 'standard', reasoning_route: 'compact', state_on: 1, state_compiler: 'engine', vtk: 'off', vtk_cards: 0 },
  'Strict Agency': { agency: 'protected', agency_reminder: 1, adherence_target: 'frontier', reasoning_route: 'verbose' },
  'Small Model': { length: 'brief', living_world: 'minimal', state_verbosity: 'full', reasoning_route: 'compact', model_adapter: 'generic', vtk: 'off', vtk_cards: 0, state_compiler: 'engine' },
  'Autonomous Sandbox': { living_world: 'sandbox', social: 'autonomous', politics: 'autonomous', world_texture: 'insistent', time_continuity: 1, state_on: 1 },
  'Romance': { genre: 'romance', romance: 'slow_burn', pacing: 'lingering', distance: 'intimate' },
  'Mystery': { genre: 'mystery', epistemic: 'alongside', reveal_cadence: 'measured', variance: 'disciplined' },
  'Visual Showcase': { vtk_cards: 1, vtk_spectacle: 1, world_broadsheet: 1, vtk: 'off', dialogue_color: 1 },
};
export function applyProfile(blocks: PolicyBlock[], selected: VariableValues, changes: Record<string, unknown>): VariableValues {
  const next = structuredClone(selected);
  for (const b of blocks) for (const v of b.variables ?? []) {
    if (!(v.name in changes)) continue;
    const value = changes[v.name];
    if (v.options && !v.options.some(o => o.id === value)) throw new Error(`Profile option unavailable: ${v.name}=${value}`);
    (next[b.id] ??= {})[v.name] = value;
  }
  return next;
}
export function dependencyIssues(v: Record<string, unknown>): Record<string, string> {
  const issues: Record<string, string> = {};
  issues.vtk = 'Deprecated in ARGENT 1.3; use Card Library for typed artifacts.';
  if (!enabled(v.vtk_cards)) { issues.vtk_spectacle = 'Requires Card Library.'; issues.world_broadsheet = 'Requires Card Library.'; }
  if (!enabled(v.antislop)) issues.slop_proofreader = 'Requires Anti-Slop.';
  if (!enabled(v.state_on)) { issues.state_verbosity = 'State output is disabled.'; issues.state_compiler = 'State output is disabled.'; issues.worldgen = 'Genesis requires state output.'; }
  if (v.prose === 'loom') issues.prose = 'Loom Style Only requires an active host Loom style.';
  return issues;
}

/** One effective contract replaces repeated doctrine only in extension-owned source regions. */
export function compileArgentPolicy(blocks: PolicyBlock[], selected: VariableValues = {}): string {
  const v = policyValues(blocks, selected);
  const issues = dependencyIssues(v);
  const defs = blocks.flatMap(b => b.variables ?? []);
  const byName = new Map(defs.map(d => [d.name, d]));
  const describe = (name: string): string => {
    const def = byName.get(name);
    const value = v[name];
    const one = (x: unknown) => def?.options?.find(o => o.id === x)?.label ?? String(x ?? '');
    return Array.isArray(value) ? value.map(one).filter(Boolean).join(', ') : one(value);
  };
  const compactGroups: Array<[string, string[]]> = [
    ['Voice', ['pov', 'tense', 'distance', 'length', 'pacing', 'dialogue', 'prose', 'stakes', 'genre', 'genre2']],
    ['Craft', ['doctrine_strictness', 'metaphor', 'diction', 'sensory', 'filter_words', 'paragraph_shape', 'profanity', 'era', 'era_strictness', 'cast', 'interiority']],
    ['World', ['epistemic', 'living_world', 'world_scale', 'world_texture', 'romance', 'disposition', 'social', 'politics', 'failure_shape', 'reveal_cadence', 'world_law', 'antagonist_pressure', 'variance']],
    ['Output', ['npc_dialogue', 'time_continuity', 'codex', 'inventory', 'nsfw_level', 'nsfl', 'vtk_cards', 'vtk_spectacle', 'dialogue_color']],
  ];
  const settings = compactGroups.map(([label, names]) => {
    const active = names.filter(name => byName.has(name) && !issues[name]).map(name => `${name}=${describe(name)}`);
    return active.length ? `${label}: ${active.join('; ')}.` : '';
  });
  const visibleReverie = v.reasoning_route === 'verbose'
    ? 'The visible response MUST begin with the literal <reverie> tag, contain the bounded 250–500 word eight-section audit, and close with the literal </reverie> tag before story prose. This is a visible fictional scene-plan preface, not provider-private reasoning; never omit it or move it to a hidden reasoning channel.'
    : v.reasoning_route === 'compact'
      ? 'The visible response MUST begin with the literal <reverie> tag, contain exactly six compact audit lines, and close with the literal </reverie> tag before story prose. This is a visible continuity-check preface, not provider-private reasoning; never omit it or move it to a hidden reasoning channel.'
      : '';
  const stateEnding = !enabled(v.state_on)
    ? 'After the selected Reverie, if any, output story prose only. No state block.'
    : v.state_compiler === 'engine'
      ? 'After the required visible Reverie, if selected, output the completed story and stop. The engine compiles state separately. Do not emit any state tag, JSON, ledger or state commentary.'
      : 'After the selected Reverie, if any, output story prose and then one complete canonical <vellum> JSON block using the separately supplied state contract. Every named on-stage NPC has a private thought. Player fields remain blank unless the VELLUM runtime PERSONA STATE option explicitly says ON; when ON, always populate mood, condition, doing, private first-person thought, and stable traits as tracker-only metadata regardless of player-agency mode. This does not authorize corresponding player behavior in prose.';
  const agencyEnding = v.agency === 'director'
    ? 'DIRECTOR FINAL GATE: in story prose, co-author the player within the latest stated intent or explicit direction. Plausible speech, action, reaction, perception, sensation and interiority are permitted when consistent with established characterization. Do not apply stricter agency modes. Never contradict intent, invent consent, cross a boundary or make an unsupported major irreversible choice.'
    : v.agency === 'continuity'
      ? 'MINOR CONTINUITY FINAL GATE: in story prose, complete only the mechanically inevitable endpoint of a trivial player action explicitly begun in the latest input. Add no speech, interiority, consent, strategy, reaction, injury, second action or new choice.'
      : 'FORBIDDEN FINAL GATE: in story prose, keep a player predicate only when the latest input supplied it exactly. An attempt grants no success, consequence, reaction or follow-up. Recast every violation on the NPC or world side.';
  const agencyLabel = v.agency === 'director' ? 'Director' : v.agency === 'continuity' ? 'Minor Continuity' : 'Forbidden (Strict)';
  const agencyRule = v.agency === 'director'
    ? 'In story prose, co-author the player as an active protagonist within the latest stated intent or direction, including plausible speech, action, reaction, perception, sensation and interiority. Preserve characterization; never contradict intent, invent consent, cross a boundary or make an unsupported major irreversible choice.'
    : v.agency === 'continuity'
      ? 'In story prose, complete only the mechanically inevitable endpoint of a trivial player action already begun. Add no speech, interiority, consent, strategy, reaction, injury, second action or new choice.'
      : 'In story prose, keep a player predicate only when the latest input supplied it exactly. An attempt grants no success, consequence, reaction or follow-up; recast violations on the NPC or world side.';
  const rules = [
    '[ARGENT EFFECTIVE POLICY]',
    'Authority: explicit user boundaries and corrections > confirmed engine facts > scenario/card/worldbook > provisional lore > inferred detail. Never turn a provisional invention into confirmed canon. Follow character truth and depicted causality.',
    `Player agency this turn: ${agencyLabel}. ${agencyRule} Apply only this turn's selected mode.`,
    'Knowledge: audit every character/fact pair against actual presence, hearing, language and a timed transmission path. Later entry grants no retroactive hearing. Evidence supports only bounded inference; private thought cannot exceed its owner’s knowledge.',
    'Reality: bind the current scene as T0; account for routes, occupied hands, object custody and elapsed time. Compute day x 1440 + clock and forbid rollback. Off-stage actors require motive, access, means and time.',
    'Causality: advance one smallest meaningful change. Before discovery, interruption, rescue, betrayal or escalation, verify actor, motive, knowledge, access, means, route and time. A missing link means trace, delay or deletion.',
    'Durability: threads and arcs change only when the exact tracked condition changes through a direct prose event. Mentions, shared people or places, elapsed time and thematic similarity do not advance them. Relationships remain directional; intensity is not trust, consent or commitment.',
    `Craft: sustain stable, distinct voice fingerprints and active motives. Prefer concrete action, subtext and sourced sensory detail. Avoid recycled openings, imagery and cadence unless repetition creates a new consequence. ${v.agency === 'director' ? 'Let the co-authored protagonist participate within the Director scope.' : 'End on live pressure before any player predicate outside the selected scope.'}`,
    ...settings,
    v.hard_limits ? `Absolute content boundaries: ${String(v.hard_limits)}` : '',
    enabled(v.dialogue_color) ? 'Wrap each named direct speaker inline as [spk=Exact Cast Name]"speech"[/spk]. One speaker per wrapper; no guessed identities.' : 'Do not add speaker markup.',
    enabled(v.vtk_cards) ? 'Presentation: optional <artifact>{"type":"letter|codex|text|decree|portrait|map|item|title|verse|tarot|broadsheet|playbill","title":"plain text","body":"plain text","tone":"neutral|warning|warm"}</artifact>. No HTML, CSS, URLs or executable markup. Artifacts are presentation; establish durable facts in prose.' : 'No artifact markup.',
    v.reasoning_route === 'verbose' ? 'Planning route: one <reverie> with an extended 250–500 word fictional scene plan in eight sections A Authority, R Reality, G Gnosis, E Embodiment, N Narrative, T Truthful deltas, V Voice, X Final checks. Keep every named on-stage NPC in the embodiment check.' : v.reasoning_route === 'compact' ? 'Planning route: one compact six-line <reverie> scene plan (Authority, Reality, Gnosis, Embodiment, Narrative, Truthful deltas).' : 'Do not emit a visible Reverie.',
    '[OUTPUT CONTRACT — FINAL]',
    visibleReverie,
    stateEnding,
    agencyEnding,
  ];
  if (enabled(v.state_on) && v.state_compiler !== 'engine') {
    const values = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x)]));
    rules.splice(rules.length - 2, 0, ...blocks.filter(b => ['arg-state-schema', 'arg-state-final'].includes(b.id)).map(b => expandMacros(b.content ?? '', values).replace(/<!--\/?ARGENT-SOURCE[^>]*-->/g, '')));
  }
  return rules.filter(Boolean).join('\n');
}
export function applyArgentPolicy<T extends { role?: unknown; content?: unknown; __isChatHistory?: unknown }>(messages: T[], capsule: string, force = false): T[] {
  let found = false;
  const next = messages.flatMap(m => {
    if (m.__isChatHistory || typeof m.content !== 'string') return [m];
    const content = m.content.replace(/<!--ARGENT-SOURCE:[\w-]+-->[\s\S]*?<!--\/ARGENT-SOURCE-->/g, () => { found = true; return ''; }).trim();
    return content ? [{ ...m, content }] : [];
  });
  return found || force ? [...next, { role: 'system', content: capsule } as T] : messages;
}

/**
 * Collapse the already macro-expanded ARGENT source regions into one final
 * system message. Because the host expands these regions with the effective
 * chat/persona/character/connection profile, this preserves the values that
 * will actually drive the turn instead of recompiling from base preset
 * metadata. Hosts that strip source comments before interception are left
 * untouched; their expanded instructions remain authoritative in place.
 */
export function collapseAssembledArgentPolicy<T extends { role?: unknown; content?: unknown; __isChatHistory?: unknown }>(
  messages: T[],
  prefix = '',
): T[] {
  const collected: string[] = [];
  const next = messages.flatMap((message) => {
    if (message.__isChatHistory || typeof message.content !== 'string') return [message];
    const content = message.content.replace(
      /<!--ARGENT-SOURCE:[\w-]+-->([\s\S]*?)<!--\/ARGENT-SOURCE-->/g,
      (_whole, body: string) => {
        const text = String(body ?? '').replace(/<!--VELLUM-EFFECTIVE\s+{[^\r\n]*}\s*-->/g, '').trim();
        if (text) collected.push(text);
        return '';
      },
    ).trim();
    return content ? [{ ...message, content }] : [];
  });
  const lead = prefix.trim();
  if (!collected.length) {
    return lead ? [...next, { role: 'system', content: lead } as T] : messages;
  }
  const content = ['[ARGENT EFFECTIVE POLICY]', lead, ...collected].filter(Boolean).join('\n\n');
  return [...next, { role: 'system', content } as T];
}

import { expandMacros } from './preset-macro-lite.js';
export interface PolicyVariable { name: string; label?: string; defaultValue: unknown; options?: { id: string; label?: string; value?: unknown }[] }
export interface PolicyBlock { id: string; content?: string; variables?: PolicyVariable[] }
export type VariableValues = Record<string, Record<string, unknown>>;
export function policyValues(blocks: PolicyBlock[], selected: VariableValues = {}): Record<string, unknown> {
  return Object.fromEntries(blocks.flatMap(b => (b.variables ?? []).map(v => [v.name, selected[b.id]?.[v.name] ?? v.defaultValue])));
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
  issues.vtk = 'Deprecated in ARGENT 1.2; use Card Library for typed artifacts.';
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
  const settings = defs.filter(d => !issues[d.name] && !['hard_limits', 'state_compiler', 'reasoning_route', 'state_on', 'state_verbosity', 'agency', 'agency_reminder', 'craft_anchor', 'adherence_target', 'vtk'].includes(d.name)).map(d => {
    const value = v[d.name];
    const describe = (x: unknown) => { const o = d.options?.find(o => o.id === x); return String(o?.value !== o?.id && o?.value !== undefined ? o.value : o?.label ?? x); };
    return `${d.label ?? d.name}: ${Array.isArray(value) ? value.map(describe).join('; ') : describe(value)}.`;
  });
  const rules = [
    '[ARGENT EFFECTIVE POLICY]',
    'Authority: explicit user boundaries and corrections > confirmed engine facts > scenario/card/worldbook > provisional lore > inferred detail. Never turn a provisional invention into confirmed canon. Follow character truth and depicted causality.',
    `Player agency: ${v.agency}. Protected forbids every unsupplied player action, utterance, perception, sensation, reaction, consequence, consent and inner state. An attempt licenses only the stated attempt. Minor continuity completes only trivial player-started actions. Director requires explicit direction; never invent consent. Apply only the selected mode.`,
    'Knowledge: audit each character and fact against actual presence, hearing, language and a demonstrated transmission path. Later entry grants no retroactive hearing. Suspicion cannot supply a hidden transcript. Keep private thoughts bounded by that character’s knowledge.',
    'Reality: start from the current physical scene; account for movement, occupied hands, objects and elapsed time. A continuous exact clock crosses midnight by advancing day. Off-stage actors act only through plausible access and motives; establish consequential developments in narrative before they enter state.',
    'Craft: sustain distinct character voices and motives. Prefer concrete action, subtext and specific sensory detail. Avoid repeated openings, imagery and paragraph patterns unless repetition is a deliberate motif, speech habit or ritual. Preserve a character’s stable voice fingerprint; do not rotate traits to meet a quota. End at a natural opening for player action.',
    ...settings,
    v.hard_limits ? `Absolute content boundaries: ${String(v.hard_limits)}` : '',
    enabled(v.dialogue_color) ? 'Wrap each named direct speaker inline as [spk=Exact Cast Name]"speech"[/spk]. One speaker per wrapper; no guessed identities.' : 'Do not add speaker markup.',
    enabled(v.vtk_cards) ? 'Presentation: optional <artifact>{"type":"letter|codex|text|decree|portrait|map|item|title|verse|tarot|broadsheet|playbill","title":"plain text","body":"plain text","tone":"neutral|warning|warm"}</artifact>. No HTML, CSS, URLs or executable markup. Artifacts are presentation; establish durable facts in prose.' : 'No artifact markup.',
    v.reasoning_route === 'verbose' ? 'Planning route: one <reverie> with an extended 250–500 word fictional scene plan in eight sections A Authority, R Reality, G Gnosis, E Embodiment, N Narrative, T Truthful deltas, V Voice, X Final checks. Keep every named on-stage NPC in the embodiment check.' : v.reasoning_route === 'compact' ? 'Planning route: one compact six-line <reverie> scene plan (Authority, Reality, Gnosis, Embodiment, Narrative, Truthful deltas).' : 'Do not emit a visible Reverie.',
    '[OUTPUT CONTRACT — FINAL]',
    !enabled(v.state_on) ? 'Output the selected Reverie, if any, followed by story prose only. No state block.' : v.state_compiler === 'engine' ? 'Output the selected Reverie, if any, then the completed story. The engine compiles state separately. Do not emit JSON or a <vellum> block in the narrative completion.' : 'After the story append one complete canonical <vellum> JSON block using the separately supplied state contract. Every named on-stage NPC has a private thought; player fields remain blank.',
  ];
  if (enabled(v.state_on) && v.state_compiler !== 'engine') {
    const values = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x)]));
    rules.splice(rules.length - 2, 0, ...blocks.filter(b => ['arg-state-schema', 'arg-state-final'].includes(b.id)).map(b => expandMacros(b.content ?? '', values).replace(/<!--\/?ARGENT-SOURCE[^>]*-->/g, '')));
  }
  return rules.filter(Boolean).join('\n');
}
export function applyArgentPolicy<T extends { role?: unknown; content?: unknown; __isChatHistory?: unknown }>(messages: T[], capsule: string): T[] {
  let found = false;
  const next = messages.flatMap(m => {
    if (m.__isChatHistory || typeof m.content !== 'string') return [m];
    const content = m.content.replace(/<!--ARGENT-SOURCE:[\w-]+-->[\s\S]*?<!--\/ARGENT-SOURCE-->/g, () => { found = true; return ''; }).trim();
    return content ? [{ ...m, content }] : [];
  });
  return found ? [...next, { role: 'system', content: capsule } as T] : messages;
}

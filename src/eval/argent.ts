import { freshState, type ChronicleState } from '../domain/types.js';
import { compileArgentPolicy, applyProfile, policyValues, type PolicyBlock } from '../domain/argent-policy.js';
import { compileState } from '../bus/state-compiler.js';
import { internalGenerate } from '../host/generation.js';

export interface Scenario { id: string; prompt: string; prior: ChronicleState; forbidden: RegExp[]; required?: RegExp[]; expectedClock?: number; offstage?: string; controls?: Record<string, unknown>; genesis?: boolean }
function world(clock = 600): ChronicleState {
  const s = freshState();
  s.day = 1; s.turns = 1;
  s.scene = { location: 'The archive', time: `${String(Math.floor(clock / 60)).padStart(2, '0')}:${String(clock % 60).padStart(2, '0')}`, clock, tension: 2, weather: 'clear', present: ['mara', 'ivo'], detail: [] };
  for (const n of ['Mara', 'Ivo', 'Ada']) s.cast[n.toLowerCase()] = { id: n.toLowerCase(), name: n, aka: [], status: n === 'Ada' ? 'active' : 'present', source: 'user', firstTurn: 1, lastTurn: 1, userEdited: true };
  return s;
}
export function argentScenarios(): Scenario[] {
  const parallel = world();
  parallel.parallel = [{ who: 'ada', where: 'Courtyard', activity: 'Waiting for the courier', turn: 1, day: 1 }];
  return [
    { id: 'protected-attempt', prior: world(), prompt: 'Player attempts to open the locked door. Mara stands beside it. Describe only Mara and the lock; do not decide whether Player succeeds or feels anything.', forbidden: [/\bPlayer\s+(?:opens|opened|feels|felt|smiles|smiled|steps|stepped)\b/i, /\byou\s+(?:feel|open|smile|step)\b/i] },
    { id: 'absent-knowledge', prior: world(), prompt: 'Mara quietly tells Ivo the password is "blue lantern". Ada is outside a locked soundproof door. Ada then enters; neither person tells Ada the password. Continue briefly.', forbidden: [/Ada[^.!?\n]*(?:knows|knew|learned|heard|recalls)[^.!?\n]*(?:password|blue lantern)/i], offstage: 'Ada' },
    { id: 'midnight', prior: world(1438), prompt: 'Exactly five minutes pass from 23:58 on day 1. Mara and Ivo remain in the archive. End at 00:03 on day 2.', forbidden: [], expectedClock: 3 },
    { id: 'named-group-thoughts', prior: world(), prompt: 'Ada enters the archive. Mara, Ivo and Ada discuss a missing parcel. Keep all three on-stage and give them distinct voices.', forbidden: [] },
    { id: 'parallel-preservation', prior: parallel, prompt: 'Mara and Ivo continue sorting books in the archive. Nothing changes for Ada in the courtyard. Do not invent an off-screen event.', forbidden: [] },
    { id: 'parallel-movement', prior: parallel, prompt: 'Mara reads a new written report aloud: Ada has just moved from the courtyard to the gate to wait for the courier. Establish that movement in the narrative. Mara and Ivo stay in the archive.', forbidden: [] },
    { id: 'color-on', prior: world(), prompt: 'Mara says "Good morning" to Ivo. He answers in character. Keep it brief.', controls: { dialogue_color: 1 }, forbidden: [], required: [/\[spk=Mara\][\s\S]*?\[\/spk\]/i, /\[spk=Ivo\][\s\S]*?\[\/spk\]/i] },
    { id: 'color-off', prior: world(), prompt: 'Mara says "Good morning" to Ivo. He answers in character. Keep it brief.', controls: { dialogue_color: 0 }, forbidden: [/\[spk=/i] },
    { id: 'state-off', prior: world(), prompt: 'Write one short exchange between Mara and Ivo.', controls: { state_on: 0, reasoning_route: 'silent' }, forbidden: [/<\/?vellum>/i, /<\/?reverie>/i] },
    { id: 'worldgen-genesis', prior: freshState(), prompt: 'Open a scene at 08:00 on day 1 in the Lantern Market. Establish in prose one nearby place and one public faction fact as a bounded initial world frame. Do not write a state block.', controls: { worldgen: 1, codex: 1, state_verbosity: 'full' }, genesis: true, forbidden: [/<\/?vellum>/i] },
  ];
}
export interface EvalResult { id: string; pass: boolean; violations: string[]; prose: string; compilerErrors?: string[]; durationMs: number }
/** Real generations with deterministic, inspectable checks; no self-graded quality score. */
export async function evaluateArgent(blocks: PolicyBlock[], generate: typeof internalGenerate = internalGenerate, onResult?: (r: EvalResult) => void): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  for (const scenario of argentScenarios()) {
    const start = Date.now();
    const values = applyProfile(blocks, {}, { length: 'brief', reasoning_route: 'silent', state_compiler: 'engine', ...scenario.controls });
    const resolved = policyValues(blocks, values);
    const narrative = await generate([{ role: 'system', content: compileArgentPolicy(blocks, values) }, { role: 'user', content: JSON.stringify({ player: 'Player', prior: scenario.prior }) + '\n' + scenario.prompt }], { temperature: 0.2, max_tokens: 1800 }, null, { timeoutMs: 45000, reasoningOff: true });
    const prose = narrative.ok ? narrative.value : '';
    const violations = narrative.ok ? scenario.forbidden.filter(r => r.test(prose)).map(r => 'Prose matched forbidden pattern: ' + r.source) : ['Generation failed: ' + narrative.error];
    if (narrative.ok) for (const r of scenario.required ?? []) if (!r.test(prose)) violations.push('Prose missed required pattern: ' + r.source);
    if (narrative.ok && !prose.trim()) violations.push('Empty narrative');
    let compilerErrors: string[] | undefined;
    if (narrative.ok && scenario.controls?.state_on !== 0) {
      const compiled = await compileState({ prior: scenario.prior, turn: (scenario.prior.turns || 0) + 1, prose, userName: 'Player', genesisAllowed: !!scenario.genesis, verbosity: resolved.state_verbosity === 'full' ? 'full' : 'lean', codexAllowed: resolved.codex !== 0, inventoryAllowed: resolved.inventory !== 0 }, null, undefined, generate);
      if (!compiled.ok) { compilerErrors = compiled.errors; violations.push('State compilation rejected'); }
      else {
        const s = compiled.candidate.state;
        if (scenario.expectedClock !== undefined && (s.scene.clock !== scenario.expectedClock || s.day !== 2)) violations.push('Incorrect midnight rollover');
        if (scenario.offstage && s.delta.knowledge?.some((k: any) => k.who === scenario.offstage && /password|blue lantern/i.test(k.fact) && k.reliability !== 'unaware')) violations.push('Off-stage knowledge leak');
        if (scenario.id === 'named-group-thoughts' && !['Mara', 'Ivo', 'Ada'].every(n => s.present.some(p => p.id === n && p.thought.trim()))) violations.push('Named group member or thought omitted');
        const p = JSON.parse(compiled.block.slice(9, -9)).delta.parallel;
        if (scenario.id === 'parallel-preservation' && !p.some((r: any) => /ada/i.test(r.who) && /courtyard/i.test(r.where))) violations.push('Unchanged off-stage actor lost');
        if (scenario.id === 'parallel-movement' && !p.some((r: any) => /ada/i.test(r.who) && /gate/i.test(r.where))) violations.push('Off-stage movement not reconciled');
        if (scenario.genesis && (!compiled.candidate.genesis || !compiled.candidate.state.ext.codex?.length)) violations.push('Eligible genesis was not atomically represented');
      }
    }
    const result = { id: scenario.id, pass: !violations.length, violations, prose, ...(compilerErrors ? { compilerErrors } : {}), durationMs: Date.now() - start };
    results.push(result); onResult?.(result);
  }
  return results;
}

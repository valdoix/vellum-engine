import { parseState } from '../parse/state-block.js';
import type { ChronicleState } from '../domain/types.js';
import { internalGenerate, type GenMsg } from '../host/generation.js';
import { has } from '../host/capability.js';

/**
 * BLOCK REPAIR (Option C) — when a just-generated turn folds with
 * `source === 'none'` (the parser recovered NO state, neither the JSON block nor
 * the terse-ledger fallback), transcribe the turn's PROSE into a valid
 * <vellum> state block with one cheap, bounded LLM call.
 *
 * This is a targeted sibling of the PASS-2 prose extractor (bus/extract.ts): the
 * extractor mines knowledge/secrets/journal/bonds into events, whereas this
 * recovers the AUTHORITATIVE block itself (scene.time/clock, the full present
 * roster, thread ops, parallel, factions, scars/codex) and seeds a correctly-
 * formatted block back into the transcript — which the preset's min_depth:1
 * context regex then re-shows next turn as a worked example.
 *
 * The pure parts (system prompt, context builder, block assembly + validation)
 * are split from the `internalGenerate` I/O so they are unit-testable, exactly
 * as `mapExtracted` is split from `extractFromProse`.
 */

// The model is asked for the RAW JSON object only (no fence), so `response_format`
// json_schema can be enforced when generation_parameters is granted. We wrap it in
// the <vellum>…</vellum> fence ourselves in `assembleBlock`.
export const VELLUM_BLOCK_REPAIR_SYS =
  'You are the STATE-BLOCK RECOVERY pass for a roleplay engine. The previous turn\u2019s prose was '
  + 'written but its machine-readable state block was dropped. Read the NARRATIVE PROSE and the CONTEXT '
  + 'header, then reconstruct the state for THIS turn as a SINGLE valid JSON object — nothing else, no '
  + 'prose, no code fence, no commentary. Be THOROUGH: recover every change the prose actually depicts, '
  + 'not just the scene line. A rich, accurate block is the goal; a bare skeleton loses continuity.\n'
  + 'DELTAS ONLY: include everything THIS turn establishes or changes, and omit what did not move. Shape:\n'
  + '{ "turn": int, "day": int, '
  + '"scene": { "loc": str, "time": str, "clock": "dawn|morning|midday|afternoon|dusk|evening|night|late-night" OR 0-1439, "tension": 0-10, "weather": str }, '
  + '"present": [{ "id": "Name", "mood": str, "condition": str, "doing": str, "thought": str, "traits": [str] }], '
  + '"delta": { '
  + '"bonds": [{ "a": "Name", "b": "Name", "aff": -100..100, "trust": -100..100, "cat": ["familial|romantic|alliance|rivalry|social"], "why": str }], '
  + '"threads": [{ "op": "new|advance|stall|resolve", "name": str, "note": str }], '
  + '"parallel": [{ "who": "Name", "where": str, "activity": str, "note": str }], '
  + '"journal": [{ "who": "Name", "about": "Name", "memory": str, "kind": "interaction|promise|betrayal|gift|shared|wound|observation", "weight": "trivial|minor|significant|defining", "sentiment": "positive|negative|neutral|complex" }], '
  + '"knowledge": [{ "who": "Name", "fact": str, "about": "Name", "reliability": "knows|believes|suspects|wrong|unaware", "truth": "true|false|unknown", "source": str }], '
  + '"secrets": [{ "keeper": "Name", "secret": str, "from": "Name" }], '
  + '"factions": [{ "name": str, "kind": str, "members": ["Name"], "standing": -40..40 }] }, '
  + '"ext": { '
  + '"scars": [{ "who": "Name", "was": "the belief proven wrong", "turn": int }], '
  + '"codex": [{ "fact": "a world-fact just made canon (not a character\u2019s belief)" }], '
  + '"inventory": [{ "who": "Name", "item": str, "op": "gain|lose|give|scene|note", "to": "Name", "note": str }], '
  + '"plant": [{ "what": "a detail seeded to pay off later" }], '
  + '"payoff": [{ "what": "a earlier plant that resolved this turn" }] } }\n'
  + 'RULES: use ONLY real character names that appear in the prose (and the player persona named in the '
  + 'CONTEXT); never placeholders or unnamed figures. Set `turn` and `day` to the values given in the '
  + 'CONTEXT header. `scene.time` MUST reflect the moment this turn ends (advance it forward from the '
  + 'prior time in the header to match the elapsed action; never reset it backward); `scene.clock` mirrors '
  + 'that time as an ordered slot so the engine can sequence beats — supply it whenever the time is clear. '
  + 'Emit `scene.loc`/`weather`/`tension` only when they changed from the CONTEXT.\n'
  + 'present[] MUST list EVERY named character on-stage this beat. The player persona goes FIRST with '
  + 'mood/condition/doing/thought/traits LEFT EMPTY (never invent the player\u2019s inner state). For each '
  + 'on-stage NPC, `thought` is REQUIRED — their genuine first-person inner voice under limited knowledge '
  + '(what they privately think this beat), unless they are a true cipher; `doing` and `mood` reflect the '
  + 'prose; `traits` = 2-4 STABLE personality tags emitted ONLY when a character is first established or a '
  + 'trait genuinely shifts (never a transient mood).\n'
  + 'delta: aff/trust are SIGNED changes THIS turn; omit an axis that did not move, and `cat` only when the '
  + 'bond\u2019s nature changed. Record a `journal` entry for any moment a character would truly carry; use '
  + '`knowledge` to capture who learned/believes/suspects what (this is where dramatic irony lives, via '
  + 'reliability+truth); `secrets` for anything now hidden from someone; `parallel` for what moved '
  + 'off-screen. ext: `scars` for a belief proven wrong that left a mark, `codex` for a world-fact just '
  + 'made canon, `inventory` for named items changing hands (who:"world" = a scene object), `plant`/`payoff` '
  + 'for setups and their resolutions.\n'
  + 'Invent nothing the prose does not support, but capture everything it DOES. Omit any section with '
  + 'nothing new. A minimal { "turn": N, "day": D, "present": [...] } is valid when truly nothing else '
  + 'changed.\n'
  + 'OUTPUT FORMAT — ABSOLUTE: your entire reply is ONE raw JSON object. Do NOT write literary paragraphs, '
  + 'a preamble, or a summary. Do NOT introduce it ("Here is the JSON:", "Certainly,"), do NOT add any '
  + 'sentence before the opening `{` or after the closing `}`, and do NOT wrap it in a ```json code fence. '
  + 'String VALUES stay terse and factual — a value is data, not prose to be embellished. Begin your reply '
  + 'with the character `{` and end it immediately with `}`. Output the JSON object and STOP.';

/** Compact CONTEXT header so the model emits correct forward deltas (right turn/
 *  day, scene continuity, real cast names, live threads) instead of guessing.
 *  Richer context ⇒ richer, more accurate recovery: knowing who was on-stage and
 *  what threads are open lets the model attribute changes correctly. Pure. */
export function buildRepairContext(prior: ChronicleState, turnNo: number): string {
  const day = prior.day || 0;
  const loc = prior.scene?.location?.trim();
  const time = prior.scene?.time?.trim();
  const tension = prior.scene?.tension;
  const weather = prior.scene?.weather?.trim();
  // Present roster WITH stable traits, so the model reuses established personality
  // tags instead of re-inventing them (and knows not to re-emit unchanged traits).
  const present = (prior.scene?.present ?? [])
    .map((id) => {
      const c = prior.cast[id];
      const name = c?.name ?? id;
      const traits = (c?.traits ?? []).slice(0, 4);
      return traits.length ? `${name} (${traits.join(', ')})` : name;
    })
    .filter(Boolean);
  // Open plot threads — so an "advance"/"resolve" op targets the right existing
  // thread name rather than spawning a duplicate "new" one.
  const openThreads = (prior.threads ?? [])
    .filter((t) => t && (t as { status?: string }).status !== 'resolved')
    .map((t) => (t as { name?: string }).name)
    .filter(Boolean)
    .slice(0, 8);
  const lines = [
    `turn: ${turnNo}`,
    `day: ${day}`,
    ...(loc ? [`prior scene location: ${loc}`] : []),
    ...(time ? [`prior scene time: ${time}`] : []),
    ...(typeof tension === 'number' && tension > 0 ? [`prior tension: ${tension}/10`] : []),
    ...(weather ? [`prior weather: ${weather}`] : []),
    ...(present.length ? [`characters present last turn: ${present.join('; ')}`] : []),
    ...(openThreads.length ? [`open plot threads (advance/resolve by exact name): ${openThreads.join('; ')}`] : []),
  ];
  return '[CONTEXT]\n' + lines.join('\n');
}

// Reasoning/thinking tags a model may leak into `content` even with
// `reasoning: off` (DeepSeek especially, and any provider that ignores the
// flag). These commonly contain their own braces — the model reasoning ABOUT
// the JSON shape — which would otherwise be the first balanced object we find.
// Mirrors the REASONING_RE used by the preview path and extract.ts's strip.
const REASONING_RE = /<(think|thinking|reverie|reasoning|reflection|scratchpad|analysis|draft|plan|planning)>[\s\S]*?<\/\1>/gi;

/** Strip reasoning tags and code fences so the JSON scan isn't derailed by a
 *  brace inside a `<think>` block or a ```json fence. Also drops a dangling
 *  unclosed reasoning tag (a `<think>` with no close, truncated mid-stream). */
function stripReasoning(s: string): string {
  return String(s || '')
    .replace(REASONING_RE, '')
    .replace(/<(think|thinking|reverie|reasoning|reflection|scratchpad|analysis|draft|plan|planning)>[\s\S]*$/i, '')
    .replace(/```[a-z]*\n?|```/gi, '')
    .trim();
}

/** Quote/bracket-aware extraction of ALL balanced top-level {…} objects from a
 *  string, in order. The model may wrap the JSON in a stray fence, precede it
 *  with a line of prose, or (DeepSeek) emit a reasoning object before the real
 *  state object — so the caller tries each candidate until one validates rather
 *  than giving up on the first. Mirrors the state-block parser's discipline so a
 *  brace inside a string can't end a scan early. */
function balancedObjects(s: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    const start = s.indexOf('{', i);
    if (start < 0) break;
    let depth = 0, inStr = false, esc = false, quote = '"', closed = false;
    let j = start;
    for (; j < s.length; j++) {
      const c = s[j]!;
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === quote) inStr = false;
        continue;
      }
      if (c === '"' || c === '\'') { inStr = true; quote = c; continue; }
      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') { depth--; if (depth === 0) { out.push(s.slice(start, j + 1)); closed = true; break; } }
    }
    // advance past this object (or past the stray '{' if it never closed)
    i = closed ? j + 1 : start + 1;
  }
  return out;
}

export interface RepairedBlock {
  /** The full fenced block ready to append to the message: `<vellum>\n{…}\n</vellum>`. */
  block: string;
  /** How the recovered JSON validated — always 'json' | 'json-partial' on success. */
  source: 'json' | 'json-partial';
}

/**
 * PURE: take the model's raw reply, extract its JSON object, wrap it in the
 * canonical <vellum> fence, and validate that the SHARED parser accepts it.
 * Returns the fenced block only when `parseState` recovers real state from it
 * (source json | json-partial). Any junk/empty/unparseable reply → null, so a
 * failed repair can never write garbage into the transcript.
 */
export function assembleBlock(rawReply: string): RepairedBlock | null {
  // Strip reasoning tags / fences FIRST — otherwise a `{…}` the model wrote
  // while reasoning about the schema (common on DeepSeek and other reasoners
  // that leak <think> into content even with reasoning off) is the first object
  // we'd find, and it never validates.
  const cleaned = stripReasoning(rawReply);
  const candidates = balancedObjects(cleaned);
  if (!candidates.length) return null;
  for (const json of candidates) {
    // require at least one real state key BEFORE wrapping: the shared parser is
    // lenient (an object of junk like {"foo":"bar"} hoists an empty delta and
    // validates as source 'json'), which would write a meaningless block and
    // mark the turn "repaired". Gate on the same keys the parser uses to
    // recognize its own block (state-block.ts SCHEMA_KEY) so only a genuine
    // state block lands. Skip non-matching candidates (e.g. a reasoning object)
    // and keep trying — the real block may come after prose or a stray object.
    if (!SCHEMA_KEY.test(json)) continue;
    const block = '<vellum>\n' + json + '\n</vellum>';
    const { state, source } = parseState(block);
    if (state && (source === 'json' || source === 'json-partial')) return { block, source };
  }
  return null;
}

// The keys that mark a real VELLUM state object (mirrors state-block.ts SCHEMA_KEY).
const SCHEMA_KEY = /"(?:delta|scene|present|turn|day)"/;

/**
 * Run the repair on a turn's prose. Returns the fenced <vellum> block to append,
 * or null. Capability-gated on `generation`; bounded (reasoning off, ~500
 * tokens, 30s). No-op on empty prose / missing permission.
 */
export async function repairStateBlock(
  prose: string,
  context: string,
  userId: string | null,
): Promise<RepairedBlock | null> {
  if (!prose || !prose.trim() || !(await has('generation'))) return null;
  const messages: GenMsg[] = [
    { role: 'system', content: VELLUM_BLOCK_REPAIR_SYS },
    { role: 'user', content: context + '\n\n[PROSE]\n' + prose.slice(0, 8000) },
  ];
  // ATTEMPT 1 — reasoning OFF, cheap and fast. 900 tokens: a full block (every
  // on-stage NPC's thought, parallel, journal, ext) legitimately runs past the
  // old 500 cap — a truncated block fails to close and parseState rejects it.
  const first = await internalGenerate(
    messages,
    { temperature: 0.2, max_tokens: 900 },
    userId,
    { reasoningOff: true, responseFormat: REPAIR_SCHEMA, timeoutMs: 30000 },
  );
  if (first.ok) {
    const block = assembleBlock(first.value);
    if (block) return block;
  }
  // ATTEMPT 2 — ESCALATE with reasoning ON. Reasoning models (DeepSeek in
  // particular) frequently return EMPTY content when reasoning is forced off,
  // or bury the object inside a <think> block; letting them reason lets the
  // JSON land in the reasoning channel that extractGenContent harvests, and
  // assembleBlock's reasoning-strip + multi-object scan pulls out the real
  // block. Higher token budget so reasoning + a full block both fit. Gated to
  // one retry so a stubborn model can't loop.
  const second = await internalGenerate(
    messages,
    { temperature: 0.2, max_tokens: 1800 },
    userId,
    { reasoningOff: false, responseFormat: REPAIR_SCHEMA, timeoutMs: 45000 },
  );
  if (!second.ok) return null;
  return assembleBlock(second.value);
}

// JSON-schema for the repair output. Best-effort: enforced only when
// generation_parameters is granted (else stripped and we still validate via
// parseState). Deliberately loose (few required fields) so a lean, delta-only
// block is accepted — the shared parser is the real gate.
const REPAIR_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'vellum_state_block',
    strict: false,
    schema: {
      type: 'object',
      properties: {
        turn: { type: 'number' },
        day: { type: 'number' },
        scene: { type: 'object', properties: {
          loc: { type: 'string' }, time: { type: 'string' },
          clock: {}, tension: { type: 'number' }, weather: { type: 'string' },
        } },
        present: { type: 'array', items: { type: 'object', properties: {
          id: { type: 'string' }, mood: { type: 'string' }, condition: { type: 'string' },
          doing: { type: 'string' }, thought: { type: 'string' },
          traits: { type: 'array', items: { type: 'string' } },
        }, required: ['id'] } },
        delta: { type: 'object', properties: {
          bonds: { type: 'array', items: { type: 'object' } },
          threads: { type: 'array', items: { type: 'object' } },
          parallel: { type: 'array', items: { type: 'object' } },
          journal: { type: 'array', items: { type: 'object' } },
          knowledge: { type: 'array', items: { type: 'object' } },
          secrets: { type: 'array', items: { type: 'object' } },
          factions: { type: 'array', items: { type: 'object' } },
        } },
        ext: { type: 'object', properties: {
          scars: { type: 'array', items: { type: 'object' } },
          codex: { type: 'array', items: { type: 'object' } },
          inventory: { type: 'array', items: { type: 'object' } },
          plant: { type: 'array', items: { type: 'object' } },
          payoff: { type: 'array', items: { type: 'object' } },
        } },
      },
      required: ['turn'],
    },
  },
} as const;

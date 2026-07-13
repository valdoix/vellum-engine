import { parseState } from '../parse/state-block.js';
import type { ChronicleState } from '../domain/types.js';
import { internalGenerate } from '../host/generation.js';
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
  + 'header, then output the state for THIS turn as a SINGLE valid JSON object — nothing else, no prose, '
  + 'no code fence, no commentary.\n'
  + 'DELTAS ONLY: include only what THIS turn establishes or changes. Shape:\n'
  + '{ "turn": int, "day": int, "scene": { "loc": str, "time": str, "tension": 0-10, "weather": str }, '
  + '"present": [{ "id": "Name", "mood": str, "condition": str, "doing": str, "thought": str }], '
  + '"delta": { '
  + '"bonds": [{ "a": "Name", "b": "Name", "aff": -100..100, "trust": -100..100, "cat": ["familial|romantic|alliance|rivalry|social"], "why": str }], '
  + '"threads": [{ "op": "new|advance|stall|resolve", "name": str, "note": str }], '
  + '"parallel": [{ "who": "Name", "where": str, "activity": str, "note": str }], '
  + '"journal": [{ "who": "Name", "about": "Name", "memory": str, "kind": "interaction|promise|betrayal|gift|shared|wound|observation", "weight": "trivial|minor|significant|defining", "sentiment": "positive|negative|neutral|complex" }], '
  + '"knowledge": [{ "who": "Name", "fact": str, "about": "Name", "reliability": "knows|believes|suspects|wrong|unaware", "truth": "true|false|unknown", "source": str }], '
  + '"secrets": [{ "keeper": "Name", "secret": str, "from": "Name" }], '
  + '"factions": [{ "name": str, "kind": str, "members": ["Name"], "standing": -40..40 }] } }\n'
  + 'RULES: use ONLY real character names that appear in the prose (and the player persona named in the '
  + 'CONTEXT); never placeholders or unnamed figures. Set `turn` and `day` to the values given in the '
  + 'CONTEXT header. `scene.time` MUST reflect the moment this turn ends (advance it forward from the '
  + 'prior time in the header to match the elapsed action; never reset it backward). '
  + 'present[] MUST include the player whenever they are on-screen, listed FIRST, with mood/condition/'
  + 'doing/thought LEFT EMPTY (never invent the player\u2019s inner state) — list every other named '
  + 'character on-stage with their current mood and what they are doing. '
  + 'aff/trust are SIGNED changes THIS turn; omit an axis that did not move; omit a whole section that '
  + 'has nothing new. Invent nothing the prose does not support. Empty sections are fine — a minimal '
  + '{ "turn": N, "day": D, "present": [...] } is valid. Output the JSON object and STOP.';

/** Compact CONTEXT header so the model emits correct forward deltas (right turn/
 *  day, scene continuity, real cast names) instead of guessing. Pure. */
export function buildRepairContext(prior: ChronicleState, turnNo: number): string {
  const day = prior.day || 0;
  const loc = prior.scene?.location?.trim();
  const time = prior.scene?.time?.trim();
  const present = (prior.scene?.present ?? [])
    .map((id) => prior.cast[id]?.name ?? id)
    .filter(Boolean);
  const lines = [
    `turn: ${turnNo}`,
    `day: ${day}`,
    ...(loc ? [`prior scene location: ${loc}`] : []),
    ...(time ? [`prior scene time: ${time}`] : []),
    ...(present.length ? [`characters present last turn: ${present.join(', ')}`] : []),
  ];
  return '[CONTEXT]\n' + lines.join('\n');
}

/** Quote/bracket-aware extraction of the first balanced top-level {…} object from
 *  a string (the model may wrap the JSON in a stray fence or a line of prose).
 *  Returns null when no complete object closes. Mirrors the discipline used by
 *  the state-block parser so a brace inside a string can't end the scan early. */
function firstBalancedObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false, quote = '"';
  for (let i = start; i < s.length; i++) {
    const c = s[i]!;
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === '\'') { inStr = true; quote = c; continue; }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
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
  const json = firstBalancedObject(String(rawReply || ''));
  if (!json) return null;
  // require at least one real state key BEFORE wrapping: the shared parser is
  // lenient (an object of junk like {"foo":"bar"} hoists an empty delta and
  // validates as source 'json'), which would write a meaningless block and mark
  // the turn "repaired". Gate on the same keys the parser uses to recognize its
  // own block (state-block.ts SCHEMA_KEY) so only a genuine state block lands.
  if (!SCHEMA_KEY.test(json)) return null;
  const block = '<vellum>\n' + json + '\n</vellum>';
  const { state, source } = parseState(block);
  if (state && (source === 'json' || source === 'json-partial')) return { block, source };
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
  const gen = await internalGenerate(
    [
      { role: 'system', content: VELLUM_BLOCK_REPAIR_SYS },
      { role: 'user', content: context + '\n\n[PROSE]\n' + prose.slice(0, 8000) },
    ],
    { temperature: 0.2, max_tokens: 500 },
    userId,
    { reasoningOff: true, responseFormat: REPAIR_SCHEMA, timeoutMs: 30000 },
  );
  if (!gen.ok) return null;
  return assembleBlock(gen.value);
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
          tension: { type: 'number' }, weather: { type: 'string' },
        } },
        present: { type: 'array', items: { type: 'object', properties: {
          id: { type: 'string' }, mood: { type: 'string' }, condition: { type: 'string' },
          doing: { type: 'string' }, thought: { type: 'string' },
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
      },
      required: ['turn'],
    },
  },
} as const;

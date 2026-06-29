import { ParsedState, type ParseResult } from './parsed.js';
import { parseFallback } from './fallback-regex.js';

/**
 * Parse the model's per-turn state. JSON-first: a fenced ‹vellum›…‹/vellum›
 * block validated against the schema. If it's absent or invalid, fall back to
 * the terse-regex parser so token-tight local models still work. This is the
 * change that kills the legacy regex-divination bug class.
 */

// Accept a few fence spellings so we're robust to model formatting drift.
const FENCES: Array<[string, string]> = [
  ['\u2039vellum\u203a', '\u2039/vellum\u203a'], // ‹vellum› … ‹/vellum›
  ['<vellum>', '</vellum>'],
  ['```vellum', '```'],
  ['[VELLUM]', '[/VELLUM]'],
];

function extractFenced(content: string): string | null {
  for (const [open, close] of FENCES) {
    const i = content.indexOf(open);
    if (i < 0) continue;
    const j = content.indexOf(close, i + open.length);
    if (j < 0) continue;
    return content.slice(i + open.length, j).trim();
  }
  // last resort: a bare {...} block that looks like our schema
  const m = content.match(/\{[\s\S]*?"(?:delta|scene|present|turn)"[\s\S]*\}/);
  return m ? m[0] : null;
}

/** Pull the outermost balanced {...} object out of a string (ignores prose/
 * fences around it). Returns null if none. */
function balancedObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false, quote = '"';
  for (let i = start; i < s.length; i++) {
    const c = s[i]!;
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === quote) inStr = false; continue; }
    if (c === '"' || c === "'") { inStr = true; quote = c; }
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

/**
 * Tolerant JSON parse, hardened against the many ways models mangle the block.
 * Strategy ladder (cheapest first; first success wins):
 *   1. plain JSON.parse on the balanced object (the happy path — no mangling)
 *   2. structural repair OUTSIDE string literals (comments, trailing commas,
 *      leading +, unquoted keys, single quotes) — a single string-aware scan so
 *      we never corrupt prose/URLs/punctuation inside a value
 *   3. close a TRUNCATED block (model ran out of tokens mid-object): trim any
 *      dangling partial token and append the missing }/] implied by the stack
 *   4. the same, plus quote-normalization, as a last resort
 * Returns the parsed value, or null if nothing works.
 */
function lenientParse(raw: string): unknown | null {
  const base = raw
    .replace(/\u00A0/g, ' ')
    .replace(/^\s*```[a-z]*\s*/i, '').replace(/```\s*$/i, '')
    .trim();
  // slice from the first '{' so leading prose/reverie never reaches the parser,
  // even when the object is unbalanced (balancedObject would return null then).
  const fromBrace = base.slice(Math.max(0, base.indexOf('{')));
  const obj0 = balancedObject(base) ?? fromBrace;

  // 1. happy path
  const direct = tryParse(obj0);
  if (direct !== undefined) return direct;

  // 2. structural repair, string-aware
  const repaired = repairJson(obj0);
  const r1 = tryParse(repaired);
  if (r1 !== undefined) return r1;

  // 3. close a truncated block, then repair
  const closed = closeUnbalanced(fromBrace);
  if (closed) {
    const r2 = tryParse(closed) ?? tryParse(repairJson(closed));
    if (r2 !== undefined) return r2;
  }

  // 4. + smart-quote normalization (do this LAST: it can mangle apostrophes in prose)
  const normalized = (closed ?? repaired)
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'");
  const r3 = tryParse(repairJson(normalized));
  if (r3 !== undefined) return r3;

  return null;
}

/**
 * Repair a TRUNCATED object: the model emitted a prefix and ran out of tokens.
 * String-aware scan tracks the bracket stack; we trim back to the last "safe"
 * boundary (drop a dangling partial key/value), then append the closers the
 * stack implies. Returns null if there's nothing to close.
 */
function closeUnbalanced(s: string): string | null {
  if (!s || s[0] !== '{') return null;
  const stack: string[] = [];
  let inStr = false, esc = false;
  let lastSafe = -1; // index just after a completed value/element (a ',' or close)
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') { inStr = false; lastSafe = i + 1; } continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') { stack.pop(); lastSafe = i + 1; }
    else if (c === ',') lastSafe = i; // keep up to (not incl) the comma
    else if (/\d/.test(c) || c === 'e' || c === 'l' || c === 'u') lastSafe = Math.max(lastSafe, i + 1); // tail of number/true/null/false
  }
  if (!stack.length && !inStr) return null; // balanced already — not our case
  // if we ended mid-string, cut the string off at lastSafe (last completed value)
  let body = inStr ? s.slice(0, lastSafe) : s;
  // drop a trailing dangling token like  , "key":   or  , "key"
  body = body.replace(/,\s*"[^"]*"\s*:?\s*$/, '').replace(/,\s*$/, '').replace(/:\s*$/, '');
  // recompute closers for the trimmed body (string-aware)
  const cl: string[] = []; let st = false, e = false;
  for (const c of body) {
    if (st) { if (e) e = false; else if (c === '\\') e = true; else if (c === '"') st = false; continue; }
    if (c === '"') st = true;
    else if (c === '{') cl.push('}');
    else if (c === '[') cl.push(']');
    else if (c === '}' || c === ']') cl.pop();
  }
  if (st) return null; // still mid-string after trim → give up
  return body + cl.reverse().join('');
}

function tryParse(s: string): unknown | undefined {
  try { return JSON.parse(s); } catch { return undefined; }
}

/**
 * Repair common JSON mangles, editing ONLY structure outside string literals so
 * a `//`, comma, or `+2` inside a value is never touched. Single left-to-right
 * scan that tracks string state, emitting a cleaned buffer.
 */
function repairJson(src: string): string {
  let out = '';
  let inStr = false, esc = false, quote = '"';
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inStr) {
      if (esc) { out += c; esc = false; continue; }
      if (c === '\\') { out += c; esc = true; continue; }
      if (c === quote) { inStr = false; out += '"'; continue; } // close (normalize ' → ")
      if (c === '"' && quote === "'") { out += '\\"'; continue; } // a " inside a '..' string
      if (c === '\n') { out += '\\n'; continue; } // unescaped newline in a string
      out += c; continue;
    }
    // --- outside a string ---
    if (c === '"' || c === "'") { inStr = true; quote = c; out += '"'; continue; }
    // line comment // … (only outside strings, so URLs in values are safe)
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    // block comment /* … */
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; continue; }
    // leading + on a number: "+2" → "2"
    if (c === '+' && /\d/.test(src[i + 1] ?? '')) continue;
    out += c;
  }
  // structural fixups on the now string-safe scaffold (these run on the emitted
  // buffer; string contents are already escaped/closed so they're inert here):
  return out
    // quote unquoted keys:  { key:  ,key:  →  "key":
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3')
    // drop "key": <placeholder> the model left in
    .replace(/"[\w$]+"\s*:\s*<[^>{}\[\]]*>\s*,?/g, '')
    // trailing commas before } or ]
    .replace(/,(\s*[}\]])/g, '$1')
    // collapse doubled commas from dropped fields
    .replace(/,\s*,/g, ',')
    .replace(/([{\[])\s*,/g, '$1');
}

export function parseState(content: string): ParseResult {
  if (!content) return { state: null, source: 'none' };

  const raw = extractFenced(content);
  if (raw) {
    const obj = lenientParse(raw);
    if (obj && typeof obj === 'object') {
      hoistDeltaFields(obj as Record<string, unknown>); // tolerate misplaced delta fields
      normalizeBlock(obj as Record<string, unknown>); // map preset grammar (cat) → schema (addCats)
      const validated = ParsedState.safeParse(obj);
      if (validated.success) return { state: validated.data, source: 'json' };
    }
  }

  const fb = parseFallback(content);
  if (fb) return { state: fb, source: 'regex' };

  return { state: null, source: 'none' };
}

/** Models sometimes put bonds/threads/arcs/journal/parallel at the TOP level
 * instead of inside `delta`. Hoist them in so nothing is silently dropped. */
function hoistDeltaFields(obj: Record<string, unknown>): void {
  const keys = ['bonds', 'threads', 'arcs', 'journal', 'knowledge', 'secrets', 'factions', 'parallel'];
  const delta = (obj.delta && typeof obj.delta === 'object') ? obj.delta as Record<string, unknown> : {};
  let moved = false;
  for (const k of keys) {
    if (Array.isArray(obj[k]) && delta[k] === undefined) { delta[k] = obj[k]; delete obj[k]; moved = true; }
  }
  if (moved || obj.delta === undefined) obj.delta = delta;
}

/**
 * Map the preset's `<vellum>` block grammar onto the ParsedBond schema before
 * validation. The block teaches the model to emit bond `"cat": [...]`, but the
 * schema field is `addCats` — zod would silently strip `cat`, dropping the
 * relationship category entirely on the JSON path (the prose extractor reads
 * `cat` directly, so only this path was affected). Also tolerate `removeCat`.
 */
function normalizeBlock(obj: Record<string, unknown>): void {
  const delta = obj.delta as Record<string, unknown> | undefined;
  const bonds = delta && Array.isArray(delta.bonds) ? delta.bonds : null;
  if (!bonds) return;
  // valid relationship categories — anything else (e.g. the model inventing
  // "physical") is FILTERED, not left to fail the whole block's validation.
  const VALID = new Set(['familial', 'romantic', 'alliance', 'rivalry', 'social', 'neutral']);
  const clean = (v: unknown): string[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const out = v.map((x) => String(x).toLowerCase().trim()).filter((x) => VALID.has(x));
    return out.length ? Array.from(new Set(out)) : undefined;
  };
  for (const b of bonds) {
    if (!b || typeof b !== 'object') continue;
    const bond = b as Record<string, unknown>;
    if (bond.addCats === undefined && bond.cat !== undefined) { bond.addCats = bond.cat; delete bond.cat; }
    if (bond.removeCats === undefined && bond.removeCat !== undefined) { bond.removeCats = bond.removeCat; delete bond.removeCat; }
    // drop unknown categories so one invented value can't nuke the whole turn
    if (bond.addCats !== undefined) { const c = clean(bond.addCats); if (c) bond.addCats = c; else delete bond.addCats; }
    if (bond.removeCats !== undefined) { const c = clean(bond.removeCats); if (c) bond.removeCats = c; else delete bond.removeCats; }
  }
}

/** True if a message carries any VELLUM state (used to gate folding). */
export function hasState(content: string): boolean {
  return parseState(content).state !== null;
}

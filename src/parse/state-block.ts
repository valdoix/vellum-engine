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
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i]!;
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

/** Tolerant JSON: normalize smart quotes, strip an inner ```fence, // and
 * block comments, trailing commas; then parse the outermost balanced object.
 * Handles the common ways models mangle the block. */
function lenientParse(raw: string): unknown | null {
  let s = raw
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')   // curly/smart double quotes → "
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")          // curly single quotes → '
    .replace(/\u00A0/g, ' ')                               // nbsp → space
    .trim();
  // drop an inner markdown code fence (```json ... ```)
  s = s.replace(/^```[a-z]*\s*/i, '').replace(/```$/i, '').trim();
  const obj0 = balancedObject(s) ?? s;
  let cleaned = obj0
    .replace(/\/\/[^\n\r]*/g, '')              // line comments
    .replace(/\/\*[\s\S]*?\*\//g, '')          // block comments
    .replace(/"[A-Za-z_][\w]*"\s*:\s*<[^>{}\[\]]*>\s*,?/g, '') // drop "key": <placeholder>
    .replace(/,(\s*[}\]])/g, '$1');            // trailing commas (after the drop)
  try { return JSON.parse(cleaned); } catch { /* try harder */ }
  // last resort: single-quoted strings + unquoted keys → JSON-ish
  try {
    const fixed = cleaned
      .replace(/'([^'\\]*)'/g, '"$1"')                                   // 'str' → "str"
      .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');     // key: → "key":
    return JSON.parse(fixed);
  } catch { return null; }
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
  const keys = ['bonds', 'threads', 'arcs', 'journal', 'knowledge', 'secrets', 'parallel'];
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

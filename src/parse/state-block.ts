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

const SCHEMA_KEY = /"(?:delta|scene|present|turn|day)"/;

function extractFenced(content: string): string | null {
  const candidates: string[] = [];
  for (const [open, close] of FENCES) {
    let from = 0;
    // collect EVERY occurrence of this fence (a model may show an example block
    // earlier in prose and the real one later — we score by schema keys below).
    for (;;) {
      const i = content.indexOf(open, from);
      if (i < 0) break;
      const j = content.indexOf(close, i + open.length);
      // closing fence missing (truncated mid-block) → take the rest of the message
      candidates.push(content.slice(i + open.length, j < 0 ? undefined : j).trim());
      from = i + open.length;
      if (j < 0) break;
    }
  }
  if (candidates.length) {
    // prefer a candidate that actually looks like our state block
    const withSchema = candidates.filter((c) => SCHEMA_KEY.test(c));
    const pool = withSchema.length ? withSchema : candidates;
    // among those, the LARGEST (most complete) wins
    return pool.reduce((a, b) => (b.length > a.length ? b : a));
  }
  // last resort: the first balanced {...} that contains a schema key (non-greedy,
  // bracket-aware — not the old greedy regex that ran to the last } in the message)
  let idx = content.indexOf('{');
  while (idx >= 0) {
    const obj = balancedObject(content.slice(idx));
    if (obj && SCHEMA_KEY.test(obj)) return obj;
    idx = content.indexOf('{', idx + 1);
  }
  // truly unbalanced bare object: hand the from-brace slice to lenientParse
  const b = content.indexOf('{');
  return b >= 0 && SCHEMA_KEY.test(content.slice(b)) ? content.slice(b) : null;
}

// smart double/single quote variants the models love to emit
const SMART_DQ = /[\u201C\u201D\u201E\u201F\u2033]/;
const SMART_SQ = /[\u2018\u2019\u201A\u2032]/;
// a "quote family": double (" and smart doubles) vs single (' and smart singles).
// We track the FAMILY when a string opens, so a smart-open / smart-close pair
// (which are different code points) still matches and the string closes.
const isDQ = (c: string): boolean => c === '"' || SMART_DQ.test(c);
const isSQ = (c: string): boolean => c === "'" || SMART_SQ.test(c);
const closesQuote = (c: string, fam: 'd' | 's'): boolean => fam === 'd' ? isDQ(c) : isSQ(c);

/** Pull the outermost balanced object out of a string (ignores prose/fences
 * around it). Quote-aware (straight + smart, both families) and tracks BOTH
 * {}/[] nesting, so a brace inside a string or a mismatched bracket can't end
 * the scan early. Returns null if no complete top-level object closes. */
function balancedObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false, fam: 'd' | 's' = 'd';
  for (let i = start; i < s.length; i++) {
    const c = s[i]!;
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (closesQuote(c, fam)) inStr = false; continue; }
    if (isDQ(c) || isSQ(c)) { inStr = true; fam = isSQ(c) ? 's' : 'd'; }
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

interface ScanResult {
  /** cleaned, string-safe scaffold (comments stripped, quotes/controls fixed) */
  out: string;
  /** unclosed brackets in stack order; reverse-join to close a truncation */
  stack: string[];
  /** true if the scan ended inside an open string literal (truncated mid-value) */
  inStr: boolean;
  /** length of `out` at the last completed value/element boundary */
  safeLen: number;
}

/**
 * ONE string-aware left-to-right scan that does ALL repairs at once, so the
 * in-string and out-of-string rules can never disagree (the bug that let a
 * newline/control char survive on one path but not another):
 *   inside strings  → normalize smart→straight quotes, escape inner ", escape
 *                     EVERY control char (\n \r \t and 0x00–0x1F), keep prose
 *                     punctuation (//, commas, +2, URLs) untouched
 *   outside strings → strip // and /* *\/ comments, drop leading + on numbers,
 *                     normalize smart quotes to ", track the bracket stack
 * Records the bracket stack + last safe boundary so a truncated block can be
 * closed from the SAME cleaned buffer.
 */
function scanJson(src: string): ScanResult {
  let out = '';
  const stack: string[] = [];
  let inStr = false, esc = false, fam: 'd' | 's' = 'd';
  let safeLen = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    const code = c.charCodeAt(0);
    if (inStr) {
      if (esc) { out += c; esc = false; continue; }
      if (c === '\\') { out += c; esc = true; continue; }
      if (closesQuote(c, fam)) { inStr = false; out += '"'; safeLen = out.length; continue; } // close → normalize to "
      // An off-family quote is CONTENT, not a delimiter: an apostrophe inside a
      // double-quoted string ("Daeron's Chambers", "I won't") and a double quote
      // inside a single-quoted string ('he said "no"') are both legal text. Only
      // a STRAIGHT double quote needs escaping (it's JSON's delimiter); a smart
      // quote or an apostrophe of the other family passes through verbatim so the
      // word it belongs to is never corrupted.
      if (c === '"') { out += '\\"'; continue; }                     // straight " as content inside a single-quoted string
      if (code < 0x20) { out += code === 10 ? '\\n' : code === 13 ? '\\r' : code === 9 ? '\\t' : '\\u' + code.toString(16).padStart(4, '0'); continue; } // ALL control chars
      out += c; continue;                                            // apostrophe / smart quote of the other family → keep as-is
    }
    // --- outside a string ---
    if (isDQ(c)) { inStr = true; fam = 'd'; out += '"'; continue; }  // straight or smart double opens a string
    if (isSQ(c)) { inStr = true; fam = 's'; out += '"'; continue; }  // straight or smart single opens a string
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }     // line comment
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; continue; } // block comment
    if (c === '+' && /\d/.test(src[i + 1] ?? '')) continue;          // leading + on a number
    out += c;
    if (c === '{' || c === '[') { stack.push(c === '{' ? '}' : ']'); }
    else if (c === '}' || c === ']') { stack.pop(); safeLen = out.length; }
    else if (c === ',') safeLen = out.length - 1;                    // before the comma
    else if (/[\d\]}eluatrsf.+-]/i.test(c)) safeLen = out.length;    // tail of a number/keyword
  }
  return { out, stack, inStr, safeLen };
}

/** Post-scan structural fixups on the string-safe scaffold (inert vs content,
 * since strings are already closed/escaped in `out`). */
function structuralFixups(out: string): string {
  return out
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3')        // quote unquoted keys
    .replace(/"[\w$]+"\s*:\s*<[^>{}\[\]]*>\s*,?/g, '')                // drop "key": <placeholder>
    .replace(/,(\s*[}\]])/g, '$1')                                    // trailing commas
    .replace(/,\s*,/g, ',')                                           // doubled commas
    .replace(/([{\[])\s*,/g, '$1');                                   // leading comma in container
}

const MAX_INPUT = 1_000_000; // 1MB guard against pathological inputs

/**
 * Tolerant JSON parse, hardened against the many ways models mangle the block.
 * Strategy ladder (cheapest first; first success wins):
 *   1. plain JSON.parse on the balanced object (happy path — no mangling)
 *   2. one string-aware repair scan + structural fixups
 *   3. close a TRUNCATED block from the SAME scan (trim the dangling token, then
 *      append the missing }/] the bracket stack implies)
 * Returns the parsed value, or null if nothing works.
 */
function lenientParse(raw: string): unknown | null {
  let base = raw
    .replace(/\u00A0/g, ' ')
    .replace(/^\s*```[a-z]*\s*/i, '').replace(/```\s*$/i, '')
    .trim();
  if (base.length > MAX_INPUT) base = base.slice(0, MAX_INPUT);

  // slice from the first '{' so leading prose/reverie never reaches the parser,
  // even when the object is unbalanced (balancedObject would return null then).
  const fromBrace = base.slice(Math.max(0, base.indexOf('{')));
  const obj0 = balancedObject(base) ?? fromBrace;

  // 1. happy path
  const direct = tryParse(obj0);
  if (direct !== undefined) return direct;

  // 2. one repair scan (covers comments, smart quotes, control chars, leading +,
  //    inner quotes) + structural fixups (unquoted keys, trailing commas, …)
  const scan = scanJson(obj0);
  const repaired = structuralFixups(scan.out);
  const r1 = tryParse(repaired);
  if (r1 !== undefined) return r1;

  // 3. truncation: close from the SAME cleaned scan of the full from-brace slice
  const closed = closeTruncated(fromBrace);
  if (closed) {
    const r2 = tryParse(closed) ?? tryParse(structuralFixups(closed));
    if (r2 !== undefined) return r2;
  }
  return null;
}

/**
 * Close a TRUNCATED object using the shared scan: trim the cleaned buffer back
 * to the last completed value/element, drop any dangling partial key, then
 * append the closers the bracket stack implies. Returns null if not truncated.
 */
function closeTruncated(s: string): string | null {
  if (!s || s[0] !== '{') return null;
  const scan = scanJson(s);
  if (!scan.stack.length && !scan.inStr) return null; // already balanced
  // if cut off mid-string, fall back to the last completed boundary
  let body = scan.inStr ? scan.out.slice(0, scan.safeLen) : scan.out;
  // iteratively drop dangling fragments so we never leave a HALF-BUILT element
  // (which would parse as JSON but fail the schema for missing required fields):
  //   - a trailing partial object  …[ { "who":"C"   → drop the whole element
  //   - a dangling key  …,"memory":  or  …,"memory"  → drop it
  //   - a trailing comma/colon
  for (let g = 0; g < 12; g++) {
    const before = body;
    body = body
      .replace(/,?\s*\{[^{}\[\]]*$/, '')        // trailing unclosed object (partial element)
      .replace(/,\s*"[^"]*"\s*:?\s*$/, '')      // dangling "key": or "key"
      .replace(/[,:]\s*$/, '');                  // trailing comma/colon
    if (body === before) break;
  }
  // recompute closers for the trimmed body (it's string-safe now)
  const stack: string[] = []; let st = false, e = false;
  for (const c of body) {
    if (st) { if (e) e = false; else if (c === '\\') e = true; else if (c === '"') st = false; continue; }
    if (c === '"') st = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') stack.pop();
  }
  if (st) return null;
  return body + stack.reverse().join('');
}

function tryParse(s: string): unknown | undefined {
  try { return JSON.parse(s); } catch { return undefined; }
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

  // The regex fallback scans line-oriented directives (scene/present/rel/…). The
  // <reverie> plan speaks the SAME words ("SCENE:", "STATE:", …) as backstage
  // notes, so feeding it the reverie makes the fallback mistake planning prose
  // for real state (e.g. dumping the reverie's SCENE sentence into scene.loc).
  // Strip the reverie first so the fallback only sees post-prose ledger text.
  // Open tag optional: a host that doesn't echo the "<reverie>" prefill leaves a
  // reply that opens mid-plan and only has the closing tag — still strip it.
  const withoutReverie = content.replace(/(?:<reverie>)?[\s\S]*?<\/\s*rever[a-z]*\s*>/i, ' ');
  const fb = parseFallback(withoutReverie);
  if (fb) return { state: fb, source: 'regex' };

  return { state: null, source: 'none' };
}

/** Models sometimes put bonds/threads/arcs/journal/parallel at the TOP level
 * instead of inside `delta`. Hoist them in so nothing is silently dropped. */
function hoistDeltaFields(obj: Record<string, unknown>): void {
  // unwrap an accidental double-nest: { delta: { delta: {...} } }
  let guard = 0;
  while (obj.delta && typeof obj.delta === 'object' && (obj.delta as Record<string, unknown>).delta && typeof (obj.delta as Record<string, unknown>).delta === 'object' && guard++ < 4) {
    obj.delta = (obj.delta as Record<string, unknown>).delta;
  }
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

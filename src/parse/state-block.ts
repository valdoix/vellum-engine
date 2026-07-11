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
    // DOUBLED-COLON RUN-ON: the model dropped the '","' between a value and the
    // next key, fusing them ("weight":"significant","sentiment":.. becomes
    // "weight":"significantsentiment":..). A quoted string in VALUE position
    // followed by ':' is illegal JSON, so the whole block would fail. We can't
    // know where the value ended and the key began, so we DON'T guess and we do
    // NOT wrap into an object (that steals the element's closing brace and leaves
    // it unbalanced). Instead we insert a null value + comma: "k":"a":"b" becomes
    // "k":null,"a":"b" — balanced, valid JSON. Zod's per-field .catch(undefined)
    // drops the nulled field `k`, the junk key `"a"` is an unknown field Zod
    // strips, and every OTHER field of that element survives instead of the whole
    // turn being lost. Runs on the string-safe scaffold (scanJson already
    // closed/escaped strings), so it can't fire inside a real string value — a
    // URL like "loc":"http://x" is untouched because the inner ':' sits inside a
    // closed "..." and the value is followed by ',' or '}', not ':'.
    .replace(/:\s*("(?:[^"\\]|\\.)*")\s*:/g, ':null,$1:')            // "k":"a":"b" → "k":null,"a":"b"
    .replace(/,(\s*[}\]])/g, '$1')                                    // trailing commas
    .replace(/,\s*,/g, ',')                                           // doubled commas
    .replace(/([{\[])\s*,/g, '$1');                                   // leading comma in container
}

// ─── Element salvage (rung 4) ────────────────────────────────────────────────
// When the whole-object parse fails (rungs 1-3), recover every VALID part and
// drop only genuinely unrecoverable elements, turning a whole-turn loss into a
// per-element loss. All walkers reuse the SAME quote-family discipline as
// scanJson/balancedObject so braces/commas/colons inside strings never fool them.

interface KV { key: string; value: string; }

/** Depth-1, quote/bracket-aware split of an object's `"key": value` pairs. Each
 *  `value` is the EXACT source substring (scalar up to the next depth-1 comma, or
 *  the matching }/] for an object/array). Returns null if the source isn't an
 *  object we can segment at all. Tolerates a trailing unterminated pair (drops it). */
function tokenizeTopLevel(objSrc: string): KV[] | null {
  const start = objSrc.indexOf('{');
  if (start < 0) return null;
  const pairs: KV[] = [];
  let i = start + 1;
  const n = objSrc.length;
  const skipWs = (): void => { while (i < n && /\s/.test(objSrc[i]!)) i++; };
  // read a quoted key (any quote family); returns the unquoted key text or null
  const readKey = (): string | null => {
    skipWs();
    const c = objSrc[i];
    if (c === undefined || c === '}') return null;
    if (!(isDQ(c) || isSQ(c))) return null; // not a key position
    const fam: 'd' | 's' = isSQ(c) ? 's' : 'd';
    i++;
    let key = '', esc = false;
    for (; i < n; i++) {
      const ch = objSrc[i]!;
      if (esc) { key += ch; esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (closesQuote(ch, fam)) { i++; return key; }
      key += ch;
    }
    return null; // unterminated key → give up on this pair
  };
  // capture a value span starting at i up to (not including) the next depth-1
  // comma or the object's closing brace. Quote + bracket aware.
  const readValue = (): string | null => {
    skipWs();
    if (i >= n) return null;
    const vStart = i;
    let depth = 0, inStr = false, esc = false, fam: 'd' | 's' = 'd';
    for (; i < n; i++) {
      const ch = objSrc[i]!;
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (closesQuote(ch, fam)) inStr = false;
        continue;
      }
      if (isDQ(ch) || isSQ(ch)) { inStr = true; fam = isSQ(ch) ? 's' : 'd'; continue; }
      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        if (depth === 0) return objSrc.slice(vStart, i).trim(); // hit the object's own close
        depth--;
      } else if (ch === ',' && depth === 0) {
        return objSrc.slice(vStart, i).trim();
      }
    }
    // ran off the end (truncation): return what we have, trimmed
    const tail = objSrc.slice(vStart).trim();
    return tail.length ? tail : null;
  };
  for (let guard = 0; guard < 500 && i < n; guard++) {
    skipWs();
    if (objSrc[i] === '}' || i >= n) break;
    const key = readKey();
    if (key === null) break;
    skipWs();
    if (objSrc[i] !== ':') break; // malformed — stop segmenting here
    i++; // consume ':'
    const value = readValue();
    if (value === null || value === '') break;
    pairs.push({ key, value });
    skipWs();
    if (objSrc[i] === ',') i++; // consume separator and continue
  }
  return pairs.length ? pairs : null;
}

/** Depth-1, quote/bracket-aware element spans of an array. NOT a comma split —
 *  commas inside strings and nested containers must not break elements. Drops a
 *  trailing unterminated element (truncation + corruption combined). */
function splitElements(arraySrc: string): string[] {
  const start = arraySrc.indexOf('[');
  if (start < 0) return [];
  const out: string[] = [];
  let i = start + 1;
  const n = arraySrc.length;
  let elStart = -1, depth = 0, inStr = false, esc = false, fam: 'd' | 's' = 'd';
  const flush = (end: number): void => {
    if (elStart < 0) return;
    const el = arraySrc.slice(elStart, end).trim();
    if (el.length) out.push(el);
    elStart = -1;
  };
  for (; i < n; i++) {
    const ch = arraySrc[i]!;
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (closesQuote(ch, fam)) inStr = false;
      continue;
    }
    if (isDQ(ch) || isSQ(ch)) { if (elStart < 0) elStart = i; inStr = true; fam = isSQ(ch) ? 's' : 'd'; continue; }
    if (ch === '{' || ch === '[') { if (elStart < 0) elStart = i; depth++; continue; }
    if (ch === '}' || ch === ']') {
      if (depth === 0) { flush(i); return out; } // array's own close
      depth--; continue;
    }
    if (ch === ',' && depth === 0) { flush(i); continue; }
    if (!/\s/.test(ch) && elStart < 0) elStart = i;
  }
  // ran off the end: the last element was truncated — DROP it (do not flush)
  return out;
}

/** repair(x): the SAME repair rungs 2 gives the whole block, scoped to a fragment
 *  (now includes Option 1's doubled-colon rule). */
function repairFragment(x: string): string {
  return structuralFixups(scanJson(x).out);
}

/** Try to parse one element; direct then repaired. */
function parseElement(el: string): unknown | undefined {
  return tryParse(el) ?? tryParse(repairFragment(el));
}

/** Count of dropped elements per section (for honest logging) + a `kept` tally of
 *  values ACTUALLY recovered, so an all-corrupt block that yields only empty
 *  containers ({delta:{journal:[]}}) is NOT mistaken for a successful salvage. */
export interface SalvageStats { dropped: Record<string, number>; kept: number; }

function salvageArray(arraySrc: string, section: string, stats: SalvageStats): unknown[] {
  const out: unknown[] = [];
  const els = splitElements(arraySrc);
  for (const el of els) {
    const v = parseElement(el);
    if (v !== undefined) { out.push(v); stats.kept++; }
    else stats.dropped[section] = (stats.dropped[section] ?? 0) + 1;
  }
  return out;
}

function salvageDelta(deltaSrc: string, stats: SalvageStats): Record<string, unknown> {
  const pairs = tokenizeTopLevel(deltaSrc);
  const out: Record<string, unknown> = {};
  if (!pairs) return out;
  for (const { key, value } of pairs) {
    if (value[0] === '[') out[key] = salvageArray(value, key, stats);
    else { const v = parseElement(value); if (v !== undefined) { out[key] = v; stats.kept++; } }
  }
  return out;
}

/** Two-level salvage matching the ParsedState shape (top-level + delta.*).
 *  Returns null unless at least one REAL value was recovered (`stats.kept > 0`) —
 *  empty containers alone don't count, so an all-corrupt block falls through to
 *  the regex/none path exactly as before. */
function salvageObject(objSrc: string, stats: SalvageStats): Record<string, unknown> | null {
  const pairs = tokenizeTopLevel(objSrc);
  if (!pairs) return null;
  const result: Record<string, unknown> = {};
  for (const { key, value } of pairs) {
    if (key === 'delta' && value[0] === '{') result.delta = salvageDelta(value, stats);
    else if (value[0] === '[') result[key] = salvageArray(value, key, stats);
    else { const v = parseElement(value); if (v !== undefined) { result[key] = v; stats.kept++; } }
  }
  return stats.kept > 0 ? result : null;
}

const MAX_INPUT = 1_000_000; // 1MB guard against pathological inputs

/**
 * Tolerant JSON parse, hardened against the many ways models mangle the block.
 * Strategy ladder (cheapest first; first success wins):
 *   1. plain JSON.parse on the balanced object (happy path — no mangling)
 *   2. one string-aware repair scan + structural fixups
 *   3. close a TRUNCATED block from the SAME scan (trim the dangling token, then
 *      append the missing }/] the bracket stack implies)
 *   4. ELEMENT SALVAGE (last resort): recover every valid top-level/delta member
 *      and drop only genuinely unrecoverable elements. Signals via `report.partial`.
 * Returns the parsed value, or null if nothing works.
 */
interface LenientReport { partial: boolean; stats: SalvageStats | null; }
function lenientParse(raw: string, report?: LenientReport): unknown | null {
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

  // 4. element salvage — recover valid members, drop only the corrupt element(s).
  //    Reached ONLY after rungs 1-3 fail, so healthy/recovered blocks never hit it.
  const stats: SalvageStats = { dropped: {}, kept: 0 };
  const salvaged = salvageObject(obj0, stats) ?? salvageObject(fromBrace, stats);
  if (salvaged && Object.keys(salvaged).length) {
    if (report) { report.partial = true; report.stats = stats; }
    return salvaged;
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
    const report: LenientReport = { partial: false, stats: null };
    const obj = lenientParse(raw, report);
    if (obj && typeof obj === 'object') {
      hoistDeltaFields(obj as Record<string, unknown>); // tolerate misplaced delta fields
      normalizeBlock(obj as Record<string, unknown>); // map preset grammar (cat) → schema (addCats)
      const validated = ParsedState.safeParse(obj);
      if (validated.success) {
        // rung 4 (element salvage) recovered the block by dropping corrupt
        // element(s) — surface that honestly so data loss is visible, not silent.
        if (report.partial) {
          const dropped = report.stats ? { ...report.stats.dropped } : {};
          return { state: validated.data, source: 'json-partial', dropped };
        }
        return { state: validated.data, source: 'json' };
      }
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

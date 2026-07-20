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

// Fence OPEN markers as tolerant regexes (whitespace inside the tag allowed).
// Used to find where the vellum suffix begins even when the block is mangled.
const VELLUM_OPEN_RE = /\u2039\s*vellum\s*\u203a|<\s*vellum\s*>|```\s*vellum|\[\s*VELLUM\s*\]/i;
// A dangling/spaced CLOSE tag implies a block whose open we missed.
const VELLUM_CLOSE_RE = /\u2039\s*\/\s*vellum\s*\u203a|<\s*\/\s*vellum\s*>?|\[\s*\/\s*VELLUM\s*\]|```/i;
// Tolerant reverie close (spaced/partial: `</ reverie >`, `</rever…>`), matching
// what parseState already uses so the two paths agree.
const REVERIE_CLOSE_RE = /<\s*\/\s*rever[a-z]*\s*>/i;
const REVERIE_OPEN_RE = /<\s*rever[a-z]*\s*>/i;
// A turn may be an ASSEMBLED beat, not a bare reply: the host prefixes the
// player message and a "[Scene]" marker before the assistant reply (see
// allTurnContents). The reverie lives INSIDE the [Scene] section, so when the
// reverie open tag is eaten (prefill), the reverie begins right after [Scene] —
// we must never cut content before it (that ate [Player action] + the user msg).
const SCENE_MARKER_RE = /\[\s*scene\s*\]/gi;

// Colored-dialogue tags: `[spk=Name]…[/spk]` (whitespace/quote tolerant, matching
// the preset's display regex). We remove the TAGS but KEEP the quoted line, so the
// prose in turns memory reads naturally without the speaker markup — regardless of
// whether the context-strip regex is enabled host-side.
const SPK_TAG_RE = /\[\s*\/?\s*spk\b(?:\s*=\s*["']?[^"'\]\r\n]{0,40}["']?)?\s*\]/gi;

// Preset planning fingerprints (Part C): the reverie's own terse note lines and
// the bracketed directive headers the preset injects. A leading block matching
// any of these is planning, not prose.
const PLANNING_LINE_RE = /^\s*(?:SCENE|STATE|CONFIG|BEATS?|GOAL|CONTINUITY|CAST|THREADS?)\s*:/i;
const PLANNING_HEADER_RE = /^\s*\[(?:REVERIE|CONFIG|GENESIS|THE CARTOGRAPHER|EXAMPLE|OUTPUT FORMAT|STATE BLOCK)/i;

/** Find where the vellum suffix starts. Returns the cut index, or -1 if none.
 *  Trust order: an OPEN fence variant, else a dangling CLOSE, else a trailing
 *  schema-keyed balanced {…} in the last ~40% (model emitted JSON, mangled tag). */
function vellumSuffixIndex(s: string): number {
  const openM = s.match(VELLUM_OPEN_RE);
  if (openM && openM.index !== undefined) return openM.index;
  const closeM = s.match(VELLUM_CLOSE_RE);
  if (closeM && closeM.index !== undefined) return closeM.index;
  // fallback: a trailing balanced {…} with schema keys, positioned late in the msg
  const tailStart = Math.floor(s.length * 0.6);
  let idx = s.indexOf('{', tailStart);
  // also try the last '{' before tailStart if nothing later (block may start ~60%)
  if (idx < 0) { const last = s.lastIndexOf('{'); if (last >= tailStart * 0.5) idx = last; }
  while (idx >= 0) {
    const obj = balancedObject(s.slice(idx));
    // require it to run to (near) end-of-string AND carry schema keys — prose
    // almost never ends with a schema-keyed JSON object.
    if (obj && SCHEMA_KEY.test(obj) && idx + obj.length >= s.trimEnd().length - 2) return idx;
    idx = s.indexOf('{', idx + 1);
  }
  return -1;
}

/**
 * Remove the reverie (prefix) and vellum (suffix) scaffold from a raw turn,
 * leaving only the prose. Position-aware and fence-tolerant — as robust as the
 * parser, and biased to LEAK rather than eat prose.
 *
 * The preset enforces a fixed shape (reverie first, prose middle, vellum last),
 * so we strip by POSITION, which survives mangled/truncated/tag-drifted blocks
 * that the old tag-pair regexes missed. Never returns empty when the input had
 * prose (leak-not-eat guard).
 */
export function stripScaffold(content: string): string {
  if (!content) return '';
  let s = content;

  // A1 — vellum suffix: cut from the earliest vellum marker to end-of-string.
  const vi = vellumSuffixIndex(s);
  if (vi >= 0) s = s.slice(0, vi);

  // A2 — reverie span: cut ONLY the reverie itself, never content before it. In an
  // assembled beat the reverie is preceded by "[Player action]\n{user msg}\n\n[Scene]",
  // so cutting from string-start would eat the player action. Anchor the reverie
  // START at its open tag, or (if the prefill ate the open) at the [Scene] marker
  // that immediately precedes it; cut [start, close-end], keeping the head intact.
  const rc = s.match(REVERIE_CLOSE_RE);
  if (rc && rc.index !== undefined) {
    const closeEnd = rc.index + rc[0].length;
    const openM = s.slice(0, rc.index).match(REVERIE_OPEN_RE);
    let start: number;
    if (openM && openM.index !== undefined) {
      start = openM.index; // explicit <reverie> — cut from there
    } else {
      // open tag eaten: the reverie starts after the LAST [Scene] marker before
      // the close (its section header), or at string-start if there is none.
      let sceneEnd = 0;
      for (const m of s.slice(0, rc.index).matchAll(SCENE_MARKER_RE)) {
        if (m.index !== undefined) sceneEnd = m.index + m[0].length;
      }
      start = sceneEnd;
    }
    s = s.slice(0, start) + '\n' + s.slice(closeEnd);
  } else if (REVERIE_OPEN_RE.test(s)) {
    // C — truncated reverie: open but no close. Strip only leading planning
    // blocks (confident-match), stopping at the first block that looks like prose.
    s = stripTruncatedReverie(s);
  }

  // A3 — remove any residual bare/dangling fence token left behind.
  s = s.replace(VELLUM_OPEN_RE, ' ').replace(REVERIE_OPEN_RE, ' ').replace(REVERIE_CLOSE_RE, ' ');

  // A4 — strip colored-dialogue tags but keep the quoted line, so the prose reads
  // cleanly in turns memory even when the host context-strip regex is off.
  s = s.replace(SPK_TAG_RE, '');

  // leak-not-eat: if stripping emptied a turn that HAD prose, return the original.
  const stripped = s.trim();
  if (!stripped && content.trim()) return content;
  return stripped;
}

/** Part C: `<reverie>` opened but never closed. Drop leading blank-line-separated
 *  blocks that match the preset's planning fingerprints; stop at the first block
 *  that does NOT (that's prose). Confident-match only — if the first block already
 *  looks like prose, strip nothing. */
function stripTruncatedReverie(s: string): string {
  // drop the open tag itself first
  const body = s.replace(REVERIE_OPEN_RE, '');
  const blocks = body.split(/\n\s*\n/);
  let cut = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    const looksPlanning = b.split(/\n/).some((ln) => PLANNING_LINE_RE.test(ln) || PLANNING_HEADER_RE.test(ln));
    if (looksPlanning) { cut = i + 1; } else break;
  }
  if (cut === 0) return s; // first block is prose → confident-match fails, strip nothing
  return blocks.slice(cut).join('\n\n');
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
  // Use the SAME scaffold stripper the turns-memory gist uses so the two paths
  // agree: it removes the reverie prefix (open tag optional — prefill often eaten)
  // and any vellum suffix. A terse plain-text ledger carries neither a fence nor a
  // schema-keyed trailing JSON object, so stripScaffold leaves it intact for the
  // fallback to scan.
  const withoutReverie = stripScaffold(content);
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

/**
 * Extract the raw `<vellum>…</vellum>` block (or bare JSON suffix) from a
 * turn's raw content. Returns the block string — including the fence tags —
 * or null when no block is present. Used to inject a worked example of the
 * previous turn's actual block into the VELLUM system injection so the model
 * sees a concrete, story-specific example of the expected output format.
 */
export function extractVellumBlock(content: string): string | null {
  if (!content) return null;
  const idx = vellumSuffixIndex(content);
  if (idx < 0) return null;
  const suffix = content.slice(idx).trim();
  // Validate it carries real state AND has at least one schema key — the
  // parser is lenient enough to hoist an empty delta from {"foo":"bar"},
  // so gate explicitly on SCHEMA_KEY before calling this a usable example.
  if (!SCHEMA_KEY.test(suffix)) return null;
  const { state } = parseState(suffix);
  if (!state) return null;
  return suffix;
}

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
  // last resort: a bare {...} block that looks like our schema (has "delta"/"scene")
  const m = content.match(/\{[\s\S]*?"(?:delta|scene|present)"[\s\S]*\}/);
  return m ? m[0] : null;
}

export function parseState(content: string): ParseResult {
  if (!content) return { state: null, source: 'none' };

  const raw = extractFenced(content);
  if (raw) {
    try {
      const obj = JSON.parse(raw);
      const validated = ParsedState.safeParse(obj);
      if (validated.success) return { state: validated.data, source: 'json' };
    } catch {
      // fall through to regex
    }
  }

  const fb = parseFallback(content);
  if (fb) return { state: fb, source: 'regex' };

  return { state: null, source: 'none' };
}

/** True if a message carries any VELLUM state (used to gate folding). */
export function hasState(content: string): boolean {
  return parseState(content).state !== null;
}

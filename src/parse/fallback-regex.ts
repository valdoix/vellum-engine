import type { ParsedState, ParsedBond } from './parsed.js';
import type { Category } from '../core/events.js';
import { isCategory } from '../domain/category.js';

/**
 * Fallback parser for models that emit the terse human-readable backstage
 * format instead of JSON (token-tight local models, format drift). Produces the
 * same ParsedState the JSON path does. Deliberately conservative: it only
 * extracts what it can match confidently and leaves the rest absent.
 *
 * Accepted relationship form (legacy-compatible):
 *   relNameA->NameB: aff +12, trust -8 cat:romantic (the look)
 */

const REL_LINE = /^rel\s*[:\s]*([^\u2192>]+?)\s*(?:\u2192|->)\s*([^:]+):(.*)$/i;

function parseAxes(tail: string): { aff?: number; trust?: number; absolute: boolean; why?: string } {
  const out: { aff?: number; trust?: number; absolute: boolean; why?: string } = { absolute: false };
  // detect signed (delta) vs bare (absolute)
  const affM = tail.match(/aff(?:ection)?\s*([+-]?\d{1,3})/i);
  const trM = tail.match(/trust\s*([+-]?\d{1,3})/i);
  if (affM) out.aff = clampInt(affM[1]!);
  if (trM) out.trust = clampInt(trM[1]!);
  // absolute if neither value carried an explicit sign
  const anySigned = /aff(?:ection)?\s*[+-]/i.test(tail) || /trust\s*[+-]/i.test(tail);
  out.absolute = (affM != null || trM != null) && !anySigned;
  const why = tail.match(/\(([^)]+)\)/);
  if (why) out.why = why[1]!.trim().slice(0, 120);
  return out;
}

function parseCats(tail: string): Category[] {
  const m = tail.match(/\bcat(?:egory)?\s*[:=]\s*([a-z,\s]+)/i);
  if (!m) return [];
  return m[1]!.split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(isCategory) as Category[];
}

function clampInt(s: string): number {
  return Math.max(-100, Math.min(100, parseInt(s, 10) || 0));
}

export function parseFallback(content: string): ParsedState | null {
  const bonds: ParsedBond[] = [];
  const lines = String(content).split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const m = line.match(REL_LINE);
    if (!m) continue;
    const a = m[1]!.trim();
    const b = m[2]!.trim();
    const tail = m[3]!;
    if (!a || !b) continue;
    const axes = parseAxes(tail);
    const cats = parseCats(tail);
    const bond: ParsedBond = { a, b };
    if (axes.aff !== undefined) bond.aff = axes.aff;
    if (axes.trust !== undefined) bond.trust = axes.trust;
    if (axes.absolute) bond.absolute = true;
    if (axes.why) bond.why = axes.why;
    if (cats.length) bond.addCats = cats;
    if (bond.aff !== undefined || bond.trust !== undefined || bond.addCats) bonds.push(bond);
  }
  if (!bonds.length) return null;
  return { delta: { bonds } };
}

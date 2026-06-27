import type { ParsedState, ParsedBond } from './parsed.js';
import type { Category } from '../core/events.js';
import { isCategory } from '../domain/category.js';

/**
 * Fallback parser for models that emit the terse human-readable backstage
 * format instead of JSON (token-tight local models, format drift). Produces the
 * same ParsedState the JSON path does. Deliberately conservative: it only
 * extracts what it can match confidently and leaves the rest absent. Returns
 * null only when nothing matched.
 *
 * Grammar (one directive per line, case-insensitive keyword):
 *   rel NameA -> NameB: aff +12, trust -8 cat:romantic (the look)
 *   scene <loc> | time <t> | tension <0-10>
 *   present Name(mood), Name2(doing...)
 *   thread <new|advance|stall|resolve> <name>: <note>
 *   arc <new|advance|resolve> <name>: <note>
 *   journal <Who>: <memory>
 *
 * NUMBER SEMANTICS (Fix 18): a bare number is a DELTA (additive — the safe
 * default). It is an ABSOLUTE SET only when preceded by an explicit marker
 * `=`, `set`, or `@`:  `aff +12` / `aff 12` → delta;  `aff =12` / `aff set 12`
 * / `aff @12` → absolute.
 */

const REL_LINE = /^rel\s*[:\s]*([^\u2192>]+?)\s*(?:\u2192|->)\s*([^:]+):(.*)$/i;
const SCENE_LINE = /^scene\b\s*[:\-]?\s*(.+)$/i;
const PRESENT_LINE = /^present\b\s*[:\-]?\s*(.+)$/i;
const THREAD_LINE = /^thread\s+(new|advance|stall|resolve)\s+([^:]+?)\s*:\s*(.*)$/i;
const ARC_LINE = /^arc\s+(new|advance|resolve)\s+([^:]+?)\s*:\s*(.*)$/i;
const JOURNAL_LINE = /^journal\s+([^:]+?)\s*:\s*(.+)$/i;

type Axis = { value: number; absolute: boolean };

/** Match an axis: explicit `=`/`set`/`@` marker → absolute; otherwise delta. */
function matchAxis(tail: string, key: string): Axis | undefined {
  const re = new RegExp(key + '\\s*(=|set\\s+|@)?\\s*([+-]?\\d{1,3})', 'i');
  const m = tail.match(re);
  if (!m) return undefined;
  return { value: clampInt(m[2]!), absolute: m[1] != null };
}

function parseAxes(tail: string): { aff?: number; trust?: number; absolute: boolean; why?: string } {
  const out: { aff?: number; trust?: number; absolute: boolean; why?: string } = { absolute: false };
  const aff = matchAxis(tail, 'aff(?:ection)?');
  const tr = matchAxis(tail, 'trust');
  if (aff) out.aff = aff.value;
  if (tr) out.trust = tr.value;
  // absolute only if a matched axis explicitly used a set-marker
  out.absolute = !!((aff?.absolute) || (tr?.absolute));
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

/** "Name(mood), Name2(doing the thing)" → present entries. */
function parsePresent(s: string): Array<{ name: string; mood?: string }> {
  const out: Array<{ name: string; mood?: string }> = [];
  for (const part of s.split(',')) {
    const m = part.trim().match(/^([^(]+?)\s*(?:\(([^)]*)\))?$/);
    if (!m) continue;
    const name = m[1]!.trim();
    if (!name) continue;
    out.push(m[2] ? { name, mood: m[2].trim() } : { name });
  }
  return out;
}

export function parseFallback(content: string): ParsedState | null {
  const bonds: ParsedBond[] = [];
  const threads: NonNullable<NonNullable<ParsedState['delta']>['threads']> = [];
  const arcs: NonNullable<NonNullable<ParsedState['delta']>['arcs']> = [];
  const journal: NonNullable<NonNullable<ParsedState['delta']>['journal']> = [];
  const present: NonNullable<ParsedState['present']> = [];
  let scene: ParsedState['scene'] | undefined;

  const lines = String(content).split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    let m: RegExpMatchArray | null;

    if ((m = line.match(REL_LINE))) {
      const a = m[1]!.trim(), b = m[2]!.trim(), tail = m[3]!;
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
      continue;
    }

    if ((m = line.match(THREAD_LINE))) {
      const name = m[2]!.trim(); if (!name) continue;
      const note = m[3]!.trim();
      threads.push({ op: m[1]!.toLowerCase() as any, name, ...(note ? { note } : {}) });
      continue;
    }

    if ((m = line.match(ARC_LINE))) {
      const name = m[2]!.trim(); if (!name) continue;
      const note = m[3]!.trim();
      arcs.push({ op: m[1]!.toLowerCase() as any, name, ...(note ? { note } : {}) });
      continue;
    }

    if ((m = line.match(JOURNAL_LINE))) {
      const who = m[1]!.trim(), memory = m[2]!.trim();
      if (who && memory) journal.push({ who, memory });
      continue;
    }

    if ((m = line.match(PRESENT_LINE))) {
      present.push(...parsePresent(m[1]!));
      continue;
    }

    if ((m = line.match(SCENE_LINE))) {
      // pipe-separated fields: "<loc> | time <t> | tension <n>"
      const sc: NonNullable<ParsedState['scene']> = {};
      const parts = m[1]!.split('|').map((p) => p.trim()).filter(Boolean);
      for (const p of parts) {
        const tm = p.match(/^time\s+(.+)$/i);
        const tn = p.match(/^tension\s+(\d{1,2})$/i);
        if (tm) sc.time = tm[1]!.trim();
        else if (tn) sc.tension = Math.max(0, Math.min(10, parseInt(tn[1]!, 10)));
        else if (!sc.loc) sc.loc = p; // first bare field = location
      }
      if (Object.keys(sc).length) scene = { ...scene, ...sc };
      continue;
    }
  }

  const delta: NonNullable<ParsedState['delta']> = {};
  if (bonds.length) delta.bonds = bonds;
  if (threads.length) delta.threads = threads;
  if (arcs.length) delta.arcs = arcs;
  if (journal.length) delta.journal = journal;

  const hasDelta = Object.keys(delta).length > 0;
  if (!hasDelta && !present.length && !scene) return null;

  return {
    ...(scene ? { scene } : {}),
    ...(present.length ? { present } : {}),
    ...(hasDelta ? { delta } : {}),
  };
}

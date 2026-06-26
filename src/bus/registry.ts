import type { ParsedState } from '../parse/parsed.js';
import type { VellumEvent } from '../core/events.js';
import type { ChronicleState } from '../domain/types.js';

/**
 * EXTENSIBILITY SEAM. VELLUM II is built to grow: a new feature (inventory,
 * factions, mood-weather, anything) is added by registering a Feature here —
 * NOT by editing the core, the reducer, or the lifecycle. Each Feature can:
 *   - extract events from a parsed turn (extract)
 *   - contribute prompt-injection context (inject) [Phase 2+]
 *   - register frontend message handlers / a UI panel [Phase 4, via UI registry]
 *
 * The lifecycle iterates registered features; the reducer already handles every
 * event KIND via its exhaustive switch (add a kind in core/events.ts + one case
 * in core/reduce.ts, then a feature that emits it). Three small, well-defined
 * touch points — never a sprawling edit.
 */

export interface ExtractCtx {
  turn: number;
  day: number;
  /** prior derived state, for diffing/dedup decisions */
  state: ChronicleState;
  /** monotonic seq allocator so emitted events order correctly */
  seq: () => number;
}

export interface InjectCtx {
  state: ChronicleState;
  query: string;
  budgetChars: number;
}

export interface Feature {
  id: string;
  /** Turn a parsed turn into events. Pure; must not mutate ctx.state. */
  extract?(parsed: ParsedState, ctx: ExtractCtx): VellumEvent[];
  /** Contribute a labeled injection block for the prompt (Phase 2+). */
  inject?(ctx: InjectCtx): { label: string; text: string; ids: string[] } | null;
}

const _features: Feature[] = [];

export function registerFeature(f: Feature): void {
  if (_features.some((x) => x.id === f.id)) return; // idempotent
  _features.push(f);
}

export function features(): readonly Feature[] {
  return _features;
}

/** Run every feature's extractor over a parsed turn → a flat event list. */
export function runExtractors(parsed: ParsedState, ctx: ExtractCtx): VellumEvent[] {
  const out: VellumEvent[] = [];
  for (const f of _features) {
    if (!f.extract) continue;
    try {
      out.push(...f.extract(parsed, ctx));
    } catch (e) {
      // a misbehaving feature must never break the fold for the others
      try { (globalThis as { console?: Console }).console?.warn?.(`[vellum] feature "${f.id}" extract failed:`, e); } catch { /* ignore */ }
    }
  }
  return out;
}

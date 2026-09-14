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
  /** completed narrative prose with planning/state scaffolds removed. Optional
   * for direct feature callers; live folds always supply it. */
  prose?: string;
  /** monotonic seq allocator so emitted events order correctly */
  seq: () => number;
  /** tone dials (romance pace + world disposition); optional, defaults neutral */
  tone?: import('../domain/tone.js').Tone;
  /** canonical {{user}} id, for the disposition first-impression seed */
  userCanon?: string;
  /** relation locks (Plot Director): forbidden/pinned categories per pair */
  locks?: readonly import('../domain/relation-lock.js').RelationLock[];
  /** explicit per-chat opt-in for grounded persona state and traits */
  personaState?: boolean;
  /** latest player-authored turn input and its resolved per-turn agency mode */
  userInput?: string;
  agency?: import('../domain/preset-runtime.js').AgencyMode;
  /** Effective off-screen simulation tier after Living World, Social autonomy,
   * and Politics autonomy are combined for this turn. */
  livingWorld?: 'off' | 'minimal' | 'active' | 'sandbox';
  /** Exact titles/keys from lorebooks attached to this chat. Inline parallel
   * reconciliation may use these labels to recognize an established off-stage
   * entity on a fresh Chronicle, but never as proof of current knowledge,
   * location, travel, or activity. */
  parallelCanonLabels?: readonly string[];
  /** Attached setting canon available to Inline Compatibility's semantic
   * no-evidence gate. Passages may establish that a person/place/motive exists,
   * but never grant a character knowledge without an in-world access path. */
  worldCanon?: readonly import('../domain/lorebook-canon.js').LorebookCanonEntry[];
  /** The parsed block came from the strict Engine compiler and already passed
   * its evidence/causality validator. Extractors may skip only redundant legacy
   * lexical gates; identity, agency, and canonical-state guards still apply. */
  validatedCompiler?: boolean;
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
      if (ctx.validatedCompiler) throw new Error(`Validated compiler extraction failed in feature "${f.id}": ${(e as Error)?.message ?? String(e)}`);
      // a misbehaving feature must never break the fold for the others
      try { (globalThis as { console?: Console }).console?.warn?.(`[vellum] feature "${f.id}" extract failed:`, e); } catch { /* ignore */ }
    }
  }
  return out;
}

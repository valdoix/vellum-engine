import { parseState } from '../parse/state-block.js';
import { runExtractors, type ExtractCtx } from './registry.js';
import { nextSeq } from '../core/ids.js';
import { hashStr } from '../core/ids.js';
import type { VellumEvent } from '../core/events.js';
import type { ChronicleState } from '../domain/types.js';

/**
 * The FOLD step, as a PURE function: given the prior derived state and a turn's
 * raw content, produce the events to append (and the parse source, for the live
 * feed). I/O (reading the message, appending, broadcasting) lives in the
 * backend; this stays unit-testable.
 *
 * Idempotency: a content signature guards against folding the same turn twice
 * (swipes/regenerates re-fire GENERATION_ENDED). Caller compares sig to the
 * last folded sig.
 */

export interface FoldResult {
  events: VellumEvent[];
  source: 'json' | 'regex' | 'none';
  sig: string;
}

export function foldTurn(content: string, prior: ChronicleState, turnNo: number): FoldResult {
  const sig = hashStr(content.slice(0, 4000));
  const { state: parsed, source } = parseState(content);
  if (!parsed) return { events: [], source, sig };

  const turn = parsed.turn ?? turnNo;
  const day = parsed.day ?? prior.day ?? 1;
  const ctx: ExtractCtx = { turn, day, state: prior, seq: nextSeq };

  const events: VellumEvent[] = [
    { seq: nextSeq(), turn, day, src: 'system', kind: 'turn.fold', sig },
    ...runExtractors(parsed, ctx),
  ];
  return { events, source, sig };
}

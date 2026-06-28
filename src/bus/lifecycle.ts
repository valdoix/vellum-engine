import { parseState } from '../parse/state-block.js';
import { runExtractors, type ExtractCtx } from './registry.js';
import { nextSeq } from '../core/ids.js';
import { hashStr } from '../core/ids.js';
import type { VellumEvent } from '../core/events.js';
import type { ChronicleState } from '../domain/types.js';
import type { Tone } from '../domain/tone.js';
import type { RelationLock } from '../domain/relation-lock.js';

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

export function foldTurn(content: string, prior: ChronicleState, turnNo: number, opts?: { tone?: Tone; userCanon?: string; locks?: readonly RelationLock[] }): FoldResult {
  const sig = hashStr(content.slice(0, 4000));
  const { state: parsed, source } = parseState(content);
  if (!parsed) return { events: [], source, sig };

  // TURN IS POSITIONAL (authoritative): the fold loop's index = the assistant
  // message position, and reduce's turn high-water drives that loop. The model's
  // self-reported `parsed.turn` is unreliable (some emit a fixed "turn":1 every
  // block) — honoring it freezes the high-water at 1, which both (a) shows every
  // event as t1 and (b) makes the loop re-fold turns 2..N each GENERATION_ENDED,
  // duplicating bond deltas. Day stays narrative (model-supplied).
  const turn = turnNo;
  const day = parsed.day ?? prior.day ?? 1;
  const ctx: ExtractCtx = { turn, day, state: prior, seq: nextSeq, ...(opts?.tone ? { tone: opts.tone } : {}), ...(opts?.userCanon ? { userCanon: opts.userCanon } : {}), ...(opts?.locks?.length ? { locks: opts.locks } : {}) };

  const events: VellumEvent[] = [
    { seq: nextSeq(), turn, day, src: 'system', kind: 'turn.fold', sig },
    ...runExtractors(parsed, ctx),
  ];
  return { events, source, sig };
}

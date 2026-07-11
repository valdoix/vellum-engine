import { parseState } from '../parse/state-block.js';
import { runExtractors, type ExtractCtx } from './registry.js';
import { nextSeq } from '../core/ids.js';
import { hashStr } from '../core/ids.js';
import { reconcileDay, hasDayAdvanceCue, parseClock } from '../domain/clock.js';
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
  source: 'json' | 'json-partial' | 'regex' | 'none';
  sig: string;
  /** for `json-partial`: count of dropped elements per section (e.g. { journal: 1 }) */
  dropped?: Record<string, number>;
}

export function foldTurn(content: string, prior: ChronicleState, turnNo: number, opts?: { tone?: Tone; userCanon?: string; locks?: readonly RelationLock[]; dayCap?: number }): FoldResult {
  const sig = hashStr(content.slice(0, 4000));
  const { state: parsed, source, dropped } = parseState(content);
  if (!parsed) return { events: [], source, sig };

  // TURN IS POSITIONAL (authoritative): the fold loop's index = the assistant
  // message position, and reduce's turn high-water drives that loop. The model's
  // self-reported `parsed.turn` is unreliable (some emit a fixed "turn":1 every
  // block) — honoring it freezes the high-water at 1, which both (a) shows every
  // event as t1 and (b) makes the loop re-fold turns 2..N each GENERATION_ENDED,
  // duplicating bond deltas. Day stays narrative (model-supplied).
  const turn = turnNo;
  // DAY SANITY: the day counter is model-supplied and monotonic downstream, so a
  // bad value sticks. reconcileDay stops blindly trusting parsed.day — it keeps
  // the prior day on a backward report and flags an unexplained large jump. A
  // prose skip cue ("weeks later") permits a big forward leap without a flag.
  const proseCue = hasDayAdvanceCue(content);
  // clock evidence for the day-creep guard: the prior scene's ordered clock vs
  // the one this turn's scene reports (explicit or derived from its time string).
  const priorClock = prior.scene?.clock;
  const newClock = (typeof parsed.scene?.clock === 'number' && parsed.scene.clock >= 0 && parsed.scene.clock <= 1439)
    ? Math.floor(parsed.scene.clock)
    : parseClock(parsed.scene?.time);
  const rec = reconcileDay(parsed.day, prior.day ?? 0, proseCue, {
    ...(priorClock !== undefined ? { priorClock } : {}),
    ...(newClock !== undefined ? { newClock } : {}),
  });
  let day = rec.day;
  // REGENERATE DAY-STABILITY: when re-folding a turn that already existed (edit/
  // regenerate), the NOW line injected the pre-rollback day as authoritative, so
  // the model tends to step PAST it — ratcheting the calendar forward on every
  // regenerate. Clamp the re-folded day to what this turn previously held, unless
  // the prose carries a genuine skip cue (then the leap is intended). Never below
  // the prior day (that's reconcileDay's floor).
  if (opts?.dayCap !== undefined && !proseCue && day > opts.dayCap) {
    day = Math.max(prior.day ?? 0, opts.dayCap);
  }
  const ctx: ExtractCtx = { turn, day, state: prior, seq: nextSeq, ...(opts?.tone ? { tone: opts.tone } : {}), ...(opts?.userCanon ? { userCanon: opts.userCanon } : {}), ...(opts?.locks?.length ? { locks: opts.locks } : {}) };

  const events: VellumEvent[] = [
    { seq: nextSeq(), turn, day, src: 'system', kind: 'turn.fold', sig },
    ...runExtractors(parsed, ctx),
  ];
  // advisory day flag (backward report / unexplained jump) — the existing
  // continuity.flag kind, so no schema change. Non-blocking; shows in the Log.
  if (rec.flag) {
    events.push({ seq: nextSeq(), turn, day, src: 'system', kind: 'continuity.flag', code: rec.flag.code, detail: rec.flag.detail });
  }
  return { events, source, sig, ...(dropped ? { dropped } : {}) };
}

import { parseState, stripScaffold } from '../parse/state-block.js';
import { runExtractors, type ExtractCtx } from './registry.js';
import { nextSeq } from '../core/ids.js';
import { hashStr } from '../core/ids.js';
import { clockTime, elapsedClockFloor, reconcileDay, parseClock, rollover, supportsDayAdvance } from '../domain/clock.js';
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

export function foldTurn(content: string, prior: ChronicleState, turnNo: number, opts?: { tone?: Tone; userCanon?: string; locks?: readonly RelationLock[]; dayCap?: number; personaState?: boolean; userInput?: string; agency?: import('../domain/preset-runtime.js').AgencyMode; parallelCanonLabels?: readonly string[] }): FoldResult {
  // Hash the complete active content. The state block lives at the end of the
  // message, so a prefix-only signature misses precisely the edits/swipes that
  // must invalidate canonical state on long replies.
  const sig = hashStr(content);
  const { state: parsed, source, dropped } = parseState(content);
  if (!parsed) return { events: [], source, sig };

  // TURN IS POSITIONAL (authoritative): the fold loop's index = the assistant
  // message position, and reduce's turn high-water drives that loop. The model's
  // self-reported `parsed.turn` is unreliable (some emit a fixed "turn":1 every
  // block) — honoring it freezes the high-water at 1, which both (a) shows every
  // event as t1 and (b) makes the loop re-fold turns 2..N each GENERATION_ENDED,
  // duplicating bond deltas. Day is reconciled against narrative evidence below.
  const turn = turnNo;
  // DAY SANITY: the day counter is model-supplied and monotonic downstream, so a
  // bad value sticks. reconcileDay accepts a forward story-day count only when
  // stripped prose proves elapsed days, a rollover, or a skip. Calendar date
  // components never become the counter; unsupported increments retain T0.
  const prose = stripScaffold(content);
  // clock evidence for the day-creep guard: the prior scene's ordered clock vs
  // the one this turn's scene reports (explicit or derived from its time string).
  const priorClock = prior.scene?.clock ?? parseClock(prior.scene?.time);
  const clockFromTime = parseClock(parsed.scene?.time);
  let newClock = clockFromTime ?? ((typeof parsed.scene?.clock === 'number' && parsed.scene.clock >= 0 && parsed.scene.clock <= 1439)
    ? Math.floor(parsed.scene.clock)
    : undefined);
  // The latest player input can establish a real time cut ("ten minutes later")
  // even when the reply does not repeat it. When either current-turn source gives
  // a completed duration, repair a frozen/under-advanced endpoint before folding.
  const timeSource = [opts?.userInput, prose].filter(Boolean).join('\n');
  if (parsed.scene && newClock !== undefined) {
    const floored = elapsedClockFloor(prior.day ?? 0, priorClock, Math.floor(parsed.day ?? prior.day ?? 0), newClock, timeSource);
    if (floored.inferred) {
      parsed.day = floored.day;
      parsed.scene.clock = floored.clock;
      parsed.scene.time = clockTime(floored.clock);
      newClock = floored.clock;
    }
  }
  const reportedGap = Math.max(1, Math.floor(parsed.day ?? prior.day ?? 0) - (prior.day ?? 0));
  const proposedDay = Math.floor(parsed.day ?? prior.day ?? 0);
  const dayAdvanceEvidence = supportsDayAdvance(timeSource, priorClock, newClock, reportedGap, proposedDay);
  const rec = reconcileDay(parsed.day, prior.day ?? 0, dayAdvanceEvidence, {
    ...(priorClock !== undefined ? { priorClock } : {}),
    ...(newClock !== undefined ? { newClock } : {}),
  });
  let day = rec.day;
  // If the prose explicitly crosses into a new day but the model forgot to bump
  // its day field, repair the rollover before extraction. This is the only case
  // where an earlier wall clock can still be forward-moving absolute time.
  const inferredRollover = rollover(prior.day ?? 0, priorClock, newClock, dayAdvanceEvidence);
  if (inferredRollover !== undefined && day <= (prior.day ?? 0)) day = inferredRollover;
  // REGENERATE DAY-STABILITY: when re-folding a turn that already existed (edit/
  // regenerate), the NOW line injected the pre-rollback day as authoritative, so
  // the model tends to step PAST it — ratcheting the calendar forward on every
  // regenerate. Clamp the re-folded day to what this turn previously held, unless
  // the prose carries a genuine skip cue (then the leap is intended). Never below
  // the prior day (that's reconcileDay's floor).
  if (opts?.dayCap !== undefined && !dayAdvanceEvidence) {
    // dayCap is the date this exact turn held before an edit/regeneration. Keep
    // it when the new block tries to ratchet beyond it; this preserves the turn's
    // established date without letting a fresh unsupported increment stick.
    const reportedBeyondCap = parsed.day !== undefined && parsed.day > opts.dayCap;
    if (reportedBeyondCap || day > opts.dayCap) day = Math.max(prior.day ?? 0, opts.dayCap);
  }
  const ctx: ExtractCtx = { turn, day, state: prior, prose, seq: nextSeq, ...(opts?.tone ? { tone: opts.tone } : {}), ...(opts?.userCanon ? { userCanon: opts.userCanon } : {}), ...(opts?.locks?.length ? { locks: opts.locks } : {}), ...(opts?.personaState ? { personaState: true } : {}), ...(opts?.userInput ? { userInput: opts.userInput } : {}), ...(opts?.agency ? { agency: opts.agency } : {}), ...(opts?.parallelCanonLabels?.length ? { parallelCanonLabels: opts.parallelCanonLabels } : {}) };

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

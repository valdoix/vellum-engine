import { spanLabelHours } from './date-format.js';

/**
 * Ordered sub-day clock — the code-level companion to the free-text `scene.time`
 * string. Time-of-day is modelled as minutes-since-midnight (0..1439) so the
 * engine (not just prose) can enforce "time only moves forward", order same-day
 * beats, and reason about elapsed hours. PURE: no I/O, no host calls.
 *
 * `parseClock` derives an ORDER from legacy/free text, while an established
 * numeric clock is the display and recall authority. Everything is best-effort
 * and optional — an unparseable time yields `undefined` and callers retain the
 * existing value, so nothing here can break a fold.
 */

/** Canonical coarse time-of-day slots → minutes-since-midnight (slot centre). */
export const CLOCK_SLOTS: Readonly<Record<string, number>> = {
  'dawn': 300,          // 05:00
  'sunrise': 330,       // 05:30
  'morning': 540,       // 09:00
  'midday': 720,        // 12:00
  'noon': 720,          // 12:00
  'midday-sun': 720,
  'afternoon': 900,     // 15:00
  'dusk': 1140,         // 19:00
  'sunset': 1140,       // 19:00
  'twilight': 1170,     // 19:30
  'evening': 1230,      // 20:30
  'night': 1320,        // 22:00
  'midnight': 0,        // 00:00
  'late-night': 90,     // 01:30
  'predawn': 240,       // 04:00
};

// slot keywords longest-first so "late-night" beats "night" and "midday" beats "day"
const SLOT_KEYS = Object.keys(CLOCK_SLOTS).sort((a, b) => b.length - a.length);

/**
 * Map a free-text `scene.time` to minutes-since-midnight, or undefined when no
 * order can be read. Tries, in order: a clock time ("9:47 PM", "21:47"), then a
 * coarse slot keyword ("dusk", "late night"). Whitespace/hyphen tolerant.
 */
export function parseClock(time: string | undefined): number | undefined {
  if (!time) return undefined;
  const raw = String(time).trim().toLowerCase();
  if (!raw) return undefined;

  // explicit clock: "9:47 pm", "21:47", "9 pm", "noon"
  const hm = raw.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (hm) {
    let h = parseInt(hm[1]!, 10);
    const m = hm[2] ? parseInt(hm[2], 10) : 0;
    const ap = hm[3];
    if (h >= 0 && h <= 24 && m >= 0 && m < 60) {
      if (ap === 'pm' && h < 12) h += 12;
      else if (ap === 'am' && h === 12) h = 0;
      if (h === 24) h = 0;
      // a bare "5" with no am/pm and no colon is ambiguous — only trust it when
      // it carried a minute or a meridiem; otherwise fall through to slot match.
      if (ap || hm[2]) return (h % 24) * 60 + m;
    }
  }

  // coarse slot keyword (normalize spaces/underscores to hyphens for "late night")
  const norm = raw.replace(/[_\s]+/g, '-');
  for (const key of SLOT_KEYS) {
    if (norm.includes(key)) return CLOCK_SLOTS[key];
  }
  return undefined;
}

/** Inverse of parseClock for display: nearest coarse slot label for minutes. */
export function clockLabel(minutes: number | undefined): string {
  if (minutes === undefined || !Number.isFinite(minutes)) return '';
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  // pick the canonical (non-alias) slot whose centre is closest
  const canon: Array<[string, number]> = [
    ['late-night', 90], ['dawn', 300], ['morning', 540], ['midday', 720],
    ['afternoon', 900], ['dusk', 1140], ['evening', 1230], ['night', 1320],
  ];
  let best = canon[0]!; let bestD = Infinity;
  for (const c of canon) {
    // circular distance on a 1440-min day
    const d = Math.min(Math.abs(m - c[1]), 1440 - Math.abs(m - c[1]));
    if (d < bestD) { bestD = d; best = c; }
  }
  return best[0];
}

/** Exact HH:MM rendering for the canonical numeric clock. Keeping this in one
 * place prevents a stale legacy `scene.time` label from disagreeing with the
 * ordered clock in Now, Chronicle, exports, or reducer replay. */
export function clockTime(minutes: number | undefined): string {
  if (minutes === undefined || !Number.isFinite(minutes)) return '';
  const m = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** A canonical clock may never regress on the same narrative day. Keeping this
 * at zero makes even a one-minute rollback visible to the continuity guard; the
 * reducer separately clamps it so invalid model output cannot become NOW. */
export const CLOCK_TOLERANCE = 0;

/**
 * True when the new scene reads as an EARLIER time on the SAME narrative day than
 * the prior scene (a likely continuity slip). Only fires when both clocks are
 * known, the day did not advance, and the backward step exceeds the jitter
 * tolerance. A day advance (newDay > priorDay) is never backward.
 */
export function detectBackwardClock(priorDay: number, priorMin: number | undefined, newDay: number, newMin: number | undefined): boolean {
  if (priorMin === undefined || newMin === undefined) return false;
  if (newDay > priorDay) return false;      // a new day legitimately resets the clock
  if (newDay < priorDay) return false;      // handled by the day-backward guard
  return newMin < priorMin - CLOCK_TOLERANCE;
}

/**
 * A day-advance cue in prose ("the next morning", "weeks later", "at dawn the
 * following day"): used to distinguish a legitimate clock rollover (time wrapped
 * past midnight into a new day) from a slip. Deliberately narrow to keep the
 * false-positive rate low.
 */
export function hasDayAdvanceCue(text: string | undefined): boolean {
  if (!text) return false;
  // A month/day label ("October 17") is deliberately NOT a generic advance
  // cue. The number 17 is a calendar day-of-month, not VELLUM's elapsed story
  // day count. Treating it as permission for any forward count is what allowed
  // a story still on Day 2 to jump to Day 17.
  return /\b(next|following)\s+(morning|day|dawn|week|month|year)\b|\b(days?|weeks?|months?|years?)\s+(later|after|pass|passed|hence)\b|\bthe\s+next\s+day\b|\bfollowing\s+(morning|day)\b|\blater\s+that\s+(week|month|year)\b|\b(after|past)\s+midnight\b|\bovernight\b|\bday\s+\d+\b|\b(?:on|by|until|come)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text);
}

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20,
};
const DURATION_AMOUNT = '(?:\\d+(?:\\.\\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|an?)';
const DURATION_UNITS = '(?:minutes?|mins?|hours?|hrs?|days?|weeks?)';
const DURATION_SPAN = `(?:half\\s+(?:an?\\s+)?hour|(?:a\\s+)?quarter\\s+(?:of\\s+)?(?:an?\\s+)?hour|${DURATION_AMOUNT}\\s+${DURATION_UNITS})`;

/** Largest explicit elapsed duration stated in text. This intentionally ignores
 * vague phrases such as "a while" or "hours seemed to pass": only an amount the
 * engine can use as evidence is returned. Multiple mentions are not summed,
 * because they may describe concurrent action or repeat the same interval. */
export function explicitElapsedMinutes(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const raw = String(text).normalize('NFKC').toLocaleLowerCase();
  const values: number[] = [];
  if (/\bhalf\s+(?:an?\s+)?hour\b|\bthirty\s+minutes?\b/.test(raw)) values.push(30);
  if (/\b(?:a\s+)?quarter\s+(?:of\s+)?(?:an?\s+)?hour\b|\bfifteen\s+minutes?\b/.test(raw)) values.push(15);
  const amount = `(${DURATION_AMOUNT.slice(3, -1)})`;
  const units: Readonly<Record<string, number>> = {
    minute: 1, minutes: 1, min: 1, mins: 1,
    hour: 60, hours: 60, hr: 60, hrs: 60,
    day: 1440, days: 1440,
    week: 10080, weeks: 10080,
  };
  const re = new RegExp(`\\b${amount}\\s+(minutes?|mins?|hours?|hrs?|days?|weeks?)\\b`, 'g');
  for (const match of raw.matchAll(re)) {
    const token = match[1]!;
    // "half an hour" was already recorded as 30 above; do not also read its
    // trailing "an hour" as a separate 60-minute duration.
    if ((token === 'a' || token === 'an') && raw.slice(0, match.index).endsWith('half ')) continue;
    const numeric = /^\d/.test(token) ? Number(token) : (token === 'a' || token === 'an' ? 1 : NUMBER_WORDS[token]);
    const multiplier = units[match[2]!]!;
    if (numeric !== undefined && Number.isFinite(numeric)) values.push(numeric * multiplier);
  }
  return values.length ? Math.max(...values) : undefined;
}

/** Require the amount to describe completed passage rather than merely appear in
 * dialogue, a deadline, or a future plan ("come back in five minutes"). */
function hasElapsedPassageSyntax(text: string): boolean {
  const raw = text.normalize('NFKC').toLocaleLowerCase();
  return new RegExp(`\\b(?:after|for|over|during)\\s+(?:about\\s+|roughly\\s+|nearly\\s+|another\\s+)?${DURATION_SPAN}\\b`).test(raw)
    || new RegExp(`\\b(?:waits?|waited|waiting|sleeps?|slept|sleeping|rests?|rested|resting|works?|worked|working|travels?|traveled|travelled|traveling|travelling|takes?|took|spends?|spent)\\b[^.!?\\n]{0,40}\\b${DURATION_SPAN}\\b`).test(raw)
    || new RegExp(`\\b${DURATION_SPAN}\\b\\s*(?:later|afterward|afterwards|pass|passes|passed|elapse|elapses|elapsed|goes by|went by|slips by|slipped by|ticks by|ticked by)\\b`).test(raw);
}

/** A duration that the current turn says has actually elapsed. This adds a few
 * common narrative phrases to the quantified parser while still excluding
 * plans and deadlines such as "come back in five minutes". */
export function completedElapsedMinutes(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const raw = String(text).normalize('NFKC').toLocaleLowerCase();
  // Quoted plans, recollections, and deadlines are not present-tense passage.
  const narrative = raw.replace(/["“][^"”\n]*["”]/g, ' ');
  const vague: number[] = [];
  if (/\b(?:a\s+)?(?:brief\s+)?moment(?:s)?\s+(?:later|passes?|passed|afterward|afterwards)\b|\bafter\s+(?:a\s+)?(?:brief\s+)?moment\b/.test(narrative)) vague.push(1);
  if (/\b(?:a\s+few|three)\s+minutes?\s+(?:later|passes?|passed|afterward|afterwards)\b|\bafter\s+(?:a\s+few|three)\s+minutes?\b/.test(narrative)) vague.push(3);
  if (/\b(?:several|some)\s+minutes?\s+(?:later|passes?|passed|afterward|afterwards)\b|\bafter\s+(?:several|some)\s+minutes?\b|\b(?:a\s+while|some\s+time)\s+later\b|\bafter\s+(?:a\s+while|some\s+time)\b/.test(narrative)) vague.push(5);
  const exact = hasElapsedPassageSyntax(narrative) ? explicitElapsedMinutes(narrative) : undefined;
  if (exact !== undefined) vague.push(exact);
  return vague.length ? Math.max(...vague) : undefined;
}

export interface ElapsedClockFloor {
  day: number;
  clock: number;
  inferred: boolean;
  elapsed?: number;
}

/** Apply completed, prose-backed duration as a floor beneath a model-reported
 * endpoint. It repairs a frozen or under-advanced clock deterministically, but
 * never rewinds a later reported endpoint and never advances from mere output.
 * Day rollover is derived only when the same passage supplies the duration. */
export function elapsedClockFloor(
  priorDay: number,
  priorClock: number | undefined,
  reportedDay: number,
  reportedClock: number,
  currentTurnText: string | undefined,
): ElapsedClockFloor {
  if (priorClock === undefined || reportedDay < priorDay) return { day: reportedDay, clock: reportedClock, inferred: false };
  const elapsedRaw = completedElapsedMinutes(currentTurnText);
  if (elapsedRaw === undefined || elapsedRaw <= 0) return { day: reportedDay, clock: reportedClock, inferred: false };
  const elapsed = Math.max(1, Math.ceil(elapsedRaw));
  const expectedAbsolute = priorDay * 1440 + priorClock + elapsed;
  const reportedAbsolute = reportedDay * 1440 + reportedClock;
  // Vague passage can repair a frozen same-day minute, but it cannot prove that
  // midnight happened. Crossing a boundary still needs a named day transition
  // or a quantified completed duration, matching supportsDayAdvance().
  if (Math.floor(expectedAbsolute / 1440) > priorDay
    && !hasDayAdvanceCue(currentTurnText)
    && !(hasElapsedPassageSyntax(String(currentTurnText)) && explicitElapsedMinutes(currentTurnText) !== undefined)) {
    return { day: reportedDay, clock: reportedClock, inferred: false, elapsed };
  }
  if (reportedAbsolute >= expectedAbsolute) return { day: reportedDay, clock: reportedClock, inferred: false, elapsed };
  return {
    day: Math.floor(expectedAbsolute / 1440),
    clock: expectedAbsolute % 1440,
    inferred: true,
    elapsed,
  };
}

/** True only when prose itself proves that the story-day count can move forward.
 * Explicit next-day, weekday, or narrative-day language is sufficient for its
 * supported span. Otherwise a quantified elapsed
 * duration must cover the proposed absolute clock difference. An earlier wall
 * clock by itself is never evidence of midnight; that was the day-creep hole. */
export function supportsDayAdvance(
  text: string | undefined,
  priorClock: number | undefined,
  newClock: number | undefined,
  dayDelta = 1,
): boolean {
  if (!text || dayDelta < 1) return false;
  // An explicit narrative count is authoritative. Other qualitative cues such
  // as "next morning" or a weekday transition establish one boundary only;
  // they cannot justify copying October 17 into state.day or a similarly large
  // unexplained jump. Multi-day changes need quantified elapsed duration.
  if (/\b(?:story|narrative)\s+day\s+\d+\b/i.test(text)) return true;
  // A bare "Day N" label is ambiguous (calendar day-of-month, chapter label,
  // quoted recollection, etc.). It can corroborate one nearby boundary, but it
  // cannot by itself authorize a multi-day leap such as Day 2 -> Day 11.
  if (/\bday\s+\d+\b/i.test(text) && dayDelta === 1) return true;
  if (hasDayAdvanceCue(text) && dayDelta === 1) return true;
  if (!hasElapsedPassageSyntax(text)) return false;
  const elapsed = explicitElapsedMinutes(text);
  if (elapsed === undefined) return false;
  // Whole-day quantified skips remain valid for legacy/coarse scenes without an
  // exact clock. A bare calendar label never reaches this path because it states
  // no elapsed duration.
  if (priorClock === undefined || newClock === undefined) return elapsed >= dayDelta * 1440;
  const required = dayDelta * 1440 + newClock - priorClock;
  return required > 0 && elapsed >= required;
}

/**
 * Suggest a day rollover: when the new time-of-day reads earlier than the prior
 * one AND prose implies a fresh day, the clock wrapped past midnight — return
 * `priorDay + 1` as the corrected day. Otherwise undefined (no rollover).
 */
export function rollover(priorDay: number, priorMin: number | undefined, newMin: number | undefined, proseCue: boolean): number | undefined {
  if (priorMin === undefined || newMin === undefined) return undefined;
  if (newMin < priorMin && proseCue) return priorDay + 1;
  return undefined;
}

/** Outcome of reconciling a model-reported day against the prior state. */
export interface DayReconcile {
  day: number;                 // the day to actually use
  flag?: { code: string; detail: string }; // advisory continuity flag, if any
}

/** How large a single-turn forward day jump is tolerated with no skip cue before
 * it is flagged for review. */
export const DAY_JUMP_LIMIT = 30;

/**
 * Sanity-check a model-reported `parsed.day` against the prior day. The day
 * counter is model-supplied and monotonic (Math.max) downstream, so a bad value
 * sticks — this guard stops blindly trusting it:
 *   - absent            → keep prior (no forced 1)
 *   - < prior           → keep prior, flag `day_backward` (model tried to rewind)
 *   - > prior with no explicit prose evidence → keep prior and flag it
 *   - otherwise         → accept
 * PURE; returns the day to use plus an optional advisory flag.
 */
export function reconcileDay(reported: number | undefined, priorDay: number, proseAdvanceEvidence: boolean, _opts?: { priorClock?: number; newClock?: number }): DayReconcile {
  const prior = priorDay > 0 ? priorDay : 0;
  if (reported === undefined || !Number.isFinite(reported)) return { day: prior || 1 };
  const day = Math.floor(reported);
  if (day < 0) return { day: prior || 1 };
  if (day < prior) {
    return { day: prior, flag: { code: 'day_backward', detail: `Model reported Day ${day} after Day ${prior}; kept Day ${prior} (time doesn't run backward).` } };
  }
  if (prior > 0 && day > prior && !proseAdvanceEvidence) {
    if (day > prior + DAY_JUMP_LIMIT) {
      return { day: prior, flag: { code: 'day_jump', detail: `Model reported Day ${day} after Day ${prior} without prose proving a time skip; kept Day ${prior}.` } };
    }
    return { day: prior, flag: { code: 'day_creep', detail: `Model advanced to Day ${day} without prose proving a new day; kept Day ${prior}.` } };
  }
  return { day };
}

/** Re-export so callers importing the clock get the hours label too. */
export { spanLabelHours };

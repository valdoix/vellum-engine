import { spanLabelHours } from './date-format.js';

/**
 * Ordered sub-day clock — the code-level companion to the free-text `scene.time`
 * string. Time-of-day is modelled as minutes-since-midnight (0..1439) so the
 * engine (not just prose) can enforce "time only moves forward", order same-day
 * beats, and reason about elapsed hours. PURE: no I/O, no host calls.
 *
 * The human string stays the source of display; `parseClock` derives an ORDER
 * from it, and `clockLabel` inverts a slot for a compact label. Everything is
 * best-effort and optional — an unparseable time simply yields `undefined` and
 * the caller falls back to the string, so nothing here can break a fold.
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

/** Tolerance (minutes) for narration jitter before a same-day clock is judged
 * to have run backward. ~30m absorbs "a little later"/"moments before" drift. */
export const CLOCK_TOLERANCE = 30;

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
  return /\b(next|following)\s+(morning|day|dawn|week|month|year)\b|\b(days?|weeks?|months?|years?)\s+(later|after|pass|passed|hence)\b|\bthe\s+next\s+day\b|\bfollowing\s+(morning|day)\b|\blater\s+that\s+(week|month|year)\b/i.test(text);
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
 *   - > prior + LIMIT with no skip cue in prose → accept (author may intend it)
 *     but flag `day_jump` for review
 *   - otherwise         → accept
 * PURE; returns the day to use plus an optional advisory flag.
 */
export function reconcileDay(reported: number | undefined, priorDay: number, proseCue: boolean, opts?: { priorClock?: number; newClock?: number }): DayReconcile {
  const prior = priorDay > 0 ? priorDay : 0;
  if (reported === undefined || !Number.isFinite(reported)) return { day: prior || 1 };
  const day = Math.floor(reported);
  if (day < 0) return { day: prior || 1 };
  if (day < prior) {
    return { day: prior, flag: { code: 'day_backward', detail: `Model reported Day ${day} after Day ${prior}; kept Day ${prior} (time doesn't run backward).` } };
  }
  if (day > prior + DAY_JUMP_LIMIT && !proseCue) {
    return { day, flag: { code: 'day_jump', detail: `Large day jump Day ${prior}\u2192${day} (+${day - prior}) with no time-skip cue in prose \u2014 confirm this leap was intended.` } };
  }
  // DAY-CREEP GUARD: a bare +1 step with NO prose day-advance cue, when the clock
  // shows time did NOT actually cross a day boundary (it's known and moved FORWARD
  // within the same day rather than wrapping past midnight), is the model nudging
  // the calendar once per turn. Keep the prior day. High-precision: only fires
  // with positive same-day clock evidence, so a legitimate advance (prose cue,
  // absent clock, or a real midnight rollover) is never frozen.
  if (day === prior + 1 && prior > 0 && !proseCue
      && opts?.priorClock !== undefined && opts.newClock !== undefined
      && opts.newClock >= opts.priorClock) {
    return { day: prior, flag: { code: 'day_creep', detail: `Model advanced to Day ${day} but the clock stayed within the same day (no rollover, no skip cue); kept Day ${prior}.` } };
  }
  return { day };
}

/** Re-export so callers importing the clock get the hours label too. */
export { spanLabelHours };

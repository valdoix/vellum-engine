/**
 * Date formatting utilities for chronicle time display.
 * Converts day numbers to various calendar formats.
 *
 * Fantasy calendars (Tier 1): the underlying structure stays Gregorian (12
 * months, real lengths, leap years) but every DISPLAY label can be renamed —
 * custom month names + an era prefix/suffix on the year ("Frostfall 5, 312 A.R.").
 */

export type DateFormat = 'day' | 'month-day-year' | 'month-day' | 'month' | 'week' | 'month-year' | 'year';

/** Optional per-chronicle naming. A ChronicleState is a structural superset, so
 * call sites can pass `state` directly as the naming source. */
export interface DateNaming {
  dateEpoch?: Date | string;      // reference date day 0 maps to
  monthNames?: string[];          // custom long month names (wraps if <12 given)
  monthNamesShort?: string[];     // custom short month names (falls back to long)
  yearPrefix?: string;            // e.g. "" or "Year "
  yearSuffix?: string;            // e.g. " A.R." or " of the Third Age"
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const MONTH_NAMES_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

/** Pick a month label from a custom list (wrapping when fewer than 12 are given
 * — a partial list like 10 fantasy months still resolves), else the default. */
function pickMonth(names: string[] | undefined, fallback: string[], month: number): string {
  const clean = (names ?? []).map((n) => String(n).trim()).filter(Boolean);
  if (clean.length) return clean[month % clean.length]!;
  return fallback[month] ?? '';
}

/**
 * Format a day number according to the specified format.
 *
 * @param day - The day number (0-based or 1-based depending on usage)
 * @param format - The desired output format
 * @param naming - Optional epoch + custom month/era names (a ChronicleState works)
 * @returns Formatted date string
 */
export function formatDate(day: number, format: DateFormat, naming?: DateNaming): string {
  if (format === 'day') {
    return `Day ${day}`;
  }

  const epoch = naming?.dateEpoch;
  // Calculate actual calendar date if epoch provided
  let calendarDate: Date;
  if (epoch) {
    calendarDate = new Date(epoch);
    if (isNaN(calendarDate.getTime())) calendarDate = new Date(1, 0, 1);
    calendarDate.setDate(calendarDate.getDate() + day);
  } else {
    // Default epoch: January 1, year 1 (fictional calendar)
    calendarDate = new Date(1, 0, 1);
    calendarDate.setDate(calendarDate.getDate() + day);
  }

  const month = calendarDate.getMonth();
  const dayOfMonth = calendarDate.getDate();
  const year = calendarDate.getFullYear();
  const monthName = pickMonth(naming?.monthNames, MONTH_NAMES, month);
  // short falls back to the custom LONG name, then the default short
  const monthShort = pickMonth(naming?.monthNamesShort, naming?.monthNames?.length ? naming.monthNames : MONTH_NAMES_SHORT, month);

  // era prefix/suffix wrap the numeric year ("312 A.R.", "Year 312")
  const yearStr = `${naming?.yearPrefix ?? ''}${year}${naming?.yearSuffix ?? ''}`;

  // Calculate week number (ISO week)
  const weekNumber = getWeekNumber(calendarDate);

  switch (format) {
    case 'month-day-year':
      return `${monthName} ${dayOfMonth}, ${yearStr}`;

    case 'month-day':
      return `${monthName} ${dayOfMonth}`;

    case 'month':
      return monthName;

    case 'week':
      return `Week ${weekNumber}`;

    case 'month-year':
      return `${monthShort} ${yearStr}`;

    case 'year':
      // no explicit era → keep the historical "Year N" label
      return (naming?.yearPrefix || naming?.yearSuffix) ? yearStr : `Year ${year}`;

    default:
      return `Day ${day}`;
  }
}

/**
 * Get ISO week number for a date.
 */
function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/**
 * Get a short label for date format options in UI.
 */
export function dateFormatLabel(format: DateFormat): string {
  switch (format) {
    case 'day': return 'Day Count (Day 1, Day 2...)';
    case 'month-day-year': return 'Month Day, Year (January 5, 2026)';
    case 'month-day': return 'Month Day (January 5)';
    case 'month': return 'Month Only (January)';
    case 'week': return 'Week Number (Week 1, Week 2...)';
    case 'month-year': return 'Month Year (Jan 2026)';
    case 'year': return 'Year Only (Year 2026)';
    default: return 'Day Count';
  }
}

/**
 * Get example output for a date format.
 */
export function dateFormatExample(format: DateFormat, naming?: DateNaming): string {
  const exampleDay = 45; // arbitrary day for example
  return formatDate(exampleDay, format, { dateEpoch: new Date(2026, 0, 1), ...naming });
}

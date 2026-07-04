/**
 * Date formatting utilities for chronicle time display.
 * Converts day numbers to various calendar formats.
 */

export type DateFormat = 'day' | 'month-day-year' | 'month-day' | 'month' | 'week' | 'month-year' | 'year';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const MONTH_NAMES_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

/**
 * Format a day number according to the specified format.
 * 
 * @param day - The day number (0-based or 1-based depending on usage)
 * @param format - The desired output format
 * @param epoch - Optional reference date to convert day offset into calendar date
 * @returns Formatted date string
 */
export function formatDate(day: number, format: DateFormat, epoch?: Date): string {
  if (format === 'day') {
    return `Day ${day}`;
  }

  // Calculate actual calendar date if epoch provided
  let calendarDate: Date;
  if (epoch) {
    calendarDate = new Date(epoch);
    calendarDate.setDate(calendarDate.getDate() + day);
  } else {
    // Default epoch: January 1, year 1 (fictional calendar)
    calendarDate = new Date(1, 0, 1);
    calendarDate.setDate(calendarDate.getDate() + day);
  }

  const month = calendarDate.getMonth();
  const dayOfMonth = calendarDate.getDate();
  const year = calendarDate.getFullYear();
  const monthName = MONTH_NAMES[month] ?? '';
  const monthShort = MONTH_NAMES_SHORT[month] ?? '';

  // Calculate week number (ISO week)
  const weekNumber = getWeekNumber(calendarDate);

  switch (format) {
    case 'month-day-year':
      return `${monthName} ${dayOfMonth}, ${year}`;
    
    case 'month-day':
      return `${monthName} ${dayOfMonth}`;
    
    case 'month':
      return monthName;
    
    case 'week':
      return `Week ${weekNumber}`;
    
    case 'month-year':
      return `${monthShort} ${year}`;
    
    case 'year':
      return `Year ${year}`;
    
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
export function dateFormatExample(format: DateFormat): string {
  const exampleDay = 45; // arbitrary day for example
  const exampleEpoch = new Date(2026, 0, 1); // Jan 1, 2026
  return formatDate(exampleDay, format, exampleEpoch);
}

import { parseClock } from '../domain/clock.js';

/**
 * Scene-visual classifier — turns the model's free-text scene.weather and
 * scene.time into a small, stable set of buckets the CSS scene band renders as
 * an illustration (gradient + particles + light source). Pure + deterministic
 * so it can be unit-tested and reused by drawer + float.
 *
 * BEAUTY leg of Story·Beauty·Memory: the header stops being a label and becomes
 * a living picture that answers "what does it feel like in the room right now?".
 */

export type WeatherClass = 'clear' | 'cloud' | 'rain' | 'storm' | 'snow' | 'fog';
export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';

/** Map free weather text to a bucket. Order matters: the most specific /
 * most dramatic wins (storm before rain before cloud). Default: clear. */
export function weatherClass(w: string | undefined | null): WeatherClass {
  const s = String(w ?? '').toLowerCase();
  if (!s.trim()) return 'clear';
  if (/(storm|thunder|lightning|tempest|gale|squall|monsoon)/.test(s)) return 'storm';
  if (/(snow|sleet|blizzard|flurr|hail|frost|ice|wintry)/.test(s)) return 'snow';
  if (/(fog|mist|haze|smog|murk|smoke|vapou?r)/.test(s)) return 'fog';
  if (/(rain|drizzle|shower|downpour|pour|wet|monsoon|deluge)/.test(s)) return 'rain';
  if (/(cloud|overcast|grey|gray|dull|leaden|gloom)/.test(s)) return 'cloud';
  if (/(clear|sun|bright|fair|blue sky|starlit|starry|cloudless|crisp)/.test(s)) return 'clear';
  return 'clear';
}

/** Map an exact clock to the four visual light bands. The broad thresholds keep
 * dawn and dusk visible long enough to read while ensuring an exact night clock
 * never falls through to the daytime default. */
function timeOfDayFromClock(minutes: number): TimeOfDay {
  const m = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  if (m >= 270 && m < 450) return 'dawn';   // 04:30–07:29
  if (m >= 450 && m < 1050) return 'day';  // 07:30–17:29
  if (m >= 1050 && m < 1230) return 'dusk'; // 17:30–20:29
  return 'night';
}

/** Map canonical scene.clock (preferred) or free scene.time text to a visual
 * bucket. Exact 24-hour and 12-hour strings are parsed before word labels.
 * Default: day when the scene has no usable time at all. */
export function timeOfDay(t: string | undefined | null, clock?: number | null): TimeOfDay {
  if (typeof clock === 'number' && Number.isFinite(clock) && clock >= 0 && clock <= 1439) {
    return timeOfDayFromClock(clock);
  }
  const s = String(t ?? '').toLowerCase();
  if (!s.trim()) return 'day';
  const parsed = parseClock(s);
  if (parsed !== undefined) return timeOfDayFromClock(parsed);
  if (/(dawn|sunrise|daybreak|first light|early morning|cockcrow|aurora)/.test(s)) return 'dawn';
  if (/(dusk|sunset|twilight|evening|gloaming|nightfall|vesper)/.test(s)) return 'dusk';
  if (/(night|midnight|dead of|witching|nocturn|small hours|moonlit|starlit)/.test(s)) return 'night';
  if (/(noon|midday|afternoon|morning|daylight|daytime|day)/.test(s)) return 'day';
  return 'day';
}

/** Convenience: the pair of data-attrs the band reads. */
export function sceneVisual(weather: string | undefined | null, time: string | undefined | null, clock?: number | null): { weather: WeatherClass; tod: TimeOfDay } {
  return { weather: weatherClass(weather), tod: timeOfDay(time, clock) };
}

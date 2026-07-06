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

/** Map free time text to a time-of-day bucket. Default: day. */
export function timeOfDay(t: string | undefined | null): TimeOfDay {
  const s = String(t ?? '').toLowerCase();
  if (!s.trim()) return 'day';
  if (/(dawn|sunrise|daybreak|first light|early morning|cockcrow|aurora)/.test(s)) return 'dawn';
  if (/(dusk|sunset|twilight|evening|gloaming|nightfall|vesper)/.test(s)) return 'dusk';
  if (/(night|midnight|dead of|witching|nocturn|small hours|moonlit|starlit)/.test(s)) return 'night';
  if (/(noon|midday|afternoon|morning|daylight|daytime|day)/.test(s)) return 'day';
  return 'day';
}

/** Convenience: the pair of data-attrs the band reads. */
export function sceneVisual(weather: string | undefined | null, time: string | undefined | null): { weather: WeatherClass; tod: TimeOfDay } {
  return { weather: weatherClass(weather), tod: timeOfDay(time) };
}

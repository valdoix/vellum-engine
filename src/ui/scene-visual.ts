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

export type WeatherClass = 'clear' | 'cloud' | 'wind' | 'rain' | 'storm' | 'snow' | 'fog';
export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';
export type LightPhase = 'night' | 'pre-dawn' | 'dawn' | 'morning' | 'midday' | 'afternoon' | 'golden-hour' | 'dusk';

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
  if (/(wind|breez|gust|bluster)/.test(s)) return 'wind';
  if (/(clear|sun|bright|fair|blue sky|starlit|starry|cloudless|crisp)/.test(s)) return 'clear';
  return 'clear';
}

/** Exact-clock visual phase. These are deliberately narrower than the four
 * semantic time-of-day buckets: the scene art must visibly move through a long
 * roleplay day instead of showing one identical "day" sky for ten hours. */
function lightPhaseFromClock(minutes: number): LightPhase {
  const m = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  if (m >= 270 && m < 330) return 'pre-dawn';    // 04:30–05:29
  if (m >= 330 && m < 450) return 'dawn';        // 05:30–07:29
  if (m >= 450 && m < 660) return 'morning';     // 07:30–10:59
  if (m >= 660 && m < 840) return 'midday';      // 11:00–13:59
  if (m >= 840 && m < 1020) return 'afternoon';  // 14:00–16:59
  if (m >= 1020 && m < 1110) return 'golden-hour'; // 17:00–18:29
  if (m >= 1110 && m < 1230) return 'dusk';      // 18:30–20:29
  return 'night';
}

function phaseTimeOfDay(phase: LightPhase): TimeOfDay {
  if (phase === 'pre-dawn' || phase === 'dawn') return 'dawn';
  if (phase === 'golden-hour' || phase === 'dusk') return 'dusk';
  if (phase === 'night') return 'night';
  return 'day';
}

/** Resolve the detailed visual phase from canonical clock first, then exact
 * time strings, then prose labels. Empty/unknown legacy state uses midday. */
export function lightPhase(t: string | undefined | null, clock?: number | null): LightPhase {
  if (typeof clock === 'number' && Number.isFinite(clock) && clock >= 0 && clock <= 1439) {
    return lightPhaseFromClock(clock);
  }
  const s = String(t ?? '').toLowerCase();
  if (!s.trim()) return 'midday';
  const parsed = parseClock(s);
  if (parsed !== undefined) return lightPhaseFromClock(parsed);
  if (/(pre[- ]?dawn|before dawn|first hint of light|small hours|cockcrow)/.test(s)) return 'pre-dawn';
  if (/(dawn|sunrise|daybreak|first light|aurora)/.test(s)) return 'dawn';
  if (/(golden hour|late afternoon)/.test(s)) return 'golden-hour';
  if (/(morning)/.test(s)) return 'morning';
  if (/(noon|midday)/.test(s)) return 'midday';
  if (/(afternoon|daylight|daytime|\bday\b)/.test(s)) return 'afternoon';
  if (/(dusk|sunset|twilight|evening|gloaming|nightfall|vesper)/.test(s)) return 'dusk';
  if (/(night|midnight|dead of|witching|nocturn|moonlit|starlit)/.test(s)) return 'night';
  return 'midday';
}

/** Map canonical scene.clock (preferred) or free scene.time text to a visual
 * bucket. Exact 24-hour and 12-hour strings are parsed before word labels.
 * Default: day when the scene has no usable time at all. */
export function timeOfDay(t: string | undefined | null, clock?: number | null): TimeOfDay {
  return phaseTimeOfDay(lightPhase(t, clock));
}

/** Convenience: the pair of data-attrs the band reads. */
export function sceneVisual(weather: string | undefined | null, time: string | undefined | null, clock?: number | null): { weather: WeatherClass; tod: TimeOfDay; phase: LightPhase } {
  const phase = lightPhase(time, clock);
  return { weather: weatherClass(weather), tod: phaseTimeOfDay(phase), phase };
}

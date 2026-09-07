import { describe, it, expect } from 'vitest';
import { weatherClass, timeOfDay, lightPhase, sceneVisual } from '../src/ui/scene-visual.js';
import { dashboardHtml } from '../src/ui/dashboard.js';
import { freshState } from '../src/domain/types.js';
import { STYLES } from '../src/ui/styles.js';

describe('scene-visual classifier', () => {
  it('weather buckets: most dramatic / specific wins', () => {
    expect(weatherClass('a sudden thunderstorm')).toBe('storm');
    expect(weatherClass('driving rain')).toBe('rain');
    expect(weatherClass('light drizzle')).toBe('rain');
    expect(weatherClass('heavy snow, blizzard')).toBe('snow');
    expect(weatherClass('a thick fog rolls in')).toBe('fog');
    expect(weatherClass('grey and overcast')).toBe('cloud');
    expect(weatherClass('a warm coastal breeze')).toBe('wind');
    expect(weatherClass('clear starlit sky')).toBe('clear');
  });

  it('weather defaults to clear on empty/unknown', () => {
    expect(weatherClass('')).toBe('clear');
    expect(weatherClass(null)).toBe('clear');
    expect(weatherClass(undefined)).toBe('clear');
    expect(weatherClass('serene')).toBe('clear');
  });

  it('storm beats rain even when both words present', () => {
    expect(weatherClass('rain and thunder')).toBe('storm');
  });

  it('time-of-day buckets', () => {
    expect(timeOfDay('dawn')).toBe('dawn');
    expect(timeOfDay('first light over the hills')).toBe('dawn');
    expect(timeOfDay('high noon')).toBe('day');
    expect(timeOfDay('afternoon')).toBe('day');
    expect(timeOfDay('dusk')).toBe('dusk');
    expect(timeOfDay('the gloaming')).toBe('dusk');
    expect(timeOfDay('dead of night')).toBe('night');
    expect(timeOfDay('midnight')).toBe('night');
  });

  it('classifies exact 24-hour and 12-hour clocks instead of defaulting to day', () => {
    expect(timeOfDay('05:45')).toBe('dawn');
    expect(timeOfDay('12:10')).toBe('day');
    expect(timeOfDay('18:20')).toBe('dusk');
    expect(timeOfDay('22:07')).toBe('night');
    expect(timeOfDay('1:30 AM')).toBe('night');
    expect(timeOfDay('6:15 PM')).toBe('dusk');
  });

  it('uses the canonical numeric clock when a stale display label disagrees', () => {
    expect(timeOfDay('morning', 22 * 60)).toBe('night');
    expect(sceneVisual('storm', 'morning', 18 * 60)).toEqual({ weather: 'storm', tod: 'dusk', phase: 'golden-hour' });
  });

  it('moves a long story day through visibly distinct clock phases', () => {
    // Real long-session clocks must not collapse back into one all-day picture.
    const phases = [375, 482, 810, 840, 955].map((clock) => lightPhase('', clock));
    expect(phases).toEqual(['dawn', 'morning', 'midday', 'afternoon', 'afternoon']);
    expect(new Set(phases).size).toBe(4);
  });

  it('time defaults to day on empty/unknown', () => {
    expect(timeOfDay('')).toBe('day');
    expect(timeOfDay(null)).toBe('day');
    expect(timeOfDay('sometime')).toBe('day');
  });

  it('sceneVisual pairs both', () => {
    expect(sceneVisual('rain', 'dusk')).toEqual({ weather: 'rain', tod: 'dusk', phase: 'dusk' });
    expect(sceneVisual('', '')).toEqual({ weather: 'clear', tod: 'day', phase: 'midday' });
  });

  it('renders the shared Now/float scene band from weather and canonical clock', () => {
    const state = freshState();
    state.scene.weather = 'driving rain';
    state.scene.time = 'morning'; // stale legacy label must not pin the artwork
    state.scene.clock = 22 * 60;
    const html = dashboardHtml(state);
    expect(html).toContain('data-weather="rain"');
    expect(html).toContain('data-tod="night"');
    expect(html).toContain('data-phase="night"');
  });

  it('ships a distinct palette for every clock phase and a visible sky cast for weather', () => {
    for (const phase of ['pre-dawn', 'dawn', 'morning', 'midday', 'afternoon', 'golden-hour', 'dusk', 'night']) {
      expect(STYLES).toContain(`.vld-band[data-phase='${phase}']`);
    }
    for (const weather of ['cloud', 'wind', 'rain', 'storm', 'snow', 'fog']) {
      expect(STYLES).toContain(`.vld-band[data-weather='${weather}']{--weather-sky:`);
    }
  });
});

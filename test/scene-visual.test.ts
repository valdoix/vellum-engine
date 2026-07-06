import { describe, it, expect } from 'vitest';
import { weatherClass, timeOfDay, sceneVisual } from '../src/ui/scene-visual.js';

describe('scene-visual classifier', () => {
  it('weather buckets: most dramatic / specific wins', () => {
    expect(weatherClass('a sudden thunderstorm')).toBe('storm');
    expect(weatherClass('driving rain')).toBe('rain');
    expect(weatherClass('light drizzle')).toBe('rain');
    expect(weatherClass('heavy snow, blizzard')).toBe('snow');
    expect(weatherClass('a thick fog rolls in')).toBe('fog');
    expect(weatherClass('grey and overcast')).toBe('cloud');
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
    expect(timeOfDay('late afternoon')).toBe('day');
    expect(timeOfDay('dusk')).toBe('dusk');
    expect(timeOfDay('the gloaming')).toBe('dusk');
    expect(timeOfDay('dead of night')).toBe('night');
    expect(timeOfDay('midnight')).toBe('night');
  });

  it('time defaults to day on empty/unknown', () => {
    expect(timeOfDay('')).toBe('day');
    expect(timeOfDay(null)).toBe('day');
    expect(timeOfDay('sometime')).toBe('day');
  });

  it('sceneVisual pairs both', () => {
    expect(sceneVisual('rain', 'dusk')).toEqual({ weather: 'rain', tod: 'dusk' });
    expect(sceneVisual('', '')).toEqual({ weather: 'clear', tod: 'day' });
  });
});

import { describe, it, expect } from 'vitest';
import { reduce } from '../src/core/reduce.js';
import { freshState } from '../src/domain/types.js';
import { migrate } from '../src/core/migrate.js';
import { SCHEMA_VERSION } from '../src/core/events.js';
import { locationList, injectableLocations } from '../src/domain/locations.js';
import type { VellumEvent } from '../src/core/events.js';

let seq = 0;
const sf = () => ++seq;
const ev = (e: Partial<VellumEvent>): VellumEvent => ({ seq: sf(), turn: 5, day: 1, src: 'model', ...(e as object) } as VellumEvent);

describe('locations — reduce', () => {
  it('location.set adds, dedupes by normalized name, updates note/lastTurn', () => {
    const s = reduce([
      ev({ kind: 'location.set', id: 'loc_solar', name: 'The Solar', auto: true, turn: 2 }),
      ev({ kind: 'location.set', id: 'loc_solar2', name: 'the solar', note: 'upper keep', turn: 5 }),
    ]);
    expect(s.locations).toHaveLength(1);
    expect(s.locations[0]!.note).toBe('upper keep');
    expect(s.locations[0]!.lastTurn).toBe(5);
  });

  it('a user edit (auto:false) is not downgraded by a later auto refresh', () => {
    const s = reduce([
      ev({ kind: 'location.set', id: 'l1', name: 'Docks', note: 'mine', auto: false, turn: 1 }),
      ev({ kind: 'location.set', id: 'l2', name: 'docks', auto: true, turn: 3 }),
    ]);
    expect(s.locations).toHaveLength(1);
    expect(s.locations[0]!.auto).toBe(false); // stays pinned
    expect(s.locations[0]!.note).toBe('mine');
  });

  it('location.drop removes', () => {
    const s = reduce([ev({ kind: 'location.set', id: 'l1', name: 'Gate', turn: 1 }), ev({ kind: 'location.drop', id: 'l1' })]);
    expect(s.locations).toHaveLength(0);
  });
});

describe('locationList injector', () => {
  it('empty → ""', () => { expect(locationList(freshState())).toBe(''); });

  it('renders names + notes and caps to most-recent (pinned always kept)', () => {
    const s = freshState();
    for (let i = 1; i <= 20; i++) s.locations.push({ id: 'a' + i, name: 'Place ' + i, auto: true, firstTurn: i, lastTurn: i });
    s.locations.push({ id: 'pin', name: 'Pinned Hall', note: 'always', auto: false, firstTurn: 1, lastTurn: 1 });
    const inj = injectableLocations(s, 5);
    expect(inj.length).toBe(5);
    expect(inj.some((l) => l.id === 'pin')).toBe(true); // pinned kept despite old lastTurn
    const block = locationList(s, 5);
    expect(block).toContain('LOCATIONS');
    expect(block).toContain('Pinned Hall \u2014 always');
  });
});

describe('continuity flag log — reduce ring buffer', () => {
  it('appends flags and caps at 50', () => {
    const evs: VellumEvent[] = [];
    for (let i = 0; i < 60; i++) evs.push(ev({ kind: 'continuity.flag', turn: i, code: 'redundant_knowledge', detail: 'x' + i }));
    const s = reduce(evs);
    expect(s.continuityFlags).toHaveLength(50);
    expect(s.continuityFlags[49]!.detail).toBe('x59'); // newest kept
  });
});

describe('migration v9 → v10', () => {
  it('advances version; reduce yields empty locations/flags', () => {
    const log = migrate({ version: 9, chatId: 'c', events: [], createdAt: 1, updatedAt: 1 }) as any;
    expect(log.version).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(10);
    const s = reduce([]);
    expect(s.locations).toEqual([]);
    expect(s.continuityFlags).toEqual([]);
  });
});

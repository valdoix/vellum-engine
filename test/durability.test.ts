import { describe, it, expect } from 'vitest';
import { lenientLog } from '../src/store/chronicle.js';
import { reduce } from '../src/core/reduce.js';

// a realistic mixed log: valid events + one malformed + a future/unknown-ish one
const GOOD = [
  { seq: 1, turn: 1, day: 1, src: 'model', kind: 'cast.seen', id: 'cersei', name: 'Cersei', status: 'present' },
  { seq: 2, turn: 1, day: 1, src: 'model', kind: 'bond.delta', a: 'cersei', b: 'jaime', aff: 20, trust: 10 },
  { seq: 3, turn: 2, day: 1, src: 'living', kind: 'knowledge.learn', who: 'ned', fact: 'the truth' },
];
const BAD = { seq: 4, turn: 2, day: 1, src: 'model', kind: 'bond.delta', a: 'x', b: 'y', aff: 9999 }; // aff out of range

describe('durability: lenient log loading', () => {
  it('keeps valid events, drops only the malformed one (never wipes)', () => {
    const { log, dropped, usable } = lenientLog({ version: 2, events: [...GOOD, BAD] }, 'c1');
    expect(usable).toBe(true);
    expect(dropped).toBe(1);
    expect(log.events).toHaveLength(3);
    const s = reduce(log.events);
    expect(s.cast.cersei).toBeTruthy();
    expect(s.relations).toHaveLength(1);
    expect(s.knowledge).toHaveLength(1);
  });

  it('a v1 log (no version/timestamps) still loads via migrate', () => {
    const { log, usable } = lenientLog({ events: GOOD }, 'c1');
    expect(usable).toBe(true);
    expect(log.events).toHaveLength(3);
    expect(typeof log.createdAt).toBe('number');
  });

  it('an unrecognized shape (no events array) is marked unusable, not coerced', () => {
    const { usable, log } = lenientLog({ foo: 'bar' }, 'c1');
    expect(usable).toBe(false);   // caller will go READ-ONLY, never overwrite
    expect(log.events).toHaveLength(0);
  });

  it('an all-bad event array yields an empty-but-usable log (kept good=0, not unusable)', () => {
    const { usable, dropped, log } = lenientLog({ version: 2, events: [BAD, { kind: 'nonsense' }] }, 'c1');
    expect(usable).toBe(true);
    expect(dropped).toBe(2);
    expect(log.events).toHaveLength(0);
  });

  it('a log from a NEWER schema is unusable (read-only), never parsed-and-pruned', () => {
    // forward-compat guard: version > code SCHEMA_VERSION must not drop unknown
    // events then let a later persist clobber the good file.
    const { usable, log } = lenientLog({ version: 9999, events: GOOD }, 'c1');
    expect(usable).toBe(false);
    expect(log.events).toHaveLength(0);
  });

  it('v2 → v3 migration rewrites historical bond.drop to both:true', () => {
    const drop = { seq: 5, turn: 3, day: 1, src: 'model', kind: 'bond.drop', a: 'cersei', b: 'jaime' };
    const { log, usable } = lenientLog({ version: 2, events: [...GOOD, drop] }, 'c1');
    expect(usable).toBe(true);
    const migrated = log.events.find((e) => e.kind === 'bond.drop') as any;
    expect(migrated?.both).toBe(true); // ended bonds stay fully severed under directional reduce
  });

  it('v3 → v4: a bare knowledge.learn (no epistemic fields) loads and defaults', () => {
    const know = { seq: 6, turn: 2, day: 1, src: 'living', kind: 'knowledge.learn', who: 'ned', fact: 'a thing' };
    const { log, usable } = lenientLog({ version: 3, events: [...GOOD, know] }, 'c1');
    expect(usable).toBe(true);
    const k = log.events.find((e) => e.kind === 'knowledge.learn') as any;
    expect(k).toBeTruthy();
    expect(k.reliability).toBeUndefined(); // optional on the event; reduce applies 'knows'/'unknown'
  });
});

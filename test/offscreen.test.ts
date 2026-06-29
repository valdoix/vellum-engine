import { describe, it, expect } from 'vitest';
import { offscreenCast, buildSimPrompt, parseSim, simEvents, SIM_SYS } from '../src/domain/offscreen.js';
import { reduce } from '../src/core/reduce.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';

function state(): ChronicleState {
  const s = freshState();
  s.turns = 12;
  s.scene = { location: 'The Hall', time: 'night', tension: 5, weather: '', present: ['cersei'], detail: [] } as any;
  s.cast = {
    cersei: { id: 'cersei', name: 'Cersei', aka: [], status: 'present', source: 'auto', firstTurn: 1, lastTurn: 12, userEdited: false },
    jaime: { id: 'jaime', name: 'Jaime', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 10, userEdited: false },
    tyrion: { id: 'tyrion', name: 'Tyrion', aka: [], status: 'mentioned', source: 'auto', firstTurn: 1, lastTurn: 11, userEdited: false },
    robert: { id: 'robert', name: 'Robert', aka: [], status: 'mentioned', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false },
  } as any;
  return s;
}

describe('offscreenCast', () => {
  it('returns non-present known characters; includes recently-mentioned, excludes stale + present', () => {
    const ids = offscreenCast(state()).map((c) => c.id);
    expect(ids).toContain('jaime');   // active, off-screen
    expect(ids).toContain('tyrion');  // recently mentioned (lastTurn 11, recent>=0)
    expect(ids).not.toContain('cersei'); // present
    expect(ids).not.toContain('robert'); // mentioned but stale (lastTurn 1)
  });
});

describe('buildSimPrompt', () => {
  it('lists off-screen cast, open subplots, and forbidden locks', () => {
    const s = state();
    s.offscreen = [{ id: 'jaime_doubt', name: 'Jaime weighs loyalty', status: 'active', gist: 'pacing the yard', beats: ['pacing the yard'], firstTurn: 8, lastTurn: 10 }] as any;
    const p = buildSimPrompt(s, offscreenCast(s), { locks: [{ key: 'cersei|jaime', a: 'Cersei', b: 'Jaime', forbid: ['romantic'], pin: [] }], tone: { disposition: 'harsh' } });
    expect(p).toContain('Jaime');
    expect(p).toContain('jaime_doubt');       // existing subplot offered for advance
    expect(p).toContain('FORBIDDEN');
    expect(p).toContain('harsh');
  });
});

describe('parseSim', () => {
  it('parses offscreen ops, slugs ids, caps to 4', () => {
    const r = parseSim('```json\n{"offscreen":[{"op":"new","name":"The Siege","gist":"walls hold"},{"op":"advance","id":"x","gist":"a"},{"op":"resolve","id":"y"},{"op":"new","id":"z","gist":"c"},{"op":"new","id":"w","gist":"d"}]}\n```')!;
    expect(r).not.toBeNull();
    expect(r.offscreen).toHaveLength(4);
    expect(r.offscreen[0]!.id).toBe('the_siege'); // slugged from name
  });
  it('returns null on garbage / nothing', () => {
    expect(parseSim('not json')).toBeNull();
    expect(parseSim('{"offscreen":[]}')).toBeNull();
  });
});

describe('simEvents + reduce round-trip', () => {
  it('new → creates a subplot; advance by id → appends a beat; resolve → flips status', () => {
    let s = state();
    const seq = (() => { let n = 0; return () => ++n; })();
    // turn 1: new
    let evs = simEvents({ offscreen: [{ op: 'new', id: 'siege', name: 'The Siege', who: 'Jaime', gist: 'walls hold' }] }, s, 12, 1, seq);
    s = reduce(evs, s);
    expect(s.offscreen).toHaveLength(1);
    expect(s.offscreen[0]!.who).toBe('jaime'); // resolved to cast id
    expect(s.offscreen[0]!.beats).toEqual(['walls hold']);
    // turn 2: advance same id
    evs = simEvents({ offscreen: [{ op: 'advance', id: 'siege', gist: 'a breach opens' }] }, s, 13, 1, seq);
    s = reduce(evs, s);
    expect(s.offscreen[0]!.beats).toEqual(['walls hold', 'a breach opens']);
    expect(s.offscreen[0]!.gist).toBe('a breach opens');
    // turn 3: resolve
    evs = simEvents({ offscreen: [{ op: 'resolve', id: 'siege' }] }, s, 14, 1, seq);
    s = reduce(evs, s);
    expect(s.offscreen[0]!.status).toBe('resolved');
  });

  it('an advance on an unknown id becomes a new (no orphan)', () => {
    const s = state();
    const evs = simEvents({ offscreen: [{ op: 'advance', id: 'ghost', name: 'Ghost', gist: 'x' }] }, s, 12, 1, (() => { let n = 0; return () => ++n; })());
    expect((evs[0] as any).op).toBe('new');
  });
});

describe('SIM_SYS', () => {
  it('instructs subplot ops + strict JSON', () => {
    expect(SIM_SYS).toContain('STRICT JSON');
    expect(SIM_SYS.toLowerCase()).toContain('advance');
  });
});

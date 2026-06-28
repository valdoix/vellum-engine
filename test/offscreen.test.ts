import { describe, it, expect } from 'vitest';
import { offscreenCast, buildSimPrompt, parseSim, simEvents, SIM_SYS } from '../src/domain/offscreen.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';

function state(): ChronicleState {
  const s = freshState();
  s.turns = 12;
  s.scene = { location: 'The Hall', time: 'night', tension: 5, weather: '', present: ['cersei'], detail: [] } as any;
  s.cast = {
    cersei: { id: 'cersei', name: 'Cersei', aka: [], status: 'present', source: 'auto', firstTurn: 1, lastTurn: 12, userEdited: false },
    jaime: { id: 'jaime', name: 'Jaime', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 10, userEdited: false },
    tyrion: { id: 'tyrion', name: 'Tyrion', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 8, userEdited: false },
    robert: { id: 'robert', name: 'Robert', aka: [], status: 'mentioned', source: 'auto', firstTurn: 1, lastTurn: 2, userEdited: false },
  } as any;
  s.threads = [{ name: 'the poison plot', status: 'active', firstTurn: 3, lastTurn: 9 }] as any;
  return s;
}

describe('offscreenCast', () => {
  it('returns active characters not in the scene, excludes present + mentioned', () => {
    const cast = offscreenCast(state());
    const ids = cast.map((c) => c.id);
    expect(ids).toContain('jaime');
    expect(ids).toContain('tyrion');
    expect(ids).not.toContain('cersei'); // present
    expect(ids).not.toContain('robert'); // mentioned, not active
  });
});

describe('buildSimPrompt', () => {
  it('lists off-screen cast + open threads + forbidden locks', () => {
    const cast = offscreenCast(state());
    const p = buildSimPrompt(state(), cast, { locks: [{ key: 'cersei|jaime', a: 'Cersei', b: 'Jaime', forbid: ['romantic'], pin: [] }], tone: { disposition: 'harsh' } });
    expect(p).toContain('Jaime');
    expect(p).toContain('the poison plot');
    expect(p).toContain('FORBIDDEN');
    expect(p).toContain('romantic');
    expect(p).toContain('harsh');
  });
});

describe('parseSim', () => {
  it('parses fenced JSON and caps to 4 beats', () => {
    const txt = '```json\n{"parallel":[{"who":"Jaime","activity":"a"},{"who":"A","activity":"b"},{"activity":"c"},{"activity":"d"},{"activity":"e"}],"threads":[{"op":"advance","name":"the poison plot"}]}\n```';
    const r = parseSim(txt)!;
    expect(r).not.toBeNull();
    expect(r.parallel).toHaveLength(4); // capped
    expect(r.threads[0]!.op).toBe('advance');
  });
  it('returns null on garbage / no beats', () => {
    expect(parseSim('not json')).toBeNull();
    expect(parseSim('{"parallel":[],"threads":[]}')).toBeNull();
  });
});

describe('simEvents', () => {
  it('merges sim beats with existing parallel, tags src:sim, resolves names', () => {
    const s = state();
    s.parallel = [{ activity: 'model-narrated beat', turn: 11, day: 1 }] as any;
    let n = 0; const seq = () => ++n;
    const evs = simEvents({ parallel: [{ who: 'Jaime', activity: 'sharpening his sword' }], threads: [{ op: 'advance', name: 'the poison plot' }] }, s, 12, 1, seq);
    const par = evs.find((e: any) => e.kind === 'parallel.set') as any;
    expect(par.items[0].src).toBe('sim');
    expect(par.items[0].who).toBe('jaime'); // resolved to id
    expect(par.items.some((i: any) => i.activity === 'model-narrated beat')).toBe(true); // existing kept
    expect(evs.some((e: any) => e.kind === 'thread.op')).toBe(true);
  });
  it('drops thread nudges for threads that do not exist (sim cannot invent)', () => {
    const evs = simEvents({ parallel: [{ activity: 'x' }], threads: [{ op: 'advance', name: 'invented thread' }] }, state(), 12, 1, (() => { let n = 0; return () => ++n; })());
    expect(evs.some((e: any) => e.kind === 'thread.op')).toBe(false);
  });
});

describe('SIM_SYS', () => {
  it('instructs small beats + strict JSON', () => {
    expect(SIM_SYS).toContain('STRICT JSON');
    expect(SIM_SYS.toLowerCase()).toContain('small');
  });
});

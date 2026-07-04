import { describe, it, expect } from 'vitest';
import { offscreenCast, buildSimPrompt, parseSim, simEvents, SIM_SYS, simSys, threadOffscreenLink, linkedOffscreen } from '../src/domain/offscreen.js';
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

  it('focusId narrows the prompt to a single subplot (per-thread advance)', () => {
    const s = state();
    s.offscreen = [
      { id: 'jaime_doubt', name: 'Jaime weighs loyalty', status: 'active', gist: 'pacing the yard', beats: ['pacing the yard'], firstTurn: 8, lastTurn: 10 },
      { id: 'tyrion_plot', name: 'Tyrion schemes', status: 'active', gist: 'reading letters', beats: ['reading letters'], firstTurn: 9, lastTurn: 11 },
    ] as any;
    const p = buildSimPrompt(s, offscreenCast(s), { focusId: 'jaime_doubt' });
    expect(p).toContain('ADVANCE THIS ONE OFF-SCREEN SUBPLOT');
    expect(p).toContain('jaime_doubt');
    expect(p).not.toContain('tyrion_plot'); // only the focused thread is in the prompt
    expect(p).toContain('exactly one entry');
  });

  it('time-skip: an elapsed day-jump asks the sim to advance the world proportionally', () => {
    const s = state();
    s.offscreen = [{ id: 'jaime_doubt', name: 'Jaime weighs loyalty', status: 'active', gist: 'pacing', beats: ['pacing'], firstTurn: 8, lastTurn: 10 }] as any;
    // world-wide tick with a 15-day skip
    const world = buildSimPrompt(s, offscreenCast(s), { skipDays: 15 });
    expect(world).toContain('TIME-SKIP');
    expect(world).toContain('week');
    // per-thread advance carries the same signal
    const focused = buildSimPrompt(s, offscreenCast(s), { focusId: 'jaime_doubt', skipDays: 40 });
    expect(focused).toContain('TIME-SKIP');
    expect(focused).toContain('month');
    // an ordinary same-turn tick (< 2 days) stays a single beat — no skip note
    expect(buildSimPrompt(s, offscreenCast(s), { skipDays: 1 })).not.toContain('TIME-SKIP');
    expect(buildSimPrompt(s, offscreenCast(s), {})).not.toContain('TIME-SKIP');
  });
});

describe('thread <-> off-screen bridge', () => {
  it('threadOffscreenLink matches on shared title/gist tokens, not on stopwords alone', () => {
    // "The Letter" thread <-> "The Appointment" subplot whose gist mentions the letter
    expect(threadOffscreenLink('The Letter', { name: 'The Appointment', gist: 'B receives A\u2019s letter and acts on it' })).toBe(true);
    expect(threadOffscreenLink('The Letter', { name: 'A letter is delivered', gist: '' })).toBe(true);
    expect(threadOffscreenLink('The Harbor Strike', { name: 'The dockhands walk off', gist: 'the harbor strike spreads' })).toBe(true);
    // no real overlap → no link (shared "the" must not link them)
    expect(threadOffscreenLink('The Letter', { name: 'The Siege', gist: 'walls hold' })).toBe(false);
  });

  it('the sim prompt tells the sim which open threads a subplot ties into', () => {
    const s = state();
    s.threads = [{ name: 'The Letter', status: 'advance', firstTurn: 3, lastTurn: 8 }] as any;
    s.offscreen = [{ id: 'appt', name: 'The Appointment', status: 'active', gist: 'B opens the letter', beats: ['B opens the letter'], firstTurn: 8, lastTurn: 8 }] as any;
    // world-wide prompt lists the thread + flags the tie
    const world = buildSimPrompt(s, offscreenCast(s), { threads: [{ name: 'The Letter', status: 'advance' }] });
    expect(world).toContain('ON-SCREEN PLOT THREADS');
    expect(world).toContain('The Letter');
    expect(world).toContain('ties into: appt');
    // focused prompt surfaces the linked thread for that one subplot
    const focused = buildSimPrompt(s, offscreenCast(s), { focusId: 'appt', threads: [{ name: 'The Letter', status: 'advance' }] });
    expect(focused).toContain('TIES INTO ON-SCREEN PLOT THREAD');
    expect(focused).toContain('The Letter');
  });

  it('linkedOffscreen finds the active subplot feeding a thread (reflection side)', () => {
    const s = state();
    s.offscreen = [
      { id: 'appt', name: 'The Appointment', status: 'active', gist: 'B opens the letter', beats: ['x'], firstTurn: 8, lastTurn: 8 },
      { id: 'siege', name: 'The Siege', status: 'active', gist: 'walls hold', beats: ['y'], firstTurn: 8, lastTurn: 8 },
    ] as any;
    const hits = linkedOffscreen(s, { name: 'The Appointment' });
    expect(hits.map((o) => o.id)).toEqual(['appt']);
    expect(linkedOffscreen(s, { name: 'The Siege' }).map((o) => o.id)).toEqual(['siege']);
  });

  it('an explicit link overrides the text match (both directions)', () => {
    const s = state();
    s.offscreen = [
      // linked to thread id "thr_the_letter" but its NAME wouldn't text-match it
      { id: 'errand', name: 'The Errand', status: 'active', gist: 'a courier rides', beats: ['x'], thread: 'thr_the_letter', firstTurn: 8, lastTurn: 8 },
    ] as any;
    // explicit link matches by id, not name
    expect(linkedOffscreen(s, { id: 'thr_the_letter', name: 'The Letter' }).map((o) => o.id)).toEqual(['errand']);
    // a different thread whose NAME would text-match "errand" no longer links, because the explicit link wins
    expect(linkedOffscreen(s, { id: 'thr_the_errand', name: 'The Errand' })).toEqual([]);
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

describe('SIM_SYS / simSys', () => {
  it('instructs subplot ops + strict JSON', () => {
    expect(SIM_SYS).toContain('STRICT JSON');
    expect(SIM_SYS.toLowerCase()).toContain('advance');
  });
  it('off/reactive ban relationship changes; living/autonomous open the bonds channel', () => {
    expect(simSys('off')).toContain('Do NOT change any relationships');
    expect(simSys('reactive')).toContain('only shift in scenes the player witnesses');
    expect(simSys('living')).toContain('bonds');
    expect(simSys('living')).toContain('Do NOT start a new romance');
    expect(simSys('autonomous')).toContain('friendship/rivalry');
    // the JSON schema advertises a bonds array only when the level allows it
    expect(simSys('autonomous')).toContain('"bonds"');
    expect(simSys('off')).not.toContain('"bonds"');
  });
});

describe('simEvents — off-screen NPC↔NPC bonds (Social autonomy)', () => {
  const bonds = { offscreen: [], bonds: [{ a: 'Jaime', b: 'Tyrion', aff: 40, trust: 40, cat: 'social', why: 'a long night of wine' }] };
  it('off / reactive emit NO bond events', () => {
    for (const social of ['off', 'reactive'] as const) {
      const evs = simEvents(bonds as any, state(), 12, 1, (() => { let n = 0; return () => ++n; })(), { social });
      expect(evs.filter((e: any) => e.kind === 'bond.delta')).toHaveLength(0);
    }
  });
  it('living clamps aff/trust to ±6 and never adds a category; emits a companion off-screen beat', () => {
    const evs = simEvents(bonds as any, state(), 12, 1, (() => { let n = 0; return () => ++n; })(), { social: 'living' });
    const bd = evs.find((e: any) => e.kind === 'bond.delta') as any;
    expect(bd).toBeTruthy();
    expect(bd.aff).toBe(6); expect(bd.trust).toBe(6); // clamped from 40
    expect(bd.addCats).toBeUndefined();               // no category flips at living
    expect(evs.some((e: any) => e.kind === 'offscreen.op' && e.id.startsWith('bond_'))).toBe(true); // surfaced as news
  });
  it('autonomous clamps to ±15 and allows a category', () => {
    const evs = simEvents(bonds as any, state(), 12, 1, (() => { let n = 0; return () => ++n; })(), { social: 'autonomous' });
    const bd = evs.find((e: any) => e.kind === 'bond.delta') as any;
    expect(bd.aff).toBe(15); expect(bd.addCats).toEqual(['social']);
  });
  it('a relation lock strips the forbidden category off-screen, exactly like the on-screen fold', () => {
    const locked = { offscreen: [], bonds: [{ a: 'Jaime', b: 'Tyrion', cat: 'social', why: 'x' }] };
    const evs = simEvents(locked as any, state(), 12, 1, (() => { let n = 0; return () => ++n; })(),
      { social: 'autonomous', locks: [{ key: 'jaime|tyrion', a: 'jaime', b: 'tyrion', forbid: ['social'], pin: [] }] });
    // the only content was a forbidden social cat → stripped → no bond survives
    expect(evs.filter((e: any) => e.kind === 'bond.delta')).toHaveLength(0);
  });
  it('never authors a bond involving {{user}}', () => {
    const withUser = { offscreen: [], bonds: [{ a: 'Jaime', b: 'You', aff: 10 }] };
    const s = state(); s.cast.you = { id: 'you', name: 'You', aka: [], status: 'present', source: 'auto', firstTurn: 1, lastTurn: 12, userEdited: false } as any;
    const evs = simEvents(withUser as any, s, 12, 1, (() => { let n = 0; return () => ++n; })(), { social: 'autonomous', userId: 'you' });
    expect(evs.filter((e: any) => e.kind === 'bond.delta')).toHaveLength(0);
  });
  it('never authors a bond where either endpoint is deceased', () => {
    const s = state(); s.cast.jaime!.deceased = true;
    const evs = simEvents(bonds as any, s, 12, 1, (() => { let n = 0; return () => ++n; })(), { social: 'autonomous' });
    expect(evs.filter((e: any) => e.kind === 'bond.delta')).toHaveLength(0);
  });
});

describe('offscreenCast — deceased exclusion', () => {
  it('a deceased active character is never selected as an off-screen actor', () => {
    const s = state(); s.cast.jaime!.deceased = true;
    const ids = offscreenCast(s).map((c) => c.id);
    expect(ids).not.toContain('jaime');
    expect(ids).toContain('tyrion'); // living, still eligible
  });
});

describe('simEvents — off-screen faction relations (Politics autonomy)', () => {
  function facState(): ChronicleState {
    const s = state();
    s.factions = {
      'fac:lannister': { id: 'fac:lannister', name: 'Lannister', aka: [], status: 'active', standing: 0, trust: 0, source: 'auto', firstTurn: 1, lastTurn: 10, userEdited: false },
      'fac:stark': { id: 'fac:stark', name: 'Stark', aka: [], status: 'active', standing: 0, trust: 0, source: 'auto', firstTurn: 1, lastTurn: 10, userEdited: false },
    } as any;
    return s;
  }
  const facs = { offscreen: [], factions: [{ a: 'Lannister', b: 'Stark', kind: 'war', standing: 40, why: 'a border raid' }] };
  it('off emits NO faction events (parity with today)', () => {
    const evs = simEvents(facs as any, facState(), 12, 1, (() => { let n = 0; return () => ++n; })(), { politics: 'off' });
    expect(evs.filter((e: any) => e.kind === 'factionrel.op')).toHaveLength(0);
  });
  it('living clamps standing to ±6 and never flips the kind; emits a companion beat', () => {
    const evs = simEvents(facs as any, facState(), 12, 1, (() => { let n = 0; return () => ++n; })(), { politics: 'living' });
    const fr = evs.find((e: any) => e.kind === 'factionrel.op') as any;
    expect(fr).toBeTruthy();
    expect(fr.standing).toBe(6);      // clamped from 40
    expect(fr.relkind).toBeUndefined(); // no kind flip at living
    expect(evs.some((e: any) => e.kind === 'offscreen.op' && e.id.startsWith('facrel_'))).toBe(true);
  });
  it('autonomous clamps to ±15 and allows a kind', () => {
    const evs = simEvents(facs as any, facState(), 12, 1, (() => { let n = 0; return () => ++n; })(), { politics: 'autonomous' });
    const fr = evs.find((e: any) => e.kind === 'factionrel.op') as any;
    expect(fr.standing).toBe(15); expect(fr.relkind).toBe('war');
  });
});

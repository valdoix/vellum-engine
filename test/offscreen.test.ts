import { describe, it, expect } from 'vitest';
import { offscreenCast, buildSimPrompt, parseSim, simEvents, SIM_SYS, simSys, threadOffscreenLink, linkedOffscreen, subplotEligible, subplotProofSufficient, planSubplotTick, effectiveSubplotMode } from '../src/domain/offscreen.js';
import { reduce } from '../src/core/reduce.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';

function state(): ChronicleState {
  const s = freshState();
  s.turns = 12;
  s.scene = { location: 'The Hall', time: 'night', tension: 5, weather: '', present: ['cersei'], detail: [] } as any;
  s.cast = {
    cersei: { id: 'cersei', name: 'Cersei', aka: [], status: 'present', source: 'auto', firstTurn: 1, lastTurn: 12, userEdited: false },
    jaime: { id: 'jaime', name: 'Jaime', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 10, lastLocation: 'The Yard', lastLocationTurn: 10, userEdited: false },
    tyrion: { id: 'tyrion', name: 'Tyrion', aka: [], status: 'mentioned', source: 'auto', firstTurn: 1, lastTurn: 11, lastLocation: 'The Yard', lastLocationTurn: 11, userEdited: false },
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

  it('keeps an old off-stage character eligible when canon still anchors their location', () => {
    const s = state();
    s.turns = 2_000;
    s.cast.robert!.lastLocation = 'The Kingsroad';
    s.cast.robert!.lastLocationTurn = 1;
    expect(offscreenCast(s).map(c => c.id)).toContain('robert');
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

  it('uses attached lorebooks as setting canon without adding them to any actor KNOWS list', () => {
    const s = state();
    const p = buildSimPrompt(s, offscreenCast(s), { worldCanon: [{ id: 'moon-gate', bookId: 'setting', title: 'Moon Gate', keys: ['Moon Gate'], content: 'The Moon Gate is the only pass through the eastern ridge.' }] });
    expect(p).toContain('ATTACHED LOREBOOK WORLD CANON');
    expect(p).toContain('The Moon Gate is the only pass');
    expect(p).not.toContain('KNOWS: The Moon Gate');
  });

  it('permits an empty result when nothing changes and supplies stable characterization', () => {
    const s = state();
    s.cast.jaime!.role = 'sworn guard';
    s.cast.jaime!.traits = ['dutiful', 'guarded'];
    const p = buildSimPrompt(s, offscreenCast(s));
    expect(simSys()).toContain('Empty output is correct');
    expect(p).toContain('(sworn guard)');
    expect(p).toContain('TRAITS: dutiful, guarded');
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

  it('does not leak on-screen plot-thread knowledge into the off-screen simulator', () => {
    const s = state();
    s.threads = [{ name: 'The Letter', status: 'advance', firstTurn: 3, lastTurn: 8 }] as any;
    s.offscreen = [{ id: 'appt', name: 'The Appointment', status: 'active', gist: 'B opens the letter', beats: ['B opens the letter'], firstTurn: 8, lastTurn: 8 }] as any;
    s.knowledge = [{ who: 'jaime', fact: 'the old gate is barred', reliability: 'knows', truth: 'true', source: 'witnessed it', turn: 7 }] as any;
    // Live plot state is author knowledge; passing the legacy field must not
    // expose it. Only actor-addressed knowledge survives.
    const world = buildSimPrompt(s, offscreenCast(s), { threads: [{ name: 'The Letter', status: 'advance' }] });
    expect(world).not.toContain('ON-SCREEN PLOT THREADS');
    expect(world).not.toContain('The Letter');
    expect(world).toContain('the old gate is barred');
    expect(world).toContain('@The Yard');
    const focused = buildSimPrompt(s, offscreenCast(s), { focusId: 'appt', threads: [{ name: 'The Letter', status: 'advance' }] });
    expect(focused).not.toContain('The Letter');
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

describe('parseSim provider tolerance', () => {
  it('recovers a complete object after brace-filled provider chatter', () => {
    const parsed = parseSim('I considered {an unsafe draft}. Final:\n```json\n{"events":[{"action":"start","name":"Gate Watch","who":"Jaime","activity":"checks the yard gate"}]}\n```');
    expect(parsed?.offscreen).toEqual([expect.objectContaining({ op: 'new', id: 'gate_watch', who: 'Jaime', gist: 'checks the yard gate' })]);
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
  it('parses action-specific schedules and causal gates', () => {
    const row = parseSim('{"offscreen":[{"op":"advance","id":"x","gist":"the courier reaches the toll road","nextTurn":13,"nextDay":4,"nextClock":600,"dependsOn":["permit"],"blockedBy":["storm"],"trigger":"the gate opens"}]}')!.offscreen[0]!;
    expect(row).toMatchObject({ nextTurn: 13, nextDay: 4, nextClock: 600, dependsOn: ['permit'], blockedBy: ['storm'], trigger: 'the gate opens' });
  });
  it('accepts VELLUM delta envelopes and parallel-shaped aliases', () => {
    const r = parseSim('<vellum>{"delta":{"parallel":[{"id":"Jaime","location":"The Yard","activity":"checks the gate"}]}}</vellum>')!;
    expect(r.offscreen).toEqual([expect.objectContaining({ who: 'Jaime', where: 'The Yard', gist: 'checks the gate' })]);
    expect(r.offscreen[0]!.id).toContain('jaime');
  });
  it('preserves causal subplot proof fields from provider output', () => {
    const row = parseSim(JSON.stringify({ offscreen: [{
      op: 'new', id: 'wardrobe', name: 'Dawn wardrobe', who: 'Xander', where: "Dawn's home",
      gist: 'measures the alcove for a wardrobe', beatKind: 'progress',
      impact: 'The finished wardrobe gives Dawn a private place to protect the letters.',
      grounding: { basis: ['character', 'location', 'intent'], rationale: "Xander knows Dawn and can realistically visit her home to build the wardrobe.", after: 'measures the alcove for a wardrobe' },
    }] }))!.offscreen[0]!;
    expect(row).toMatchObject({ beatKind: 'progress', impact: expect.stringContaining('protect the letters') });
    expect(row.grounding).toMatchObject({ basis: ['character', 'location', 'intent'], after: 'measures the alcove for a wardrobe' });
  });
});

describe('subplot causal proof', () => {
  it('accepts a grounded consequential project start', () => {
    expect(subplotProofSufficient({
      op: 'new', id: 'wardrobe', name: 'Dawn wardrobe', who: 'Xander', where: "Dawn's home",
      gist: 'measures the alcove for a wardrobe', beatKind: 'progress',
      impact: 'The wardrobe will conceal Dawn’s letters and change what visitors can discover.',
      grounding: { basis: ['character', 'location', 'intent'], rationale: "Xander knows Dawn, has practical skills, and can visit her home.", after: 'measures the alcove for a wardrobe' },
    })).toBe(true);
  });

  it('rejects an advance that only restates the prior activity', () => {
    const prior = { id: 'wardrobe', name: 'Dawn wardrobe', status: 'active', who: 'xander', where: "Dawn's home", gist: 'measures the alcove for a wardrobe', beats: ['measures the alcove for a wardrobe'], firstTurn: 1, lastTurn: 1 } as any;
    expect(subplotProofSufficient({
      op: 'advance', id: 'wardrobe', gist: 'measuring the alcove for the wardrobe', beatKind: 'progress',
      impact: 'The wardrobe will conceal Dawn\'s letters and change what visitors can discover.',
      grounding: { basis: ['subplot'], rationale: 'The current beat is claimed as progress on the established wardrobe project.', before: 'measures the alcove for a wardrobe', after: 'measuring the alcove for the wardrobe' },
    }, prior)).toBe(false);
  });

  it('accepts an advance when grounding.before matches a prior beat instead of gist', () => {
    const prior = {
      id: 'hellions_smash_the_bot', name: 'Hellion Bot Smash', status: 'active',
      who: 'hellion_bikers', where: 'Sunnydale streets',
      gist: 'The Hellion biker gang catches and destroys the Buffybot during the rampage, ending the illusion that the Slayer still patrols Sunnydale.',
      beats: [
        'Hellion bikers arrived at the cemetery to disrupt the resurrection ritual',
        'The Hellion biker gang catches and destroys the Buffybot during the rampage',
      ],
      firstTurn: 1, lastTurn: 2,
    } as any;
    expect(subplotProofSufficient({
      op: 'advance', id: 'hellions_smash_the_bot',
      gist: 'Hellions parade Buffybot parts through the streets, drawing more demons to Sunnydale',
      beatKind: 'consequence',
      impact: 'The visible destruction of the Slayer decoy emboldens demon factions and weakens Sunnydale\'s defensive bluff.',
      grounding: {
        basis: ['subplot', 'location'],
        rationale: 'The Hellions destroyed the Buffybot during the rampage; parading its parts is a plausible next escalation.',
        refs: ['hellions_smash_the_bot'],
        before: 'Hellion bikers arrived at the cemetery to disrupt the resurrection ritual',
        after: 'Hellions parade Buffybot parts through the streets, drawing more demons to Sunnydale',
      },
    }, prior)).toBe(true);
  });

  it('accepts an advance when grounding.before paraphrases the subplot name', () => {
    const prior = {
      id: 'spike_guards_dawn', name: 'Spike Guards Dawn', status: 'active',
      who: 'spike', where: 'Summers home',
      gist: 'Spike fulfills his promise to protect Dawn during the Hellion raid.',
      beats: ['Spike guards Dawn under the Buffybot-assisted household arrangement'],
      firstTurn: 1, lastTurn: 2,
    } as any;
    expect(subplotProofSufficient({
      op: 'advance', id: 'spike_guards_dawn',
      gist: 'Spike barricades the house after hearing distant explosions, keeping Dawn inside',
      beatKind: 'progress',
      impact: 'Dawn remains safe but isolated; Spike commits to a defensive posture that limits his options.',
      grounding: {
        basis: ['subplot', 'character'],
        rationale: 'Spike promised to protect Dawn and is at the Summers home; barricading after hearing danger is in-character.',
        refs: ['spike_guards_dawn'],
        before: 'Spike guards Dawn at the Summers home',
        after: 'Spike barricades the house after hearing distant explosions, keeping Dawn inside',
      },
    }, prior)).toBe(true);
  });

  it('accepts an advance when grounding.before describes actor+place context', () => {
    const prior = {
      id: 'willow_research', name: "Willow's Dark Research", status: 'active',
      who: 'willow_rosenberg', where: 'Magic Box',
      gist: 'Willow searches for a counter-ritual in the restricted section of the Magic Box.',
      beats: ['Willow begins consulting restricted texts at the Magic Box'],
      firstTurn: 3, lastTurn: 4,
    } as any;
    expect(subplotProofSufficient({
      op: 'advance', id: 'willow_research',
      gist: 'Willow discovers a dangerous amplification spell that could reverse the resurrection side effects',
      beatKind: 'progress',
      impact: 'A new magical option opens but carries serious risk of dark magic corruption.',
      grounding: {
        basis: ['subplot', 'character', 'location'],
        rationale: 'Willow is an experienced witch at the Magic Box with access to restricted texts.',
        refs: ['willow_research'],
        before: 'Willow Rosenberg researches at the Magic Box',
        after: 'Willow discovers a dangerous amplification spell that could reverse the resurrection side effects',
      },
    }, prior)).toBe(true);
  });

  it('still rejects an advance with completely unrelated grounding.before', () => {
    const prior = {
      id: 'hellions_smash_the_bot', name: 'Hellion Bot Smash', status: 'active',
      who: 'hellion_bikers', where: 'Sunnydale streets',
      gist: 'The Hellion biker gang catches and destroys the Buffybot.',
      beats: ['The Hellion biker gang catches and destroys the Buffybot'],
      firstTurn: 1, lastTurn: 2,
    } as any;
    expect(subplotProofSufficient({
      op: 'advance', id: 'hellions_smash_the_bot',
      gist: 'Hellions parade Buffybot parts through the streets',
      beatKind: 'consequence',
      impact: 'The destruction emboldens demon factions.',
      grounding: {
        basis: ['subplot'],
        rationale: 'The destruction is a consequence.',
        refs: ['hellions_smash_the_bot'],
        before: 'The weather is nice in Sunnydale today and birds are singing',
        after: 'Hellions parade Buffybot parts through the streets',
      },
    }, prior)).toBe(false);
  });
});

describe('adaptive subplot scheduler', () => {
  it('can tick on consecutive turns when each attempted action is due', () => {
    const s = state();
    s.offscreen = [{ id: 'courier', name: 'Courier run', status: 'active', gist: 'leaves the yard', beats: ['leaves the yard'], firstTurn: 12, lastTurn: 12, nextTurn: 13 }] as any;
    s.turns = 13;
    expect(subplotEligible(s, s.offscreen[0]!)).toBe(true);
    s.offscreen[0]!.lastTurn = 13; s.offscreen[0]!.nextTurn = 14; s.turns = 14;
    expect(subplotEligible(s, s.offscreen[0]!)).toBe(true);
  });

  it('waits for future time and dependencies, while active blockers remain hard gates', () => {
    const s = state(); s.turns = 20; s.day = 3; s.scene.clock = 600;
    s.offscreen = [
      { id: 'permit', name: 'Permit', status: 'resolved', gist: 'issued', beats: ['issued'], firstTurn: 1, lastTurn: 10 },
      { id: 'storm', name: 'Storm', status: 'active', gist: 'road closed', beats: ['road closed'], firstTurn: 1, lastTurn: 19 },
      { id: 'journey', name: 'Journey', status: 'active', gist: 'waiting', beats: ['waiting'], firstTurn: 1, lastTurn: 19, nextDay: 4, nextClock: 480, dependsOn: ['permit'], blockedBy: ['storm'] },
    ] as any;
    expect(subplotEligible(s, s.offscreen[2]!)).toBe(false);
    s.day = 4; s.scene.clock = 500;
    expect(subplotEligible(s, s.offscreen[2]!)).toBe(false);
    s.offscreen[1]!.status = 'resolved';
    expect(subplotEligible(s, s.offscreen[2]!)).toBe(true);
  });

  it('opens a bounded new subplot from an unoccupied NPC intent, not a cadence counter', () => {
    const s = state();
    s.cast.jaime!.intent = { goal: 'deliver the warrant', nextStep: 'find a horse', constraints: ['the gate is watched'], status: 'active', updatedTurn: 12 };
    expect(planSubplotTick(s, 'active')).toMatchObject({ allowNew: true });
    expect(planSubplotTick(s, 'minimal')).toEqual({ dueIds: [], allowNew: false, newCap: 0, reason: 'living world is not autonomous' });
  });

  it('promotes Living controls to Active and Autonomous controls to Sandbox depth', () => {
    expect(effectiveSubplotMode('off', 'living', 'off')).toBe('active');
    expect(effectiveSubplotMode('minimal', 'off', 'living')).toBe('active');
    expect(effectiveSubplotMode('active', 'autonomous', 'off')).toBe('sandbox');
    expect(effectiveSubplotMode('off', 'off', 'autonomous')).toBe('sandbox');
  });

  it('gives sandbox a larger due/new budget than active', () => {
    const s = state();
    s.cast.jaime!.role = 'sworn guard';
    s.cast.tyrion!.role = 'envoy';
    expect(planSubplotTick(s, 'active')).toMatchObject({ allowNew: true, newCap: 1 });
    expect(planSubplotTick(s, 'sandbox')).toMatchObject({ allowNew: true, newCap: 2 });
    expect(simSys('living', 'living', 'active')).toContain('LIVING/ACTIVE DEPTH');
    expect(simSys('autonomous', 'autonomous', 'sandbox')).toContain('AUTONOMOUS/SANDBOX DEPTH');
  });
});

describe('simEvents + reduce round-trip', () => {
  it('new → creates a subplot; advance by id → appends a beat; resolve → flips status', () => {
    let s = state();
    const seq = (() => { let n = 0; return () => ++n; })();
    // turn 1: new
    let evs = simEvents({ offscreen: [{ op: 'new', id: 'siege', name: 'The Siege', who: 'Jaime', gist: 'walls hold', nextTurn: 13, dependsOn: ['watch_order'] }] }, s, 12, 1, seq);
    s = reduce(evs, s);
    expect(s.offscreen).toHaveLength(1);
    expect(s.offscreen[0]!.who).toBe('jaime'); // resolved to cast id
    expect(s.offscreen[0]!.beats).toEqual(['walls hold']);
    expect(s.offscreen[0]).toMatchObject({ nextTurn: 13, dependsOn: ['watch_order'] });
    expect(s.parallel).toEqual([expect.objectContaining({ who: 'jaime', where: 'The Yard', activity: 'walls hold', src: 'sim', turn: 12, day: 1 })]);
    // turn 2: advance same id
    evs = simEvents({ offscreen: [{ op: 'advance', id: 'siege', gist: 'a breach opens' }] }, s, 13, 1, seq);
    s = reduce(evs, s);
    expect(s.offscreen[0]!.beats).toEqual(['walls hold', 'a breach opens']);
    expect(s.offscreen[0]!.beatKinds).toEqual(['progress', 'progress']);
    expect(s.offscreen[0]!.gist).toBe('a breach opens');
    // turn 3: resolve
    evs = simEvents({ offscreen: [{ op: 'resolve', id: 'siege' }] }, s, 14, 1, seq);
    s = reduce(evs, s);
    expect(s.offscreen[0]!.status).toBe('resolved');
    expect(s.parallel).toEqual([]);
  });
  it('accepts a depicted journey to a lorebook-established place and rejects the same invented destination without canon', () => {
    const parsed = { offscreen: [{ op: 'new' as const, id: 'moon_errand', name: 'Moon errand', who: 'Jaime', where: 'Moon Gate', gist: 'travels from the yard and arrives at the Moon Gate' }] };
    const next = () => 1;
    expect(simEvents(parsed, state(), 12, 1, next)).toEqual([]);
    const withCanon = simEvents(parsed, state(), 12, 1, next, { worldCanon: [{ id: 'moon-gate', bookId: 'setting', keys: ['Moon Gate'], content: 'The Moon Gate is the eastern ridge pass.' }] });
    expect(withCanon).toEqual([expect.objectContaining({ kind: 'offscreen.op', who: 'jaime', where: 'Moon Gate' })]);
  });

  it('an advance on an unknown id becomes a new (no orphan)', () => {
    const s = state();
    const evs = simEvents({ offscreen: [{ op: 'advance', id: 'ghost', name: 'Ghost', gist: 'x' }] }, s, 12, 1, (() => { let n = 0; return () => ++n; })());
    expect((evs[0] as any).op).toBe('new');
  });
  it('requires impact and transition proof when strict simulation is requested', () => {
    const s = state();
    const next = (() => { let n = 0; return () => ++n; })();
    expect(simEvents({ offscreen: [{ op: 'new', id: 'empty', name: 'Empty', who: 'Jaime', where: 'The Yard', gist: 'checks the gate' }] }, s, 12, 1, next, { requireProof: true })).toEqual([]);
    expect(simEvents({ offscreen: [{
      op: 'new', id: 'gate_watch', name: 'Gate watch', who: 'Jaime', where: 'The Yard', gist: 'checks the gate hinges', beatKind: 'progress',
      impact: 'A damaged hinge could delay the guard response when the gate is attacked.',
      grounding: { basis: ['character', 'location'], rationale: 'Jaime is an established guard currently anchored in the Yard.', after: 'checks the gate hinges' },
    }] }, s, 12, 1, next, { requireProof: true })).toEqual([expect.objectContaining({ kind: 'offscreen.op', id: 'gate_watch', impact: expect.stringContaining('guard response') })]);
  });
  it('never places the persona in a named or anonymous subplot', () => {
    const s = state();
    s.cast.player = { ...s.cast.jaime!, id: 'player', name: 'Player', aka: ['The Captain'], status: 'active' } as any;
    const parsed = { offscreen: [
      { op: 'new' as const, id: 'persona_errand', name: 'Player errand', who: 'Player', where: 'The Yard', gist: 'Player waits by the gate' },
      { op: 'new' as const, id: 'anonymous_persona', name: 'Captain watch', where: 'The Yard', gist: 'The Captain is watched from the wall' },
    ] };
    const evs = simEvents(parsed, s, 12, 1, (() => { let n = 0; return () => ++n; })(), { livingWorld: 'sandbox', userId: 'player' });
    expect(evs).toEqual([]);
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

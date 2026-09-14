import { describe, it, expect, vi } from 'vitest';
import { applyCompilerMergePatch, argentRequirementErrors, CompilerCandidate, compilerProviderSchema, compilerRepairBase, jsonSchema, salvageCompilation, validateCompilation, type CompilerInput, type StateCandidate } from '../src/domain/state-compiler.js';
import { freshState } from '../src/domain/types.js';
import { compileState, compilerContext, compilerPatchObjects, compilerReplyObjects, compilerSectionsForErrors, COMPILER_SECTIONS, ENGINE_OUTPUT_TOKENS, ENGINE_TIMEOUT_MS, repairCompilation, STATE_COMPILER_SYSTEM } from '../src/bus/state-compiler.js';
import { foldTurn } from '../src/bus/lifecycle.js';
import { parseState } from '../src/parse/state-block.js';
import { registerFeature } from '../src/bus/registry.js';
import { reduce } from '../src/core/reduce.js';
import { coreFeature } from '../src/domain/core-feature.js';

registerFeature(coreFeature);

function input(): CompilerInput {
  const prior = freshState(); prior.day = 1;
  prior.scene = { location: 'Archive', time: '23:58', clock: 1438, tension: 1, weather: '', present: ['mara'], detail: [] };
  prior.cast.mara = { id: 'mara', name: 'Mara', aka: [], status: 'present', source: 'user', firstTurn: 1, lastTurn: 1, userEdited: true };
  prior.cast.ada = { ...prior.cast.mara, id: 'ada', name: 'Ada', status: 'active' };
  prior.parallel = [{ who: 'ada', where: 'Courtyard', activity: 'Waiting', day: 1, turn: 1 }];
  return { prior, turn: 2, prose: 'Mara waits five minutes. Ada moves to the gate. Player stays quiet.', userName: 'Player', genesisAllowed: false };
}
function candidate(): StateCandidate {
  return { state: { turn: 2, day: 2, scene: { loc: 'Archive', time: '00:03', clock: 3 }, present: [{ id: 'Mara', thought: 'I should wait.' }, { id: 'Player', thought: '' }], delta: {}, ext: {} }, parallelReviewed: ['Ada'], parallelOps: [], parallelWorldOps: [], evidence: [{ path: 'scene.time', quote: 'five minutes' }], trackEvidence: [], genesis: false };
}
describe('strict pre-commit state compiler', () => {
  it('accepts and files a prose-grounded durable subplot when Living World is active', () => {
    const i = input();
    i.livingWorld = 'active';
    i.prose = 'Mara waits five minutes. Elsewhere, Ada waits in the Courtyard for the bell. Player stays quiet.';
    const c = candidate();
    c.state.delta.offscreen = [{
      op: 'new', id: 'courtyard_watch', name: 'Courtyard watch', who: 'Ada', where: 'Courtyard',
      gist: 'waits in the Courtyard for the bell', nextTurn: 3, beatKind: 'progress',
      impact: 'Ada can warn the archive when the bell sounds, changing how quickly Mara can respond.',
      grounding: {
        basis: ['scene', 'character', 'location', 'intent'],
        rationale: 'Ada is an established NPC whose active bell-watching intent places her in the Courtyard.',
        after: 'waits in the Courtyard for the bell',
      },
    }];
    c.state.ext.intent = [{ who: 'Ada', goal: 'hear the bell signal', nextStep: 'wait in the Courtyard', status: 'active' }];
    c.evidence.push({ path: 'delta.offscreen.0', quote: 'Ada waits in the Courtyard for the bell' });
    c.evidence.push({ path: 'ext.intent.0', quote: 'Ada waits in the Courtyard for the bell' });
    const accepted = validateCompilation(c, i);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    const folded = foldTurn(accepted.block, structuredClone(i.prior), i.turn, { userCanon: 'player' });
    const next = reduce(folded.events, i.prior);
    expect(next.offscreen).toEqual([expect.objectContaining({ id: 'courtyard_watch', who: 'ada', nextTurn: 3 })]);
  });

  it('rejects durable subplots when Living World autonomy is disabled', () => {
    const i = input(); i.livingWorld = 'minimal';
    i.prose = 'Mara waits five minutes. Elsewhere, Ada waits in the Courtyard for the bell. Player stays quiet.';
    const c = candidate();
    c.state.delta.offscreen = [{ op: 'new', id: 'courtyard_watch', name: 'Courtyard watch', who: 'Ada', where: 'Courtyard', gist: 'waits in the Courtyard for the bell' }];
    c.state.ext.intent = [{ who: 'Ada', goal: 'hear the bell signal', nextStep: 'wait in the Courtyard', status: 'active' }];
    c.evidence.push({ path: 'delta.offscreen.0', quote: 'Ada waits in the Courtyard for the bell' });
    c.evidence.push({ path: 'ext.intent.0', quote: 'Ada waits in the Courtyard for the bell' });
    const rejected = validateCompilation(c, i);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.errors).toContain('offscreen deltas require Living World active or sandbox');
  });

  it('preserves unmodified off-stage actors and emits the canonical contract across midnight', () => {
    const r = validateCompilation(candidate(), input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const state = JSON.parse(r.block.slice(9, -9));
    expect(state.delta.parallel).toEqual([{ who: 'Ada', where: 'Courtyard', activity: 'Waiting' }]);
    expect(state.scene).toMatchObject({ time: '00:03', clock: 3 });
  });
  it('normalizes a friendly provider time and copies the first-turn prose header before strict validation', () => {
    const prior = freshState();
    prior.scene = { id: 'scn_pending', reason: 'new_chat', pending: true, location: '', time: '', tension: 0, weather: '', present: [], detail: [] };
    const i: CompilerInput = {
      prior, turn: 1,
      prose: '[SCENE|The Hand That Reached|Winters residence · 02:47]\nAt 2:47 AM, the living-room lamp burned through the smoke haze.',
      userName: 'Player', genesisAllowed: false,
    };
    const raw: any = {
      state: { turn: 1, day: 0, scene: { transition: 'scene', loc: 'Winters residence', time: '2:47 AM', clock: 167 }, present: [], delta: {}, ext: {} },
      parallelOps: [], parallelWorldOps: [], parallelReviewed: [],
      evidence: [{ path: 'scene.loc', quote: 'Winters residence' }, { path: 'scene.time', quote: '2:47 AM' }],
      trackEvidence: [], genesis: false,
    };
    const result = salvageCompilation(raw, i);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recovered).toContain('candidate shape');
    expect(result.candidate.state.scene).toMatchObject({ title: 'The Hand That Reached', time: '02:47', clock: 167 });
  });

  it('holds a first-scene compiler candidate that has no model or prose title', () => {
    const prior = freshState();
    prior.scene = { id: 'scn_pending', reason: 'new_chat', pending: true, location: '', time: '', tension: 0, weather: '', present: [], detail: [] };
    const i: CompilerInput = { prior, turn: 1, prose: 'At 02:47, the living-room lamp burned.', userName: 'Player', genesisAllowed: false };
    const raw: any = {
      state: { turn: 1, day: 0, scene: { loc: 'living room', time: '02:47', clock: 167 }, present: [], delta: {}, ext: {} },
      parallelOps: [], parallelWorldOps: [], parallelReviewed: [],
      evidence: [{ path: 'scene.loc', quote: 'living-room' }, { path: 'scene.time', quote: '02:47' }], trackEvidence: [], genesis: false,
    };
    const result = salvageCompilation(raw, i);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('new scene requires scene.title');
  });
  it('accepts current opening-scene and Codex evidence copied from an active lorebook', () => {
    const prior = freshState();
    prior.scene = { id: 'scn_pending', reason: 'new_chat', pending: true, location: '', time: '', tension: 0, weather: '', present: [], detail: [] };
    const lore = 'At present, the resurrection site is the Sunnydale cemetery, and it is still night.';
    const i: CompilerInput = {
      prior, turn: 1, prose: 'Smoke drifts between the headstones.', userName: 'Player', genesisAllowed: false,
      lorebookCanon: [{ id: 'opening', bookId: 'buffy', title: 'Current Situation', category: 'scenario', content: lore }],
    };
    const c: StateCandidate = {
      state: {
        turn: 1, day: 0,
        scene: { title: 'Ash Among the Headstones', transition: 'scene', loc: 'Sunnydale cemetery', time: '03:05', clock: 185 },
        present: [], delta: {}, ext: { codex: [{ op: 'add', fact: 'The resurrection site is the Sunnydale cemetery.', tag: 'opening situation' }] },
      },
      parallelOps: [], parallelWorldOps: [], parallelReviewed: [],
      evidence: [
        { path: 'scene.loc', quote: 'Sunnydale cemetery' },
        { path: 'scene.time', quote: 'still night' },
        { path: 'ext.codex.0', quote: 'the resurrection site is the Sunnydale cemetery' },
      ],
      trackEvidence: [], genesis: false,
    };
    const result = validateCompilation(c, i);
    expect(result.ok).toBe(true);
  });
  it('accepts a faithful evidence paraphrase instead of requiring an exact quote', () => {
    const i = input();
    i.prose = 'Mara waits five minutes, then discovers a copper key hidden beneath the ledger. Player stays quiet.';
    const c = candidate();
    c.state.ext.codex = [{ op: 'add', fact: 'A copper key was hidden beneath the ledger.', tag: 'discovery' }];
    c.evidence.push({ path: 'ext.codex.0', quote: 'Mara finds the copper key beneath the ledger.' });
    expect(i.prose).not.toContain(c.evidence[c.evidence.length - 1]!.quote);
    expect(validateCompilation(c, i).ok).toBe(true);

    c.evidence[c.evidence.length - 1]!.quote = 'Mara waits five minutes.';
    const unrelated = validateCompilation(c, i);
    expect(unrelated.ok).toBe(false);
    if (!unrelated.ok) expect(unrelated.errors).toContain('evidence does not materially ground the state change: ext.codex.0');
  });
  it('accepts a new plot baseline from lorebook canon but never treats it as later progress', () => {
    const i = input();
    const quote = 'At present, the sealed Moon Gate cannot open until Mara finds the silver key.';
    i.lorebookCanon = [{ id: 'moon-plot', bookId: 'world', title: 'Current Plot', category: 'plot', content: quote }];
    const c = candidate();
    c.state.delta.threads = [{ op: 'new', name: 'Open the Moon Gate', note: 'The sealed Moon Gate remains closed until Mara finds the silver key.' }];
    c.evidence.push({ path: 'delta.threads.0', quote });
    c.trackEvidence.push({
      path: 'delta.threads.0', targetId: 'new', before: 'absent', after: 'The sealed Moon Gate remains closed until Mara finds the silver key.',
      quote, basis: 'new_open_question',
    });
    expect(validateCompilation(c, i).ok).toBe(true);

    i.prior.threads = [{ id: 'thr_moon', name: 'Open the Moon Gate', status: 'open', beats: ['The gate is sealed.'], firstTurn: 1, lastTurn: 1 }];
    c.state.delta.threads = [{ op: 'advance', name: 'Open the Moon Gate', note: 'The sealed Moon Gate remains closed until Mara finds the silver key.' }];
    c.trackEvidence[0] = { ...c.trackEvidence[0]!, targetId: 'thr_moon', before: 'The gate is sealed.', basis: 'direct_development' };
    const rejected = validateCompilation(c, i);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.errors).toContain('lorebook baseline cannot advance or resolve an existing plot row: delta.threads.0');
  });
  it('requires and accepts a complete opted-in persona snapshot in every agency mode without evidence', () => {
    const i = input();
    i.personaState = true;
    i.userInput = 'I remain by the door. I am exhausted and wary. I think the seal is a trap. I have always been stubborn.';
    const c = candidate();
    const player = c.state.present.find((row) => row.id === 'Player')!;
    Object.assign(player, { doing: 'remaining by the door', condition: 'exhausted', mood: 'wary', thought: 'The seal is a trap.', traits: ['stubborn'] });
    for (const agency of ['protected', 'continuity', 'director'] as const) {
      i.agency = agency;
      const accepted = validateCompilation(structuredClone(c), i);
      expect(accepted.ok, agency).toBe(true);
      if (accepted.ok) {
        const folded = foldTurn(accepted.block, structuredClone(i.prior), i.turn, { userCanon: 'player', personaState: true, agency });
        const scene = folded.events.find((event) => event.kind === 'scene.set') as any;
        expect(scene.detail.find((row: any) => row.id === 'player')).toMatchObject({ mood: 'wary', condition: 'exhausted', doing: 'remaining by the door', thought: 'The seal is a trap.' });
      }
    }
    const incomplete = structuredClone(c);
    delete incomplete.state.present.find((row) => row.id === 'Player')!.condition;
    const rejected = validateCompilation(incomplete, i);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.errors).toContain('persona state requires condition');
  });
  it('repairs a manufactured next day and still rejects its backward wall clock', () => {
    const i = input();
    i.prior.scene = { ...i.prior.scene, time: '22:00', clock: 1320 };
    i.prose = 'Mara closes the ledger and remains beside the desk.';
    const c = candidate();
    c.state.scene.time = '06:00';
    c.state.scene.clock = 360;
    c.evidence = [{ path: 'scene.time', quote: 'Mara closes the ledger' }];
    const r = validateCompilation(c, i);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain('clock moves backward');
  });
  it('accepts scene-time evidence from the latest player input', () => {
    const i = input();
    i.prior.scene = { ...i.prior.scene, time: '19:38', clock: 1178 };
    i.userInput = 'Ten minutes later, I remain by the archive door.';
    i.prose = 'Mara keeps watch beside the desk. Player remains by the archive door.';
    const c = candidate();
    c.state.day = 1;
    c.state.scene.time = '19:48';
    c.state.scene.clock = 1188;
    c.evidence = [{ path: 'scene.time', quote: 'Ten minutes later' }];
    const r = validateCompilation(c, i);
    expect(r.ok).toBe(true);
  });
  it('repairs a frozen compiler clock from completed current-turn duration', () => {
    const i = input();
    i.prior.scene = { ...i.prior.scene, time: '19:38', clock: 1178 };
    i.userInput = 'Ten minutes later, I remain by the archive door.';
    i.prose = 'Mara keeps watch beside the desk. Player remains by the archive door.';
    const c = candidate();
    c.state.day = 1;
    c.state.scene.time = '19:38';
    c.state.scene.clock = 1178;
    c.evidence = [];
    const r = validateCompilation(c, i);
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.parse(r.block.slice(9, -9)).scene).toMatchObject({ time: '19:48', clock: 1188 });
  });
  it('advances a frozen compiler clock for an unquantified live beat', () => {
    const i = input();
    i.prior.scene = { ...i.prior.scene, time: '19:38', clock: 1178 };
    i.prose = 'Mara closes the ledger, crosses to the door, and asks Ada to follow.';
    const c = candidate();
    c.state.day = 1;
    c.state.scene.time = '19:38';
    c.state.scene.clock = 1178;
    c.evidence = [];
    const r = validateCompilation(c, i);
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.parse(r.block.slice(9, -9)).scene).toMatchObject({ time: '19:39', clock: 1179 });
  });
  it('preserves anonymous world parallel events during Engine Second Pass', () => {
    const i = input();
    i.prior.parallel.unshift({ where: 'Harbor', activity: 'The storm front is closing the channel', note: 'Ferries remain docked', day: 1, turn: 1 });
    const r = validateCompilation(candidate(), i);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.parse(r.block.slice(9, -9)).delta.parallel).toEqual([
      { where: 'Harbor', activity: 'The storm front is closing the channel', note: 'Ferries remain docked' },
      { who: 'Ada', where: 'Courtyard', activity: 'Waiting' },
    ]);
  });
  it('starts, updates, and resolves anonymous world parallel events with exact prose evidence', () => {
    const i = input();
    i.prior.parallel = [{ where: 'Harbor', activity: 'Ferries remain docked', day: 1, turn: 1 }];
    i.prose += ' The harbor master reopens the ferry channel. Bells begin ringing across the city.';
    const advance = candidate();
    advance.parallelReviewed = [];
    advance.parallelWorldOps = [{ op: 'advance', priorActivity: 'Ferries remain docked', priorWhere: 'Harbor', where: 'Harbor', activity: 'Ferries are departing again', evidence: 'The harbor master reopens the ferry channel.' }];
    let r = validateCompilation(advance, i);
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.parse(r.block.slice(9, -9)).delta.parallel).toEqual([{ where: 'Harbor', activity: 'Ferries are departing again' }]);

    const start = candidate();
    start.parallelReviewed = [];
    start.parallelWorldOps = [{ op: 'start', activity: 'Bells are ringing across the city', evidence: 'Bells begin ringing across the city.' }];
    r = validateCompilation(start, { ...i, prior: { ...i.prior, parallel: [] } });
    expect(r.ok).toBe(true);

    const resolve = candidate();
    resolve.parallelReviewed = [];
    resolve.parallelWorldOps = [{ op: 'resolve', priorActivity: 'Ferries remain docked', priorWhere: 'Harbor', evidence: 'The harbor master reopens the ferry channel.' }];
    r = validateCompilation(resolve, i);
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.parse(r.block.slice(9, -9)).delta.parallel).toEqual([]);
  });
  it('rejects unrelated, teleporting, and epistemically impossible parallel updates', () => {
    const unrelated = candidate();
    unrelated.parallelOps = [{ op: 'advance', who: 'Ada', where: 'Courtyard', activity: 'stealing the crown', evidence: 'Mara waits five minutes.' }];
    expect(validateCompilation(unrelated, input()).ok).toBe(false);

    const teleportInput = input();
    teleportInput.prose = 'Ada stands guard at the East Gate. Mara waits five minutes. Player stays quiet.';
    const teleport = candidate();
    teleport.parallelOps = [{ op: 'advance', who: 'Ada', where: 'East Gate', activity: 'stands guard', evidence: 'Ada stands guard at the East Gate.' }];
    expect(validateCompilation(teleport, teleportInput).ok).toBe(false);

    const noTravel = candidate();
    noTravel.parallelOps = [{ op: 'move', who: 'Ada', where: 'Gate', activity: 'Waiting', evidence: 'Ada is waiting at the gate.' }];
    const noTravelInput = input();
    noTravelInput.prose = 'Mara waits five minutes. Ada is waiting at the gate. Player stays quiet.';
    expect(validateCompilation(noTravel, noTravelInput).ok).toBe(false);

    const learned = candidate();
    learned.state.delta.knowledge = [{ who: 'Ada', fact: 'the key is seven', reliability: 'knows', truth: 'true', source: 'Mara whispers' }];
    learned.evidence.push({ path: 'delta.knowledge.0', quote: 'Mara whispers that the key is seven' });
    const learnedInput = input();
    learnedInput.prose += ' Mara whispers that the key is seven.';
    expect(validateCompilation(learned, learnedInput).ok).toBe(false);
  });
  it('accepts off-stage knowledge only when a depicted channel reaches its recipient', () => {
    const i = input();
    i.prose += ' A messenger tells Ada at the East Gate that the key is seven.';
    const c = candidate();
    c.state.delta.knowledge = [{ who: 'Ada', fact: 'the key is seven', reliability: 'knows', truth: 'true', source: 'messenger tells Ada' }];
    c.evidence.push({ path: 'delta.knowledge.0', quote: 'A messenger tells Ada at the East Gate that the key is seven' });
    const accepted = validateCompilation(c, i);
    expect(accepted.ok).toBe(true);
  });
  it('rejects knowledge that overstates a real quote or reverses its subject', () => {
    const i = input();
    i.prose += ' Ada smiles at Mara. Ada says, "I ordered dinner."';
    const c = candidate();
    c.state.delta.knowledge = [{
      who: 'Mara', about: 'Ada', reliability: 'knows', truth: 'true',
      fact: 'Ada privately counted every raindrop and Mara ordered dinner to avoid the court',
      source: 'Ada says to Mara',
    }];
    c.evidence.push({ path: 'delta.knowledge.0', quote: 'Ada says, "I ordered dinner."' });
    const rejected = validateCompilation(c, i);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.errors).toContain('knowledge fact overreaches its evidence: Mara');
  });
  it('starts a grounded parallel row from active Living World state without requiring it in visible prose', () => {
    const i = input();
    i.prior.parallel = [];
    i.livingWorld = 'active';
    i.prior.offscreen = [{ id: 'courier_watch', name: 'The Late Courier', status: 'active', who: 'ada', where: 'East Gate', gist: 'waiting for the courier', beats: ['waiting for the courier'], firstTurn: 1, lastTurn: 1 }] as any;
    const c = candidate();
    c.parallelReviewed = [];
    c.parallelOps = [{ op: 'start', who: 'Ada', where: 'East Gate', activity: 'waiting for the courier', evidence: 'Ada at East Gate: waiting for the courier' }];
    const r = validateCompilation(c, i);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(JSON.parse(r.block.slice(9, -9)).delta.parallel).toEqual([{ who: 'Ada', where: 'East Gate', activity: 'waiting for the courier' }]);
      const folded = foldTurn(r.block, structuredClone(i.prior), i.turn);
      expect(folded.source).toBe('json');
      expect(reduce(folded.events).parallel).toEqual([
        expect.objectContaining({ who: 'ada', where: 'East Gate', activity: 'waiting for the courier' }),
      ]);
    }

    i.livingWorld = 'minimal';
    expect(validateCompilation(c, i).ok).toBe(false);
    i.livingWorld = 'sandbox';
    c.parallelOps[0]!.activity = 'stealing the crown';
    expect(validateCompilation(c, i).ok).toBe(false);
  });
  it('rejects a parallel snapshot that contradicts the newest active subplot beat', () => {
    const i = input();
    i.livingWorld = 'active';
    i.prose = 'Mara waits five minutes. At the East Gate, Ada tightens the courier latch, then reads the courier ledger. Player stays quiet.';
    i.prior.parallel = [{ who: 'ada', where: 'East Gate', activity: 'waiting for the courier', day: 1, turn: 1 }];
    i.prior.offscreen = [{ id: 'courier_watch', name: 'The Late Courier', status: 'active', who: 'ada', where: 'East Gate', gist: 'waiting for the courier', beats: ['waiting for the courier'], firstTurn: 1, lastTurn: 1 }] as any;
    const c = candidate();
    c.state.delta.offscreen = [{
      op: 'advance', id: 'courier_watch', where: 'East Gate', gist: 'tightens the courier latch', beatKind: 'progress',
      impact: 'The repaired latch controls whether the arriving courier can enter without alerting Ada.',
      grounding: { basis: ['scene', 'subplot'], rationale: 'Ada tightens the latch at the established gate while continuing the courier watch.', before: 'waiting for the courier', after: 'tightens the courier latch' },
    }];
    c.evidence.push({ path: 'delta.offscreen.0', quote: 'At the East Gate, Ada tightens the courier latch' });
    c.parallelReviewed = [];
    c.parallelOps = [{ op: 'advance', who: 'Ada', where: 'East Gate', activity: 'reads the courier ledger', evidence: 'At the East Gate, Ada reads the courier ledger.' }];
    const rejected = validateCompilation(c, i);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.errors).toContain('parallel activity contradicts active subplot courier_watch: ada');
  });
  it('accepts a canon-plausible autonomous parallel beat without a prose quote', () => {
    const i = input();
    i.livingWorld = 'active';
    i.prior.scene.location = 'Sunnydale Cemetery';
    i.prior.parallel = [];
    i.prior.cast.spike = { ...i.prior.cast.ada!, id: 'spike', name: 'Spike', status: 'active', deceased: false, lastLocation: undefined, lastLocationTurn: undefined };
    i.lorebookCanon = [{
      id: 'bronze', bookId: 'buffy', title: 'The Bronze', keys: ['Bronze', 'Sunnydale'],
      content: 'The Bronze is a nightclub and live-music venue in Sunnydale frequented by local residents and vampires.',
    }];
    const c = candidate();
    c.state.scene.loc = 'Sunnydale Cemetery';
    c.parallelReviewed = [];
    c.parallelOps = [{
      op: 'start', who: 'Spike', where: 'The Bronze', activity: 'playing pool near the bar',
      evidence: 'Spike is alive and playing pool at the Bronze, an established Sunnydale venue; this is a reversible local activity.',
    }];
    const accepted = validateCompilation(c, i);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(JSON.parse(accepted.block.slice(9, -9)).delta.parallel).toEqual([
      { who: 'Spike', where: 'The Bronze', activity: 'playing pool near the bar' },
    ]);

    c.parallelOps[0] = {
      op: 'start', who: 'Spike', where: 'Beijing', activity: 'playing pool near the bar',
      evidence: 'Spike is alive and playing pool in Beijing.',
    };
    const remote = validateCompilation(c, i);
    expect(remote.ok).toBe(false);
    if (!remote.ok) expect(remote.errors).toContain('parallel operation is not grounded in the scene or a canon-plausible life/location/activity: spike');
  });
  it('rejects autonomous activity for a deceased character even at a canonical venue', () => {
    const i = input();
    i.livingWorld = 'sandbox';
    i.prior.scene.location = 'Sunnydale Cemetery';
    i.prior.parallel = [];
    i.prior.cast.spike = { ...i.prior.cast.ada!, id: 'spike', name: 'Spike', status: 'active', deceased: true };
    i.lorebookCanon = [{ id: 'bronze', bookId: 'buffy', title: 'The Bronze', content: 'The Bronze is a nightclub in Sunnydale.' }];
    const c = candidate();
    c.state.scene.loc = 'Sunnydale Cemetery';
    c.parallelReviewed = [];
    c.parallelOps = [{ op: 'start', who: 'Spike', where: 'The Bronze', activity: 'playing pool', evidence: 'Spike is playing pool at the Bronze in Sunnydale.' }];
    const rejected = validateCompilation(c, i);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.errors).toContain('deceased actor cannot act in parallel: spike');
  });
  it('rejects rollback against a legacy prior time even when prior clock is absent', () => {
    const i = input();
    delete i.prior.scene.clock;
    i.prose = 'Mara closes the ledger. Ada moves to the gate. Player stays quiet.';
    const c = candidate();
    c.state.day = 1;
    c.state.scene.time = '23:57';
    c.state.scene.clock = 1437;
    const r = validateCompilation(c, i);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain('clock moves backward');
  });
  it('moves, resolves and removes arrived actors with explicit evidence', () => {
    const c = candidate(); c.parallelOps = [{ op: 'move', who: 'Ada', where: 'Gate', activity: 'Waiting', evidence: 'Ada moves to the gate.' }];
    const r = validateCompilation(c, input()); expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.parse(r.block.slice(9, -9)).delta.parallel[0].where).toBe('Gate');
    c.state.present.push({ id: 'Ada', thought: 'I have arrived.' });
    c.evidence.push({ path: 'present.add.ada', quote: 'Ada enters the Archive.' });
    const arrivalInput = input(); arrivalInput.prose += ' Ada enters the Archive.';
    const arrival = validateCompilation(c, arrivalInput);
    expect(arrival.ok).toBe(true);
    if (arrival.ok) expect(JSON.parse(arrival.block.slice(9, -9)).delta.parallel).toEqual([]);
  });
  it.each([
    ['clock mismatch', (c: StateCandidate) => { c.state.scene.clock = 5; }],
    ['backward time', (c: StateCandidate) => { c.state.day = 0; }],
    ['invented player predicate', (c: StateCandidate) => { c.state.present[1]!.doing = 'opens the door'; }],
    ['duplicate actor', (c: StateCandidate) => { c.state.present.push(c.state.present[0]!); }],
    ['unsupported roster removal', (c: StateCandidate) => { c.state.present = c.state.present.filter(p => p.id !== 'Mara'); }],
    ['unjustified genesis', (c: StateCandidate) => { c.genesis = true; }],
    ['unknown field', (c: StateCandidate) => { (c.state as any).invented = true; }],
    ['invalid operation', (c: StateCandidate) => { c.parallelOps.push({ op: 'teleport' as any, who: 'Ada', evidence: 'Ada moves to the gate.' }); }],
    ['unquoted evidence', (c: StateCandidate) => { c.evidence.push({ path: 'scene', quote: 'Mara vanishes.' }); }],
    ['unbacked lore', (c: StateCandidate) => { c.state.ext.codex = [{ fact: 'The moon is iron.' }]; }],
  ])('rejects %s without changing prior state', (_label, mutate) => {
    const i = input(); const before = JSON.stringify(i.prior); const c = candidate(); mutate(c);
    expect(validateCompilation(c, i).ok).toBe(false); expect(JSON.stringify(i.prior)).toBe(before);
  });
  it('exports strict nested provider schemas from the local validator', () => {
    const schema = jsonSchema(CompilerCandidate) as any;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.state.properties.scene.properties.clock).toMatchObject({ type: 'integer', minimum: 0, maximum: 1439 });
    expect(schema.properties.state.properties.delta.additionalProperties).toBe(false);
    expect(schema.properties.state.properties.delta.properties.secrets.items.properties.from.anyOf[1].maxItems).toBe(32);
  });
  it('offers the provider a partial change schema instead of engine bookkeeping', () => {
    const schema = compilerProviderSchema() as any;
    expect(schema.required).toEqual(['state']);
    expect(schema.properties).not.toHaveProperty('evidence');
    expect(schema.properties).not.toHaveProperty('trackEvidence');
    expect(schema.properties).not.toHaveProperty('parallelReviewed');
    expect(schema.properties.state.required).toEqual([]);
    expect(schema.properties.state.properties.scene.required).toEqual([]);
    expect(schema.properties.state.properties.scene.properties.evidence.properties).toHaveProperty('present');
    expect(schema.properties.state.properties.present.items.required).toEqual(['id']);
    expect(schema.properties.state.properties.delta.properties.offscreen.items.properties.evidence).toEqual({ type: 'string' });
  });
  it('repairs a looping secret audience before filing the canonical block', () => {
    const i = input();
    i.prose += ' Ada whispers that the copper key opens the sealed archive.';
    const c = candidate();
    c.state.delta.secrets = [{
      keeper: 'Ada', secret: 'the copper key opens the sealed archive',
      from: ['Ada', 'Mara', ...Array.from({ length: 100 }, () => 'Mara'), 'unspecified'],
    }];
    c.evidence.push({ path: 'delta.secrets.0', quote: 'Ada whispers that the copper key opens the sealed archive' });
    const compiled = salvageCompilation(c, i);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(JSON.parse(compiled.block.slice(9, -9)).delta.secrets[0].from).toEqual(['mara']);
  });
  it('drops a recreated tracked secret instead of echoing it into the next block', () => {
    const i = input();
    i.prior.secrets = [{ id: 'sec_key', keeper: 'ada', from: ['mara'], text: 'the copper key opens the sealed archive', revealed: false, revealedTo: [], formedTurn: 1 }];
    i.prose += ' Ada repeats that the copper key opens the sealed archive.';
    const c = candidate();
    c.state.delta.secrets = [{ keeper: 'Ada', secret: 'the copper key opens the sealed archive', from: ['Mara'] }];
    c.evidence.push({ path: 'delta.secrets.0', quote: 'Ada repeats that the copper key opens the sealed archive' });
    const compiled = salvageCompilation(c, i);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(JSON.parse(compiled.block.slice(9, -9)).delta.secrets ?? []).toEqual([]);
    expect(compiled.recovered).toContain('delta.secrets.0');
  });
  it('allows disabled Codex only for an actually consumed eligible genesis', () => {
    const i = input();
    i.genesisAllowed = true; i.codexAllowed = false;
    i.prose += ' The moon is iron.';
    const c = candidate();
    c.state.ext.codex = [{ fact: 'The moon is iron.' }];
    c.evidence.push({ path: 'ext.codex.0', quote: 'The moon is iron.' });
    expect(validateCompilation(c, i).ok).toBe(false);
    c.genesis = true;
    expect(validateCompilation(c, i).ok).toBe(true);
  });
  it('accepts only evidence-backed updates to existing secret and Codex ids', () => {
    const i = input();
    i.prior.secrets = [{ id: 'sec_gate', keeper: 'ada', from: ['mara'], text: 'the gate code is seven', revealed: false, revealedTo: [], formedTurn: 1 }];
    i.prior.lore = [{ id: 'lore_bell', fact: 'The bell rings at dawn', source: 'user', status: 'confirmed', turn: 1 }];
    i.prose += ' Ada tells Mara the gate code is seven. The bell now rings at dusk.';
    const c = candidate();
    c.state.delta.secretReveals = [{ id: 'sec_gate', to: ['Mara'] }];
    c.state.delta.knowledge = [{ who: 'Mara', fact: 'the gate code is seven', reliability: 'knows', truth: 'unknown', source: 'Ada tells Mara' }];
    c.state.ext.codex = [{ id: 'lore_bell', op: 'refresh', fact: 'The bell now rings at dusk' }];
    c.evidence.push(
      { path: 'delta.secretReveals.0', quote: 'Ada tells Mara the gate code is seven' },
      { path: 'delta.knowledge.0', quote: 'Ada tells Mara the gate code is seven' },
      { path: 'ext.codex.0', quote: 'The bell now rings at dusk' },
    );
    expect(validateCompilation(c, i).ok).toBe(true);
    c.state.delta.secretReveals[0]!.id = 'invented_secret';
    expect(validateCompilation(c, i).ok).toBe(false);
  });
  it('accepts a direct thread development with an exact before-evidence-after proof', () => {
    const i = input();
    i.prior.threads = [{ id: 'thr_forged_letter', name: 'The Forged Letter', status: 'Mara hid the forged letter', beats: ['Mara hid the forged letter beneath the ledger'], firstTurn: 1, lastTurn: 1 }];
    i.prose += ' Ada finds the forged letter beneath the ledger.';
    const c = candidate();
    c.state.delta.threads = [{ op: 'advance', name: 'The Forged Letter', note: 'Ada finds the forged letter beneath the ledger' }];
    c.evidence.push({ path: 'delta.threads.0', quote: 'Ada finds the forged letter beneath the ledger' });
    c.trackEvidence.push({ path: 'delta.threads.0', targetId: 'thr_forged_letter', before: 'Mara hid the forged letter beneath the ledger', after: 'Ada finds the forged letter beneath the ledger', quote: 'Ada finds the forged letter beneath the ledger', basis: 'direct_development' });
    expect(validateCompilation(c, i).ok).toBe(true);
  });
  it('requires a new plot title to describe the unresolved situation established in prose', () => {
    const i = input();
    i.prose += ' A courier delivers a blackmail letter demanding the royal seal.';
    const c = candidate();
    c.state.delta.threads = [{ op: 'new', name: 'The Blackmail Letter', note: 'A blackmail letter demands the royal seal' }];
    c.evidence.push({ path: 'delta.threads.0', quote: 'A courier delivers a blackmail letter demanding the royal seal' });
    c.trackEvidence.push({ path: 'delta.threads.0', targetId: 'new', before: 'absent', after: 'A blackmail letter demands the royal seal', quote: 'A courier delivers a blackmail letter demanding the royal seal', basis: 'new_open_question' });
    expect(validateCompilation(c, i).ok).toBe(true);
    c.state.delta.threads[0]!.name = 'The Missing Heir';
    expect(validateCompilation(c, i).ok).toBe(false);
  });
  it('rejects unrelated, stale, mis-targeted, and unproven thread movement', () => {
    const i = input();
    i.prior.threads = [{ id: 'thr_forged_letter', name: 'The Forged Letter', status: 'Mara hid the forged letter', beats: ['Mara hid the forged letter beneath the ledger'], firstTurn: 1, lastTurn: 1 }];
    i.prose += ' Gabriel watches the sunrise brighten the kitchen.';
    const c = candidate();
    c.state.delta.threads = [{ op: 'advance', name: 'The Forged Letter', note: 'Gabriel watches the sunrise brighten the kitchen' }];
    c.evidence.push({ path: 'delta.threads.0', quote: 'Gabriel watches the sunrise brighten the kitchen' });
    c.trackEvidence.push({ path: 'delta.threads.0', targetId: 'thr_forged_letter', before: 'Mara hid the forged letter beneath the ledger', after: 'Gabriel watches the sunrise brighten the kitchen', quote: 'Gabriel watches the sunrise brighten the kitchen', basis: 'direct_development' });
    const unrelated = validateCompilation(c, i);
    expect(unrelated.ok).toBe(false);
    if (!unrelated.ok) expect(unrelated.errors).toContain('plot proof is not grounded in the tracked situation: delta.threads.0');

    c.state.delta.threads[0]!.note = 'Mara hid the forged letter beneath the ledger';
    c.trackEvidence[0]!.after = 'Mara hid the forged letter beneath the ledger';
    c.trackEvidence[0]!.quote = 'Mara hid the forged letter beneath the ledger';
    c.evidence[c.evidence.length - 1]!.quote = 'Mara hid the forged letter beneath the ledger';
    i.prose += ' Mara hid the forged letter beneath the ledger.';
    expect(validateCompilation(c, i).ok).toBe(false);

    c.state.delta.threads[0]!.note = 'Ada finds the forged letter beneath the ledger';
    c.trackEvidence[0] = { ...c.trackEvidence[0]!, targetId: 'thr_wrong', after: 'Ada finds the forged letter beneath the ledger', quote: 'Ada finds the forged letter beneath the ledger' };
    c.evidence[c.evidence.length - 1]!.quote = 'Ada finds the forged letter beneath the ledger';
    i.prose += ' Ada finds the forged letter beneath the ledger.';
    expect(validateCompilation(c, i).ok).toBe(false);

    c.trackEvidence = [];
    expect(validateCompilation(c, i).ok).toBe(false);
  });
  it('advances an arc from a changed linked thread and rejects character-only arc drift', () => {
    const i = input();
    i.prior.arcs = [{ id: 'thr_city_conspiracy', name: 'The City Conspiracy', status: 'The conspirators seek the seal', beats: ['The conspirators seek the royal seal'], firstTurn: 1, lastTurn: 1 }];
    i.prior.threads = [{ id: 'thr_stolen_seal', name: 'The Stolen Seal', status: 'Ada searches the archive', beats: ['Ada searches the archive for the royal seal'], arc: 'thr_city_conspiracy', firstTurn: 1, lastTurn: 1 }];
    i.prose += ' Ada finds the royal seal hidden in the archive wall.';
    const c = candidate();
    c.state.delta.threads = [{ op: 'advance', name: 'The Stolen Seal', note: 'Ada finds the royal seal hidden in the archive wall' }];
    c.state.delta.arcs = [{ op: 'advance', name: 'The City Conspiracy', note: 'Finding the royal seal changes the conspirators\' leverage' }];
    c.evidence.push(
      { path: 'delta.threads.0', quote: 'Ada finds the royal seal hidden in the archive wall' },
      { path: 'delta.arcs.0', quote: 'Ada finds the royal seal hidden in the archive wall' },
    );
    c.trackEvidence.push(
      { path: 'delta.threads.0', targetId: 'thr_stolen_seal', before: 'Ada searches the archive for the royal seal', after: 'Ada finds the royal seal hidden in the archive wall', quote: 'Ada finds the royal seal hidden in the archive wall', basis: 'direct_development' },
      { path: 'delta.arcs.0', targetId: 'thr_city_conspiracy', before: 'The conspirators seek the royal seal', after: 'Finding the royal seal changes the conspirators\' leverage', quote: 'Ada finds the royal seal hidden in the archive wall', basis: 'child_milestone', childThreadIds: ['thr_stolen_seal'] },
    );
    const accepted = validateCompilation(c, i);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    const folded = foldTurn(accepted.block, structuredClone(i.prior), i.turn, { validatedCompiler: true });
    expect(folded.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'thread.op', name: 'The Stolen Seal' }),
      expect.objectContaining({ kind: 'arc.op', name: 'The City Conspiracy' }),
    ]));
    c.trackEvidence[1]!.childThreadIds = [];
    expect(validateCompilation(c, i).ok).toBe(false);
  });
  it('bounds compiler context while retaining current actors and parallel rows', () => {
    const i = input();
    for (let n = 0; n < 400; n++) i.prior.knowledge.push({ id: `k${n}`, who: 'mara', fact: 'fact '.repeat(40) + n, reliability: 'knows', truth: 'unknown', turn: n });
    const context = compilerContext(i);
    expect(context.length).toBeLessThan(45000);
    expect(context).toContain('Courtyard'); expect(context).toContain('Mara');
  });
  it('labels the canonical day count separately from the formatted calendar date', () => {
    const i = input();
    i.prior.day = 2;
    i.prior.dateFormat = 'month-day-year';
    i.prior.dateEpoch = new Date(2001, 9, 15, 12);
    const context = JSON.parse(compilerContext(i));
    expect(context.prior.dayCount).toBe(2);
    expect(context.prior.displayedDate).toBe('October 17, 2001');
    expect(context.prior.day).toBeUndefined();
  });
  it.each([
    ['lean', 'compact_fields'],
    ['full', 'expanded_fields'],
  ] as const)('declares identical content coverage with %s formatting', (verbosity, format) => {
    const i = input();
    i.verbosity = verbosity;
    const context = JSON.parse(compilerContext(i));
    expect(context.outputContract).toMatchObject({
      contentCoverage: 'all_supported_durable_changes',
      sceneAndPresent: 'complete_current_snapshot',
      format,
    });
    expect(context.outputContract.rule).toContain('never reduces facts, events, state families');
  });
  it('repairs a copied calendar day-of-month in engine and inline state', () => {
    const i = input();
    i.prior.day = 2;
    i.prior.dateFormat = 'month-day-year';
    i.prior.dateEpoch = new Date(2001, 9, 15, 12);
    i.prior.scene = { ...i.prior.scene, time: '19:38', clock: 1178 };
    i.prose = 'October 17 remains cold. Mara waits one minute. Player stays quiet.';
    const c = candidate();
    c.state.day = 17;
    c.state.scene = { loc: 'Archive', time: '19:39', clock: 1179 };
    c.evidence = [{ path: 'scene.time', quote: 'October 17' }];
    const compiled = validateCompilation(c, i);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.recovered).toContain('state.day (kept canonical story-day count)');
    expect(JSON.parse(compiled.block.slice(9, -9)).day).toBe(2);

    const inline = foldTurn(`October 17 remains cold. Mara waits one minute.
<vellum>
${JSON.stringify(c.state)}
</vellum>`, i.prior, 2);
    expect(inline.events.find(event => event.kind === 'turn.fold')?.day).toBe(2);
    expect(inline.events.find(event => event.kind === 'continuity.flag' && event.code === 'day_creep')).toBeTruthy();
  });
  it('prioritizes an old relevant secret over newer unrelated rows', () => {
    const i = input();
    i.prose += ' Mara repeats that the obsidian gate code is seven.';
    i.prior.secrets = Array.from({ length: 80 }, (_, n) => ({ id: `sec_${n}`, keeper: 'ada', from: ['mara'], text: n === 0 ? 'the obsidian gate code is seven' : `unrelated secret ${n}`, revealed: false, revealedTo: [], formedTurn: n + 1 }));
    const context = compilerContext(i);
    expect(context).toContain('the obsidian gate code is seven');
    expect(context).not.toContain('unrelated secret 1"');
  });
  it('compacts damaged prior secret audiences before sending compiler context', () => {
    const i = input();
    i.prior.secrets = [{
      id: 'sec_loop', keeper: 'ada', text: 'the copper key opens the sealed archive', revealed: false,
      from: ['ada', 'mara', ...Array.from({ length: 100 }, () => 'mara'), 'unspecified'], revealedTo: [], formedTurn: 1,
    }];
    expect(JSON.parse(compilerContext(i)).prior.secrets[0].from).toEqual(['mara']);
  });
  it('passes the persona-state control to the second-pass model', () => {
    const i = input(); i.personaState = true;
    expect(JSON.parse(compilerContext(i)).controls.personaState).toBe(true);
  });
  it('supplies semantic evidence policy and cast life-state to Engine Pass', () => {
    const i = input();
    i.prior.cast.ada!.deceased = true;
    const context = JSON.parse(compilerContext(i));
    expect(context.evidencePolicy.question).toContain('factually correct');
    expect(context.evidencePolicy.accepted).toContain('faithful paraphrase');
    expect(context.parallelPolicy.proseQuoteRequired).toBe(false);
    expect(context.parallelPolicy.hardReject).toContain('deceased actor');
    expect(context.prior.cast.find((row: { id: string }) => row.id === 'ada')).toMatchObject({ deceased: true });
  });
  it('keeps the Cast-selected player persona distinct from the character card', () => {
    const i = input();
    i.userName = 'Gabriel Winters';
    i.characterName = 'Buffy Summers';
    const context = JSON.parse(compilerContext(i));
    expect(context.identity.playerPersona).toEqual({ id: 'gabriel_winters', name: 'Gabriel Winters' });
    expect(context.identity.characterCard).toEqual({ id: 'buffy_summers', name: 'Buffy Summers' });
    expect(context.identity.rule).toContain('characterCard is {{char}} and must never replace it');
  });
  it('supplies relevant attached lorebook canon as world truth without making it character knowledge', () => {
    const i = input();
    i.prose += ' Mara studies a map of the Moon Gate.';
    i.lorebookCanon = [
      { id: 'moon-gate', bookId: 'setting', title: 'Moon Gate', keys: ['Moon Gate'], content: 'The Moon Gate is the only pass through the eastern ridge.' },
      { id: 'irrelevant', bookId: 'setting', title: 'Western Sea', keys: ['Western Sea'], content: 'The western sea freezes each winter.' },
    ];
    const context = JSON.parse(compilerContext(i));
    expect(context.prior.lorebookCanon[0]).toMatchObject({ id: 'moon-gate', content: expect.stringContaining('only pass') });
    expect(context.prior.knowledge).toEqual([]);
  });
  it('accepts Director persona detail grounded in completed prose', () => {
    const i = input();
    i.personaState = true;
    i.agency = 'director';
    i.userName = 'Gabriel Winters';
    i.prose = 'Mara waits five minutes. Gabriel Winters rubs his tired eyes, wary of the seal. The seal is a trap, he thinks.';
    i.prior.cast.gabriel_winters = { ...i.prior.cast.mara, id: 'gabriel_winters', name: 'Gabriel Winters', aka: [], status: 'present', source: 'user', firstTurn: 1, lastTurn: 1, traits: ['stubborn'], userEdited: false };
    i.prior.scene.present.push('gabriel_winters');
    const c = candidate();
    c.state.present = [
      { id: 'Gabriel Winters', mood: 'wary', condition: 'tired', doing: 'rubbing his eyes', thought: 'The seal is a trap.', traits: ['stubborn'] },
      { id: 'Mara', thought: 'I should wait.' },
    ];
    c.evidence.push(
      { path: 'present.persona.mood', quote: 'wary of the seal' },
      { path: 'present.persona.condition', quote: 'tired eyes' },
      { path: 'present.persona.doing', quote: 'rubs his tired eyes' },
      { path: 'present.persona.thought', quote: 'The seal is a trap, he thinks' },
    );
    expect(validateCompilation(c, i).ok).toBe(true);
  });
  it('passes Living World policy and grounded starts to the second-pass model', async () => {
    const i = input();
    i.prior.parallel = [];
    i.livingWorld = 'sandbox';
    i.configuredLivingWorld = 'active';
    i.social = 'autonomous';
    i.politics = 'living';
    i.argent = true;
    i.prior.threads = [{ id: 'thr_existing', name: 'Existing plot', status: 'open', beats: [], firstTurn: 1, lastTurn: 1 }];
    i.prior.offscreen = [{ id: 'courier_watch', name: 'The Late Courier', status: 'active', who: 'ada', where: 'East Gate', gist: 'waiting for the courier', beats: ['waiting for the courier'], firstTurn: 1, lastTurn: 1 }] as any;
    i.prior.locations = ['Harbor', 'Bell Tower', 'Market'].map((name, index) => ({ id: `place_${index}`, name, source: 'user' as const, firstTurn: 1, lastTurn: 1 }));
    const c = candidate();
    c.parallelReviewed = [];
    c.parallelOps = [{ op: 'start', who: 'Ada', where: 'East Gate', activity: 'waiting for the courier', evidence: 'Ada at East Gate: waiting for the courier' }];
    c.state.delta.offscreen = [
      {
        op: 'new', id: 'harbor_watch', name: 'Harbor Watch', where: 'Harbor', gist: 'Dockworkers close the harbor gates', beatKind: 'progress',
        impact: 'Closing the gates delays every arriving courier and changes who can reach the archive.',
        grounding: { basis: ['scene', 'location'], rationale: 'At the established Harbor, dockworkers close the gates and alter access to the city.', after: 'Dockworkers close the harbor gates' },
      },
      {
        op: 'new', id: 'bell_watch', name: 'Bell Watch', where: 'Bell Tower', gist: 'The warning bells begin ringing', beatKind: 'consequence',
        impact: 'The warning bells alert the district and force the archive to react to the alarm.',
        grounding: { basis: ['scene', 'location'], rationale: 'At the established Bell Tower, the keepers sound the warning bells for the district.', after: 'The warning bells begin ringing' },
      },
    ];
    c.evidence.push(
      { path: 'delta.offscreen.0', quote: 'At the Harbor, dockworkers close the harbor gates.' },
      { path: 'delta.offscreen.1', quote: 'At the Bell Tower, the warning bells begin ringing.' },
    );
    c.parallelWorldOps = [
      { op: 'start', where: 'Harbor', activity: 'Dockworkers close the harbor gates', evidence: 'At the Harbor, dockworkers close the harbor gates.' },
      { op: 'start', where: 'Bell Tower', activity: 'The warning bells begin ringing', evidence: 'At the Bell Tower, the warning bells begin ringing.' },
      { op: 'start', where: 'Market', activity: 'Merchants shutter the market stalls', evidence: 'At the Market, merchants shutter the market stalls.' },
    ];
    const generate = vi.fn().mockResolvedValue({ ok: true, value: JSON.stringify(c) });
    const r = await compileState(i, null, undefined, generate);
    expect(r.ok).toBe(true);
    expect(generate.mock.calls[0]![0][1].content).toContain('"livingWorld":"active"');
    expect(generate.mock.calls[0]![0][1].content).toContain('"effectiveLivingWorld":"sandbox"');
    expect(generate.mock.calls[0]![0][1].content).toContain('"social":"autonomous"');
    expect(generate.mock.calls[0]![0][1].content).toContain('"politics":"living"');
    expect(generate.mock.calls[0]![0][1].content).toContain('"subplotDueCap":0');
    expect(generate.mock.calls[0]![0][1].content).toContain('"subplotNewCap":0');
    expect(generate.mock.calls[0]![0][1].content).toContain('"sandboxNewSubplotMinimum":2');
    expect(generate.mock.calls[0]![0][1].content).toContain('"sandboxParallelEventMinimum":4');
    expect(generate.mock.calls[0]![0][1].content).toContain('"sandboxMaximum":"none"');
    expect(generate.mock.calls[0]![0][1].content).toContain('Ada at East Gate: waiting for the courier');
  });
  it('rejects an ARGENT reply that skips its required opening thread and parent arc', async () => {
    const i = input();
    i.argent = true;
    i.prose = 'A courier delivers a blackmail letter. The letter demands the royal seal before dawn. The blackmail threat places the royal seal in immediate danger.';
    const empty = vi.fn().mockResolvedValue({ ok: true, value: '{"state":{}}' });
    const missing = await compileState(i, null, undefined, empty);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors).toEqual(expect.arrayContaining([
      'ARGENT requires exactly one grounded opening thread when the plot ledger is empty',
      'ARGENT requires exactly one grounded opening parent arc when no parent arc exists',
    ]));

    const required = {
      state: { delta: {
        threads: [{ op: 'new', name: 'The Blackmail Letter', note: 'The letter demands the royal seal before dawn', arc: 'The Royal Seal Crisis', evidence: 'The letter demands the royal seal before dawn.' }],
        arcs: [{ op: 'new', name: 'The Royal Seal Crisis', note: 'The blackmail threat places the royal seal in immediate danger', evidence: 'The blackmail threat places the royal seal in immediate danger.' }],
      } },
    };
    const filled = vi.fn().mockResolvedValue({ ok: true, value: JSON.stringify(required) });
    expect((await compileState(i, null, undefined, filled)).ok).toBe(true);
  });
  it('does not count subplot-linked tracks as extra ARGENT opening threads or arcs', () => {
    const i = input();
    i.argent = true;
    i.livingWorld = 'sandbox';
    i.prose = 'A courier delivers a blackmail letter while harbor guards close the gates and bell keepers prepare a warning.';
    const c = candidate();
    c.state.delta.threads = [
      { op: 'new', name: 'The Blackmail Letter', note: 'The letter demands the royal seal', arc: 'The Royal Seal Crisis' },
      { op: 'new', id: 'thread_harbor_watch', name: 'Harbor Watch', note: 'Harbor guards close the gates', arc: 'Harbor Lockdown' },
      { op: 'new', id: 'thread_bell_watch', name: 'Bell Watch', note: 'Bell keepers prepare a warning', arc: 'Bell Alarm' },
    ];
    c.state.delta.arcs = [
      { op: 'new', name: 'The Royal Seal Crisis', note: 'The blackmail threat puts the seal in danger' },
      { op: 'new', name: 'Harbor Lockdown', note: 'The harbor is closing under pressure' },
      { op: 'new', name: 'Bell Alarm', note: 'The warning network is mobilizing' },
    ];
    c.state.delta.offscreen = [
      { op: 'new', id: 'harbor_watch', name: 'Harbor Watch', where: 'Harbor', gist: 'Harbor guards close the gates', thread: 'thread_harbor_watch', arc: 'Harbor Lockdown' },
      { op: 'new', id: 'bell_watch', name: 'Bell Watch', where: 'Bell Tower', gist: 'Bell keepers prepare a warning', thread: 'Bell Watch', arc: 'Bell Alarm' },
    ];
    c.parallelWorldOps = Array.from({ length: 4 }, (_, index) => ({
      op: 'start' as const, where: `Place ${index}`, activity: `World event ${index}`, evidence: `World event ${index}`,
    }));
    expect(argentRequirementErrors(c, i)).toEqual([]);
  });
  it('keeps the Living/Active caps but removes Sandbox caps', () => {
    const makeRows = (count: number) => Array.from({ length: count }, (_, index) => ({
      op: 'new' as const, id: `watch_${index}`, name: `Watch ${index}`, where: 'Courtyard', gist: `Bell watch ${index} begins`, beatKind: 'progress' as const,
      impact: `Bell watch ${index} changes when the archive receives its next warning.`,
      grounding: { basis: ['scene', 'location'] as const, rationale: `At the Courtyard, bell watch ${index} begins and changes the warning schedule.`, after: `Bell watch ${index} begins` },
    }));
    const i = input(); i.livingWorld = 'active';
    const c = candidate();
    c.state.delta.offscreen = makeRows(2);
    c.evidence.push(
      { path: 'delta.offscreen.0', quote: 'At the Courtyard, bell watch 0 begins and changes the warning schedule.' },
      { path: 'delta.offscreen.1', quote: 'At the Courtyard, bell watch 1 begins and changes the warning schedule.' },
    );
    const living = validateCompilation(c, i);
    expect(living.ok).toBe(false);
    if (!living.ok) expect(living.errors).toContain('offscreen deltas exceed the active new-row cap of 1');

    i.livingWorld = 'sandbox';
    c.state.delta.offscreen = makeRows(3);
    c.evidence.push({ path: 'delta.offscreen.2', quote: 'At the Courtyard, bell watch 2 begins and changes the warning schedule.' });
    const autonomous = validateCompilation(c, i);
    expect(autonomous.ok).toBe(true);
  });
  it('enforces Sandbox floors without imposing a maximum', () => {
    const i = input(); i.argent = true; i.livingWorld = 'sandbox';
    i.prior.threads = [{ id: 'thr_existing', name: 'Existing plot', status: 'open', beats: [], firstTurn: 1, lastTurn: 1 }];
    const c = candidate();
    expect(argentRequirementErrors(c, i)).toEqual(expect.arrayContaining([
      'ARGENT Sandbox requires at least 2 new durable subplots; received 0',
      'ARGENT Sandbox requires at least 4 parallel event operations; received 0',
    ]));
    c.state.delta.offscreen = Array.from({ length: 7 }, (_, index) => ({ op: 'new' as const, id: `subplot_${index}`, name: `Subplot ${index}`, where: `Place ${index}`, gist: `World pressure ${index}` }));
    c.parallelWorldOps = Array.from({ length: 9 }, (_, index) => ({ op: 'start' as const, where: `Place ${index}`, activity: `World event ${index}`, evidence: `At Place ${index}, world event ${index} unfolds.` }));
    expect(argentRequirementErrors(c, i)).toEqual([]);
  });
  it('corrects offscreen status:"active" to op:"new" when the subplot is not in the prior ledger', () => {
    const i = input(); i.argent = true; i.livingWorld = 'sandbox'; i.evidenceMode = 'none';
    i.prior.threads = [{ id: 'thr_existing', name: 'Existing plot', status: 'open', beats: [], firstTurn: 1, lastTurn: 1 }];
    i.prose = 'Mara waits. Elsewhere, Ada watches the gate and the bell-ringer tries the south path. Player stays quiet.';
    const raw: any = {
      state: { day: 1, scene: { loc: 'Archive', time: '00:03', clock: 3 }, present: [], delta: { offscreen: [
        { status: 'active', id: 'gate_watch', name: 'Gate watch', who: 'Ada', where: 'Courtyard', gist: 'watches the gate', beatKind: 'progress', impact: 'Ada can intercept couriers at the gate.', grounding: { basis: ['scene', 'character', 'location'], rationale: 'Ada is established and watches the Courtyard gate.' } },
        { status: 'active', id: 'south_path', name: 'South path', who: 'Ada', where: 'Courtyard', gist: 'tries the south path', beatKind: 'progress', impact: 'A new route opens for Ada.', grounding: { basis: ['scene', 'character', 'location'], rationale: 'Ada explores a south path from the Courtyard.' } },
      ] } },
      parallelOps: [
        { op: 'start', who: 'Ada', where: 'Courtyard', activity: 'watches the gate', evidence: 'Ada watches the gate' },
        { op: 'start', who: 'Ada', where: 'Courtyard', activity: 'tries the south path', evidence: 'Ada tries the south path' },
        { op: 'start', where: 'Square', activity: 'A bell rings', evidence: 'A bell rings in the square' },
        { op: 'start', where: 'Harbor', activity: 'A ship docks', evidence: 'A ship docks at the harbor' },
      ],
    };
    const result = salvageCompilation(raw, i);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const offscreen = result.candidate.state.delta.offscreen ?? [];
    expect(offscreen.length).toBeGreaterThanOrEqual(1);
    expect(offscreen.every((r: any) => r.op === 'new')).toBe(true);
  });
  it('retargets offscreen op:"new" to "advance" when the subplot already exists in the prior ledger', () => {
    const i = input(); i.argent = true; i.livingWorld = 'sandbox'; i.evidenceMode = 'none';
    i.prior.threads = [{ id: 'thr_existing', name: 'Existing plot', status: 'open', beats: [], firstTurn: 1, lastTurn: 1 }];
    i.prior.offscreen = [{ id: 'gate_watch', name: 'Gate watch', who: 'ada', where: 'Courtyard', gist: 'watches the gate', status: 'active', beats: ['watches the gate'], firstTurn: 1, lastTurn: 1 }] as any;
    i.prose = 'Mara waits. Ada spots a courier approaching. The bell-ringer tries the south path. Player stays quiet.';
    const raw: any = {
      state: { day: 1, scene: { loc: 'Archive', time: '00:03', clock: 3 }, present: [], delta: { offscreen: [
        { status: 'active', id: 'gate_watch', name: 'Gate watch', who: 'Ada', where: 'Courtyard', gist: 'spots a courier approaching the gate', beatKind: 'progress', impact: 'Ada can intercept the courier before they reach the archive.', grounding: { basis: ['scene', 'character', 'subplot'], rationale: 'Ada spots a courier from her Courtyard post.', before: 'watches the gate', after: 'spots a courier approaching the gate' } },
        { status: 'active', id: 'south_path', name: 'South path', who: 'Ada', where: 'Courtyard', gist: 'tries the south path', beatKind: 'progress', impact: 'A new route opens for Ada.', grounding: { basis: ['scene', 'character', 'location'], rationale: 'Ada explores a south path from the Courtyard.' } },
      ] } },
      parallelOps: [
        { op: 'start', who: 'Ada', where: 'Courtyard', activity: 'spots a courier approaching the gate', evidence: 'Ada spots a courier approaching' },
        { op: 'start', who: 'Ada', where: 'Courtyard', activity: 'tries the south path', evidence: 'Ada tries the south path' },
        { op: 'start', where: 'Square', activity: 'A bell rings', evidence: 'A bell rings in the square' },
        { op: 'start', where: 'Harbor', activity: 'A ship docks', evidence: 'A ship docks at the harbor' },
      ],
    };
    const result = salvageCompilation(raw, i);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const offscreen = result.candidate.state.delta.offscreen ?? [];
    const gate = offscreen.find((r: any) => r.id === 'gate_watch');
    const south = offscreen.find((r: any) => r.id === 'south_path');
    expect(gate?.op).toBe('advance');
    expect(south?.op).toBe('new');
  });
  it('normalizes offscreen beatKind/impact/grounding aliases during inline parse', () => {
    const block = `<vellum>{"scene":{"loc":"Archive","time":"00:03","clock":3},"present":[],"delta":{"offscreen":[
      {"op":"new","id":"gate_watch","name":"Gate watch","who":"Ada","where":"Gate","gist":"watches the gate",
       "type":"progress","effect":"Ada can intercept couriers.","rationale":"Ada is at the gate.","basis":"scene"}
    ]}}</vellum>`;
    const { state } = parseState(block);
    expect(state).not.toBeNull();
    if (!state) return;
    const row = state.delta?.offscreen?.[0];
    expect(row).toMatchObject({ beatKind: 'progress', impact: 'Ada can intercept couriers.' });
    expect(row?.grounding).toMatchObject({ rationale: 'Ada is at the gate.', basis: ['scene'] });
  });
  it('forbids the persona from subplots and parallel events', () => {
    const i = input(); i.livingWorld = 'sandbox'; i.argent = true;
    i.prior.threads = [{ id: 'thr_existing', name: 'Existing plot', status: 'open', beats: [], firstTurn: 1, lastTurn: 1 }];
    const c = candidate();
    c.state.delta.offscreen = [{ op: 'new', id: 'player_watch', name: 'Player Watch', who: 'Player', where: 'Courtyard', gist: 'Player waits beyond the scene' }];
    c.evidence.push({ path: 'delta.offscreen.0', quote: 'Player waits in the Courtyard beyond the scene.' });
    c.parallelOps = [{ op: 'start', who: 'Player', where: 'Courtyard', activity: 'waits beyond the scene', evidence: 'Player waits in the Courtyard beyond the scene.' }];
    const result = validateCompilation(c, i);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toEqual(expect.arrayContaining([
      'persona cannot appear in an offscreen subplot: player_watch',
      'persona cannot appear in a parallel event: Player',
    ]));
  });
  it.each(['protected', 'continuity', 'director'] as const)('passes the %s agency contract for this turn only', (agency) => {
    const i = input();
    i.agency = agency;
    i.userInput = agency === 'director' ? 'OOC: Direct Mara to leave with me.' : 'I reach for the latch.';
    const context = JSON.parse(compilerContext(i));
    expect(context.controls.agency).toBe(agency);
    expect(context.latestUser).toBe(i.userInput);
  });
  it('rejects a truncated provider response without repeating the expensive call', async () => {
    const generate = vi.fn().mockResolvedValue({ ok: true, value: JSON.stringify(candidate()).slice(0, -12) });
    const r = await compileState(input(), null, undefined, generate);
    expect(r.ok).toBe(false); expect(generate).toHaveBeenCalledTimes(1);
    if (!r.ok) expect(r.draft).toEqual(compilerRepairBase(input()));
  });
  it('applies a minimal merge patch without changing unaffected compiler branches', () => {
    const base = candidate();
    const patched = applyCompilerMergePatch(base, { state: { turn: 7, scene: { weather: 'rain' } } }) as StateCandidate;
    expect(patched.state.turn).toBe(7);
    expect(patched.state.scene.weather).toBe('rain');
    expect(patched.state.present).toEqual(base.state.present);
    expect(patched.evidence).toEqual(base.evidence);
  });
  it('regenerates corrections from the canonical repair base through a streamed merge patch', async () => {
    const i = input();
    i.personaState = true;
    const rejected = candidate();
    Object.assign(rejected.state.present.find(row => row.id === 'Player')!, {
      mood: 'wary', doing: 'keeping still', thought: 'I should stay quiet.', traits: ['patient'],
    });
    const invalid = validateCompilation(structuredClone(rejected), i);
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    const replacement = structuredClone(rejected.state.present);
    replacement.find(row => row.id === 'Player')!.condition = 'tired';
    const reply = JSON.stringify({ patch: { state: { present: replacement } } });
    const progress: Array<Record<string, unknown>> = [];
    const generate = vi.fn(async (_messages: unknown, _params: unknown, _userId: unknown, options: any) => {
      options.onStream?.({ type: 'content', token: reply });
      return { ok: true as const, value: reply };
    });
    const repaired = await repairCompilation(i, rejected, invalid.errors, null, undefined, generate as any, {
      attempt: 2,
      onProgress: update => progress.push(update as unknown as Record<string, unknown>),
    });
    expect(repaired.ok).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
    const messages = generate.mock.calls[0]![0] as Array<{ content: string }>;
    expect(messages[0]!.content).toContain('regenerate a corrected VELLUM compiler candidate');
    expect(messages[0]!.content).toContain('failed attempt is intentionally not supplied');
    const context = JSON.parse(messages[1]!.content);
    expect(context.repairBase).toEqual(compilerRepairBase(i));
    expect(context.authority).toContain('failed attempt is not repair evidence');
    expect(context).not.toHaveProperty('rejectedAttempt');
    expect(context).not.toHaveProperty('rejectedFragment');
    expect(progress.map(update => update.status)).toEqual(expect.arrayContaining(['retry', 'chunk', 'validating', 'validated']));
    if (repaired.ok) expect(repaired.candidate.state.present.find(row => row.id === 'Player')?.condition).toBe('tired');
  });
  it('rejects a no-op repair so a timeout cannot silently file an unchanged base', async () => {
    const i = input();
    const draft = compilerRepairBase(i);
    const generate = vi.fn().mockResolvedValue({ ok: true, value: '{"patch":{}}' });
    const repaired = await repairCompilation(i, draft, ['timeout'], null, undefined, generate);
    expect(repaired).toMatchObject({ ok: false, errors: ['Repair patch made no changes to the canonical repair base'] });
  });

  it('creates missing required state without retaining unsupported rows from the rejected attempt', async () => {
    const i = input();
    i.personaState = true;
    i.userInput = 'I stay beside Mara, exhausted but alert. I think the seal is a trap.';
    const rejected = candidate();
    rejected.state.present = [{ id: 'Mara', thought: 'I should wait.' }];
    rejected.state.delta.threads = [{ op: 'new', name: 'Unsupported Detour', note: 'A fact absent from the turn.' }];
    const player = { id: 'Player', mood: 'alert', doing: 'staying beside Mara', condition: 'exhausted', thought: 'The seal is a trap.', traits: ['watchful'] };
    const reply = JSON.stringify({ patch: { state: { present: [{ id: 'Mara' }, player] } } });
    const generate = vi.fn().mockResolvedValue({ ok: true, value: reply });
    const repaired = await repairCompilation(i, rejected, ['persona state requires the player in present'], null, undefined, generate);
    expect(repaired.ok).toBe(true);
    if (!repaired.ok) return;
    expect(repaired.candidate.state.present).toContainEqual(expect.objectContaining({ id: 'Player', thought: 'The seal is a trap.' }));
    expect(repaired.candidate.state.delta.threads).toBeUndefined();
  });
  it('accepts a complete streamed object even when the provider terminal event times out', async () => {
    const generate = vi.fn(async (_messages: unknown, _params: unknown, _userId: unknown, options: any) => {
      options.onStream?.({ type: 'content', token: JSON.stringify(candidate()) });
      return { ok: false as const, error: 'internalGenerate_timeout_45000ms' };
    });
    const r = await compileState(input(), null, undefined, generate as any);
    expect(r.ok).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('keeps supported state and drops only an invalid optional mutation locally', () => {
    const i = input();
    const c = candidate();
    c.state.ext.codex = [{ fact: 'The moon is iron.' }];
    const r = salvageCompilation(c, i);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.recovered).toContain('ext.codex.0');
    expect(r.candidate.state.ext.codex).toBeUndefined();
    expect(JSON.parse(r.block.slice(9, -9)).scene.time).toBe('00:03');
  });
  it('retains rejected plot rows as reviewable suggestions with a clear cause', () => {
    const i = input();
    i.prose += ' Gabriel watches the sunrise brighten the kitchen.';
    i.prior.threads = [{ id: 'thr_forged_letter', name: 'The Forged Letter', status: 'hidden', beats: ['Mara hid the forged letter'], firstTurn: 1, lastTurn: 1 }];
    const c = candidate();
    c.state.delta.threads = [{ op: 'advance', name: 'The Forged Letter', note: 'Gabriel watches the sunrise' }];
    c.evidence.push({ path: 'delta.threads.0', quote: 'Gabriel watches the sunrise brighten the kitchen' });
    c.trackEvidence.push({ path: 'delta.threads.0', targetId: 'thr_forged_letter', before: 'Mara hid the forged letter', after: 'Gabriel watches the sunrise', quote: 'Gabriel watches the sunrise brighten the kitchen', basis: 'direct_development' });
    const r = salvageCompilation(c, i);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.suggestions).toEqual([expect.objectContaining({ kind: 'thread', row: expect.objectContaining({ name: 'The Forged Letter' }) })]);
    expect(r.suggestions?.[0]?.reason).toContain('plot proof');
  });
  it('accepts typographic evidence variants and derives redundant plot proof bookkeeping', () => {
    const i = input();
    i.prose = 'Mara says, “The forged letter is in the east-wing vault.”';
    i.prior.threads = [{ id: 'thr_forged_letter', name: 'The Forged Letter', status: 'hidden', beats: ['Mara concealed the forged letter'], firstTurn: 1, lastTurn: 1 }];
    const c: any = candidate();
    c.state.delta.threads = [{ op: 'advance', name: 'The Forged Letter', note: 'The forged letter is in the east-wing vault.', evidence: '“The forged letter is in the east-wing vault.”' }];
    c.evidence = [];
    c.trackEvidence = [];
    const r = salvageCompilation(c, i);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.candidate.trackEvidence).toEqual([expect.objectContaining({ targetId: 'thr_forged_letter', basis: 'direct_development' })]);
    expect(r.candidate.evidence).toEqual([expect.objectContaining({ path: 'delta.threads.0' })]);
  });
  it('fills omitted boilerplate and strips unsupported shape keys locally', () => {
    const c: any = candidate();
    delete c.parallelOps; delete c.parallelReviewed; delete c.evidence; delete c.trackEvidence; delete c.genesis;
    c.state.v = 2;
    const r = salvageCompilation(c, input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.recovered).toContain('candidate shape');
    expect((r.candidate.state as any).v).toBeUndefined();
    expect(r.candidate.parallelReviewed).toEqual(['Ada']);
  });
  it('files a bare Engine reply with a subplot and parallel move but no roster or proof arrays', async () => {
    const i = input();
    i.livingWorld = 'active';
    i.prose = 'Mara waits five minutes. Elsewhere, Ada moves to the gate and waits beside it. Player stays quiet.';
    const raw = {
      state: { delta: { offscreen: [{
        op: 'new', id: 'gate_watch', name: 'Gate watch', who: 'Ada', where: 'Gate',
        gist: 'waits beside the gate', evidence: 'Ada moves to the gate and waits beside it', beatKind: 'progress',
        impact: 'Ada can intercept the courier at the gate and warn Mara before the archive is entered.',
        grounding: {
          basis: ['scene', 'character', 'location'],
          rationale: 'Ada is established and the scene explicitly places her at the gate waiting for the courier.',
          after: 'waits beside the gate',
        },
      }] } },
      parallelOps: [{ op: 'move', who: 'Ada', where: 'Gate', activity: 'waits beside the gate', evidence: 'Ada moves to the gate and waits beside it' }],
    };
    const generate = vi.fn().mockResolvedValue({ ok: true, value: JSON.stringify(raw) });
    const compiled = await compileState(i, null, undefined, generate);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const folded = foldTurn(compiled.block, structuredClone(i.prior), i.turn, { validatedCompiler: true, livingWorld: 'active' });
    const state = reduce(folded.events, i.prior);
    expect(state.offscreen).toEqual([expect.objectContaining({ id: 'gate_watch', who: 'ada', gist: 'waits beside the gate' })]);
    expect(state.parallel).toEqual([expect.objectContaining({ who: 'ada', where: 'Gate', activity: 'waits beside the gate' })]);
  });
  it('normalizes common Engine Pass aliases before evidence and schema validation', () => {
    const prior = freshState();
    prior.scene = { id: 'scn_pending', reason: 'new_chat', pending: true, location: '', time: '', tension: 0, weather: '', present: [], detail: [] };
    const prose = '[SCENE|Out of the Earth|Sunnydale Cemetery Clearing · Night]\nA sealed letter lies unopened on the altar, demanding a choice.';
    const i: CompilerInput = { prior, turn: 1, prose, userName: 'Player', genesisAllowed: false };
    const raw: any = { output: {
      state: {
        turn: '1', day: '0',
        current_scene: { title: 'Out of the Earth', transition: 'new scene', location: 'Sunnydale Cemetery Clearing', time: 'night', clock: '23:15' },
        roster: [],
        delta: {
          plot_threads: [{ id: 'sealed_letter', title: 'The Sealed Letter', status: 'open', beat: 'The sealed letter lies unopened on the altar.' }],
        },
        extensions: { plant: [{ description: 'The sealed letter lies unopened on the altar.' }] },
      },
      parallel_ops: [], parallel_world_ops: [], parallel_reviewed: [],
      evidence: {
        'state.scene.location': 'Sunnydale Cemetery Clearing',
        'state.scene.clock': 'Night',
        'state.delta.plotThreads[0]': 'A sealed letter lies unopened on the altar, demanding a choice.',
        'state.extensions.plant[0]': 'A sealed letter lies unopened on the altar, demanding a choice.',
      },
      track_evidence: [{
        field: 'state.delta.plotThreads[0]', id: 'sealed_letter', previous: 'absent',
        result: 'The sealed letter lies unopened on the altar.', evidence: { quote: 'A sealed letter lies unopened on the altar, demanding a choice.' }, reason: 'new',
      }],
      is_genesis: false,
    } };
    const result = salvageCompilation(raw, i);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recovered).toContain('candidate shape');
    expect(result.candidate.state.scene).toMatchObject({ title: 'Out of the Earth', transition: 'scene', loc: 'Sunnydale Cemetery Clearing', time: '23:15', clock: 1395 });
    expect(result.candidate.state.delta.threads).toEqual([expect.objectContaining({ op: 'new', name: 'The Sealed Letter' })]);
    expect(result.candidate.state.ext.plant).toEqual([{ what: 'The sealed letter lies unopened on the altar.' }]);
    expect(result.candidate.evidence.map(row => row.path)).toEqual(['scene.loc', 'scene.time', 'delta.threads.0', 'ext.plant.0']);
    expect(result.candidate.trackEvidence[0]).toMatchObject({ path: 'delta.threads.0', targetId: 'new', before: 'absent', basis: 'new_open_question' });
  });
  it('rejoins a legacy Chronicle scene roster with detail before persona validation', async () => {
    const i = input();
    i.personaState = true;
    i.userName = 'Gabriel Winters';
    i.prose = "At Sunnydale Cemetery, Gabriel keeps holding Buffy's hand while she fights the vertigo.";
    i.prior.scene = { location: 'Sunnydale Cemetery', time: '21:59', clock: 1319, tension: 5, weather: 'Clear', present: [], detail: [] };
    i.prior.cast.gabriel_winters = {
      id: 'gabriel_winters', name: 'Gabriel Winters', aka: [], traits: ['protective'], status: 'present',
      source: 'user', firstTurn: 1, lastTurn: 1, userEdited: true,
    };
    i.prior.cast.buffy_summers = {
      id: 'buffy_summers', name: 'Buffy Summers', aka: [], traits: [], status: 'present',
      source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false,
    };
    const raw: any = {
      state: {
        turn: 2, day: 1,
        scene: {
          location: 'Sunnydale Cemetery', time: '22:00',
          present: ['gabriel_winters', 'buffy_summers'],
          detail: [
            { id: 'buffy_summers', mood: 'disoriented', doing: "gripping Gabriel's hand", condition: 'weak', thought: 'Stay here.' },
            { id: 'gabriel_winters', mood: 'steady', doing: "holding Buffy's hand", condition: 'uninjured', thought: 'She is alive.' },
          ],
          evidence: { time: 'while she fights the vertigo', present: "Gabriel keeps holding Buffy's hand" },
        },
      },
    };

    const result = salvageCompilation(raw, i);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.state.present).toEqual([
      expect.objectContaining({ id: 'Gabriel Winters', mood: 'steady', thought: 'She is alive.', traits: ['protective'] }),
      expect.objectContaining({ id: 'buffy_summers', mood: 'disoriented', thought: 'Stay here.' }),
    ]);
    const repairedCandidate = salvageCompilation(raw, i);
    expect(repairedCandidate.ok).toBe(true);
    if (!repairedCandidate.ok) return;
    const repairBase = compilerRepairBase(i);
    const generate = vi.fn().mockResolvedValue({ ok: true, value: JSON.stringify({ patch: repairedCandidate.candidate }) });
    const repaired = await repairCompilation(i, raw, ['persona state requires the player in present'], null, undefined, generate);
    expect(repaired.ok).toBe(true);
    expect(generate).toHaveBeenCalledOnce();
    expect(JSON.parse((generate.mock.calls[0]![0] as Array<{ content: string }>)[1]!.content).repairBase).toEqual(repairBase);
  });
  it('streams compiler content and lifecycle without exposing reasoning tokens', async () => {
    const progress: Array<Record<string, unknown>> = [];
    const generate = vi.fn(async (_messages: unknown, _params: unknown, _userId: unknown, options: any) => {
      options.onStream?.({ type: 'reasoning', token: 'private chain of thought' });
      options.onStream?.({ type: 'content', token: '{"state":' });
      options.onStream?.({ type: 'content', token: '"streamed"}' });
      return { ok: true as const, value: JSON.stringify(candidate()) };
    });
    const r = await compileState(input(), null, undefined, generate as any, { onProgress: (update) => progress.push(update as unknown as Record<string, unknown>) });
    expect(r.ok).toBe(true);
    expect(progress.map((update) => update.status)).toEqual(expect.arrayContaining(['start', 'requesting', 'reasoning', 'chunk', 'validating', 'validated']));
    expect(progress.find((update) => update.status === 'requesting')?.message).toContain('first output token');
    expect(progress.find((update) => update.status === 'validated')?.text).toContain('<vellum>');
    expect(JSON.stringify(progress)).not.toContain('private chain of thought');
  });
  it('reports errors for the same final candidate shown in the Engine window', async () => {
    const i = input();
    i.argent = true;
    const stale = candidate() as any;
    stale.state.scene.tension = 11;
    const final = candidate() as any;
    final.state.scene.tension = 7;
    const progress: Array<Record<string, unknown>> = [];
    const generate = vi.fn().mockResolvedValue({ ok: true, value: `${JSON.stringify(stale)}\n${JSON.stringify(final)}` });
    const result = await compileState(i, null, undefined, generate, { onProgress: update => progress.push(update as unknown as Record<string, unknown>) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('ARGENT requires exactly one grounded opening thread when the plot ledger is empty');
      expect(result.errors.join('\n')).not.toContain('less than or equal to 10');
      expect((result.draft as StateCandidate).state.scene.tension).toBe(7);
    }
    const failed = [...progress].reverse().find(update => update.status === 'failed');
    expect(JSON.parse(String(failed?.text)).state.scene.tension).toBe(7);
  });
  it('does not carry an invalid legacy tension into the canonical repair base', () => {
    const i = input();
    i.prior.scene.tension = 11;
    expect(compilerRepairBase(i).state.scene.tension).toBeUndefined();
  });
  it('changes state formatting without reducing Lean or Full extraction coverage', () => {
    expect(STATE_COMPILER_SYSTEM).toContain('Lean and Full have identical content coverage');
    expect(STATE_COMPILER_SYSTEM).toContain('audit every supported state family');
    expect(STATE_COMPILER_SYSTEM).not.toContain('prefer an empty state object');
    expect(ENGINE_OUTPUT_TOKENS.lean).toBe(ENGINE_OUTPUT_TOKENS.full);
    expect(ENGINE_TIMEOUT_MS.lean).toBe(ENGINE_TIMEOUT_MS.full);
  });
  it.each([
    ['lean', ENGINE_OUTPUT_TOKENS.lean, ENGINE_TIMEOUT_MS.lean],
    ['full', ENGINE_OUTPUT_TOKENS.full, ENGINE_TIMEOUT_MS.full],
  ] as const)('reserves a complete-object output budget for the %s contract', async (verbosity, maxTokens, timeoutMs) => {
    const i = input();
    i.verbosity = verbosity;
    const generate = vi.fn().mockResolvedValue({ ok: true, value: JSON.stringify(candidate()) });
    expect((await compileState(i, null, undefined, generate)).ok).toBe(true);
    expect(generate.mock.calls[0]![1].max_tokens).toBe(maxTokens);
    expect(generate.mock.calls[0]![3].timeoutMs).toBe(timeoutMs);
  });
  it('accepts a complete compiler object wrapped in harmless provider chatter', async () => {
    const generate = vi.fn().mockResolvedValue({ ok: true, value: 'Here is the extracted state:\n```json\n' + JSON.stringify(candidate()) + '\n```' });
    expect((await compileState(input(), null, undefined, generate)).ok).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('recovers provider-added bold markers around JSON members', () => {
    const raw = JSON.stringify(candidate());
    const decorated = `{**${raw.slice(1, -1)}**}`;
    expect(compilerReplyObjects(decorated)).toEqual([candidate()]);
  });
  it('keeps truncated objects out of the compiler candidate scan', () => {
    expect(compilerReplyObjects('{"state":{"turn":1}')).toEqual([]);
  });
  it('extracts a merge patch without mistaking it for a complete compiler file', () => {
    const raw = '```json\n{"patch":{"state":{"turn":2}}}\n```';
    expect(compilerPatchObjects(raw)).toEqual([{ patch: { state: { turn: 2 } } }]);
    expect(compilerReplyObjects(raw)).toEqual([]);
  });
  it('quarantines provider failure after one bounded call', async () => {
    const generate = vi.fn().mockResolvedValue({ ok: false, error: 'timeout' });
    const result = await compileState(input(), null, undefined, generate);
    expect(result).toMatchObject({ ok: false, errors: ['timeout'] });
    if (!result.ok) expect(result.draft).toEqual(compilerRepairBase(input()));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]![3].timeoutMs).toBe(ENGINE_TIMEOUT_MS.lean);
    expect(generate.mock.calls[0]![0][0].content).not.toContain('"additionalProperties"');
  });

  it('generates Engine Pass state as four independently owned sections', async () => {
    const generate = vi.fn().mockResolvedValue({ ok: true, value: JSON.stringify(candidate()) });
    const result = await compileState(input(), null, undefined, generate, { sectioned: true });
    expect(result.ok).toBe(true);
    expect(generate).toHaveBeenCalledTimes(COMPILER_SECTIONS.length);
    const systems = generate.mock.calls.map(call => String(call[0][0].content));
    expect(systems).toEqual(expect.arrayContaining([
      expect.stringContaining('SECTION core owns'),
      expect.stringContaining('SECTION story owns'),
      expect.stringContaining('SECTION extensions owns'),
      expect.stringContaining('SECTION world owns'),
    ]));
    const schemas = generate.mock.calls.map(call => call[3].responseFormat.json_schema.schema);
    expect(Object.keys(schemas[0].properties.state.properties)).toEqual(expect.arrayContaining(['scene', 'present']));
    expect(schemas[0].properties.state.properties).not.toHaveProperty('delta');
    expect(schemas[1].properties.state.properties.delta.properties).not.toHaveProperty('offscreen');
    expect(schemas[2].properties.state.properties).toHaveProperty('ext');
    expect(Object.keys(schemas[3].properties.state.properties.delta.properties)).toContain('offscreen');
  });

  it('regenerates only the section implicated by validation errors', async () => {
    const i = input();
    i.evidenceMode = 'none';
    i.personaState = true;
    i.prior.day = 2;
    i.prior.scene.time = '00:00';
    i.prior.scene.clock = 0;
    i.userInput = 'I stay quiet beside Mara, tired but alert, thinking that I should watch the door.';
    const invalid = candidate();
    invalid.state.present = [{ id: 'Mara', thought: 'I should wait.' }];
    const initialGenerate = vi.fn().mockResolvedValue({ ok: true, value: JSON.stringify(invalid) });
    const first = await compileState(i, null, undefined, initialGenerate, { sectioned: true });
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(compilerSectionsForErrors(first.errors)).toEqual(['core']);

    const corrected = candidate();
    corrected.state.present.find(row => row.id === 'Player')!.mood = 'alert';
    corrected.state.present.find(row => row.id === 'Player')!.doing = 'staying quiet beside Mara';
    corrected.state.present.find(row => row.id === 'Player')!.condition = 'tired';
    corrected.state.present.find(row => row.id === 'Player')!.thought = 'I should watch the door.';
    corrected.state.present.find(row => row.id === 'Player')!.traits = ['watchful'];
    const repairGenerate = vi.fn().mockResolvedValue({ ok: true, value: JSON.stringify(corrected) });
    const repaired = await repairCompilation(i, first.draft, first.errors, null, undefined, repairGenerate, { attempt: 2 });
    expect(repaired).toMatchObject({ ok: true });
    expect(repairGenerate).toHaveBeenCalledTimes(1);
    const messages = repairGenerate.mock.calls[0]![0];
    expect(messages[0].content).toContain('accepted sections are immutable');
    const context = JSON.parse(messages[1].content);
    expect(context.section).toBe('core');
    expect(context.sectionBase.state).not.toHaveProperty('delta');
    expect(context.sectionBase).not.toHaveProperty('parallelOps');
  });

  it('resumes from the failed section without regenerating completed earlier sections', async () => {
    const initialGenerate = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: JSON.stringify(candidate()) })
      .mockResolvedValueOnce({ ok: false, error: 'timeout' });
    const first = await compileState(input(), null, undefined, initialGenerate, { sectioned: true });
    expect(first.ok).toBe(false);
    expect(initialGenerate).toHaveBeenCalledTimes(2);
    if (first.ok) return;

    const repairGenerate = vi.fn().mockResolvedValue({ ok: true, value: JSON.stringify(candidate()) });
    const repaired = await repairCompilation(input(), first.draft, first.errors, null, undefined, repairGenerate);
    expect(repaired.ok).toBe(true);
    expect(repairGenerate).toHaveBeenCalledTimes(3);
    const systems = repairGenerate.mock.calls.map(call => String(call[0][0].content));
    expect(systems.some(system => system.includes('SECTION core owns'))).toBe(false);
    expect(systems).toEqual(expect.arrayContaining([
      expect.stringContaining('SECTION story owns'),
      expect.stringContaining('SECTION extensions owns'),
      expect.stringContaining('SECTION world owns'),
    ]));
  });
});

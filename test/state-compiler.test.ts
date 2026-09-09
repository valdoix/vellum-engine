import { describe, it, expect, vi } from 'vitest';
import { CompilerCandidate, jsonSchema, salvageCompilation, validateCompilation, type CompilerInput, type StateCandidate } from '../src/domain/state-compiler.js';
import { freshState } from '../src/domain/types.js';
import { compileState, compilerContext, compilerReplyObjects, ENGINE_OUTPUT_TOKENS, ENGINE_TIMEOUT_MS } from '../src/bus/state-compiler.js';
import { foldTurn } from '../src/bus/lifecycle.js';
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
  it('preserves unmodified off-stage actors and emits the canonical contract across midnight', () => {
    const r = validateCompilation(candidate(), input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const state = JSON.parse(r.block.slice(9, -9));
    expect(state.delta.parallel).toEqual([{ who: 'Ada', where: 'Courtyard', activity: 'Waiting' }]);
    expect(state.scene).toMatchObject({ time: '00:03', clock: 3 });
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
    expect(validateCompilation(c, i).ok).toBe(true);
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
    ['missing thought', (c: StateCandidate) => { c.state.present[0]!.thought = ''; }],
    ['invented player predicate', (c: StateCandidate) => { c.state.present[1]!.doing = 'opens the door'; }],
    ['duplicate actor', (c: StateCandidate) => { c.state.present.push(c.state.present[0]!); }],
    ['forgotten parallel row', (c: StateCandidate) => { c.parallelReviewed = []; }],
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
    expect(validateCompilation(c, i).ok).toBe(true);
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
    i.prior.offscreen = [{ id: 'courier_watch', name: 'The Late Courier', status: 'active', who: 'ada', where: 'East Gate', gist: 'waiting for the courier', beats: ['waiting for the courier'], firstTurn: 1, lastTurn: 1 }] as any;
    const c = candidate();
    c.parallelReviewed = [];
    c.parallelOps = [{ op: 'start', who: 'Ada', where: 'East Gate', activity: 'waiting for the courier', evidence: 'Ada at East Gate: waiting for the courier' }];
    const generate = vi.fn().mockResolvedValue({ ok: true, value: JSON.stringify(c) });
    const r = await compileState(i, null, undefined, generate);
    expect(r.ok).toBe(true);
    expect(generate.mock.calls[0]![0][1].content).toContain('"livingWorld":"sandbox"');
    expect(generate.mock.calls[0]![0][1].content).toContain('Ada at East Gate: waiting for the courier');
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
  it('quarantines provider failure after one bounded call', async () => {
    const generate = vi.fn().mockResolvedValue({ ok: false, error: 'timeout' });
    expect(await compileState(input(), null, undefined, generate)).toEqual({ ok: false, errors: ['timeout'] });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]![3].timeoutMs).toBe(ENGINE_TIMEOUT_MS.lean);
    expect(generate.mock.calls[0]![0][0].content).not.toContain('"additionalProperties"');
  });
});

import { describe, expect, it } from 'vitest';
import { parseState } from '../src/parse/state-block.js';
import { coreFeature } from '../src/domain/core-feature.js';
import { freshState } from '../src/domain/types.js';
import type { ExtractCtx } from '../src/bus/registry.js';
import { reduce } from '../src/core/reduce.js';
import { DEFAULT_TONE } from '../src/domain/tone.js';

const wrap = (value: unknown): string => `<vellum>${JSON.stringify(value)}</vellum>`;

describe('inline VELLUM compatibility normalization', () => {
  it('hoists a misplaced delta.ext payload and preserves snapshot-style possession verbs', () => {
    const parsed = parseState(wrap({
      day: 0,
      delta: {
        threads: [{ op: 'advance', name: 'The Return', note: 'The survivor reaches the surface.' }],
        ext: {
          inventory: [{ who: 'Buffy Summers', item: 'a gold necklace', op: 'hold', note: 'held through the fight' }],
          affect: [{ who: 'Buffy Summers', valence: 'positive', arousal: 6, control: 3, cause: 'someone kept a promise' }],
        },
      },
    }));

    expect(parsed.source).toBe('json');
    expect(parsed.state?.ext).toMatchObject({
      inventory: [{ who: 'Buffy Summers', item: 'a gold necklace', op: 'note', note: 'held through the fight' }],
      affect: [{ who: 'Buffy Summers', valence: 1, arousal: 2, control: 2, direction: 'someone kept a promise' }],
    });
    expect((parsed.state?.delta as Record<string, unknown>)?.ext).toBeUndefined();
  });

  it('unwraps an Engine-shaped inline state envelope so plot rows reach the extension', () => {
    const parsed = parseState(wrap({ output: { state: {
      scene: { loc: 'Observatory', time: '03:05', clock: 185 },
      delta: {
        arcs: [{ op: 'new', name: 'The Observatory Mystery', evidence: 'A sealed letter appears in the observatory.' }],
        threads: [{ op: 'new', name: 'The Sealed Letter', evidence: 'A sealed letter appears in the observatory.', arc: 'The Observatory Mystery' }],
      },
    } } }));
    expect(parsed.source).toBe('json');
    expect(parsed.state?.delta).toMatchObject({
      arcs: [{ op: 'new', name: 'The Observatory Mystery', note: 'A sealed letter appears in the observatory.' }],
      threads: [{ op: 'new', name: 'The Sealed Letter', note: 'A sealed letter appears in the observatory.', arc: 'The Observatory Mystery' }],
    });
    let sequence = 0;
    const state = freshState();
    const events = coreFeature.extract!(parsed.state!, {
      turn: 1, day: 0, state, prose: 'A sealed letter appears in the observatory.', seq: () => ++sequence,
    } as ExtractCtx);
    const next = reduce(events, state);
    expect(next.arcs.find(row => row.name === 'The Observatory Mystery')).toBeTruthy();
    expect(next.threads.find(row => row.name === 'The Sealed Letter')).toMatchObject({ arc: expect.any(String) });
  });

  it('files a note-less new inline thread when its title is directly grounded in prose', () => {
    const parsed = parseState(wrap({ delta: {
      arcs: [{ op: 'new', name: 'The Observatory Mystery' }],
      threads: [{ op: 'new', name: 'The Sealed Letter', arc: 'The Observatory Mystery' }],
    } })).state!;
    let sequence = 0;
    const state = freshState();
    const events = coreFeature.extract!(parsed, {
      turn: 1, day: 0, state, prose: 'Mira finds the sealed letter beneath the telescope.', seq: () => ++sequence,
    } as ExtractCtx);
    const next = reduce(events, state);
    expect(next.arcs.find(row => row.name === 'The Observatory Mystery')).toBeTruthy();
    expect(next.threads.find(row => row.name === 'The Sealed Letter')).toMatchObject({ arc: expect.any(String) });
  });

  it('merges a dedicated persona tracker object into the canonical present roster', () => {
    const parsed = parseState(wrap({
      scene: { loc: 'Library', time: '20:10', clock: 1210 },
      present: [{ id: 'Mara', thought: 'I should close the shutters.' }],
      personaState: { mood: 'wary', condition: 'tired', doing: 'guarding the door', thought: 'I do not trust the seal.', traits: ['stubborn'] },
    })).state!;
    let sequence = 0;
    const state = freshState();
    state.scene = { location: 'Library', time: '20:09', clock: 1209, tension: 1, weather: '', present: [], detail: [] };
    const events = coreFeature.extract!(parsed, {
      turn: 2, day: 0, state, userCanon: 'gabriel_winters', personaState: true,
      prose: 'Mara closes the shutters while Gabriel remains by the door.', seq: () => ++sequence,
    } as ExtractCtx);
    const scene = events.find(event => event.kind === 'scene.set') as any;
    expect(scene.detail.find((row: any) => row.id === 'gabriel_winters')).toMatchObject({
      mood: 'wary', condition: 'tired', doing: 'guarding the door', thought: 'I do not trust the seal.',
    });
    expect(events).toContainEqual(expect.objectContaining({ kind: 'cast.edit', id: 'gabriel_winters', patch: { traits: ['stubborn'] } }));
  });

  it('coalesces a normal player row and dedicated persona tracker without duplicating the roster', () => {
    const parsed = parseState(wrap({
      scene: { loc: 'Library', time: '20:10', clock: 1210 },
      present: [{ id: 'Mara', thought: 'I should close the shutters.' }, { id: 'Gabriel Winters' }],
      personaState: { mood: 'wary', condition: 'tired', doing: 'guarding the door', thought: 'I do not trust the seal.', traits: ['stubborn'] },
    })).state!;
    let sequence = 0;
    const events = coreFeature.extract!(parsed, {
      turn: 2, day: 0, state: freshState(), userCanon: 'gabriel_winters', personaState: true,
      prose: 'Mara closes the shutters while Gabriel remains by the door.', seq: () => ++sequence,
    } as ExtractCtx);
    const scene = events.find(event => event.kind === 'scene.set') as any;
    expect(scene.present).toEqual(['gabriel_winters', 'mara']);
    expect(scene.detail.filter((row: any) => row.id === 'gabriel_winters')).toHaveLength(1);
    expect(scene.detail[0]).toMatchObject({ id: 'gabriel_winters', mood: 'wary', thought: 'I do not trust the seal.' });
  });

  it('retains alternate field names, singleton rows, trait text, and descriptive NPC state', () => {
    const parsed = parseState(wrap({
      v: '1', turn: '17', day: '2',
      scene: { location: 'Living Room', time: '18:15', clock: '1095', tension: '8' },
      present: { character: 'Jonathan Winters', activity: 'kneeling nearby', traits: 'controlled (defining), protective, precise' },
      delta: {
        threads: { title: 'Parents En Route', prior: 'driving to Sunnydale', event: 'Jonathan and Eleanor arrive at the house', note: 'resolved — parents present', status: 'resolved' },
        journal: [
          { character: 'Jonathan Winters', type: 'scar', entry: 'He saw the scar and understood the danger.' },
          { character: 'Eleanor Winters', type: 'knowledge', entry: 'Gabriel is conscious.' },
        ],
        parallel_events: { character: 'Willow Rosenberg', location: "Spike's crypt", doing: 'sitting in silence' },
      },
      ext: {
        intent: { character: 'Jonathan Winters', goal: 'learn who caused the injury', next: 'ask for the full account', constraints: 'needs facts before action', status: 'active' },
        affect: { character: 'Jonathan Winters', valence: 'controlled relief masking fury', arousal: 'very high, suppressed', cause: 'his son is injured' },
        introduction: { character: 'Jonathan Winters', packet: 'Silver-templed attorney with an even voice and a protective reserve.' },
      },
    }));

    expect(parsed.source).toBe('json');
    expect(parsed.state).toMatchObject({
      turn: 17, day: 2,
      scene: { loc: 'Living Room', clock: 1095, tension: 8 },
      present: [{ id: 'Jonathan Winters', doing: 'kneeling nearby', traits: ['controlled (defining)', 'protective', 'precise'] }],
      delta: {
        threads: [{ name: 'Parents En Route', prior: 'driving to Sunnydale', note: 'Jonathan and Eleanor arrive at the house', op: 'resolve' }],
        journal: [
          { who: 'Jonathan Winters', memory: 'He saw the scar and understood the danger.', kind: 'wound' },
          { who: 'Eleanor Winters', memory: 'Gabriel is conscious.', kind: 'observation' },
        ],
        parallel: [{ who: 'Willow Rosenberg', where: "Spike's crypt", activity: 'sitting in silence' }],
      },
      ext: {
        intent: [{ who: 'Jonathan Winters', goal: 'learn who caused the injury', nextStep: 'ask for the full account', constraints: ['needs facts before action'] }],
        affect: [{ who: 'Jonathan Winters', valence: 0, arousal: 2, control: 2, direction: 'his son is injured' }],
        introduction: [{ who: 'Jonathan Winters', summary: 'Silver-templed attorney with an even voice and a protective reserve.' }],
      },
    });
  });

  it('uses a grounded prior anchor and preserves prose introduction packets without inventing structure', () => {
    const state = freshState();
    state.cast.jonathan_winters = {
      id: 'jonathan_winters', name: 'Jonathan Winters', aka: [], status: 'active', source: 'auto',
      firstTurn: 1, lastTurn: 16, traits: [], userEdited: false,
    } as any;
    state.threads.push({
      id: 'thread_parents', name: 'Parents En Route', status: 'active',
      beats: ['Jonathan and Eleanor are driving to Sunnydale'], firstTurn: 15, lastTurn: 16,
    } as any);
    const parsed = parseState(wrap({
      delta: {
        threads: [{ title: 'Parents En Route', prior: 'driving to Sunnydale', event: 'Jonathan and Eleanor arrive at the house', note: 'resolved — parents present', status: 'resolved' }],
        journal: [{ character: 'Jonathan Winters', type: 'scar', entry: 'He sees the scar and understands the danger.' }],
      },
      ext: {
        intent: [{ character: 'Jonathan Winters', goal: 'identify the attacker', next: 'ask for the full account', constraints: 'needs facts' }],
        affect: [{ character: 'Jonathan Winters', valence: 'controlled relief masking fury', arousal: 'high', cause: 'his son is injured' }],
        introduction: [{ character: 'Jonathan Winters', packet: 'Silver-templed attorney with an even voice and a protective reserve.' }],
      },
    })).state!;
    let sequence = 0;
    const ctx: ExtractCtx = {
      turn: 17, day: 2, state, seq: () => ++sequence,
      prose: 'Jonathan and Eleanor arrive at the house. Jonathan sees the scar and asks for the full account.',
    };
    const events = coreFeature.extract!(parsed, ctx);

    expect(events).toContainEqual(expect.objectContaining({ kind: 'thread.op', op: 'resolve', name: 'Parents En Route', note: 'Jonathan and Eleanor arrive at the house' }));
    expect(events).toContainEqual(expect.objectContaining({ kind: 'journal.entry', who: 'jonathan_winters', jkind: 'wound' }));
    expect(events).toContainEqual(expect.objectContaining({ kind: 'cast.edit', id: 'jonathan_winters', patch: expect.objectContaining({ intent: expect.objectContaining({ nextStep: 'ask for the full account' }) }) }));
    expect(events).toContainEqual(expect.objectContaining({ kind: 'cast.edit', id: 'jonathan_winters', patch: expect.objectContaining({ affect: expect.objectContaining({ arousal: 1, direction: 'his son is injured' }) }) }));
    expect(events).toContainEqual(expect.objectContaining({ kind: 'cast.edit', id: 'jonathan_winters', patch: { note: 'Silver-templed attorney with an even voice and a protective reserve.' } }));
  });

  it('files id-shaped autonomous parallel rows from attached canon on a fresh Chronicle', () => {
    const rows = [
      { id: 'Willow Rosenberg', where: 'Sunnydale cemetery road', activity: 'retreating with Tara, Xander, and Anya after the interrupted ritual; believes resurrection failed' },
      { id: 'Tara Maclay', where: 'Sunnydale cemetery road', activity: 'retreating after ritual interruption' },
      { id: 'Xander Harris', where: 'Sunnydale cemetery road', activity: 'retreating after ritual interruption' },
      { id: 'Anya Jenkins', where: 'Sunnydale cemetery road', activity: 'retreating after ritual interruption' },
      { id: 'Dawn Summers', where: 'Summers home', activity: 'unaware of resurrection attempt' },
      { id: 'Spike', where: 'Summers home', activity: 'unaware of resurrection attempt; Buffybot being destroyed by Hellions' },
      { id: 'Hellion biker gang', where: 'downtown Sunnydale', activity: 'rampaging through town, destroying the Buffybot' },
    ];
    // The reported block used parallel at the root as well as `id` rather than
    // `who`; both are common model drift and must survive normalization.
    const parsedResult = parseState(wrap({
      scene: { loc: 'cemetery', time: '02:10', clock: 130 },
      present: [{ id: 'Buffy Summers' }],
      parallel: rows,
    }));
    expect(parsedResult.source).toBe('json');
    expect(parsedResult.state?.delta?.parallel).toHaveLength(7);
    expect(parsedResult.state?.delta?.parallel?.map(row => row.who)).toEqual(rows.map(row => row.id));

    let sequence = 0;
    const events = coreFeature.extract!(parsedResult.state!, {
      turn: 1,
      day: 1,
      state: freshState(),
      prose: 'Buffy wakes alone beneath disturbed earth.',
      tone: { ...DEFAULT_TONE, social: 'autonomous' },
      parallelCanonLabels: [
        'Willow Rosenberg', 'Tara Maclay', 'Xander Harris', 'Anya Jenkins',
        'Dawn Summers', 'Spike', 'Hellion bikers', 'Sunnydale cemetery road',
        'Summers home', 'downtown Sunnydale',
      ],
      seq: () => ++sequence,
    } as ExtractCtx);
    const parallel = events.find(event => event.kind === 'parallel.set');
    expect(parallel).toMatchObject({ kind: 'parallel.set', items: expect.arrayContaining([
      expect.objectContaining({ who: 'willow_rosenberg', activity: expect.stringContaining('resurrection failed') }),
      expect.objectContaining({ who: 'spike', activity: expect.stringContaining('Buffybot being destroyed') }),
      expect.objectContaining({ who: 'hellion_biker_gang', activity: expect.stringContaining('destroying the Buffybot') }),
    ]) });
    expect((parallel as any).items).toHaveLength(7);

    const state = reduce(events);
    expect(state.parallel).toHaveLength(7);
    expect(state.cast.willow_rosenberg?.status).toBe('active');
    expect(state.cast.spike?.status).toBe('active');
    expect(state.cast.hellion_biker_gang).toBeUndefined();
  });

  it('keeps useful off-screen beats when the model omits their ids', () => {
    const parsed = parseState(wrap({
      delta: {
        offscreen_events: [
          { title: 'Gate Watch', character: 'Ada', location: 'East Gate', activity: 'checks each arriving courier', nextTurn: 4 },
        ],
      },
    }));
    expect(parsed.source).toBe('json');
    expect(parsed.state?.delta?.offscreen).toEqual([
      expect.objectContaining({ id: 'gate_watch', name: 'Gate Watch', who: 'Ada', where: 'East Gate', gist: 'checks each arriving courier', nextTurn: 4 }),
    ]);
  });

  it('materializes an inline arc, child thread, parallel row, and linked subplot in one pass', () => {
    const state = freshState();
    state.scene = { location: 'Archive', time: '10:00', clock: 600, tension: 1, weather: '', present: ['mara'], detail: [] };
    state.cast.mara = { id: 'mara', name: 'Mara', aka: [], status: 'present', source: 'auto', firstTurn: 1, lastTurn: 1, traits: [], userEdited: false } as any;
    state.cast.ada = { id: 'ada', name: 'Ada', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, traits: [], userEdited: false, lastLocation: 'East Gate', lastLocationTurn: 1 } as any;
    const prose = 'At the East Gate, Ada searches the arriving courier and finds the royal seal missing.';
    const parsed = parseState(wrap({
      scene: { loc: 'Archive', time: '10:01', clock: 601 },
      present: [{ id: 'Mara', thought: 'The courier should be here.' }],
      delta: {
        arcs: [{ op: 'new', name: 'The City Conspiracy', note: 'The royal seal is missing at the East Gate.' }],
        threads: [{ op: 'new', name: 'The Missing Royal Seal', note: 'Ada finds the royal seal missing at the East Gate.', arc: 'The City Conspiracy' }],
        parallel: [{ who: 'Ada', where: 'East Gate', activity: 'searching for the missing royal seal' }],
        offscreen: [{
          op: 'new', id: 'east_gate_search', name: 'East Gate Search', who: 'Ada', where: 'East Gate',
          gist: 'searching for the missing royal seal', thread: 'The Missing Royal Seal', arc: 'The City Conspiracy', nextTurn: 3,
          beatKind: 'progress', impact: 'The search can identify which courier diverted the seal before the archive receives it.',
          grounding: { basis: ['character', 'location', 'parallel'], rationale: 'Ada is established at the East Gate and the current parallel row places her in the same search.' },
        }],
      },
    })).state!;
    let sequence = 0;
    const events = coreFeature.extract!(parsed, { turn: 2, day: 0, state, prose, livingWorld: 'active', seq: () => ++sequence } as ExtractCtx);
    const next = reduce(events, structuredClone(state));
    const arc = next.arcs.find(row => row.name === 'The City Conspiracy')!;
    const thread = next.threads.find(row => row.name === 'The Missing Royal Seal')!;
    expect(arc).toBeTruthy();
    expect(thread.arc).toBe(arc.id);
    expect(next.parallel).toEqual([expect.objectContaining({ who: 'ada', where: 'East Gate' })]);
    expect(next.offscreen).toEqual([expect.objectContaining({ id: 'east_gate_search', thread: thread.id })]);
  });

  it('reclassifies an exact existing arc misplaced in threads and lets explicit subplot state outrank an automatic bridge', () => {
    const state = freshState();
    state.cast.buffy_summers = {
      id: 'buffy_summers', name: 'Buffy Summers', aka: [], status: 'active', source: 'auto',
      firstTurn: 1, lastTurn: 3, traits: [], userEdited: false,
    } as any;
    state.threads = [{
      id: 'thr_buffy_s_resurrection', name: "Buffy's Resurrection", status: 'Buffy is alive but in danger.',
      beats: ['Buffy is alive but in danger.'], firstTurn: 1, lastTurn: 3, arc: 'arc_buffy_returns',
    } as any];
    state.arcs = [{
      id: 'arc_buffy_returns', name: 'Buffy Returns', status: 'Buffy is alive and disoriented.',
      beats: ['Buffy is alive and disoriented.'], firstTurn: 1, lastTurn: 3,
    } as any];
    state.offscreen = [
      {
        id: 'hellion_raid', name: 'hellion_raid', status: 'active',
        gist: 'Buffy is alive but in danger.', beats: ['Hellions are closing on the cemetery.', 'Buffy is alive but in danger.'],
        firstTurn: 1, lastTurn: 3, where: 'Sunnydale', thread: 'thr_buffy_s_resurrection', beatKind: 'bridge',
        grounding: { basis: ['scene', 'subplot'], rationale: 'The foreground scene directly changed the plot thread linked to this subplot.', before: 'Hellions are closing on the cemetery.', after: 'Buffy is alive but in danger.' },
      },
      {
        id: 'scoobies_fleeing', name: 'scoobies_fleeing', status: 'active',
        gist: 'The Scoobies are fleeing and believe the ritual failed.', beats: ['The Scoobies are fleeing and believe the ritual failed.'],
        firstTurn: 1, lastTurn: 3, where: 'Sunnydale streets', thread: 'thr_buffy_s_resurrection',
      },
    ] as any;
    state.parallel = [
      { where: 'Sunnydale', activity: 'Hellions are closing on the cemetery.', turn: 3, day: 0 },
      { where: 'Sunnydale', activity: 'Buffy is alive but in danger.', turn: 3, day: 0 },
    ];
    const prose = 'Gabriel kills the cemetery Hellions, ending Buffy\'s immediate danger. Her disorientation begins to lift as she reconnects with the present.';
    const parsed = parseState(wrap({ delta: {
      threads: [
        { op: 'advance', name: "Buffy's Resurrection", note: 'Buffy\'s immediate danger changes when Gabriel kills the cemetery Hellions.', arc: 'Buffy Returns' },
        { op: 'advance', name: 'Buffy Returns', note: 'Buffy\'s disorientation begins to lift as she reconnects with the present.', arc: 'Buffy Returns' },
      ],
      offscreen: [{
        op: 'advance', id: 'hellion_raid', who: 'Hellion biker gang', where: 'Sunnydale — multiple locations',
        gist: 'A Hellion pack at the cemetery was killed while the wider raid continues across Sunnydale.', thread: "Buffy's Resurrection",
        beatKind: 'consequence', impact: 'The cemetery is safer but the rest of Sunnydale remains under attack.',
        grounding: { basis: ['scene'], rationale: 'The visible fight destroys the local pack.', refs: ['hellion_raid'], before: 'Hellions are closing on the cemetery.', after: 'Cemetery pack destroyed; wider raid continues.' },
      }],
    } })).state!;
    let sequence = 0;
    const events = coreFeature.extract!(parsed, {
      turn: 4, day: 0, state, prose, livingWorld: 'active', seq: () => ++sequence,
    } as ExtractCtx);

    expect(events).toContainEqual(expect.objectContaining({ kind: 'arc.op', name: 'Buffy Returns', op: 'advance' }));
    expect(events.filter(event => event.kind === 'offscreen.op' && event.id === 'hellion_raid')).toEqual([
      expect.objectContaining({ where: 'Sunnydale', gist: 'A Hellion pack at the cemetery was killed while the wider raid continues across Sunnydale.' }),
    ]);
    expect(events.some(event => event.kind === 'offscreen.op' && event.id === 'scoobies_fleeing')).toBe(false);
    const next = reduce(events, structuredClone(state));
    const worldActivity = next.parallel.filter(row => !row.who).map(row => row.activity);
    expect(worldActivity).toEqual(expect.arrayContaining([
      'A Hellion pack at the cemetery was killed while the wider raid continues across Sunnydale.',
    ]));
    expect(worldActivity).not.toContain('Hellions are closing on the cemetery.');
    expect(worldActivity).not.toContain('Buffy is alive but in danger.');
  });

  it('creates an explicitly named parent arc when an inline child omits the redundant arc row', () => {
    const state = freshState();
    const prose = 'The sealed letter orders Mara to choose an heir before dawn.';
    const parsed = parseState(wrap({ delta: { threads: [{ op: 'new', name: 'Choose an Heir', note: prose, arc: 'The Succession Crisis' }] } })).state!;
    let sequence = 0;
    const next = reduce(coreFeature.extract!(parsed, { turn: 1, day: 0, state, prose, seq: () => ++sequence } as ExtractCtx), state);
    const arc = next.arcs.find(row => row.name === 'The Succession Crisis')!;
    expect(next.threads.find(row => row.name === 'Choose an Heir')?.arc).toBe(arc.id);
  });

  it('uses a coherent arc-thread-subplot graph to corroborate a paraphrastic new title', () => {
    const prose = 'Ada discovers that the royal seal vanished from the courier case.';
    const parsed = parseState(wrap({ delta: {
      arcs: [{ op: 'new', id: 'arc_succession', name: 'The Succession Crisis', note: prose }],
      threads: [{ op: 'new', id: 'thread_empty_throne', name: 'The Empty Throne', note: prose, arc: 'arc_succession' }],
      offscreen: [{
        op: 'new', id: 'courier_search', where: 'East Gate', gist: 'The gate watch searches arriving couriers', thread: 'thread_empty_throne',
        beatKind: 'progress', impact: 'The search can expose who removed the royal seal before the succession decision.',
        grounding: { basis: ['scene', 'location'], rationale: 'The scene establishes the missing seal at the East Gate and the watch can inspect arrivals.' },
      }],
    } })).state!;
    let sequence = 0;
    const next = reduce(coreFeature.extract!(parsed, {
      turn: 1, day: 0, state: freshState(), prose, seq: () => ++sequence,
    } as ExtractCtx));
    const arc = next.arcs.find(row => row.name === 'The Succession Crisis')!;
    expect(next.threads.find(row => row.name === 'The Empty Throne')).toMatchObject({ arc: arc.id });
    expect(next.offscreen.find(row => row.id === 'courier_search')).toMatchObject({ thread: 'thr_the_empty_throne' });
  });

  it('accepts semantic no-evidence subplot grounding but rejects decorative rows without impact', () => {
    const state = freshState();
    state.scene = { location: 'Magic Box', time: '10:00', clock: 600, tension: 1, weather: '', present: [], detail: [] };
    state.cast.xander = { id: 'xander', name: 'Xander', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, lastLocation: 'Summers home', lastLocationTurn: 1, traits: ['practical'], userEdited: false } as any;
    const parsed = parseState(wrap({ delta: { offscreen: [
      {
        op: 'new', id: 'dawn_wardrobe', name: "Dawn's Wardrobe", who: 'Xander', where: 'Summers home', gist: 'builds Dawn a wardrobe',
        beatKind: 'progress', impact: 'Dawn gains needed storage and Xander must later deliver the finished wardrobe.',
        grounding: { basis: ['character', 'location'], rationale: 'Xander is practical, is already at the Summers home, and has time to work there.' },
      },
      {
        op: 'new', id: 'ambient_coffee', name: 'Coffee', who: 'Xander', where: 'Summers home', gist: 'drinks coffee',
        beatKind: 'progress', grounding: { basis: ['character', 'location'], rationale: 'Xander can drink coffee at the Summers home.' },
      },
    ] } })).state!;
    let sequence = 0;
    const next = reduce(coreFeature.extract!(parsed, {
      turn: 2, day: 0, state, prose: 'Buffy checks the books at the Magic Box.', livingWorld: 'active', seq: () => ++sequence,
    } as ExtractCtx), structuredClone(state));
    expect(next.offscreen).toEqual([expect.objectContaining({ id: 'dawn_wardrobe', impact: expect.stringContaining('deliver') })]);
  });

  it('accepts a grounded nearby address refinement for an existing off-screen actor', () => {
    const state = freshState();
    state.cast.spike = {
      id: 'spike', name: 'Spike', aka: [], status: 'active', source: 'auto',
      firstTurn: 1, lastTurn: 1, lastLocation: 'Sunnydale streets near Revello Drive', lastLocationTurn: 1,
      traits: [], userEdited: false,
    } as any;
    const parsed = parseState(wrap({ delta: { offscreen: [{
      op: 'new', id: 'spike_dawn_shelter', who: 'Spike', where: 'Summers residence, 1630 Revello Drive',
      gist: 'Spike protects Dawn during the Hellion raid.', beatKind: 'obstacle',
      impact: 'Dawn depends on Spike while the raid threatens their shelter.',
      grounding: {
        basis: ['character', 'location'], rationale: 'Spike is guarding Dawn at Revello Drive during the raid.',
        refs: ['Spike guarding Dawn at Revello Drive'], before: 'Spike guarding Dawn near Revello Drive',
        after: 'Spike and Dawn shelter at the Summers residence on Revello Drive',
      },
    }] } })).state!;
    let sequence = 0;
    const events = coreFeature.extract!(parsed, {
      turn: 2, day: 0, state, prose: '', livingWorld: 'sandbox', seq: () => ++sequence,
    } as ExtractCtx);
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'offscreen.op', id: 'spike_dawn_shelter', who: 'spike', where: 'Summers residence, 1630 Revello Drive',
    }));
  });

  it('materializes generated resurrection tracks and grounded subplots despite inflection, collective actors, and reordered places', () => {
    const content = `Buffy claws her way out of the grave while Gabriel waits beside the broken ritual circle.
<vellum>${JSON.stringify({
      v: 1, turn: 1, day: 0,
      scene: { title: 'From the Earth', loc: 'Sunnydale Cemetery', time: 'night', tension: 8 },
      present: [{ id: 'Gabriel Winters' }, { id: 'Buffy Summers' }],
      delta: {
        threads: [{ op: 'new', name: "Buffy's Resurrection", note: 'Buffy has clawed out of her grave and is alive, but does not know who resurrected her or why.', arc: 'Buffy Returns' }],
        arcs: [{ op: 'new', name: 'Buffy Returns', note: 'Buffy Summers has been pulled from the grave by Gabriel Winters. She is alive, traumatized, and disoriented.' }],
        parallel: [{ who: 'Willow Rosenberg', where: 'Fleeing through Sunnydale streets', activity: 'Running from the Hellion bikers after the interrupted resurrection ritual' }],
        offscreen: [
          {
            op: 'new', id: 'hellion_raid', who: 'Hellion Biker Gang', where: 'Sunnydale town center and surrounding streets',
            gist: 'The Hellion biker gang is rampaging through Sunnydale and attacking anything that moves', thread: 'Buffy Returns',
            beatKind: 'consequence', impact: 'Town-wide chaos, fires, destruction, and an exposed gap in Slayer patrols', autonomy: 'active',
            grounding: { basis: ['Canon: Hellions attack during Bargaining', 'The ritual was interrupted by the Hellion assault'], rationale: 'The active Hellion raid interrupted the resurrection ritual' },
          },
          {
            op: 'new', id: 'scoobies_fleeing', who: 'Willow Rosenberg', where: 'Sunnydale streets, fleeing',
            gist: 'Willow and the others are running from the attack believing the resurrection ritual failed', thread: "Buffy's Resurrection",
            beatKind: 'obstacle', impact: 'The people who brought Buffy back do not know she is alive and believe they failed', autonomy: 'active',
            grounding: { basis: ['Canon: Scoobies flee when the urn shatters', 'They did not witness Buffy emerge'], rationale: 'The group witnessed the urn shatter, fled before seeing Buffy emerge, and inferred that the ritual failed.' },
          },
        ],
      },
    })}</vellum>`;
    const parsed = parseState(content);
    expect(parsed.source).toBe('json');
    expect(parsed.state?.delta?.offscreen).toHaveLength(2);

    let sequence = 0;
    const state = freshState();
    const next = reduce(coreFeature.extract!(parsed.state!, {
      turn: 1, day: 0, state,
      prose: 'Buffy claws her way out of the grave while Gabriel waits beside the broken ritual circle.',
      livingWorld: 'active', tone: { ...DEFAULT_TONE, social: 'autonomous' },
      parallelCanonLabels: ['Willow Rosenberg', 'Hellion bikers', 'Fleeing through Sunnydale streets', 'Sunnydale town center and surrounding streets'],
      seq: () => ++sequence,
    } as ExtractCtx), state);

    const arc = next.arcs.find(row => row.name === 'Buffy Returns')!;
    const thread = next.threads.find(row => row.name === "Buffy's Resurrection")!;
    expect(arc).toBeTruthy();
    expect(thread).toMatchObject({ arc: arc.id });
    expect(next.offscreen).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'hellion_raid', thread: thread.id }),
      expect.objectContaining({ id: 'scoobies_fleeing', thread: thread.id, who: 'willow_rosenberg' }),
    ]));
    expect(next.offscreen.find(row => row.id === 'hellion_raid')).not.toHaveProperty('who');

    let blockSequence = 0;
    const knownState = freshState();
    // Existing cast names are removed from title-evidence tokens, which makes
    // this exercise the generic inflection matcher rather than a shared name.
    knownState.cast.buffy_summers = {
      id: 'buffy_summers', name: 'Buffy Summers', aka: [], status: 'active', source: 'auto',
      firstTurn: 0, lastTurn: 0, traits: [], userEdited: false,
    } as any;
    const folded = reduce(coreFeature.extract!(parsed.state!, {
      turn: 1, day: 0, state: knownState, prose: '',
      livingWorld: 'active', tone: { ...DEFAULT_TONE, social: 'autonomous' },
      parallelCanonLabels: ['Willow Rosenberg', 'Hellion bikers', 'Fleeing through Sunnydale streets', 'Sunnydale town center and surrounding streets'],
      seq: () => ++blockSequence,
    } as ExtractCtx), knownState);
    expect(folded.arcs.find(row => row.name === 'Buffy Returns')).toBeTruthy();
    expect(folded.threads.find(row => row.name === "Buffy's Resurrection")).toBeTruthy();
    expect(folded.offscreen).toHaveLength(2);
  });
});

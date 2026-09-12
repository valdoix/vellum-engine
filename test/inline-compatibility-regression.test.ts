import { describe, expect, it } from 'vitest';
import { parseState } from '../src/parse/state-block.js';
import { coreFeature } from '../src/domain/core-feature.js';
import { freshState } from '../src/domain/types.js';
import type { ExtractCtx } from '../src/bus/registry.js';
import { reduce } from '../src/core/reduce.js';
import { DEFAULT_TONE } from '../src/domain/tone.js';

const wrap = (value: unknown): string => `<vellum>${JSON.stringify(value)}</vellum>`;

describe('inline VELLUM compatibility normalization', () => {
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
      { id: 'Willow Rosenberg', where: 'fleeing cemetery area', activity: 'retreating with Tara, Xander, and Anya after the interrupted ritual; believes resurrection failed' },
      { id: 'Tara Maclay', where: 'fleeing with Willow', activity: 'retreating after ritual interruption' },
      { id: 'Xander Harris', where: 'fleeing with Willow', activity: 'retreating after ritual interruption' },
      { id: 'Anya Jenkins', where: 'fleeing with Willow', activity: 'retreating after ritual interruption' },
      { id: 'Dawn Summers', where: 'Summers home or with Spike', activity: 'unaware of resurrection attempt' },
      { id: 'Spike', where: 'Sunnydale, protecting Dawn', activity: 'unaware of resurrection attempt; Buffybot being destroyed by Hellions' },
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
        'Dawn Summers', 'Spike', 'Hellion bikers',
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
});

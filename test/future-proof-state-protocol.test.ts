import { describe, expect, it } from 'vitest';
import { parseState } from '../src/parse/state-block.js';
import { reduce } from '../src/core/reduce.js';
import { freshState } from '../src/domain/types.js';
import { creativeSubplotTitle, subplotTitleCase } from '../src/domain/subplot-title.js';
import type { VellumEvent } from '../src/core/events.js';
import { ParsedState } from '../src/parse/parsed.js';
import { CompilerState, compilerProviderSchema, salvageCompilation, type CompilerInput, type StateCandidate } from '../src/domain/state-compiler.js';
import { engineValidationCapabilities, STATE_DELTA_FAMILIES, STATE_EXTENSION_FAMILIES, STATE_PROTOCOL, STATE_PROTOCOL_VERSION } from '../src/domain/state-protocol.js';
import { VELLUM_STATE_BLOCK_CONTENT } from '../src/domain/preset-health.js';

const base = { turn: 1, day: 0, src: 'model' as const };

describe('future-proof state protocol', () => {
  it('keeps the prompt contract in parity with every canonical delta and extension family', () => {
    const delta = (ParsedState.shape.delta as any).removeCatch().unwrap().shape as Record<string, unknown>;
    expect(Object.keys(delta).sort()).toEqual([...STATE_DELTA_FAMILIES].sort());
    expect(Object.keys(CompilerState.shape.delta.shape).sort()).toEqual([...STATE_DELTA_FAMILIES].filter(family => family !== 'parallel').sort());
    expect(Object.keys(CompilerState.shape.ext.shape).sort()).toEqual([...STATE_EXTENSION_FAMILIES].sort());
    const provider = compilerProviderSchema() as any;
    expect(Object.keys(provider.properties.state.properties.delta.properties).sort()).toEqual([...STATE_DELTA_FAMILIES].filter(family => family !== 'parallel').sort());
    expect(Object.keys(provider.properties.state.properties.ext.properties).sort()).toEqual([...STATE_EXTENSION_FAMILIES].sort());
    for (const family of [...STATE_DELTA_FAMILIES, ...STATE_EXTENSION_FAMILIES]) expect(VELLUM_STATE_BLOCK_CONTENT).toContain(family);
  });

  it('defines every family ownership, identity, omission, and evidence policy in one executable manifest', () => {
    for (const layer of ['delta', 'extension'] as const) for (const [name, contract] of Object.entries(STATE_PROTOCOL.families[layer])) {
      expect(name).not.toBe('');
      expect(contract).toMatchObject({ ownership: expect.any(String), omission: expect.any(String), identity: expect.any(String), evidence: expect.any(String) });
    }
  });

  it('changes only quotation capabilities between evidence and no-evidence Engine Pass modes', () => {
    const evidence = engineValidationCapabilities('evidence');
    const none = engineValidationCapabilities('none');
    expect(evidence).toMatchObject({ providerEvidenceFields: 'include', requireEvidence: true, validateEvidenceGrounding: true });
    expect(none).toMatchObject({ providerEvidenceFields: 'omit', requireEvidence: false, validateEvidenceGrounding: false });
    for (const gate of ['validateCanon', 'validateChronology', 'validateCausality', 'validateIdentity'] as const) {
      expect(evidence[gate]).toBe(true);
      expect(none[gate]).toBe(true);
    }
  });

  it('reports exact unsupported Engine candidate paths instead of silently pruning them', () => {
    const prior = freshState();
    prior.scene = { location: 'Hall', time: '09:00', clock: 540, tension: 0, weather: '', present: [], detail: [] };
    prior.scene.id = 'scene_hall';
    const input: CompilerInput = { prior, turn: 2, prose: 'The hall remains quiet.', userName: '', genesisAllowed: false, evidenceMode: 'none' };
    const candidate: StateCandidate & { surprise?: string } = {
      state: { turn: 2, day: 0, scene: { loc: 'Hall', time: '09:00', clock: 540, unsupportedMood: 'uneasy' } as any, present: [], delta: {}, ext: {} },
      parallelOps: [], parallelWorldOps: [], parallelReviewed: [], evidence: [], trackEvidence: [], genesis: false,
      surprise: 'ignored',
    };
    const compiled = salvageCompilation(candidate, input);
    expect(compiled.ok).toBe(true);
    if (compiled.ok) expect(compiled.recovered).toEqual(expect.arrayContaining([
      'ignored unsupported field: surprise',
      'ignored unsupported field: state.scene.unsupportedMood',
    ]));
  });

  it('migrates old wire versions and reports unsupported fields by exact path', () => {
    const parsed = parseState(`<vellum>${JSON.stringify({ v: 1, scene: { loc: 'Hall', unsupportedMood: 'uneasy' } })}</vellum>`);
    expect(parsed.source).toBe('json');
    expect(parsed.state?.v).toBe(STATE_PROTOCOL_VERSION);
    expect(parsed.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'protocol_migrated', path: 'v' }),
      expect.objectContaining({ code: 'unknown_field', path: 'scene.unsupportedMood' }),
    ]));
  });

  it('keeps ids machine-stable while repairing display titles creatively in Title Case', () => {
    expect(subplotTitleCase('the_last_watch')).toBe('The Last Watch');
    expect(creativeSubplotTitle({ id: 'hellion_raid', name: 'hellion_raid', gist: 'The biker gang patrols the burning streets.' })).toBe('Engines In The Night');
    const parsed = parseState(`<vellum>${JSON.stringify({ v: 3, delta: { offscreen: [{ op: 'new', id: 'scoobies_fleeing', location_op: 'refinement', gist: 'The group is fleeing the attack.' }] } })}</vellum>`);
    expect(parsed.state?.delta?.offscreen?.[0]).toMatchObject({ id: 'scoobies_fleeing', name: 'No Safe Road Home', locationOp: 'refine' });
  });

  it('does not turn a historical possession note into current ownership', () => {
    const state = reduce([{ ...base, seq: 1, kind: 'item.change', id: 'item_necklace', who: 'buffy', item: 'gold necklace', op: 'note', note: 'Buffy held it, then returned it.' } as VellumEvent]);
    expect(state.items).toEqual([]);
    expect(state.itemHistory).toEqual([expect.objectContaining({ itemId: 'item_necklace', op: 'note' })]);
  });

  it('replaces and removes derived parallel projections by subplot id, not mutable prose', () => {
    const state = freshState();
    const events: VellumEvent[] = [
      { ...base, seq: 1, kind: 'offscreen.op', op: 'new', id: 'night_watch', name: 'night_watch', where: 'North Gate', gist: 'The watch searches the road.' },
      { ...base, seq: 2, turn: 2, kind: 'offscreen.op', op: 'advance', id: 'night_watch', where: 'North Gate', gist: 'A rider breaks through the cordon.' },
    ] as VellumEvent[];
    const advanced = reduce(events, state);
    expect(advanced.parallel).toEqual([expect.objectContaining({ sourceSubplotId: 'night_watch', activity: 'A rider breaks through the cordon.' })]);
    expect(advanced.parallel).toHaveLength(1);
    const dropped = reduce([{ ...base, seq: 3, turn: 3, kind: 'offscreen.drop', id: 'night_watch' } as VellumEvent], advanced);
    expect(dropped.parallel).toEqual([]);
  });
});

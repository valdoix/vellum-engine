import { describe, it, expect, vi } from 'vitest';
import { CompilerCandidate, jsonSchema, validateCompilation, type CompilerInput, type StateCandidate } from '../src/domain/state-compiler.js';
import { freshState } from '../src/domain/types.js';
import { compileState, compilerContext } from '../src/bus/state-compiler.js';

function input(): CompilerInput {
  const prior = freshState(); prior.day = 1;
  prior.scene = { location: 'Archive', time: '23:58', clock: 1438, tension: 1, weather: '', present: ['mara'], detail: [] };
  prior.cast.mara = { id: 'mara', name: 'Mara', aka: [], status: 'present', source: 'user', firstTurn: 1, lastTurn: 1, userEdited: true };
  prior.cast.ada = { ...prior.cast.mara, id: 'ada', name: 'Ada', status: 'active' };
  prior.parallel = [{ who: 'ada', where: 'Courtyard', activity: 'Waiting', day: 1, turn: 1 }];
  return { prior, turn: 2, prose: 'Mara waits five minutes. Ada moves to the gate. Player stays quiet.', userName: 'Player', genesisAllowed: false };
}
function candidate(): StateCandidate {
  return { state: { turn: 2, day: 2, scene: { loc: 'Archive', time: '00:03', clock: 3 }, present: [{ id: 'Mara', thought: 'I should wait.' }, { id: 'Player', thought: '' }], delta: {}, ext: {} }, parallelReviewed: ['Ada'], parallelOps: [], evidence: [{ path: 'scene.time', quote: 'five minutes' }], genesis: false };
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
  it('bounds compiler context while retaining current actors and parallel rows', () => {
    const i = input();
    for (let n = 0; n < 400; n++) i.prior.knowledge.push({ id: `k${n}`, who: 'mara', fact: 'fact '.repeat(40) + n, reliability: 'knows', truth: 'unknown', turn: n });
    const context = compilerContext(i);
    expect(context.length).toBeLessThan(75000);
    expect(context).toContain('Courtyard'); expect(context).toContain('Mara');
  });
  it('does not salvage a truncated provider response; bounded retry can recover', async () => {
    const generate = vi.fn().mockResolvedValueOnce({ ok: true, value: JSON.stringify(candidate()).slice(0, -12) }).mockResolvedValueOnce({ ok: true, value: JSON.stringify(candidate()) });
    const r = await compileState(input(), null, undefined, generate);
    expect(r.ok).toBe(true); expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1]![0][1].content).toContain('Previous candidate rejected');
  });
  it('quarantines repeated provider failure after two calls', async () => {
    const generate = vi.fn().mockResolvedValue({ ok: false, error: 'timeout' });
    expect(await compileState(input(), null, undefined, generate)).toEqual({ ok: false, errors: ['timeout'] });
    expect(generate).toHaveBeenCalledTimes(2);
  });
});

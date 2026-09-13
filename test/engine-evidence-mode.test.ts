import { describe, it, expect, vi } from 'vitest';
import { validateCompilation, salvageCompilation, compilerProviderSchema, type CompilerInput, type StateCandidate } from '../src/domain/state-compiler.js';
import { compileState, compilerContext } from '../src/bus/state-compiler.js';
import { freshState } from '../src/domain/types.js';

// Same-day clock fixture: a small forward tick the deterministic floor can infer
// from the prose without any evidence quote, so no-evidence mode never needs a
// scene.time quotation to justify a day advance.
function input(): CompilerInput {
  const prior = freshState(); prior.day = 1;
  prior.scene = { location: 'Archive', time: '10:00', clock: 600, tension: 1, weather: '', present: ['mara'], detail: [] };
  prior.cast.mara = { id: 'mara', name: 'Mara', aka: [], status: 'present', source: 'user', firstTurn: 1, lastTurn: 1, userEdited: true };
  prior.cast.ada = { ...prior.cast.mara, id: 'ada', name: 'Ada', status: 'active' };
  prior.cast.spike = { ...prior.cast.mara, id: 'spike', name: 'Spike', status: 'active' };
  prior.cast.bones = { ...prior.cast.mara, id: 'bones', name: 'Bones', status: 'active', deceased: true };
  prior.parallel = [{ who: 'ada', where: 'Courtyard', activity: 'Waiting', day: 1, turn: 1 }];
  return { prior, turn: 2, prose: 'Mara waits five minutes in the Archive. Ada patrols the gate. Player stays quiet.', userName: 'Player', genesisAllowed: false };
}
function candidate(): StateCandidate {
  return {
    state: { turn: 2, day: 1, scene: { loc: 'Archive', time: '10:05', clock: 605 }, present: [{ id: 'Mara', thought: 'I should wait.' }, { id: 'Player', thought: '' }], delta: {}, ext: {} },
    parallelReviewed: ['Ada'], parallelOps: [], parallelWorldOps: [], evidence: [], trackEvidence: [], genesis: false,
  };
}

describe('Engine Pass evidence mode', () => {
  it('default mode still rejects a delta row without evidence', () => {
    const i = input();
    i.prose = 'Mara waits five minutes, then discovers a copper key beneath the ledger. Player stays quiet.';
    const c = candidate();
    c.state.ext.codex = [{ op: 'add', fact: 'A copper key was hidden beneath the ledger.', tag: 'discovery' }];
    const r = validateCompilation(c, i);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain('missing evidence: ext.codex.0');
  });

  it('no-evidence mode accepts the same row without any evidence', () => {
    const i = input(); i.evidenceMode = 'none';
    i.prose = 'Mara waits five minutes, then discovers a copper key beneath the ledger. Player stays quiet.';
    const c = candidate();
    c.state.ext.codex = [{ op: 'add', fact: 'A copper key was hidden beneath the ledger.', tag: 'discovery' }];
    const r = validateCompilation(c, i);
    expect(r.ok).toBe(true);
  });

  it('no-evidence mode accepts a plot advance without a trackEvidence quote (proof synthesized)', () => {
    const i = input(); i.evidenceMode = 'none';
    i.prior.threads = [{ id: 'thr_gate', name: 'Open the gate', status: 'open', beats: ['The gate is sealed.'], firstTurn: 1, lastTurn: 1 }];
    const c = candidate();
    c.state.delta.threads = [{ op: 'advance', name: 'Open the gate', note: 'Mara lifts the latch and the gate swings open.' }];
    const r = validateCompilation(c, i);
    expect(r.ok).toBe(true);
  });

  it('no-evidence mode still rejects an unchanged plot condition', () => {
    const i = input(); i.evidenceMode = 'none';
    i.prior.threads = [{ id: 'thr_gate', name: 'Open the gate', status: 'open', beats: ['Mara lifts the latch and the gate swings open.'], firstTurn: 1, lastTurn: 1 }];
    const c = candidate();
    c.state.delta.threads = [{ op: 'advance', name: 'Open the gate', note: 'Mara lifts the latch and the gate swings open.' }];
    const r = validateCompilation(c, i);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain('plot change does not alter the prior condition: delta.threads.0');
  });

  it('no-evidence mode accepts a plausible autonomous parallel op without a quote', () => {
    const i = input(); i.evidenceMode = 'none'; i.livingWorld = 'active';
    const c = candidate();
    c.parallelOps = [{ op: 'advance', who: 'Ada', where: 'Courtyard', activity: 'patrols the gate' }];
    const r = validateCompilation(c, i);
    expect(r.ok).toBe(true);
  });

  it('no-evidence mode still rejects a deceased actor in a parallel op', () => {
    const i = input(); i.evidenceMode = 'none'; i.livingWorld = 'sandbox';
    const c = candidate();
    c.parallelOps = [{ op: 'start', who: 'Bones', where: 'Courtyard', activity: 'patrols the gate' }];
    const r = validateCompilation(c, i);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some(e => e.includes('deceased actor cannot act in parallel: bones'))).toBe(true);
  });

  it('no-evidence mode still rejects an unknown parallel actor', () => {
    const i = input(); i.evidenceMode = 'none'; i.livingWorld = 'sandbox';
    const c = candidate();
    c.parallelOps = [{ op: 'start', who: 'Nobody', where: 'Courtyard', activity: 'patrols the gate' }];
    const r = validateCompilation(c, i);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some(e => e.includes('unknown parallel actor'))).toBe(true);
  });

  it('no-evidence mode still rejects a backward clock', () => {
    const i = input(); i.evidenceMode = 'none';
    i.prose = 'Mara stands in the Archive. Player stays quiet.';
    const c = candidate();
    c.state.scene.time = '09:50'; c.state.scene.clock = 590;
    const r = validateCompilation(c, i);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain('clock moves backward');
  });

  it('no-evidence mode still requires Living World for offscreen subplots', () => {
    const i = input(); i.evidenceMode = 'none';
    const c = candidate();
    c.state.delta.offscreen = [{ op: 'new', id: 'watch', name: 'Courtyard watch', who: 'Ada', where: 'Courtyard', gist: 'patrols the gate' }];
    const r = validateCompilation(c, i);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain('offscreen deltas require Living World active or sandbox');
  });

  it('salvage keeps a scene location change without evidence in no-evidence mode', () => {
    const i = input(); i.evidenceMode = 'none';
    i.prose = 'Mara crosses to the East Wing. Player stays quiet.';
    const raw = {
      state: { turn: 2, day: 1, scene: { loc: 'East Wing', time: '10:05', clock: 605 }, present: [{ id: 'Mara', thought: 'I should wait.' }, { id: 'Player', thought: '' }], delta: {}, ext: {} },
      parallelOps: [], parallelWorldOps: [], parallelReviewed: ['Ada'], evidence: [], trackEvidence: [], genesis: false,
    };
    const r = salvageCompilation(raw, i);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.candidate.state.scene.loc).toBe('East Wing');
  });

  it('provider schema drops evidence fields in no-evidence mode', () => {
    const evidenceSchema = compilerProviderSchema('evidence') as any;
    const noneSchema = compilerProviderSchema('none') as any;
    expect(evidenceSchema.properties.state.properties.scene.properties.evidence).toBeDefined();
    expect(noneSchema.properties.state.properties.scene.properties.evidence).toBeUndefined();
    expect(noneSchema.properties.parallelOps.items.required).not.toContain('evidence');
  });

  it('compiler context reports evidence mode none and omits the evidence question', () => {
    const i = input(); i.evidenceMode = 'none';
    const ctx = JSON.parse(compilerContext(i));
    expect(ctx.evidencePolicy.mode).toBe('none');
    expect(ctx.controls.evidenceMode).toBe('none');
  });

  it('compileState emits the no-evidence directive and a none evidencePolicy', async () => {
    const i = input(); i.evidenceMode = 'none';
    let captured: any = null;
    const generate = vi.fn(async (messages: any[]) => { captured = messages; return { ok: true, value: JSON.stringify(candidate()) }; });
    await compileState(i, null, undefined, generate as any);
    expect(captured).toBeTruthy();
    const system = captured[0].content as string;
    expect(system).toContain('EVIDENCE MODE — NONE');
    const user = JSON.parse(captured[1].content);
    expect(user.evidencePolicy.mode).toBe('none');
  });

  it('default compileState does not emit the no-evidence directive', async () => {
    const i = input();
    let captured: any = null;
    const generate = vi.fn(async (messages: any[]) => { captured = messages; return { ok: true, value: JSON.stringify(candidate()) }; });
    await compileState(i, null, undefined, generate as any);
    const system = captured[0].content as string;
    expect(system).not.toContain('EVIDENCE MODE — NONE');
  });
});

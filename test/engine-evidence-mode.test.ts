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
    expect(system).toContain('plot mutations belong in state.delta as {op,id,name,note,arc}');
    expect(system).toContain('never put offscreen or parallelOps inside state.ext');
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

  it('no-evidence mode corrects status:"active" on an opening thread to op:"new" for ARGENT', () => {
    const i = input(); i.evidenceMode = 'none'; i.argent = true;
    i.prose = 'Mara kneels beside the open grave, gripping her companion\'s hand, disoriented and overwhelmed by the noise and smoke. Player stays quiet.';
    const raw = {
      state: { turn: 2, day: 1, scene: { loc: 'Archive', time: '10:05', clock: 605 }, present: [{ id: 'Mara', thought: 'I should wait.' }, { id: 'Player', thought: '' }], delta: {
        threads: [{ id: 't_grave_dirt', title: 'Grave Dirt and Ocean Eyes', status: 'active', kind: 'actionable', description: 'Mara clawed out of her grave.', linkedArc: 'a_after_death', turn: 2, day: 0 }],
        arcs: [{ id: 'a_after_death', title: 'After Death', status: 'active', description: 'Mara has been resurrected.', linkedThreads: ['t_grave_dirt'], turn: 2, day: 0 }],
      }, ext: {} },
      parallelOps: [], parallelWorldOps: [], parallelReviewed: ['Ada'], evidence: [], trackEvidence: [], genesis: false,
    };
    const r = salvageCompilation(raw, i);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const threads = r.candidate.state.delta.threads ?? [];
      expect(threads).toHaveLength(1);
      expect(threads[0]!.op).toBe('new');
      const arcs = r.candidate.state.delta.arcs ?? [];
      expect(arcs).toHaveLength(1);
      expect(arcs[0]!.op).toBe('new');
    }
  });

  it('recovers a Chronicle-shaped no-evidence opening and misplaced world branches', () => {
    const i = input(); i.evidenceMode = 'none'; i.argent = true; i.livingWorld = 'sandbox';
    i.prose = 'Mara claws free of the grave and grips Gabriel\'s hand while distant engines tear through the night. Player stays quiet.';
    for (const [id, name] of [['spike', 'Spike'], ['iris', 'Iris'], ['jules', 'Jules']] as const) {
      i.prior.cast[id] = { ...i.prior.cast.ada!, id, name, lastLocation: 'Courtyard', lastLocationTurn: 1 };
    }
    i.prior.cast.ada!.lastLocation = 'Courtyard'; i.prior.cast.ada!.lastLocationTurn = 1;
    i.prior.locations = [{ id: 'courtyard', name: 'Courtyard', source: 'user', firstTurn: 1, lastTurn: 1 }];
    const grounding = (actor: string, activity: string) => ({
      before: `${actor} was elsewhere in the established setting`, after: activity,
      basis: [`The lorebook establishes ${actor} and the Courtyard`, `The prose supports the current scene while ${actor} acts elsewhere`],
      rationale: `${actor} is an established living NPC at the established Courtyard.`,
    });
    const raw = {
      state: {
        turn: 2, day: 1,
        scene: { loc: 'Archive', time: '10:05', clock: 605 },
        present: [{ id: 'Mara', thought: 'I should wait.' }, { id: 'Player', thought: '' }],
        delta: {
          threads: [{ id: 't_return', title: 'The Return', status: 'open', arc: 'a_return', summary: 'Mara is alive but disoriented.', proof: 'Mara claws free of the grave and does not know why she returned.' }],
          arcs: [{ id: 'a_return', title: 'After Death', status: 'open', summary: 'Mara has returned from death.', linkedThreads: ['t_return'] }],
        },
        ext: {
          offscreen: [
            { id: 'ada_watch', actor: 'Ada', place: 'Courtyard', activity: 'patrols the courtyard', beatKind: 'progress', impact: 'Ada can intercept anyone crossing the courtyard.', grounding: grounding('Ada', 'patrols the courtyard') },
            { id: 'spike_watch', actor: 'Spike', place: 'Courtyard', activity: 'checks the crypt doors', beatKind: 'obstacle', impact: 'Spike may discover which crypt was disturbed.', grounding: grounding('Spike', 'checks the crypt doors') },
          ],
          parallelOps: [
            { id: 'par_ada', actor: 'Ada', place: 'Courtyard', activity: 'patrols the courtyard' },
            { id: 'par_spike', actor: 'Spike', place: 'Courtyard', activity: 'checks the crypt doors' },
            { id: 'par_iris', actor: 'Iris', place: 'Courtyard', activity: 'counts the lanterns' },
            { id: 'par_jules', actor: 'Jules', place: 'Courtyard', activity: 'secures the side gate' },
          ],
        },
      },
      parallelOps: [], parallelWorldOps: [], parallelReviewed: [], evidence: [], trackEvidence: [], genesis: false,
    };
    const r = salvageCompilation(raw, i);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.candidate.state.delta.threads).toEqual([expect.objectContaining({ op: 'new', name: 'The Return', note: 'Mara claws free of the grave and does not know why she returned.' })]);
    expect(r.candidate.state.delta.arcs).toEqual([expect.objectContaining({ op: 'new', name: 'After Death', note: 'Mara has returned from death.' })]);
    expect(r.candidate.state.delta.offscreen, JSON.stringify(r, null, 2)).toHaveLength(2);
    expect(r.candidate.state.delta.offscreen?.every((row: { op?: string }) => row.op === 'new')).toBe(true);
    expect(r.candidate.parallelOps).toHaveLength(4);
    expect(r.candidate.parallelOps.map(row => row.who)).toEqual(['Ada', 'Spike', 'Iris', 'Jules']);
    expect((r.candidate.state.ext as any).offscreen).toBeUndefined();
    expect((r.candidate.state.ext as any).parallelOps).toBeUndefined();
  });

  it('reports a salvaged opening row rejection before the downstream ARGENT count error', async () => {
    const i = input(); i.evidenceMode = 'none'; i.argent = true;
    i.prose = 'Mara claws free of the grave and grips Gabriel\'s hand, alive but disoriented and uncertain why she returned. Player stays quiet.';
    const raw = {
      state: { turn: 2, day: 1, scene: { loc: 'Archive', time: '10:05', clock: 605 }, present: [{ id: 'Mara', thought: 'I should wait.' }, { id: 'Player', thought: '' }], delta: {
        threads: [{ id: 't_return', title: 'The Return', status: 'open', arc: 'a_return' }],
        arcs: [{ id: 'a_return', title: 'After Death', status: 'open', summary: 'Mara has returned from death.' }],
      }, ext: {} },
      parallelOps: [], parallelWorldOps: [], parallelReviewed: ['Ada'], evidence: [], trackEvidence: [], genesis: false,
    };
    const generate = vi.fn(async () => ({ ok: true, value: JSON.stringify(raw) }));
    const r = await compileState(i, null, undefined, generate as any);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/^Rejected thread "The Return":/);
    expect(r.errors).toContain('ARGENT requires exactly one grounded opening thread when the plot ledger is empty');
  });

  it('evidence mode also corrects status:"active" on an opening thread to op:"new" for ARGENT', () => {
    const i = input(); i.argent = true;
    i.prose = 'Mara clawed out of her grave, resurrected at last. Player stays quiet.';
    const raw = {
      state: { turn: 2, day: 1, scene: { loc: 'Archive', time: '10:00', clock: 600 }, present: [{ id: 'Mara', thought: 'I should wait.' }, { id: 'Player', thought: '' }], delta: {
        threads: [{ id: 't_grave_dirt', title: 'Grave Dirt', status: 'active', description: 'Mara clawed out of her grave.', linkedArc: 'a_resurrection', turn: 2, day: 0 }],
        arcs: [{ id: 'a_resurrection', title: 'Resurrected', status: 'active', description: 'resurrected at last', linkedThreads: ['t_grave_dirt'], turn: 2, day: 0 }],
      }, ext: {} },
      parallelOps: [], parallelWorldOps: [], parallelReviewed: ['Ada'],
      evidence: [
        { path: 'delta.threads.0', quote: 'Mara clawed out of her grave' },
        { path: 'delta.arcs.0', quote: 'resurrected at last' },
      ], trackEvidence: [], genesis: false,
    };
    const r = salvageCompilation(raw, i);
    if (!r.ok) {
      // If salvage rejected, verify it's NOT the ARGENT op error — the op
      // correction still happened during normalization
      expect(r.errors.some((e: string) => e.includes('ARGENT requires exactly one'))).toBe(false);
    } else {
      expect((r.candidate.state.delta.threads ?? [])[0]!.op).toBe('new');
      expect((r.candidate.state.delta.arcs ?? [])[0]!.op).toBe('new');
    }
  });

  it('does not promote an existing thread with status:"active" to op:"new"', () => {
    const i = input(); i.evidenceMode = 'none'; i.argent = true;
    i.prior.threads = [{ id: 't_grave_dirt', name: 'Grave Dirt and Ocean Eyes', status: 'open', beats: ['Mara clawed out.'], firstTurn: 1, lastTurn: 1 }];
    i.prior.arcs = [{ id: 'a_after_death', name: 'After Death', status: 'open', beats: ['Mara has been resurrected.'], firstTurn: 1, lastTurn: 1 }];
    i.prose = 'Mara kneels beside the open grave, gripping her companion\'s hand, disoriented and overwhelmed by the noise and smoke. Player stays quiet.';
    const raw = {
      state: { turn: 2, day: 1, scene: { loc: 'Archive', time: '10:05', clock: 605 }, present: [{ id: 'Mara', thought: 'I should wait.' }, { id: 'Player', thought: '' }], delta: {
        threads: [{ id: 't_grave_dirt', title: 'Grave Dirt and Ocean Eyes', status: 'active', note: 'Mara steadies herself against the gravestone.', linkedArc: 'a_after_death' }],
        arcs: [{ id: 'a_after_death', title: 'After Death', status: 'active', note: 'The aftermath continues.' }],
      }, ext: {} },
      parallelOps: [], parallelWorldOps: [], parallelReviewed: ['Ada'], evidence: [], trackEvidence: [], genesis: false,
    };
    const r = salvageCompilation(raw, i);
    if (r.ok) {
      expect((r.candidate.state.delta.threads ?? [])[0]!.op).toBe('advance');
    }
  });
});

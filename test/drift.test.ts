import { describe, it, expect } from 'vitest';
import { reduce } from '../src/core/reduce.js';
import { mergeCastDuplicates } from '../src/domain/identity.js';
import { coreFeature } from '../src/domain/core-feature.js';
import { checkContinuity } from '../src/domain/continuity.js';
import { freshState } from '../src/domain/types.js';
import { migrate } from '../src/core/migrate.js';
import { SCHEMA_VERSION } from '../src/core/events.js';
import { traitArc, dormantTraits, driftInjection } from '../src/domain/drift.js';
import type { ExtractCtx } from '../src/bus/registry.js';
import type { VellumEvent } from '../src/core/events.js';

let seq = 0;
const sf = () => ++seq;
const ev = (e: Partial<VellumEvent>): VellumEvent => ({ seq: sf(), turn: 5, day: 1, src: 'model', ...(e as object) } as VellumEvent);
function cast(id: string, traits: string[], firstTurn = 1) { return { id, name: id.charAt(0).toUpperCase() + id.slice(1), aka: [], status: 'active', source: 'auto', firstTurn, lastTurn: firstTurn, userEdited: false, traits } as any; }
function ctx(state = freshState(), turn = 10): ExtractCtx { return { turn, day: 1, state, seq: sf } as any; }

describe('drift derivation (core-feature)', () => {
  it('a new character seeds emerge for each trait (no cause needed)', () => {
    const out = coreFeature.extract!({ present: [{ id: 'Cersei', traits: ['proud', 'trusting'] }], scene: { loc: 'x' } } as any, ctx());
    const drifts = out.filter((e) => e.kind === 'trait.drift') as any[];
    expect(drifts).toHaveLength(2);
    expect(drifts.every((d) => d.op === 'emerge')).toBe(true);
  });

  it('a trait change WITH a cause (scar) logs a reverse; the cause is linked', () => {
    const s = freshState();
    s.cast.cersei = cast('cersei', ['trusting'], 1);
    const out = coreFeature.extract!({ present: [{ id: 'Cersei', traits: ['guarded'] }], ext: { scars: [{ who: 'Cersei', was: 'believed Jaime loyal' }] } } as any, ctx(s, 40));
    const d = out.find((e) => e.kind === 'trait.drift') as any;
    expect(d.op).toBe('reverse');
    expect(d.from).toBe('trusting');
    expect(d.trait).toBe('guarded');
    expect(d.cause).toContain('belief proven wrong');
  });

  it('a trait change with NO cause logs nothing (noise gate)', () => {
    const s = freshState();
    s.cast.cersei = cast('cersei', ['calm'], 1);
    const out = coreFeature.extract!({ present: [{ id: 'Cersei', traits: ['anxious'] }] } as any, ctx(s, 20));
    expect(out.filter((e) => e.kind === 'trait.drift')).toHaveLength(0);
  });

  it('inertia: a long-held trait does not fade without a DEFINING cause', () => {
    const s = freshState();
    s.cast.cersei = cast('cersei', ['guarded'], 1);
    s.traitHistory.push({ who: 'cersei', trait: 'guarded', op: 'emerge', turn: 1 });
    // turn 40: a mere 'significant' journal (not defining) — inertia suppresses the fade/reverse
    const out = coreFeature.extract!({ present: [{ id: 'Cersei', traits: ['open'] }], delta: { journal: [{ who: 'Cersei', memory: 'a nice chat', weight: 'significant' }] } } as any, ctx(s, 40));
    const drifts = out.filter((e) => e.kind === 'trait.drift') as any[];
    // no reverse of the heavy trait; 'open' still emerges (added, not gated)
    expect(drifts.some((d) => d.op === 'reverse' || (d.op === 'fade' && d.trait === 'guarded'))).toBe(false);
  });
});

describe('drift reduce + views', () => {
  it('trait.drift folds into traitHistory; cast.drop cascades; merge remaps', () => {
    expect(reduce([ev({ kind: 'trait.drift', who: 'cersei', trait: 'guarded', op: 'emerge' })]).traitHistory).toHaveLength(1);
    // merge: two cast cards (short + full) collapse; traitHistory.who remaps to the survivor
    let s = reduce([
      ev({ kind: 'cast.seen', id: 'cersei', name: 'Cersei', status: 'active' }),
      ev({ kind: 'cast.seen', id: 'cersei_lannister', name: 'Cersei Lannister', status: 'active' }),
      ev({ kind: 'trait.drift', who: 'cersei', trait: 'guarded', op: 'emerge' }),
    ]);
    s = mergeCastDuplicates(s);
    expect(s.traitHistory[0]!.who).toBe('cersei_lannister');
    const dropped = reduce([ev({ kind: 'trait.drift', who: 'x', trait: 't', op: 'emerge' }), ev({ kind: 'cast.drop', id: 'x' })]);
    expect(dropped.traitHistory).toHaveLength(0);
  });

  it('traitArc marks a reversed-away trait dormant and the new one active', () => {
    const s = freshState();
    s.cast.cersei = cast('cersei', ['guarded'], 1);
    s.turns = 60;
    s.traitHistory.push({ who: 'cersei', trait: 'trusting', op: 'emerge', turn: 3 });
    s.traitHistory.push({ who: 'cersei', trait: 'guarded', op: 'reverse', from: 'trusting', turn: 58 });
    s.traitHistory.push({ who: 'cersei', trait: 'trusting', op: 'fade', turn: 58 });
    const arcs = traitArc(s, 'cersei');
    expect(arcs.map((a) => a.trait)).toContain('guarded');
    expect(arcs.map((a) => a.trait)).not.toContain('trusting');
    expect(dormantTraits(s, 'cersei')).toContain('trusting');
  });

  it('driftInjection includes only present, drifted characters (capped)', () => {
    const s = freshState();
    s.cast.cersei = cast('cersei', ['guarded'], 1);
    s.cast.flat = cast('flat', ['stoic'], 1);
    s.traitHistory.push({ who: 'cersei', trait: 'trusting', op: 'emerge', turn: 3 });
    s.traitHistory.push({ who: 'cersei', trait: 'guarded', op: 'reverse', from: 'trusting', turn: 58 });
    s.traitHistory.push({ who: 'flat', trait: 'stoic', op: 'emerge', turn: 1 }); // single emerge = not drifted
    const inj = driftInjection(s, ['cersei', 'flat']);
    expect(inj).toContain('PERSONALITY');
    expect(inj).toContain('Cersei');
    expect(inj).not.toContain('Flat');
  });
});

describe('anti-flip-flop continuity flag', () => {
  it('flags a hardened trait reversing', () => {
    const prior = freshState();
    prior.cast.cersei = cast('cersei', ['guarded'], 1);
    prior.traitHistory.push({ who: 'cersei', trait: 'guarded', op: 'harden', turn: 40 });
    const w = checkContinuity([ev({ kind: 'trait.drift', who: 'cersei', trait: 'guarded', op: 'reverse', from: 'guarded' })], prior);
    expect(w.some((x) => x.kind === 'trait_reversal')).toBe(true);
  });
});

describe('migration v10 → v11', () => {
  it('advances version; reduce yields empty traitHistory', () => {
    const log = migrate({ version: 10, chatId: 'c', events: [], createdAt: 1, updatedAt: 1 }) as any;
    expect(log.version).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(11);
    expect(reduce([]).traitHistory).toEqual([]);
  });
});

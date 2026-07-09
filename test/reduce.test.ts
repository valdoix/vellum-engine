import { describe, it, expect } from 'vitest';
import { reduce } from '../src/core/reduce.js';
import type { VellumEvent } from '../src/core/events.js';

// helper to stamp the common base fields
let seq = 0;
function ev(e: Partial<VellumEvent> & { kind: VellumEvent['kind'] }): VellumEvent {
  return { seq: ++seq, turn: 1, day: 1, src: 'model', ...(e as object) } as VellumEvent;
}

describe('reduce — relations', () => {
  it('relationships are directional: a→b and b→a are independent edges', () => {
    const events: VellumEvent[] = [
      ev({ kind: 'bond.delta', a: 'cersei', b: 'jaime', aff: 20, trust: 10, addCats: ['social'] }),
      ev({ kind: 'bond.delta', a: 'jaime', b: 'cersei', aff: -30, addCats: ['rivalry'] }), // reverse order = distinct edge
    ];
    const s = reduce(events);
    expect(s.relations).toHaveLength(2); // directional identity
    const cj = s.relations.find((r) => r.a === 'cersei' && r.b === 'jaime')!;
    const jc = s.relations.find((r) => r.a === 'jaime' && r.b === 'cersei')!;
    expect(cj.affection).toBe(20);
    expect(jc.affection).toBe(-30);
    expect(cj.categories).toContain('social');
    expect(jc.categories).toContain('rivalry');
  });

  it('accumulates same-direction deltas in place', () => {
    const s = reduce([
      ev({ kind: 'bond.delta', a: 'a', b: 'b', aff: 20, addCats: ['social'] }),
      ev({ kind: 'bond.delta', a: 'a', b: 'b', aff: 30, addCats: ['romantic'] }),
    ]);
    expect(s.relations).toHaveLength(1);
    expect(s.relations[0]!.affection).toBe(50);
    expect(s.relations[0]!.category).toBe('romantic');
  });

  it('bond.drop is directed; both:true clears the reciprocal too', () => {
    const base: VellumEvent[] = [
      ev({ kind: 'bond.delta', a: 'a', b: 'b', aff: 10 }),
      ev({ kind: 'bond.delta', a: 'b', b: 'a', aff: -10 }),
    ];
    const directed = reduce([...base, ev({ kind: 'bond.drop', a: 'a', b: 'b' })]);
    expect(directed.relations).toHaveLength(1);
    expect(directed.relations[0]!.a).toBe('b');

    const both = reduce([...base, ev({ kind: 'bond.drop', a: 'a', b: 'b', both: true })]);
    expect(both.relations).toHaveLength(0);
  });

  it('auto source cannot silently strip an established facet; user can', () => {
    const auto = reduce([
      ev({ kind: 'bond.delta', a: 'a', b: 'b', addCats: ['romantic'] }),
      ev({ kind: 'bond.delta', a: 'a', b: 'b', removeCats: ['romantic'], src: 'living' }),
    ]);
    expect(auto.relations[0]!.categories).toContain('romantic'); // auto blocked

    const user = reduce([
      ev({ kind: 'bond.delta', a: 'a', b: 'b', addCats: ['romantic'] }),
      ev({ kind: 'bond.delta', a: 'a', b: 'b', removeCats: ['romantic'], src: 'user' }),
    ]);
    expect(user.relations[0]!.categories).not.toContain('romantic'); // user allowed
  });

  it('user-edited bond still evolves with narrative deltas, but resists auto absolute overwrites', () => {
    // a manual edit sets the baseline; the story must still move it (the "stays at
    // 0 after I made the relation" bug). Only a non-user ABSOLUTE set is blocked.
    const s = reduce([
      ev({ kind: 'bond.delta', a: 'a', b: 'b', aff: 50, src: 'user' }), // manual baseline
      ev({ kind: 'bond.delta', a: 'a', b: 'b', aff: 12, src: 'model' }), // narrative delta → accumulates
    ]);
    expect(s.relations[0]!.affection).toBe(62);

    const locked = reduce([
      ev({ kind: 'bond.delta', a: 'a', b: 'b', aff: 50, src: 'user' }),
      ev({ kind: 'bond.delta', a: 'a', b: 'b', aff: 5, absolute: true, src: 'model' }), // auto absolute → ignored
    ]);
    expect(locked.relations[0]!.affection).toBe(50);

    // but a USER absolute set still applies
    const userAbs = reduce([
      ev({ kind: 'bond.delta', a: 'a', b: 'b', aff: 50, src: 'user' }),
      ev({ kind: 'bond.delta', a: 'a', b: 'b', aff: 5, absolute: true, src: 'user' }),
    ]);
    expect(userAbs.relations[0]!.affection).toBe(5);
  });

  it('records a score history sample per change (powers the scrubber)', () => {
    const s = reduce([
      ev({ kind: 'bond.delta', a: 'a', b: 'b', aff: 10, turn: 1 }),
      ev({ kind: 'bond.delta', a: 'a', b: 'b', aff: 20, turn: 5 }),
    ]);
    expect(s.relations[0]!.history.length).toBe(2);
    expect(s.relations[0]!.history[1]!.turn).toBe(5);
  });
});

describe('reduce — cast, knowledge, secrets, memory', () => {
  it('demotes cast who left the scene from present \u2192 active', () => {
    const s = reduce([
      ev({ kind: 'cast.seen', id: 'ned', name: 'Ned', status: 'present' }),
      ev({ kind: 'cast.seen', id: 'jon', name: 'Jon', status: 'present' }),
      ev({ kind: 'scene.set', present: ['ned', 'jon'] }),
      // next turn: only Ned remains on stage
      ev({ kind: 'scene.set', present: ['ned'] }),
      ev({ kind: 'cast.seen', id: 'ned', name: 'Ned', status: 'present' }),
    ]);
    expect(s.cast.ned!.status).toBe('present'); // still on stage
    expect(s.cast.jon!.status).toBe('active'); // left \u2192 demoted, not stuck present
    expect(s.scene.present).toEqual(['ned']);
  });

  it('mergeDetail scene.set fills empty detail fields without overwriting authored ones', () => {
    const s = reduce([
      ev({ kind: 'scene.set', present: ['ned'], detail: [{ id: 'ned', mood: 'grim' }] }), // block authored mood only
      // prose extractor recovers the inner thought (and would-be mood, which must NOT clobber)
      ev({ kind: 'scene.set', present: ['ned'], detail: [{ id: 'ned', mood: 'weary', thought: 'Winter is coming.' }], mergeDetail: true }),
    ]);
    const d = s.scene.detail.find((x) => x.id === 'ned')!;
    expect(d.mood).toBe('grim'); // authored value preserved
    expect(d.thought).toBe('Winter is coming.'); // gap filled
    expect(s.scene.present).toEqual(['ned']);
  });

  it('mergeDetail scene.set adds a missing present character and never demotes cast', () => {
    const s = reduce([
      ev({ kind: 'cast.seen', id: 'jon', name: 'Jon', status: 'present' }),
      ev({ kind: 'scene.set', present: ['ned'], detail: [{ id: 'ned' }] }), // authoritative: only Ned on stage
      // recovery re-seeds Jon (cast.seen) then adds his thought without wiping Ned
      ev({ kind: 'cast.seen', id: 'jon', name: 'Jon', status: 'present' }),
      ev({ kind: 'scene.set', present: ['jon'], detail: [{ id: 'jon', thought: 'I am no Stark.' }], mergeDetail: true }),
    ]);
    expect(s.scene.present).toEqual(['ned', 'jon']); // merged, not replaced
    expect(s.scene.detail.find((x) => x.id === 'jon')!.thought).toBe('I am no Stark.');
    expect(s.cast.jon!.status).toBe('present'); // merge event never demotes
  });

  it('tracks cast and drops cascade to relations', () => {
    const s = reduce([
      ev({ kind: 'cast.seen', id: 'ned', name: 'Ned Stark', status: 'present' }),
      ev({ kind: 'cast.seen', id: 'jon', name: 'Jon Snow', status: 'active' }),
      ev({ kind: 'bond.delta', a: 'ned', b: 'jon', addCats: ['familial'] }),
      ev({ kind: 'cast.drop', id: 'ned' }),
    ]);
    expect(s.cast.ned).toBeUndefined();
    expect(s.relations).toHaveLength(0); // edge removed with the node
  });

  it('memory.edit updates the gist text and detail in place', () => {
    const s = reduce([
      ev({ kind: 'memory.record', id: 'chap1', tier: 'chapter', text: 'old gist', detail: 'old detail', keys: [] }),
      ev({ kind: 'memory.edit', id: 'chap1', text: 'new gist', detail: 'new detail' }),
    ]);
    const m = s.memories.find((x) => x.id === 'chap1')!;
    expect(m.text).toBe('new gist');
    expect(m.detail).toBe('new detail');
  });

  it('memory.edit with empty detail clears it; blank text is ignored', () => {
    const s = reduce([
      ev({ kind: 'memory.record', id: 'c2', tier: 'chapter', text: 'keep', detail: 'd', keys: [] }),
      ev({ kind: 'memory.edit', id: 'c2', text: '   ', detail: '' }),
    ]);
    const m = s.memories.find((x) => x.id === 'c2')!;
    expect(m.text).toBe('keep'); // blank text ignored
    expect(m.detail).toBeUndefined(); // empty detail cleared
  });

  it('cast.drop cascades to ALL their data (knowledge/secrets/journal/memberships)', () => {
    const s = reduce([
      ev({ kind: 'cast.seen', id: 'ned', name: 'Ned', status: 'present' }),
      ev({ kind: 'cast.seen', id: 'jon', name: 'Jon', status: 'active' }),
      ev({ kind: 'knowledge.learn', who: 'ned', fact: 'winter is coming', about: 'jon' }),
      ev({ kind: 'knowledge.learn', who: 'jon', fact: 'a secret about ned', about: 'ned' }),
      ev({ kind: 'secret.form', id: 's1', keeper: 'ned', from: ['jon'], text: 'true parentage' }),
      ev({ kind: 'secret.form', id: 's2', keeper: 'jon', from: ['ned'], text: 'kept from ned' }),
      ev({ kind: 'journal.entry', id: 'j1', who: 'ned', about: 'jon', memory: 'm', jkind: 'shared', weight: 'significant', sentiment: 'positive' }),
      ev({ kind: 'faction.member', char: 'ned', faction: 'fac:starks', op: 'add' }),
      ev({ kind: 'cast.drop', id: 'ned' }),
    ]);
    expect(s.cast.ned).toBeUndefined();
    expect(s.knowledge.some((k) => k.who === 'ned' || k.about === 'ned')).toBe(false); // held by + about
    expect(s.secrets.some((x) => x.keeper === 'ned' || (x.from ?? []).includes('ned'))).toBe(false); // kept by + kept-from
    expect(s.journal.some((j) => j.who === 'ned' || j.about === 'ned')).toBe(false);
    expect(s.memberships.some((m) => m.char === 'ned')).toBe(false);
    // Jon's own unrelated-to-ned data is unaffected beyond the ned linkage
    expect(s.cast.jon).toBeDefined();
  });

  it('Fix 22: cast.edit changes only allowed fields, protects identity keys', () => {
    const s = reduce([
      ev({ kind: 'cast.seen', id: 'ned', name: 'Ned Stark', status: 'present' }),
      ev({ kind: 'cast.edit', id: 'ned', patch: { id: 'x', source: 'user', firstTurn: 99, role: 'King' } as any, src: 'user' }),
    ]);
    expect(s.cast.ned!.role).toBe('King');
    expect(s.cast.ned!.id).toBe('ned'); // identity untouched
    expect(s.cast.ned!.source).toBe('auto'); // protected
    expect(s.cast.ned!.firstTurn).toBe(1); // protected
  });

  it('auto-registers a cast card for ANY referenced character, not just present ones', () => {
    // a side character who only appears in knowledge/secret/journal — never in a
    // scene.set present list — must still become tracked cast (with their data).
    const s = reduce([
      ev({ kind: 'knowledge.learn', who: 'tyrion', fact: 'knows of the tunnels' }),
      ev({ kind: 'secret.form', id: 'x1', keeper: 'varys', from: ['robert'], text: 'a hidden heir' }),
      ev({ kind: 'journal.entry', id: 'j1', who: 'sansa', about: 'joffrey', memory: 'he humiliated me', jkind: 'wound', weight: 'defining', sentiment: 'negative' }),
    ]);
    expect(s.cast.tyrion).toBeDefined();
    expect(s.cast.varys).toBeDefined();
    expect(s.cast.robert).toBeDefined();
    expect(s.cast.sansa).toBeDefined();
    expect(s.cast.joffrey).toBeDefined();
    expect(s.cast.tyrion!.status).toBe('mentioned');
    expect(s.cast.sansa!.name).toBe('Sansa'); // readable de-canonicalized name
    // their data is attributed to them, not lost
    expect(s.knowledge.find((k) => k.who === 'tyrion')).toBeTruthy();
    expect(s.journal.find((j) => j.who === 'sansa')).toBeTruthy();
  });

  it('a later cast.seen upgrades a mentioned character to present', () => {
    const s = reduce([
      ev({ kind: 'knowledge.learn', who: 'tyrion', fact: 'knows a thing' }),
      ev({ kind: 'cast.seen', id: 'tyrion', name: 'Tyrion Lannister', status: 'present' }),
    ]);
    expect(s.cast.tyrion!.status).toBe('present');
  });

  it('added (user pre-seed) flows added → mentioned → present/active', () => {
    // user pre-seeds a character before they appear
    let s = reduce([ev({ kind: 'cast.seen', id: 'gendry', name: 'Gendry', status: 'added' })]);
    expect(s.cast.gendry!.status).toBe('added');

    // the story references them (a bond) → promoted into the live lifecycle
    s = reduce([ev({ kind: 'bond.delta', a: 'gendry', b: 'arya', aff: 5 })], s, 0);
    expect(s.cast.gendry!.status).toBe('mentioned');

    // they walk on-stage → present
    s = reduce([ev({ kind: 'cast.seen', id: 'gendry', name: 'Gendry', status: 'present' })], s, 0);
    expect(s.cast.gendry!.status).toBe('present');
  });

  it('added is promoted to present directly when the scene introduces them', () => {
    let s = reduce([ev({ kind: 'cast.seen', id: 'hodor', name: 'Hodor', status: 'added' })]);
    s = reduce([
      ev({ kind: 'scene.set', present: ['hodor'] }),
      ev({ kind: 'cast.seen', id: 'hodor', name: 'Hodor', status: 'present' }),
    ], s, 0);
    expect(s.cast.hodor!.status).toBe('present');
  });

  it('knowledge carries reliability/truth/source, defaulting when omitted', () => {
    const s = reduce([
      ev({ kind: 'knowledge.learn', who: 'cersei', fact: 'the heirs are not the king\u2019s', reliability: 'wrong', truth: 'false', source: 'denial' }),
      ev({ kind: 'knowledge.learn', who: 'ned', fact: 'a bare fact' }), // no epistemic fields
    ]);
    const k1 = s.knowledge.find((k) => k.who === 'cersei')!;
    const k2 = s.knowledge.find((k) => k.who === 'ned')!;
    expect(k1.reliability).toBe('wrong');
    expect(k1.truth).toBe('false');
    expect(k1.source).toBe('denial');
    expect(k2.reliability).toBe('knows'); // default
    expect(k2.truth).toBe('unknown'); // default
  });

  it('re-folding the same who|fact firms the epistemic frame in place (no dup)', () => {
    const s = reduce([
      ev({ kind: 'knowledge.learn', who: 'ned', fact: 'the truth', reliability: 'suspects', truth: 'unknown' }),
      ev({ kind: 'knowledge.learn', who: 'ned', fact: 'the truth', reliability: 'knows', truth: 'true', source: 'saw the ledger' }),
    ]);
    expect(s.knowledge).toHaveLength(1);
    expect(s.knowledge[0]!.reliability).toBe('knows');
    expect(s.knowledge[0]!.truth).toBe('true');
    expect(s.knowledge[0]!.source).toBe('saw the ledger');
  });

  it('dedupes knowledge and reveals secrets', () => {
    const s = reduce([
      ev({ kind: 'knowledge.learn', who: 'cersei', fact: 'the children are not the king\u2019s' }),
      ev({ kind: 'knowledge.learn', who: 'cersei', fact: 'the children are not the king\u2019s' }),
      ev({ kind: 'secret.form', id: 's1', keeper: 'cersei', from: ['robert'], text: 'incest' }),
      ev({ kind: 'secret.reveal', id: 's1', to: ['ned'] }),
    ]);
    expect(s.knowledge).toHaveLength(1);
    expect(s.secrets[0]!.revealed).toBe(true);
    expect(s.secrets[0]!.revealedTo).toContain('ned');
  });
});

describe('reduce — incremental folding', () => {
  it('folding new events onto a prior snapshot equals a full reduce', () => {
    const all: VellumEvent[] = [
      ev({ kind: 'bond.delta', a: 'a', b: 'b', aff: 10 }),
      ev({ kind: 'bond.delta', a: 'a', b: 'b', aff: 10 }),
      ev({ kind: 'bond.delta', a: 'a', b: 'b', aff: 10 }),
    ];
    const full = reduce(all);
    const partial = reduce(all.slice(0, 2));
    const incremental = reduce(all, partial, 2); // fold only the 3rd onto the snapshot
    expect(incremental.relations[0]!.affection).toBe(full.relations[0]!.affection);
  });
});

describe('reduce — location containment', () => {
  it('location.set carries + updates parent; empty clears it', () => {
    const s = reduce([
      ev({ kind: 'location.set', id: 'town', name: 'Thornfield' }),
      ev({ kind: 'location.set', id: 'tavern', name: 'The Salt Docks', parent: 'town' }),
    ]);
    expect(s.locations.find((l) => l.id === 'tavern')!.parent).toBe('town');
    const cleared = reduce([ev({ kind: 'location.set', id: 'tavern', name: 'The Salt Docks', parent: '' })], s, 0);
    expect(cleared.locations.find((l) => l.id === 'tavern')!.parent).toBeUndefined();
  });
});

describe('reduce — faction seat + relations', () => {
  it('faction.edit seat persists via patch', () => {
    const s = reduce([
      ev({ kind: 'faction.seen', id: 'fac:stark', name: 'Stark', status: 'active' }),
      ev({ kind: 'faction.edit', id: 'fac:stark', patch: { seat: 'winterfell' } }),
    ]);
    expect(s.factions['fac:stark']!.seat).toBe('winterfell');
  });

  it('factionrel.op upserts a directed edge, clamps, and auto-creates factions', () => {
    const s = reduce([
      ev({ kind: 'factionrel.op', a: 'fac:lannister', b: 'fac:stark', relkind: 'war', standing: -30 }),
    ]);
    expect(s.factions['fac:lannister']).toBeTruthy(); // ensureFaction ran
    const fr = s.factionRelations.find((r) => r.a === 'fac:lannister' && r.b === 'fac:stark')!;
    expect(fr.kind).toBe('war'); expect(fr.standing).toBe(-30);
  });

  it('faction.drop cascades to faction relations', () => {
    const s = reduce([
      ev({ kind: 'factionrel.op', a: 'fac:lannister', b: 'fac:stark', relkind: 'rivalry', standing: 10 }),
      ev({ kind: 'faction.drop', id: 'fac:stark' }),
    ]);
    expect(s.factionRelations).toHaveLength(0);
  });

  it('factionrel.drop removes only the directed edge (both clears reciprocal)', () => {
    const base: VellumEvent[] = [
      ev({ kind: 'factionrel.op', a: 'fac:a', b: 'fac:b', standing: 5 }),
      ev({ kind: 'factionrel.op', a: 'fac:b', b: 'fac:a', standing: 5 }),
    ];
    const one = reduce([...base, ev({ kind: 'factionrel.drop', a: 'fac:a', b: 'fac:b' })]);
    expect(one.factionRelations).toHaveLength(1);
    const both = reduce([...base, ev({ kind: 'factionrel.drop', a: 'fac:a', b: 'fac:b', both: true })]);
    expect(both.factionRelations).toHaveLength(0);
  });
});

describe('reduce — plant subject + abandon', () => {
  it('plant.set carries subject; plant.abandon flips status and drops it from open', () => {
    const s = reduce([
      ev({ kind: 'plant.set', id: 'p1', what: 'a locked drawer', subject: 'cersei' }),
      ev({ kind: 'plant.abandon', id: 'p1' }),
    ]);
    expect(s.plants[0]!.subject).toBe('cersei');
    expect(s.plants[0]!.status).toBe('abandoned');
  });
});

describe('reduce — day.set correction', () => {
  it('absolute day.set walks back a spurious high day (overrides monotonic rule)', () => {
    const s = reduce([
      ev({ kind: 'turn.fold', sig: 'x', day: 9999 }),   // model froze a bad high day
      ev({ kind: 'day.set', day: 12, absolute: true }),
    ]);
    expect(s.day).toBe(12);
  });
  it('non-absolute day.set advances monotonically like a report', () => {
    const s = reduce([
      ev({ kind: 'turn.fold', sig: 'x', day: 20 }),
      ev({ kind: 'day.set', day: 12 }), // lower, non-absolute → ignored (Math.max)
    ]);
    expect(s.day).toBe(20);
  });
});

describe('reduce — scene clock derivation', () => {
  it('derives an ordered clock from the time string when none is supplied', () => {
    const s = reduce([ev({ kind: 'scene.set', time: 'dusk', present: [] } as any)]);
    expect(s.scene.clock).toBe(1140);
  });
  it('trusts an explicit clock over the time string', () => {
    const s = reduce([ev({ kind: 'scene.set', time: 'dusk', clock: 615, present: [] } as any)]);
    expect(s.scene.clock).toBe(615);
  });
  it('keeps the established clock when a later scene time is unparseable', () => {
    const s = reduce([
      ev({ kind: 'scene.set', time: 'morning', present: [] } as any),
      ev({ kind: 'scene.set', time: 'some time later', present: [] } as any),
    ]);
    expect(s.scene.clock).toBe(540); // morning retained
  });
});

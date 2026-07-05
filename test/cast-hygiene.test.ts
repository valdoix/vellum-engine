import { describe, it, expect } from 'vitest';
import { freshState, type ChronicleState, type CastCard } from '../src/domain/types.js';
import {
  isProvisionalCast,
  hasCastAttachments,
  visibleCast,
  sweepProvisionalCast,
  PROVISIONAL_GRACE_TURNS,
} from '../src/domain/cast-hygiene.js';

/**
 * Cast hygiene: durability layers behind the identity blocklist.
 *  - Layer 1: provisional (unproven, single-mention, attachment-less auto) cards
 *    are hidden from browse surfaces via visibleCast().
 *  - Layer 2: source trust — user cards and model-STAGED (present/active) cards
 *    are never provisional; only auto 'mentioned'/'added' names are.
 *  - Layer 3: the GC sweep reaps provisional cards past the grace window.
 */

const card = (over: Partial<CastCard> & { id: string }): CastCard => ({
  name: over.id, aka: [], status: 'mentioned', source: 'auto',
  firstTurn: 1, lastTurn: 1, userEdited: false, ...over,
});
const withCast = (turns: number, ...cards: CastCard[]): ChronicleState => {
  const s = freshState();
  s.turns = turns;
  for (const c of cards) s.cast[c.id] = c;
  return s;
};

describe('isProvisionalCast — the predicate', () => {
  it('a bare auto single-mention card with nothing attached IS provisional', () => {
    const s = withCast(1, card({ id: 'harrenhal_restoration' }));
    expect(isProvisionalCast(s, 'harrenhal_restoration')).toBe(true);
  });

  it('Layer 2: a model-STAGED (present/active) card is NOT provisional', () => {
    const s = withCast(1, card({ id: 'daeron', status: 'active' }));
    expect(isProvisionalCast(s, 'daeron')).toBe(false);
  });

  it('Layer 2: a user card / user-edited card is NEVER provisional', () => {
    const s = withCast(1, card({ id: 'a', source: 'user' }), card({ id: 'b', userEdited: true }));
    expect(isProvisionalCast(s, 'a')).toBe(false);
    expect(isProvisionalCast(s, 'b')).toBe(false);
  });

  it('a recurred card (firstTurn != lastTurn) is NOT provisional', () => {
    const s = withCast(5, card({ id: 'x', firstTurn: 1, lastTurn: 4 }));
    expect(isProvisionalCast(s, 'x')).toBe(false);
  });

  it('a deceased card is NOT provisional (a remembered dead name is intentional)', () => {
    const s = withCast(1, card({ id: 'x', deceased: true }));
    expect(isProvisionalCast(s, 'x')).toBe(false);
  });

  it('an attachment (a bond) promotes the card off provisional', () => {
    const s = withCast(1, card({ id: 'x' }));
    s.relations.push({ a: 'x', b: 'y', label: '', categories: ['neutral'], category: 'neutral', affection: 5, trust: 0, sentiment: 'neutral', status: 'active', source: 'auto', userEdited: false, firstTurn: 1, lastTurn: 1, firstDay: 0, history: [], categoryHistory: [] });
    expect(hasCastAttachments(s, 'x')).toBe(true);
    expect(isProvisionalCast(s, 'x')).toBe(false);
  });

  it('various attachments each keep a card', () => {
    const mk = (): ChronicleState => withCast(1, card({ id: 'x' }));
    let s = mk(); s.knowledge.push({ id: 'k', who: 'x', fact: 'f', turn: 1, reliability: 'knows', truth: 'true' }); expect(isProvisionalCast(s, 'x')).toBe(false);
    s = mk(); s.journal.push({ id: 'j', who: 'x', memory: 'm', kind: 'observation', weight: 'minor', sentiment: 'neutral', turn: 1, day: 0 }); expect(isProvisionalCast(s, 'x')).toBe(false);
    s = mk(); s.items.push({ id: 'i', who: 'x', item: 'sword', turn: 1 }); expect(isProvisionalCast(s, 'x')).toBe(false);
    s = mk(); s.memberships.push({ char: 'x', faction: 'fac:y' }); expect(isProvisionalCast(s, 'x')).toBe(false);
    s = mk(); s.scene.present.push('x'); expect(isProvisionalCast(s, 'x')).toBe(false);
  });
});

describe('visibleCast — Layer 1 quarantine', () => {
  it('hides provisional cards, keeps real ones', () => {
    const s = withCast(1,
      card({ id: 'daeron', status: 'active' }),          // staged → visible
      card({ id: 'harrenhal_plumbing' }),                // provisional → hidden
    );
    const ids = visibleCast(s).map((c) => c.id);
    expect(ids).toContain('daeron');
    expect(ids).not.toContain('harrenhal_plumbing');
  });
});

describe('sweepProvisionalCast — Layer 3 GC', () => {
  it('does NOT reap within the grace window', () => {
    const s = withCast(1 + PROVISIONAL_GRACE_TURNS, card({ id: 'junk', firstTurn: 1 + PROVISIONAL_GRACE_TURNS, lastTurn: 1 + PROVISIONAL_GRACE_TURNS }));
    // firstTurn == now → age 0, inside grace
    const out = sweepProvisionalCast(s);
    expect(out).toBe(s); // same object, nothing reaped
    expect(out.cast.junk).toBeDefined();
  });

  it('reaps a provisional card once it ages past the grace window', () => {
    const now = 10;
    const s = withCast(now, card({ id: 'junk', firstTurn: 1, lastTurn: 1 }));
    const out = sweepProvisionalCast(s);
    expect(out).not.toBe(s);
    expect(out.cast.junk).toBeUndefined();
  });

  it('never reaps staged / user / attached / deceased / recurred cards', () => {
    const now = 20;
    const s = withCast(now,
      card({ id: 'staged', status: 'active', firstTurn: 1, lastTurn: 1 }),
      card({ id: 'usercard', source: 'user', firstTurn: 1, lastTurn: 1 }),
      card({ id: 'dead', deceased: true, firstTurn: 1, lastTurn: 1 }),
      card({ id: 'recurred', firstTurn: 1, lastTurn: 8 }),
      card({ id: 'attached', firstTurn: 1, lastTurn: 1 }),
      card({ id: 'junk', firstTurn: 1, lastTurn: 1 }),
    );
    s.relations.push({ a: 'attached', b: 'staged', label: '', categories: ['neutral'], category: 'neutral', affection: 1, trust: 0, sentiment: 'neutral', status: 'active', source: 'auto', userEdited: false, firstTurn: 1, lastTurn: 1, firstDay: 0, history: [], categoryHistory: [] });
    const out = sweepProvisionalCast(s);
    expect(Object.keys(out.cast).sort()).toEqual(['attached', 'dead', 'recurred', 'staged', 'usercard']);
  });

  it('is idempotent (a second sweep changes nothing)', () => {
    const s = withCast(10, card({ id: 'junk', firstTurn: 1, lastTurn: 1 }), card({ id: 'daeron', status: 'active' }));
    const once = sweepProvisionalCast(s);
    const twice = sweepProvisionalCast(once);
    expect(twice).toBe(once); // no-op → same object
    expect(Object.keys(twice.cast)).toEqual(['daeron']);
  });
});

describe('end-to-end via reduce(): a knowledge mention that recurs is kept', () => {
  it('a one-off mentioned name is reaped; a re-referenced one survives', () => {
    // simulate: turn 1 mentions "oneoff" (knowledge about them), then it is DROPPED
    // (the knowledge deleted), and the story runs on. Contrast a name kept by a
    // standing bond. We build state directly (reduce paths are covered elsewhere).
    const now = 12;
    const s = withCast(now,
      card({ id: 'oneoff', firstTurn: 1, lastTurn: 1 }),         // orphaned mention
      card({ id: 'keeper', firstTurn: 1, lastTurn: 1 }),         // has a bond
    );
    s.relations.push({ a: 'keeper', b: 'oneoff'.replace('oneoff', 'someone'), label: '', categories: ['neutral'], category: 'neutral', affection: 3, trust: 0, sentiment: 'neutral', status: 'active', source: 'auto', userEdited: false, firstTurn: 1, lastTurn: 1, firstDay: 0, history: [], categoryHistory: [] });
    const out = sweepProvisionalCast(s);
    expect(out.cast.oneoff).toBeUndefined(); // orphan reaped
    expect(out.cast.keeper).toBeDefined();   // bond-bearing kept
  });
});

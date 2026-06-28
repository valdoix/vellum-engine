import { describe, it, expect } from 'vitest';
import { reduce } from '../src/core/reduce.js';
import { coreFeature } from '../src/domain/core-feature.js';
import { resolveFactionId, mergeFactionDuplicates, mergeDuplicates } from '../src/domain/identity.js';
import { cmdEvents, CMD_TYPES } from '../src/domain/commands.js';
import { freshState, type ChronicleState, type CastCard, type Faction } from '../src/domain/types.js';
import type { VellumEvent } from '../src/core/events.js';

let seq = 0;
const ev = (e: any): VellumEvent => ({ seq: ++seq, turn: 1, day: 1, src: 'model', ...e } as VellumEvent);

describe('reduce — faction lifecycle', () => {
  it('creates a faction, members are edges, standing accumulates', () => {
    const s = reduce([
      ev({ kind: 'faction.seen', id: 'fac:household', name: 'The Household', status: 'active' }),
      ev({ kind: 'faction.member', char: 'martha', faction: 'fac:household', op: 'add', role: 'maid' }),
      ev({ kind: 'faction.member', char: 'bessa', faction: 'fac:household', op: 'add' }),
      ev({ kind: 'faction.standing', faction: 'fac:household', standing: -20, trust: -10 }),
      ev({ kind: 'faction.standing', faction: 'fac:household', standing: -5 }),
    ]);
    expect(s.factions['fac:household']!.standing).toBe(-25);
    expect(s.factions['fac:household']!.trust).toBe(-10);
    expect(s.memberships.filter((m) => m.faction === 'fac:household').length).toBe(2);
    expect(s.cast.martha).toBeDefined(); // member auto-registered as cast
    expect(s.memberships.find((m) => m.char === 'martha')!.role).toBe('maid');
  });

  it('a character can belong to multiple factions', () => {
    const s = reduce([
      ev({ kind: 'faction.member', char: 'cersei', faction: 'fac:lannisters' }),
      ev({ kind: 'faction.member', char: 'cersei', faction: 'fac:crown' }),
    ]);
    expect(s.memberships.filter((m) => m.char === 'cersei').length).toBe(2);
  });

  it('faction.drop removes the faction and its memberships', () => {
    const s = reduce([
      ev({ kind: 'faction.member', char: 'a', faction: 'fac:x' }),
      ev({ kind: 'faction.drop', id: 'fac:x' }),
    ]);
    expect(s.factions['fac:x']).toBeUndefined();
    expect(s.memberships.length).toBe(0);
  });

  it('dropping a cast member removes their memberships', () => {
    const s = reduce([
      ev({ kind: 'faction.member', char: 'martha', faction: 'fac:household' }),
      ev({ kind: 'cast.drop', id: 'martha' }),
    ]);
    expect(s.memberships.find((m) => m.char === 'martha')).toBeUndefined();
  });

  it('absolute standing sets the value; delta accumulates', () => {
    const s = reduce([
      ev({ kind: 'faction.standing', faction: 'fac:x', standing: 30 }),
      ev({ kind: 'faction.standing', faction: 'fac:x', standing: 50, absolute: true }),
    ]);
    expect(s.factions['fac:x']!.standing).toBe(50);
  });
});

describe('identity — faction id space NEVER crosses cast', () => {
  const card = (id: string, name: string): CastCard => ({ id, name, aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false });
  const fac = (id: string, name: string): Faction => ({ id, name, aka: [], status: 'active', standing: 0, trust: 0, source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false });

  it('resolveFactionId emits fac: ids and merges variants', () => {
    const s = freshState();
    s.factions['fac:targaryens'] = fac('fac:targaryens', 'The Targaryens');
    expect(resolveFactionId(s, 'Targaryens')).toBe('fac:targaryens');
    expect(resolveFactionId(s, 'House of New Lords')).toBe('fac:house_of_new_lords'); // fresh
    expect(resolveFactionId(s, 'she')).toBe(''); // non-name rejected
  });

  it('a cast "Daeron Targaryen" and faction "The Targaryens" stay distinct', () => {
    const s = freshState();
    s.cast.daeron_targaryen = card('daeron_targaryen', 'Daeron Targaryen');
    s.factions['fac:targaryens'] = fac('fac:targaryens', 'The Targaryens');
    const m = mergeDuplicates(s);
    expect(m.cast.daeron_targaryen).toBeDefined();
    expect(m.factions['fac:targaryens']).toBeDefined();
    expect(Object.keys(m.cast)).not.toContain('fac:targaryens');
  });

  it('mergeFactionDuplicates folds a split faction (targaryens ⊂ targaryen_house)', () => {
    const s = freshState();
    s.factions['fac:targaryens'] = fac('fac:targaryens', 'Targaryens');
    s.factions['fac:targaryens_house'] = fac('fac:targaryens_house', 'Targaryens House');
    s.memberships = [{ char: 'daeron', faction: 'fac:targaryens' }];
    const m = mergeFactionDuplicates(s);
    expect(Object.keys(m.factions)).toEqual(['fac:targaryens_house']);
    expect(m.memberships[0]!.faction).toBe('fac:targaryens_house');
  });
});

describe('extraction — factions from the block + tone seed', () => {
  it('folds delta.factions into faction + members + (disposition-seeded) standing', () => {
    let n = 0;
    const parsed = { present: [], delta: { factions: [{ name: 'The Household', kind: 'household', members: ['Martha', 'Bessa'], standing: -5 }] } };
    const s = reduce(coreFeature.extract!(parsed as any, { turn: 1, day: 1, state: freshState(), seq: () => ++n, tone: { romance: 'medium', disposition: 'brutal' } } as any));
    const fid = Object.keys(s.factions).find((k) => k.includes('household'))!;
    expect(s.memberships.filter((m) => m.faction === fid).length).toBe(2);
    expect(s.factions[fid]!.standing).toBe(-30); // brutal seed -25 + explicit -5
  });
});

describe('commands — faction intents', () => {
  const ctx = { turn: 1, day: 1, seq: () => ++seq };
  it('exposes the faction command types', () => {
    for (const t of ['faction_upsert', 'faction_delete', 'faction_member', 'faction_standing_set']) expect(CMD_TYPES.has(t)).toBe(true);
  });
  it('faction_upsert mints a fac: id + standing', () => {
    const evs = cmdEvents('faction_upsert', { name: 'The Household', kind: 'household', standing: -15 }, freshState(), ctx as any);
    const seen = evs.find((e: any) => e.kind === 'faction.seen') as any;
    const st = evs.find((e: any) => e.kind === 'faction.standing') as any;
    expect(seen.id).toBe('fac:the_household');
    expect(st.standing).toBe(-15);
  });
});

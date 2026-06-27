import { describe, it, expect } from 'vitest';
import { DEFAULT_CATEGORIES, settingsToEntryFields, resolveCategory, customCategory, POSITION_CODE } from '../src/domain/vault.js';
import { recursionSeeds, type VaultEntryLite } from '../src/domain/vault-intel.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';

describe('vault categories + settings mapping', () => {
  it('ships sensible built-in categories', () => {
    const ids = DEFAULT_CATEGORIES.map((c) => c.id);
    expect(ids).toContain('characters');
    expect(ids).toContain('locations');
    expect(ids).toContain('factions');
    expect(ids).toContain('systems');
    expect(DEFAULT_CATEGORIES.every((c) => c.builtin && c.color && c.glyph)).toBe(true);
  });

  it('encodes the position/depth wisdom: framing before-main low order, urgent shallow high order', () => {
    const loc = DEFAULT_CATEGORIES.find((c) => c.id === 'locations')!;
    const ev = DEFAULT_CATEGORIES.find((c) => c.id === 'events')!;
    expect(loc.defaults.position).toBe('before_main');
    expect(loc.defaults.order).toBeLessThan(ev.defaults.order);
    expect(ev.defaults.position).toBe('at_depth');
    expect(ev.defaults.depth).toBeLessThanOrEqual(1);
  });

  it('maps friendly settings to host entry fields', () => {
    const f = settingsToEntryFields({ position: 'at_depth', depth: 2, role: 'system', order: 120, sticky: 4 });
    expect(f.position).toBe(POSITION_CODE.at_depth);
    expect(f.depth).toBe(2);
    expect(f.order_value).toBe(120);
    expect(f.sticky).toBe(4);
  });

  it('omits depth when position is not at_depth', () => {
    const f = settingsToEntryFields({ position: 'before_main', role: 'system', order: 50, depth: 9 });
    expect(f.depth).toBeUndefined();
    expect(f.position).toBe(POSITION_CODE.before_main);
  });

  it('systems category is constant (rules should be stable)', () => {
    const sys = DEFAULT_CATEGORIES.find((c) => c.id === 'systems')!;
    expect(settingsToEntryFields(sys.defaults).constant).toBe(true);
  });

  it('custom category is non-builtin and resolvable', () => {
    const c = customCategory('custom_1', 'Vehicles', '\u2708', '#abc');
    expect(c.builtin).toBe(false);
    expect(resolveCategory([...DEFAULT_CATEGORIES, c], 'custom_1').label).toBe('Vehicles');
    expect(resolveCategory(DEFAULT_CATEGORIES, 'nonexistent').id).toBe('characters'); // falls back
  });
});

describe('Fix 7 — recursionSeeds', () => {
  function st(): ChronicleState {
    const s = freshState();
    const mk = (id: string, name: string) => { s.cast[id] = { id, name, aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 5, userEdited: false }; };
    mk('cersei', 'Cersei'); mk('jaime', 'Jaime');
    s.relations.push({ a: 'cersei', b: 'jaime', label: '', categories: ['familial'], category: 'familial', affection: 80, trust: 60, sentiment: 'warm', status: 'active', source: 'auto', userEdited: false, firstTurn: 1, lastTurn: 5, firstDay: 1, history: [], categoryHistory: [] });
    return s;
  }
  const entry = (id: string, link: string, content: string): VaultEntryLite => ({ id, key: [], content, link, category: 'characters', disabled: false });

  it('weaves each bonded partner name into the other entry', () => {
    const seeds = recursionSeeds(st(), [entry('e1', 'cast:cersei', 'Cersei is queen.'), entry('e2', 'cast:jaime', 'Jaime is a knight.')]);
    expect(seeds.get('e1')).toContain('Jaime');
    expect(seeds.get('e2')).toContain('Cersei');
  });

  it('no seed when the name is already present in content', () => {
    const seeds = recursionSeeds(st(), [entry('e1', 'cast:cersei', 'Cersei loves Jaime.'), entry('e2', 'cast:jaime', 'Jaime loves Cersei.')]);
    expect(seeds.size).toBe(0);
  });
});

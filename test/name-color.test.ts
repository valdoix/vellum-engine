import { describe, it, expect } from 'vitest';
import { reduce } from '../src/core/reduce.js';
import { cmdEvents } from '../src/domain/commands.js';
import { nameHtml, lowContrast } from '../src/ui/format.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';

function withCast(): ChronicleState {
  const s = freshState();
  s.cast = { cersei: { id: 'cersei', name: 'Cersei', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false } } as any;
  return s;
}

describe('name color — command validation', () => {
  const ctx = { turn: 2, day: 1 } as any;

  it('accepts a valid #hex color + gradient end', () => {
    const evs = cmdEvents('cast_upsert', { id: 'cersei', name: 'Cersei', color: '#ff0000', colorTo: '#00ff00' }, withCast(), ctx) as any[];
    const edit = evs.find((e) => e.kind === 'cast.edit');
    expect(edit.patch.color).toBe('#ff0000');
    expect(edit.patch.colorTo).toBe('#00ff00');
  });

  it('drops an invalid color (never stores junk)', () => {
    const evs = cmdEvents('cast_upsert', { id: 'cersei', name: 'Cersei', color: 'red' }, withCast(), ctx) as any[];
    const edit = evs.find((e) => e.kind === 'cast.edit');
    expect('color' in edit.patch).toBe(false);
  });

  it('empty color string passes through as a clear', () => {
    const evs = cmdEvents('cast_upsert', { id: 'cersei', name: 'Cersei', color: '' }, withCast(), ctx) as any[];
    const edit = evs.find((e) => e.kind === 'cast.edit');
    expect(edit.patch.color).toBe('');
  });
});

describe('name color — reduce carry + clear', () => {
  it('applies color, and an empty clear removes it', () => {
    const s = withCast();
    let st = reduce([{ seq: 1, turn: 2, day: 1, src: 'user', kind: 'cast.edit', id: 'cersei', patch: { color: '#abcdef' } } as any], s);
    expect(st.cast.cersei!.color).toBe('#abcdef');
    st = reduce([{ seq: 2, turn: 3, day: 1, src: 'user', kind: 'cast.edit', id: 'cersei', patch: { color: '' } } as any], st);
    expect(st.cast.cersei!.color).toBeUndefined();
  });
});

describe('nameHtml', () => {
  it('plain when no color (today\u2019s output)', () => {
    expect(nameHtml(withCast(), 'cersei')).toBe('Cersei');
  });
  it('solid color wraps in a colored span', () => {
    const s = withCast(); s.cast.cersei!.color = '#cda84e';
    expect(nameHtml(s, 'cersei')).toContain('color:#cda84e');
  });
  it('gradient uses the clip-text vars', () => {
    const s = withCast(); s.cast.cersei!.color = '#ff0000'; s.cast.cersei!.colorTo = '#0000ff';
    const h = nameHtml(s, 'cersei');
    expect(h).toContain('vle-name--grad');
    expect(h).toContain('--c1:#ff0000');
    expect(h).toContain('--c2:#0000ff');
  });
  it('escapes the name', () => {
    const s = withCast(); s.cast.cersei!.name = '<b>x</b>'; s.cast.cersei!.color = '#cda84e';
    expect(nameHtml(s, 'cersei')).toContain('&lt;b&gt;');
  });
  it('a very dark solid color gets the legibility lift', () => {
    const s = withCast(); s.cast.cersei!.color = '#010101';
    expect(nameHtml(s, 'cersei')).toContain('vle-name--lift');
    expect(lowContrast('#010101')).toBe(true);
    expect(lowContrast('#ffffff')).toBe(false);
  });
});

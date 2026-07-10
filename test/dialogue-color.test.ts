import { describe, it, expect } from 'vitest';
import { buildColorReplaceString, castColorHash, colorScripts } from '../src/domain/dialogue-color.js';
import { castSlotColors } from '../src/core/palette.js';
import { cmdEvents } from '../src/domain/commands.js';
import { reduce } from '../src/core/reduce.js';
import { freshState, type ChronicleState, type CastCard } from '../src/domain/types.js';

function makeCast(cards: Partial<CastCard>[]): ChronicleState {
  const s = freshState();
  for (const c of cards) {
    const id = c.id ?? 'x';
    s.cast[id] = {
      id, name: c.name ?? id, aka: c.aka ?? [], status: c.status ?? 'active',
      source: 'user', firstTurn: 1, lastTurn: 1, userEdited: true,
      ...(c.dialogueColor ? { dialogueColor: c.dialogueColor } : {}),
      ...(c.color ? { color: c.color } : {}),
    } as CastCard;
  }
  return s;
}

describe('palette', () => {
  it('assigns collision-free colors per id', () => {
    const colors = castSlotColors(['cersei', 'jaime', 'tyrion']);
    expect(colors.size).toBe(3);
    // all valid 6-digit hex
    for (const c of colors.values()) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    // distinct
    expect(new Set(colors.values()).size).toBe(3);
  });

  it('is stable regardless of input order', () => {
    const a = castSlotColors(['a', 'b', 'c']);
    const b = castSlotColors(['c', 'a', 'b']);
    expect(a.get('a')).toBe(b.get('a'));
    expect(a.get('b')).toBe(b.get('b'));
  });
});

describe('buildColorReplaceString', () => {
  it('uses explicit dialogueColor when set', () => {
    const s = makeCast([{ id: 'cersei', name: 'Cersei', dialogueColor: '#ff0000' }]);
    const out = buildColorReplaceString(s);
    expect(out).toContain('Cersei::#ff0000');
    expect(out).toContain('{{switch::$1::');
    expect(out).toContain('#b9ad92'); // default ink fallback
  });

  it('falls back to slot color when dialogueColor unset', () => {
    const s = makeCast([{ id: 'jaime', name: 'Jaime' }]);
    const slot = castSlotColors(['jaime']).get('jaime')!;
    const out = buildColorReplaceString(s);
    expect(out).toContain(`Jaime::${slot}`);
  });

  it('includes akas mapped to the same color', () => {
    const s = makeCast([{ id: 'cersei', name: 'Cersei', aka: ['The Queen'], dialogueColor: '#abcdef' }]);
    const out = buildColorReplaceString(s);
    expect(out).toContain('Cersei::#abcdef');
    expect(out).toContain('The Queen::#abcdef');
  });

  it('wraps output in a colored span with title', () => {
    const s = makeCast([{ id: 'a', name: 'A' }]);
    const out = buildColorReplaceString(s);
    expect(out).toMatch(/^<span style="color:.*" title="\$1">\$2<\/span>$/);
  });
});

describe('castColorHash', () => {
  it('is stable across reorder', () => {
    const a = makeCast([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    const b = makeCast([{ id: 'b', name: 'B' }, { id: 'a', name: 'A' }]);
    expect(castColorHash(a)).toBe(castColorHash(b));
  });

  it('changes when a color changes', () => {
    const a = makeCast([{ id: 'a', name: 'A' }]);
    const b = makeCast([{ id: 'a', name: 'A', dialogueColor: '#123456' }]);
    expect(castColorHash(a)).not.toBe(castColorHash(b));
  });
});

describe('colorScripts', () => {
  it('produces display + strip scripts scoped to the chat', () => {
    const s = makeCast([{ id: 'a', name: 'A' }]);
    const scripts = colorScripts('chat123', s);
    expect(scripts).toHaveLength(2);
    const display = scripts.find((x) => x.target === 'display')!;
    const strip = scripts.find((x) => x.target === 'prompt')!;
    expect(display.script_id).toBe('vellum-engine-spk-display-chat123');
    expect(display.scope).toBe('chat');
    expect(display.scope_id).toBe('chat123');
    expect(display.metadata?.castHash).toBe(castColorHash(s));
    expect(strip.script_id).toBe('vellum-engine-spk-strip-chat123');
    expect(strip.replace_string).toBe('');
  });
});

describe('cast_upsert dialogueColor', () => {
  const ctx = { turn: 1, day: 1 };

  it('emits a cast.edit patch with dialogueColor', () => {
    const s = freshState();
    const evs = cmdEvents('cast_upsert', { entry: { name: 'Cersei', dialogueColor: '#ff0000' } }, s, ctx);
    const edit = evs.find((e) => e.kind === 'cast.edit') as any;
    expect(edit).toBeTruthy();
    expect(edit.patch.dialogueColor).toBe('#ff0000');
  });

  it('drops invalid hex (no junk stored)', () => {
    const s = freshState();
    const evs = cmdEvents('cast_upsert', { entry: { name: 'Cersei', dialogueColor: 'notahex' } }, s, ctx);
    const edit = evs.find((e) => e.kind === 'cast.edit') as any;
    expect(edit.patch.dialogueColor).toBeUndefined();
  });

  it('clears dialogueColor in reduce when set to empty', () => {
    let s = freshState();
    // first set a color
    let evs = cmdEvents('cast_upsert', { entry: { name: 'Cersei', dialogueColor: '#ff0000' } }, s, ctx);
    s = reduce(evs, s);
    const id = Object.keys(s.cast)[0]!;
    expect(s.cast[id]!.dialogueColor).toBe('#ff0000');
    // then clear it
    evs = cmdEvents('cast_upsert', { entry: { id, name: 'Cersei', dialogueColor: '' } }, s, ctx);
    s = reduce(evs, s);
    expect(s.cast[id]!.dialogueColor).toBeUndefined();
  });
});

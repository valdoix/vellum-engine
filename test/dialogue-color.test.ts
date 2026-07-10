import { describe, it, expect } from 'vitest';
import { castSlotColors } from '../src/core/palette.js';
import { buildSpeakerColorMap, colorizeText, hasSpkTags, hashContent } from '../src/ui/spk-color.js';
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
    for (const c of colors.values()) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(colors.values()).size).toBe(3);
  });

  it('is stable regardless of input order', () => {
    const a = castSlotColors(['a', 'b', 'c']);
    const b = castSlotColors(['c', 'a', 'b']);
    expect(a.get('a')).toBe(b.get('a'));
    expect(a.get('b')).toBe(b.get('b'));
  });
});

describe('buildSpeakerColorMap', () => {
  it('uses explicit dialogueColor when set (keyed lowercase)', () => {
    const s = makeCast([{ id: 'cersei', name: 'Cersei', dialogueColor: '#ff0000' }]);
    const map = buildSpeakerColorMap(s);
    expect(map.get('cersei')).toBe('#ff0000');
  });

  it('falls back to slot color when dialogueColor unset', () => {
    const s = makeCast([{ id: 'jaime', name: 'Jaime' }]);
    const slot = castSlotColors(['jaime']).get('jaime')!;
    const map = buildSpeakerColorMap(s);
    expect(map.get('jaime')).toBe(slot);
  });

  it('maps akas to the same color as the canonical name', () => {
    const s = makeCast([{ id: 'cersei', name: 'Cersei', aka: ['The Queen'], dialogueColor: '#abcdef' }]);
    const map = buildSpeakerColorMap(s);
    expect(map.get('cersei')).toBe('#abcdef');
    expect(map.get('the queen')).toBe('#abcdef');
  });

  it('returns an empty map for empty/nullish state', () => {
    expect(buildSpeakerColorMap(null).size).toBe(0);
    expect(buildSpeakerColorMap(freshState()).size).toBe(0);
  });
});

describe('colorizeText', () => {
  it('wraps a known speaker in a colored span (case-insensitive match)', () => {
    const map = new Map([['cersei', '#ff0000']]);
    const out = colorizeText('[spk=Cersei]"Power is power."[/spk]', map);
    expect(out).toBe('<span class="vle-spk" style="color:#ff0000" title="Cersei">"Power is power."</span>');
  });

  it('strips tags but keeps the line for an unknown speaker (never shows raw tag)', () => {
    const map = new Map([['cersei', '#ff0000']]);
    const out = colorizeText('[spk=Stranger]"Who am I?"[/spk]', map);
    expect(out).toBe('"Who am I?"');
    expect(out).not.toContain('[spk=');
  });

  it('handles multiple speakers in one message', () => {
    const map = new Map([['a', '#111111'], ['b', '#222222']]);
    const out = colorizeText('[spk=A]"Hi."[/spk] narration [spk=B]"Bye."[/spk]', map);
    expect(out).toContain('style="color:#111111"');
    expect(out).toContain('style="color:#222222"');
    expect(out).toContain(' narration ');
  });

  it('leaves text without tags untouched', () => {
    const map = new Map([['a', '#111111']]);
    expect(colorizeText('plain narration, no tags', map)).toBe('plain narration, no tags');
  });
});

describe('hasSpkTags', () => {
  it('detects presence/absence of speaker tags', () => {
    expect(hasSpkTags('[spk=A]"x"[/spk]')).toBe(true);
    expect(hasSpkTags('no tags here')).toBe(false);
  });
});

describe('hashContent', () => {
  it('is stable for identical input and differs on change', () => {
    expect(hashContent('abc')).toBe(hashContent('abc'));
    expect(hashContent('abc')).not.toBe(hashContent('abd'));
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
    let evs = cmdEvents('cast_upsert', { entry: { name: 'Cersei', dialogueColor: '#ff0000' } }, s, ctx);
    s = reduce(evs, s);
    const id = Object.keys(s.cast)[0]!;
    expect(s.cast[id]!.dialogueColor).toBe('#ff0000');
    evs = cmdEvents('cast_upsert', { entry: { id, name: 'Cersei', dialogueColor: '' } }, s, ctx);
    s = reduce(evs, s);
    expect(s.cast[id]!.dialogueColor).toBeUndefined();
  });
});

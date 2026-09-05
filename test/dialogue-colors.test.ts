import { describe, it, expect } from 'vitest';
import { autoHue } from '../src/core/palette.js';
import {
  collapseGradient,
  resolveDialogueColor,
  buildSpeakerColors,
  SPEAKER_SPAN_REPLACEMENT,
  speakerColorCss,
  speakerSig,
} from '../src/domain/dialogue-colors.js';

describe('collapseGradient', () => {
  it('blends two hexes at the midpoint', () => {
    expect(collapseGradient('#000000', '#ffffff')).toBe('#808080');
  });

  it('mixes channels independently', () => {
    expect(collapseGradient('#ff0000', '#0000ff')).toBe('#800080');
  });

  it('falls back to the valid side when one is malformed', () => {
    expect(collapseGradient('#12345', '#00ff00')).toBe('#00ff00');
    expect(collapseGradient('#00ff00', 'nope')).toBe('#00ff00');
  });
});

describe('resolveDialogueColor', () => {
  it('prefers a dedicated dialogueColor over everything', () => {
    expect(resolveDialogueColor({ id: 'a', name: 'A', dialogueColor: '#123456', color: '#abcdef', colorTo: '#fedcba' }))
      .toBe('#123456');
  });

  it('uses a solid name color as-is when no dialogueColor', () => {
    expect(resolveDialogueColor({ id: 'a', name: 'A', color: '#abcdef' })).toBe('#abcdef');
  });

  it('collapses a gradient name (color + colorTo) to one color', () => {
    // #000000 + #ffffff midpoint = #808080
    expect(resolveDialogueColor({ id: 'a', name: 'A', color: '#000000', colorTo: '#ffffff' })).toBe('#808080');
  });

  it('falls back to the deterministic slot hue when no colors set', () => {
    expect(resolveDialogueColor({ id: 'char:elara', name: 'Elara' })).toBe(autoHue('char:elara'));
  });

  it('ignores an invalid dialogueColor and falls through', () => {
    expect(resolveDialogueColor({ id: 'a', name: 'A', dialogueColor: 'red', color: '#abcdef' })).toBe('#abcdef');
  });
});

describe('buildSpeakerColors', () => {
  it('returns [] for undefined cast', () => {
    expect(buildSpeakerColors(undefined)).toEqual([]);
  });

  it('skips nameless entries and includes aliases', () => {
    const out = buildSpeakerColors({
      a: { id: 'a', name: 'Elara', aka: ['El', ''], color: '#112233' },
      b: { id: 'b', name: '' as unknown as string },
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe('Elara');
    expect(out[0]!.aka).toEqual(['El']); // blanks filtered
    expect(out[0]!.color).toBe('#112233');
  });
});

describe('speakerColorCss', () => {
  it('shares the inline authored-color marker required by current Lumiverse', () => {
    expect(SPEAKER_SPAN_REPLACEMENT).toBe(
      '<span class="v-spk" data-spk="$1" style="color:var(--vle-spk-color,inherit)">$2</span>',
    );
  });

  it('always emits variable and legacy-renderer fallback rules first', () => {
    const css = speakerColorCss([]);
    expect(css.split('\n')[0]).toBe('.v-spk{--vle-spk-color:var(--vle-spk-default,inherit);color:var(--vle-spk-color)!important}');
    expect(css.split('\n')[1]).toBe('.v-spk *{color:inherit!important}');
  });

  it('emits a case-insensitive rule per name and alias', () => {
    const css = speakerColorCss([{ name: 'Elara', aka: ['El'], color: '#e0736b' }]);
    expect(css).toContain('.v-spk[data-spk="Elara"]{--vle-spk-color:#e0736b}');
    expect(css).toContain('.v-spk[data-spk="El"]{--vle-spk-color:#e0736b}');
    expect(css).toContain('.v-spk[data-spk="Elara" i]{--vle-spk-color:#e0736b}');
    expect(css).toContain('.v-spk[data-spk="El" i]{--vle-spk-color:#e0736b}');
  });

  it('keeps an exact lower-case alias rule when it differs only by case', () => {
    const css = speakerColorCss([{ name: 'Firstname', aka: ['firstname'], color: '#e0736b' }]);
    expect(css).toContain('.v-spk[data-spk="Firstname"]{--vle-spk-color:#e0736b}');
    expect(css).toContain('.v-spk[data-spk="firstname"]{--vle-spk-color:#e0736b}');
    expect(css.match(/data-spk="Firstname" i/g)).toHaveLength(1);
  });

  it('colors unambiguous short forms of formal cast names', () => {
    const css = speakerColorCss([{ name: 'Lady Mara Vey', aka: [], color: '#c0ffee' }]);
    expect(css).toContain('.v-spk[data-spk="Mara Vey"]{--vle-spk-color:#c0ffee}');
    expect(css).toContain('.v-spk[data-spk="Mara Vey" i]{--vle-spk-color:#c0ffee}');
    expect(css).toContain('.v-spk[data-spk="Mara" i]{--vle-spk-color:#c0ffee}');
    expect(css).toContain('.v-spk[data-spk="Vey" i]{--vle-spk-color:#c0ffee}');
  });

  it('does not assign an ambiguous short name or surname to either speaker', () => {
    const css = speakerColorCss([
      { name: 'Jon Snow', aka: [], color: '#111111' },
      { name: 'Jon Rivers', aka: [], color: '#222222' },
      { name: 'Arya Snow', aka: [], color: '#333333' },
    ]);
    expect(css).not.toMatch(/data-spk="Jon"/);
    expect(css).not.toMatch(/data-spk="Snow"/);
    expect(css).toContain('.v-spk[data-spk="Rivers" i]{--vle-spk-color:#222222}');
    expect(css).toContain('.v-spk[data-spk="Arya" i]{--vle-spk-color:#333333}');
  });

  it('escapes quotes and backslashes in names', () => {
    const css = speakerColorCss([{ name: 'He said "hi"', aka: [], color: '#fff' }]);
    expect(css).toContain('.v-spk[data-spk="He said \\"hi\\""]{--vle-spk-color:#fff}');
    expect(css).toContain('.v-spk[data-spk="He said \\"hi\\"" i]{--vle-spk-color:#fff}');
  });

  it('dedupes folded selectors while retaining distinct exact spellings', () => {
    const css = speakerColorCss([
      { name: 'Elara', aka: ['elara'], color: '#e0736b' },
    ]);
    const matches = css.split('\n').filter((l) => l.includes('data-spk='));
    expect(matches).toHaveLength(3); // exact Elara + exact elara + one case-insensitive fallback
    expect(new Set(matches).size).toBe(matches.length);
  });
});

describe('speakerSig', () => {
  it('is order-independent', () => {
    const a = [{ name: 'A', aka: [], color: '#111' }, { name: 'B', aka: [], color: '#222' }];
    const b = [{ name: 'B', aka: [], color: '#222' }, { name: 'A', aka: [], color: '#111' }];
    expect(speakerSig(a)).toBe(speakerSig(b));
  });

  it('changes when a color changes', () => {
    const a = [{ name: 'A', aka: [], color: '#111' }];
    const b = [{ name: 'A', aka: [], color: '#999' }];
    expect(speakerSig(a)).not.toBe(speakerSig(b));
  });
});

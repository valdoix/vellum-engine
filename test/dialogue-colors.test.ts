import { describe, it, expect } from 'vitest';
import { autoHue } from '../src/core/palette.js';
import {
  collapseGradient,
  resolveDialogueColor,
  buildSpeakerColors,
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
  it('always emits the .v-spk fallback rule first', () => {
    const css = speakerColorCss([]);
    expect(css.split('\n')[0]).toBe('.v-spk{color:var(--vle-spk-default,inherit)}');
  });

  it('emits a case-insensitive rule per name and alias', () => {
    const css = speakerColorCss([{ name: 'Elara', aka: ['El'], color: '#e0736b' }]);
    expect(css).toContain('.v-spk[data-spk="Elara" i]{color:#e0736b}');
    expect(css).toContain('.v-spk[data-spk="El" i]{color:#e0736b}');
  });

  it('escapes quotes and backslashes in names', () => {
    const css = speakerColorCss([{ name: 'He said "hi"', aka: [], color: '#fff' }]);
    expect(css).toContain('.v-spk[data-spk="He said \\"hi\\"" i]{color:#fff}');
  });

  it('dedupes identical name+color rules', () => {
    const css = speakerColorCss([
      { name: 'Elara', aka: ['elara'], color: '#e0736b' }, // "elara" dupes "Elara" case-insensitively at same color
    ]);
    const matches = css.split('\n').filter((l) => l.includes('data-spk='));
    expect(matches).toHaveLength(1);
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

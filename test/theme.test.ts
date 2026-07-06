import { describe, it, expect } from 'vitest';
import { MODES, SKINS, setMode, getTheme, patchTheme, customizePanel } from '../src/ui/theme.js';
import { renderBondRadar } from '../src/ui/theme-render.js';
import { freshState } from '../src/domain/types.js';

/**
 * Theme-system guards (Phase 1). These run in node (no DOM); theme.ts's
 * localStorage access is try/catch-guarded so import + the pure setters work.
 */

// every key a Mode patch or Skin theme may legally set
const THEME_KEYS = new Set([
  'skin', 'accent', 'accent2', 'accentIntensity', 'serif', 'mono', 'scale', 'dataScale',
  'density', 'opacity', 'blur', 'radius', 'border', 'inkEmphasis', 'texture', 'motion',
  'launcher', 'chrome', 'tensionStyle', 'surf1', 'surf2', 'ink', 'ink2', 'glass', 'bg', 'surf1c', 'surf2c',
  'pos', 'posInk', 'neg', 'negInk', 'info', 'warn', 'press', 'pressInk',
]);

describe('theme system', () => {
  it('every MODES patch sets only known Theme keys', () => {
    for (const m of MODES) {
      for (const k of Object.keys(m.patch)) expect(THEME_KEYS.has(k), `${m.id}.patch.${k}`).toBe(true);
    }
  });

  it('MODES are exactly the six chromes', () => {
    expect(MODES.map((m) => m.id).sort()).toEqual(['bloom', 'default', 'ember', 'futuristic', 'illuminated', 'modern']);
  });

  it("each mode's dark + light skins exist", () => {
    for (const m of MODES) {
      expect(SKINS.some((s) => s.id === m.skinDark), `${m.id} dark ${m.skinDark}`).toBe(true);
      expect(SKINS.some((s) => s.id === m.skinLight), `${m.id} light ${m.skinLight}`).toBe(true);
    }
  });

  it('setMode applies the chrome and its recommended skin palette', () => {
    setMode('futuristic');
    const t = getTheme();
    expect(t.chrome).toBe('futuristic');
    expect(t.skin).toBe('noir'); // futuristic recommends noir
    // mode patch wins over the skin for accent
    expect(t.accent.toLowerCase()).toBe('#28e0d8');
  });

  it('sanitize clamps an out-of-range chrome back to default', () => {
    // @ts-expect-error — deliberately feed a bad value past the type
    patchTheme({ chrome: 'bogus' });
    expect(getTheme().chrome).toBe('default');
  });

  it('every skin defines the press (amber) semantic', () => {
    for (const s of SKINS) {
      expect(typeof s.theme.press, s.id).toBe('string');
      expect(typeof s.theme.pressInk, s.id).toBe('string');
    }
  });

  it('custom background/surfaces: valid hex sticks, junk clears to skin default', () => {
    patchTheme({ bg: '#123456', surf1c: '#abcdef', surf2c: '' });
    let t = getTheme();
    expect(t.bg).toBe('#123456');
    expect(t.surf1c).toBe('#abcdef');
    expect(t.surf2c).toBe(''); // blank = derive from skin
    // invalid values are cleared, not stored — so the skin always shows through
    patchTheme({ bg: 'not-a-color', surf1c: '#zzz' });
    t = getTheme();
    expect(t.bg).toBe('');
    expect(t.surf1c).toBe('');
    // the Color tab exposes the pickers
    expect(customizePanel('color')).toContain('data-cz-bg');
  });

  it('the Look tab shows theme cards + the size slider (two-tier customize)', () => {
    const html = customizePanel('look');
    expect(html).toContain('data-mode="modern"'); // theme cards present
    expect(html).toContain('data-cz-num="scale"'); // interface-size slider present
    expect(html).toContain('vle-czt-sep'); // the Advanced divider exists
  });
});

describe('bond radar (futuristic render branch)', () => {
  const mkRel = (a: string, b: string, aff: number, trust: number): import('../src/domain/types.js').Relation => ({
    a, b, label: '', categories: ['social'], category: 'social', affection: aff, trust,
    sentiment: 'neutral', status: 'active', source: 'auto', userEdited: false,
    firstTurn: 1, lastTurn: 1, firstDay: 1, history: [], categoryHistory: [],
  });

  it('returns an <svg> for a known bond', () => {
    const s = freshState();
    const out = renderBondRadar(s, [mkRel('x', 'y', 62, -20), mkRel('y', 'x', 72, 40)]);
    expect(out).toContain('<svg');
    expect(out).toContain('vle-radar-a');
    expect(out).toContain('vle-radar-b');
  });

  it('returns "" for an empty group so the caller falls back to twin meters', () => {
    expect(renderBondRadar(freshState(), [])).toBe('');
  });
});

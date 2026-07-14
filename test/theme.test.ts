import { describe, it, expect, vi } from 'vitest';
import { MODES, SKINS, setMode, getTheme, patchTheme, customizePanel, resolveShape, sanitizeCardShapes, CHROME_SHAPES, SHAPE_IDS, SURFACES, setThemePersist, hydrateTheme, isLightSkin, safeFontUrl, familyFromFontUrl } from '../src/ui/theme.js';
import { renderBondRadar } from '../src/ui/theme-render.js';
import { freshState } from '../src/domain/types.js';

/**
 * Theme-system guards (Phase 1). These run in node (no DOM); theme.ts's
 * localStorage access is try/catch-guarded so import + the pure setters work.
 */

// every key a Mode patch or Skin theme may legally set
const THEME_KEYS = new Set([
  'skin', 'accent', 'accent2', 'accentIntensity', 'serif', 'mono', 'serifUrl', 'monoUrl', 'scale', 'dataScale',
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

  it('MODES are exactly the fourteen chromes', () => {
    expect(MODES.map((m) => m.id).sort()).toEqual(['arcade', 'bestiary', 'bloom', 'default', 'ember', 'faewild', 'futuristic', 'gatsby', 'graphite', 'grimoire', 'illuminated', 'modern', 'riot', 'sumi']);
  });

  it("each mode's dark + light skins exist", () => {
    for (const m of MODES) {
      expect(SKINS.some((s) => s.id === m.skinDark), `${m.id} dark ${m.skinDark}`).toBe(true);
      expect(SKINS.some((s) => s.id === m.skinLight), `${m.id} light ${m.skinLight}`).toBe(true);
    }
  });

  it('graphite chrome: mode, skins, shapes, and steel-blue accent resolve', () => {
    setMode('graphite');
    const t = getTheme();
    expect(t.chrome).toBe('graphite');
    expect(t.skin).toBe('graphite'); // dark default
    expect(t.accent.toLowerCase()).toBe('#5b8fb0');
    // its six surfaces map to the new engineer's-desk shapes
    expect(CHROME_SHAPES.graphite).toEqual({ present: 'rail-cap', bonds: 'spec-frame', cast: 'screw-tab', beats: 'gauge', factions: 'chamfer-bar', items: 'track' });
    // both skins exist and every new shape id is registered
    expect(SKINS.some((s) => s.id === 'graphite')).toBe(true);
    expect(SKINS.some((s) => s.id === 'graphite-light')).toBe(true);
    for (const id of ['rail-cap', 'gauge', 'screw-tab', 'track', 'spec-frame', 'chamfer-bar'] as const) {
      expect(SHAPE_IDS.includes(id), id).toBe(true);
    }
  });

  it('maximalist chromes: mode, paired skins, accent, shapes, and signature shape ids resolve', () => {
    const cases = [
      { id: 'arcade', skin: 'arcade-crt', light: 'arcade-sun', accent: '#ff2ea6',
        shapes: { present: 'arcade-btn', bonds: 'notched', cast: 'pixel-step', beats: 'coin-slot', factions: 'inset', items: 'bracket' },
        sig: ['arcade-btn', 'pixel-step', 'coin-slot'] },
      { id: 'riot', skin: 'riot-black', light: 'riot-paper', accent: '#e8ff2e',
        shapes: { present: 'taped', bonds: 'torn-edge', cast: 'stitch', beats: 'studs', factions: 'inset', items: 'ransom-cut' },
        sig: ['taped', 'torn-edge', 'ransom-cut'] },
      { id: 'grimoire', skin: 'grimoire-arcane', light: 'grimoire-parchment', accent: '#a24cff',
        shapes: { present: 'dropcap', bonds: 'sigil-seal', cast: 'tarot', beats: 'deckle', factions: 'rune-spine', items: 'gilt-edge' },
        sig: ['dropcap', 'sigil-seal', 'rune-spine'] },
      { id: 'bestiary', skin: 'bestiary-candlelit', light: 'bestiary-vellum', accent: '#c8a24e',
        shapes: { present: 'vine-frame', bonds: 'gilt-edge', cast: 'tarot', beats: 'scalloped', factions: 'heraldic-shield', items: 'manuscript-rule' },
        sig: ['vine-frame', 'heraldic-shield', 'manuscript-rule'] },
    ] as const;
    for (const c of cases) {
      setMode(c.id);
      const t = getTheme();
      expect(t.chrome, c.id).toBe(c.id);
      expect(t.skin, c.id).toBe(c.skin); // dark default
      expect(t.accent.toLowerCase(), c.id).toBe(c.accent);
      expect(SKINS.some((s) => s.id === c.skin), `${c.id} dark`).toBe(true);
      expect(SKINS.some((s) => s.id === c.light), `${c.id} light`).toBe(true);
      expect(CHROME_SHAPES[c.id], c.id).toEqual(c.shapes);
      for (const id of c.sig) expect(SHAPE_IDS.includes(id), `${c.id}:${id}`).toBe(true);
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
    expect(html).toContain('data-cz-tab="look"'); // rail items present
    expect(html).toContain('vle-cz-rail'); // rail container exists
  });

  it('the sidebar rail renders one nav item per CzTab', () => {
    const html = customizePanel('look');
    expect(html).toContain('vle-cz--sb'); // sidebar+canvas container
    expect(html).toContain('vle-cz-rail'); // the left nav rail
    for (const tab of ['look', 'skin', 'mode', 'layout', 'color', 'type', 'window', 'cards', 'sections']) {
      expect(html, tab).toContain(`data-cz-tab="${tab}"`);
    }
    // the active tab's rail item carries the .on marker
    expect(html).toContain('class="vle-cz-railitem on" data-cz-tab="look"');
  });
});

describe('skin grouping (light / dark)', () => {
  it('isLightSkin classifies known skins correctly', () => {
    const byId = (id: string) => SKINS.find((s) => s.id === id)!;
    // light-field skins (dark ink on a light surface)
    for (const id of ['parchment', 'daylit', 'graphite-light', 'blush', 'sumi-paper', 'gatsby-champagne']) {
      expect(isLightSkin(byId(id)), `${id} should be light`).toBe(true);
    }
    // dark-field skins (light ink on a dark surface)
    for (const id of ['illuminated', 'moonlit', 'graphite', 'sumi-ink', 'gatsby-noir', 'noir']) {
      expect(isLightSkin(byId(id)), `${id} should be dark`).toBe(false);
    }
  });

  it('every skin classifies without throwing (parse robustness)', () => {
    for (const s of SKINS) {
      expect(() => isLightSkin(s), s.id).not.toThrow();
      expect(typeof isLightSkin(s), s.id).toBe('boolean');
    }
  });

  it('the Skins tab splits into labelled Dark and Light groups', () => {
    const html = customizePanel('skin');
    expect(html).toContain('Dark skins');
    expect(html).toContain('Light skins');
    // both groups render skin swatch buttons with the unchanged data-skin wiring
    expect(html).toContain('data-skin="illuminated"'); // a dark skin
    expect(html).toContain('data-skin="parchment"');   // a light skin
  });
});

describe('card shapes (per-surface silhouette overrides)', () => {
  it('default theme has an empty cardShapes map (visually unchanged)', () => {
    setMode('default');
    expect(getTheme().cardShapes).toEqual({});
  });

  it('CHROME_SHAPES covers every chrome x every surface with a valid shape id', () => {
    for (const m of MODES) {
      const map = CHROME_SHAPES[m.id];
      expect(map, m.id).toBeTruthy();
      for (const surface of SURFACES) {
        expect(SHAPE_IDS.includes(map[surface]), `${m.id}.${surface}=${map[surface]}`).toBe(true);
      }
    }
  });

  it('CHROME_SHAPES uses only content-safe v4 shapes (no cut silhouettes)', () => {
    // rounds of review cut folio/hex/cameo/glass/gem/constellation/ticket then
    // ribbon/rule/arch/petal/chamfer; every chrome default must now be a survivor
    // or a v4 addition. default is left at the live look so the default theme
    // stays byte-identical.
    const CUT = new Set(['folio', 'hex', 'cameo', 'glass', 'gem', 'constellation', 'ticket', 'ribbon', 'rule', 'arch', 'petal', 'chamfer']);
    for (const [chrome, map] of Object.entries(CHROME_SHAPES)) {
      for (const [surface, id] of Object.entries(map)) {
        expect(SHAPE_IDS, `${chrome}.${surface}=${id}`).toContain(id);
        expect(CUT.has(id), `${chrome}.${surface} must not use a cut shape (${id})`).toBe(false);
      }
    }
    expect(CHROME_SHAPES.default).toEqual({ present: 'left-spine', bonds: 'split', cast: 'inset', beats: 'slab', factions: 'slab', items: 'slab' });
  });

  it('resolveShape: override wins, else falls back to the chrome default', () => {
    expect(resolveShape('present', 'ember', {})).toBe(CHROME_SHAPES.ember.present);
    expect(resolveShape('present', 'ember', { present: 'aperture' })).toBe('aperture');
    // an invalid override is ignored -> chrome default
    // @ts-expect-error deliberately bad shape id
    expect(resolveShape('present', 'default', { present: 'bogus' })).toBe(CHROME_SHAPES.default.present);
  });

  it('sanitizeCardShapes drops unknown surfaces and unknown shapes', () => {
    expect(sanitizeCardShapes({ present: 'tarot', xxx: 'slab', bonds: 'nope' })).toEqual({ present: 'tarot' });
    expect(sanitizeCardShapes(null)).toEqual({});
    expect(sanitizeCardShapes('junk')).toEqual({});
  });

  it('patchTheme sanitizes a bogus cardShapes map down to valid entries', () => {
    // @ts-expect-error feeding junk past the type
    patchTheme({ cardShapes: { present: 'bogus', zzz: 'slab', bonds: 'aperture' } });
    expect(getTheme().cardShapes).toEqual({ bonds: 'aperture' });
    patchTheme({ cardShapes: {} }); // reset for other tests
  });

  it('the Cards tab renders clickable shape tiles per surface with an Auto option', () => {
    const html = customizePanel('cards');
    // no <select> control remains — tiles replaced the dropdown
    expect(html).not.toContain('<select');
    // every surface gets a tile group with the unchanged data-cz-cardshape wiring
    for (const surface of SURFACES) expect(html, surface).toContain(`data-cz-cardshape="${surface}"`);
    // an Auto tile (empty data-shape clears the override) plus real shape tiles
    expect(html).toContain('data-shape=""');
    expect(html).toContain('Auto (');
    // each tile carries the real .v-shape--<id> geometry class for the preview
    for (const id of SHAPE_IDS) expect(html, id).toContain(`v-shape--${id}`);
    expect(html).toContain('vle-shape-tile');
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

describe('theme persistence (spindle.storage round-trip)', () => {
  it('hydrateTheme(null) is a no-op', () => {
    const before = JSON.stringify(getTheme());
    hydrateTheme(null);
    expect(JSON.stringify(getTheme())).toBe(before);
  });

  it('hydrateTheme(invalid JSON) is a no-op', () => {
    const before = JSON.stringify(getTheme());
    hydrateTheme('not valid json {{{');
    expect(JSON.stringify(getTheme())).toBe(before);
  });

  it('hydrateTheme(valid JSON) updates _theme', () => {
    hydrateTheme(JSON.stringify({ accent: '#123456', skin: 'noir' }));
    const t = getTheme();
    expect(t.accent).toBe('#123456');
    expect(t.skin).toBe('noir');
  });

  it('save() calls the registered persist callback with the theme JSON', () => {
    const spy = vi.fn();
    setThemePersist(spy);
    patchTheme({ accent: '#654321' });
    expect(spy).toHaveBeenCalled();
    const arg = spy.mock.calls![0]![0];
    expect(typeof arg).toBe('string');
    expect(JSON.parse(arg).accent).toBe('#654321');
  });
});

describe('custom Google Font URL (Customize → Type)', () => {
  it('safeFontUrl accepts only https fonts.googleapis.com links', () => {
    expect(safeFontUrl('https://fonts.googleapis.com/css2?family=Lora:wght@400;700')).toBe('https://fonts.googleapis.com/css2?family=Lora:wght@400;700');
    // rejected: wrong host, non-https, data:, javascript:, empty
    expect(safeFontUrl('https://evil.example/x.css')).toBe('');
    expect(safeFontUrl('http://fonts.googleapis.com/css2?family=Lora')).toBe('');
    expect(safeFontUrl('https://fonts.gstatic.com/s/lora.woff2')).toBe('');
    expect(safeFontUrl('data:text/css,body{}')).toBe('');
    expect(safeFontUrl('javascript:alert(1)')).toBe('');
    expect(safeFontUrl('')).toBe('');
    // a host-lookalike prefix must not slip through
    expect(safeFontUrl('https://fonts.googleapis.com.evil.example/x')).toBe('https://fonts.googleapis.com.evil.example/x'.startsWith('https://fonts.googleapis.com/') ? 'https://fonts.googleapis.com.evil.example/x' : '');
  });

  it('familyFromFontUrl extracts and normalizes the first family', () => {
    expect(familyFromFontUrl('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;1,700')).toBe('Playfair Display');
    expect(familyFromFontUrl('https://fonts.googleapis.com/css2?family=Lora&display=swap')).toBe('Lora');
    expect(familyFromFontUrl('https://fonts.googleapis.com/css2?display=swap')).toBe('');
  });

  it('sanitize keeps a valid font URL and drops a malicious one', () => {
    patchTheme({ serifUrl: 'https://fonts.googleapis.com/css2?family=Lora:wght@400;700', serif: "'Lora',Georgia,serif" });
    expect(getTheme().serifUrl).toBe('https://fonts.googleapis.com/css2?family=Lora:wght@400;700');
    patchTheme({ serifUrl: 'javascript:alert(1)' });
    expect(getTheme().serifUrl).toBe('');
    patchTheme({ serifUrl: '', monoUrl: '' }); // reset for other tests
  });

  it('hydrateTheme does not persist a non-Google font URL', () => {
    hydrateTheme(JSON.stringify({ accent: '#ffffff', serifUrl: 'https://evil.example/x.css' }));
    expect(getTheme().serifUrl).toBe('');
  });

  it('the Type tab exposes both font-URL inputs', () => {
    const html = customizePanel('type');
    expect(html).toContain('data-cz-fonturl');
    expect(html).toContain('data-cz-monourl');
  });
});

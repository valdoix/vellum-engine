import { describe, it, expect } from 'vitest';
import { SKINS } from '../src/ui/theme.js';
import { contrastRatio, flattenColor } from '../src/ui/format.js';

/**
 * Phase 5 — color discipline + WCAG contrast audit across every skin.
 *
 * Each skin declares its own surfaces (surf1/surf2/glass) and inks (primary
 * `ink`, muted `ink2`, plus the semantic *Ink text variants). This audit
 * flattens the (often translucent) surface over a dark base and asserts each
 * text role clears a WCAG 2.x threshold against it, so a new skin can't ship an
 * unreadable ink pairing. Primary body ink is held to AA (4.5:1); de-emphasised
 * roles (muted ink, small status text) to the 3:1 large-text / UI floor.
 *
 * These are contrast RATIOS computed from the declared hexes — not a substitute
 * for manual testing with assistive tech, but they catch the gross regressions.
 */

// representative opaque backdrop the translucent surfaces composite over (matches
// the darkest chrome fill; light skins declare near-opaque surfaces so the base
// barely matters for them).
const BASE = '#0c0a08';

const AA = 4.5;   // normal body text
const UI = 3.0;   // large text / de-emphasised UI (WCAG 1.4.11 / 1.4.3 large)

describe('skin contrast audit (WCAG)', () => {
  for (const skin of SKINS) {
    const t = skin.theme as Record<string, string>;
    // the surface a card/panel actually paints on: surf1 over the glass over base
    const glass = flattenColor(t.glass ?? '', BASE);
    const surface = flattenColor(t.surf1 ?? '', glass);

    it(`${skin.id}: primary ink is AA on its surface`, () => {
      const ratio = contrastRatio(flattenColor(t.ink ?? '', surface), surface);
      expect(ratio, `${skin.id} ink ${t.ink} on ${surface} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);
    });

    it(`${skin.id}: muted ink clears the UI floor`, () => {
      const ratio = contrastRatio(flattenColor(t.ink2 ?? '', surface), surface);
      expect(ratio, `${skin.id} ink2 ${t.ink2} on ${surface} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(UI);
    });

    // the *Ink semantic variants are the ones used as TEXT (posInk/negInk/…);
    // they must at least clear the large-text/UI floor on the surface.
    for (const key of ['posInk', 'negInk', 'pressInk'] as const) {
      const val = t[key];
      if (!val) continue;
      it(`${skin.id}: ${key} clears the UI floor`, () => {
        const ratio = contrastRatio(flattenColor(val, surface), surface);
        expect(ratio, `${skin.id} ${key} ${val} on ${surface} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(UI);
      });
    }
  }
});

import { describe, it, expect } from 'vitest';
import { shapeOrnament, scarSeam } from '../src/ui/ornament.js';
import { SHAPE_IDS, SURFACES } from '../src/ui/theme.js';

/**
 * Ornament layer guards. shapeOrnament must return a small self-contained
 * snippet for shapes that carry an SVG detail and '' otherwise, and everything
 * it emits must be default-safe: no inline animation (motion lives in CSS behind
 * --vmotion), no `--` inside SVG (would break XML parsing), always non-interactive.
 */

const HAS_ORNAMENT = new Set(['folio', 'gem', 'constellation']);

describe('shapeOrnament', () => {
  it('returns a snippet only for shapes with a drawn SVG detail', () => {
    for (const id of SHAPE_IDS) {
      const out = shapeOrnament(id, 'present');
      if (HAS_ORNAMENT.has(id)) {
        expect(out, id).toContain('<svg');
        expect(out, id).toContain('v-ornlayer');
      } else {
        expect(out, id).toBe('');
      }
    }
  });

  it("returns '' for a null shape (default chrome emits no attribute -> no markup)", () => {
    for (const surface of SURFACES) expect(shapeOrnament(null, surface)).toBe('');
  });

  it('emits nothing interactive and no inline animation', () => {
    for (const id of SHAPE_IDS) {
      const out = shapeOrnament(id, 'cast');
      expect(out).not.toMatch(/onclick|onload|<script/i);
      expect(out).not.toMatch(/\banimation\s*:/i); // motion is CSS-gated, never inline
    }
  });

  it('never contains a double-hyphen inside SVG markup (valid XML)', () => {
    for (const id of SHAPE_IDS) {
      const out = shapeOrnament(id, 'bonds');
      if (!out) continue;
      // class tokens like v-fold-back are fine; guard specifically against `<!--`
      expect(out).not.toContain('<!--');
    }
    expect(scarSeam(false)).not.toContain('<!--');
  });

  it('is marked aria-hidden and pointer-inert via the layer class', () => {
    const out = shapeOrnament('folio', 'present');
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('v-ornlayer');
  });
});

describe('scarSeam', () => {
  it('draws a seam path; healing variant adds the healing modifier', () => {
    const open = scarSeam(false);
    const healing = scarSeam(true);
    expect(open).toContain('<svg');
    expect(open).toContain('v-scar');
    expect(open).not.toContain('v-scar--healing');
    expect(healing).toContain('v-scar--healing');
  });
});

import { describe, it, expect } from 'vitest';
import { shapeOrnament } from '../src/ui/ornament.js';
import { SHAPE_IDS, SURFACES } from '../src/ui/theme.js';

/**
 * Ornament layer guards. v3: every surviving silhouette carries its detail as a
 * pure-CSS pseudo-element (see shapeDetail() in styles.ts), so shapeOrnament()
 * appends no markup and always returns ''. The big jagged scar "seam" SVG was
 * cut in the review (only the belief strikethrough is kept). This test locks in
 * the no-op contract so a renderer can keep calling shapeOrnament() safely.
 */

describe('shapeOrnament', () => {
  it("returns '' for every shape id (details are pure CSS now)", () => {
    for (const id of SHAPE_IDS) {
      for (const surface of SURFACES) {
        expect(shapeOrnament(id, surface), `${id}/${surface}`).toBe('');
      }
    }
  });

  it("returns '' for a null shape (default chrome emits no attribute -> no markup)", () => {
    for (const surface of SURFACES) expect(shapeOrnament(null, surface)).toBe('');
  });
});

/**
 * Card-shape ornament hooks.
 *
 * v3: after the shape review, EVERY surviving silhouette carries its defining
 * detail as a pure-CSS pseudo-element keyed off the `data-shape-<surface>`
 * attribute (see the shapeDetail() rules in styles.ts) — the corner brackets,
 * top ribbon, arch keyline, base rule, leaf spark, torn deckle and inset frame
 * all live in the card's reserved padding so they never clip content. There is
 * therefore no per-card SVG markup to append anymore, and the big jagged scar
 * "seam" (the full-width zig-zag on the Scars section) was cut in the review —
 * the individual belief strikethrough (.vle-scar-was in styles.ts) is kept.
 *
 * shapeOrnament() is retained as a no-op so the (many) renderer call sites don't
 * need to change; it always returns '' now. It is PRESENTATION ONLY and pure.
 */
import type { ShapeId, Surface } from './theme.js';

/**
 * Formerly appended an inline-SVG detail for a shape; all shape details are now
 * pure CSS (styles.ts), so this returns nothing. Kept so renderers can keep the
 * `shapeOrnament(activeShape(surface), surface)` call without churn.
 */
export function shapeOrnament(_shape: ShapeId | null, _surface: Surface): string {
  return '';
}

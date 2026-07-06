/**
 * Card-shape ORNAMENT layer (mockups 30-35). A silhouette is more than a corner
 * radius: every gallery card layers a defining detail on top of its outline
 * (folio dog-ear fold, gem facet lines, ticket tear, futuristic reticle,
 * ember constellation, chronicle scar seam). This module returns that detail as
 * a small, self-contained HTML/SVG snippet a renderer appends ONCE inside a card
 * root. Everything here is:
 *   - PRESENTATION ONLY (no state, no engine) and pure given its inputs;
 *   - absolutely positioned + pointer-events:none (see .v-ornlayer in styles.ts);
 *   - default-safe: renderers gate on activeShape(surface) which is null on the
 *     default chrome, so the default theme emits NO ornament markup;
 *   - motion-safe: no inline animation; any motion lives in CSS behind --vmotion.
 *
 * Inline SVG is used where a pseudo-element cannot draw the form (folds, facets,
 * arcs, jagged seams). Simpler details (accent bar, reticle ticks, tear line,
 * inner frame, cameo/tarot avatar reshape) are pure CSS keyed off the same
 * data-shape-<surface> attribute and live in styles.ts instead.
 *
 * SVGs inherit color via currentColor / the --vg accent token and use
 * vector-effect:non-scaling-stroke so strokes stay crisp under clip-path cards.
 * XML comments must never contain `--` (breaks the SVG parser); we use none.
 */
import type { ShapeId, Surface } from './theme.js';

// wrap a snippet in the shared, non-interactive ornament layer
const layer = (inner: string, extra = ''): string =>
  `<span class="v-ornlayer${extra}" aria-hidden="true">${inner}</span>`;

// a full-bleed SVG that scales to the card via preserveAspectRatio=none
const svg = (body: string, cls = ''): string =>
  `<svg class="v-ornsvg${cls}" viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">${body}</svg>`;

/**
 * The ornament for a given resolved shape on a given surface, or '' when the
 * shape carries its detail purely in CSS (slab/left-spine/hex/cameo/etc.).
 * Callers pass the ACTIVE shape (see activeShape) so default chrome -> no call.
 */
export function shapeOrnament(shape: ShapeId | null, _surface: Surface): string {
  switch (shape) {
    case 'folio':
      // a turned page: a triangular dog-ear fold in the top-right corner with a
      // soft shadow crease. Two paths: the lifted corner + the crease line.
      return layer(svg(
        '<path class="v-fold-back" d="M100 0 L100 14 L86 0 Z"/>' +
        '<path class="v-fold-crease" d="M86 0 L100 14" vector-effect="non-scaling-stroke"/>',
        ' v-ornsvg--folio',
      ));
    case 'gem':
      // internal facet lines echoing the octagon clip, for a cut-stone read.
      return layer(svg(
        '<path class="v-facet" vector-effect="non-scaling-stroke" d="M50 2 L86 14 M50 2 L14 14 ' +
        'M98 50 L86 14 M98 50 L86 86 M50 98 L86 86 M50 98 L14 86 M2 50 L14 86 M2 50 L14 14 ' +
        'M50 2 L50 98 M2 50 L98 50"/>',
        ' v-ornsvg--gem',
      ));
    case 'constellation':
      // ember bonds: a dotted arc strung with star nodes, drawn across the card.
      return layer(svg(
        '<path class="v-const-arc" vector-effect="non-scaling-stroke" fill="none" ' +
        'd="M8 78 Q30 20 50 40 T92 22"/>' +
        '<g class="v-const-star">' +
        '<circle cx="8" cy="78" r="2.2"/><circle cx="50" cy="40" r="2.6"/>' +
        '<circle cx="72" cy="30" r="1.8"/><circle cx="92" cy="22" r="2.2"/>' +
        '</g>',
        ' v-ornsvg--const',
      ));
    default:
      return '';
  }
}

/**
 * Chronicle scar seam (mockup 21): a jagged polyline torn across the card,
 * solid for an OPEN scar and dotted+fading for a HEALING one. Surface-agnostic
 * helper the chronicle renderer calls directly (state -> presentation only).
 */
export function scarSeam(healing: boolean): string {
  return layer(svg(
    `<path class="v-scar${healing ? ' v-scar--healing' : ''}" fill="none" ` +
    'vector-effect="non-scaling-stroke" ' +
    'd="M0 62 L14 54 L26 66 L40 50 L54 64 L68 48 L82 62 L100 52"/>',
    ' v-ornsvg--scar',
  ));
}
